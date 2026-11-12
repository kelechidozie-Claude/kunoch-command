import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

/* kc-bridge — single server endpoint for Kunoch Command v4.
 *
 * verify_jwt is ON, and every request is additionally checked against the
 * owner account, so a stranger who signs up with the public anon key gets nothing.
 *
 * Actions (POST JSON { action, ... }):
 *   feed          → calendar meetings + open tasks from Portfolio Command (Nigeria)
 *   tasks_create  → file debrief actions as Portfolio Command tasks
 *   chat          → streamed adviser reply (Anthropic key stays server-side)
 *   email         → send a briefing PDF by email (Resend)
 *
 * All third-party secrets live in app_config or function secrets; none reach the browser.
 */

const CORS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (o: unknown, s = 200) =>
  new Response(JSON.stringify(o), { status: s, headers: { ...CORS, "Content-Type": "application/json" } });
const fail = (message: string, s = 400) => json({ error: { message } }, s);

const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

const MODELS = new Set(["claude-sonnet-5-5", "claude-fable-5-2", "claude-haiku-5-5", "claude-sonnet-4-6"]);

async function cfg(keys: string[]): Promise<Record<string, string>> {
  const { data, error } = await admin.from("app_config").select("key, value").in("key", keys);
  if (error) throw new Error("config read failed: " + error.message);
  const out: Record<string, string> = {};
  for (const r of data ?? []) out[r.key] = r.value;
  return out;
}

async function pcRpc(url: string, key: string, fn: string, args: Record<string, unknown>) {
  const res = await fetch(`${url}/rest/v1/rpc/${fn}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", apikey: key, Authorization: `Bearer ${key}` },
    body: JSON.stringify(args),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`Portfolio Command ${fn} failed (${res.status}): ${text.slice(0, 200)}`);
  return text ? JSON.parse(text) : null;
}

/* The owner is app_config.owner_user_id when set; otherwise the first account ever
 * created on this project (the founder's). Later sign-ups are never the owner. */
let ownerCache: string | null = null;
async function ownerId(): Promise<string | null> {
  if (ownerCache) return ownerCache;
  const c = await cfg(["owner_user_id"]);
  if (c.owner_user_id) return (ownerCache = c.owner_user_id);
  const { data } = await admin.auth.admin.listUsers({ page: 1, perPage: 200 });
  const first = (data?.users ?? []).slice().sort((a, b) => (a.created_at < b.created_at ? -1 : 1))[0];
  return (ownerCache = first?.id ?? null);
}

const str = (v: unknown, max: number) => (typeof v === "string" ? v.trim().slice(0, max) : "");

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return fail("method_not_allowed", 405);

  // ── who is calling ────────────────────────────────────────────────
  const token = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
  const { data: u, error: uErr } = await admin.auth.getUser(token);
  if (uErr || !u?.user) return fail("not signed in", 401);
  if (u.user.id !== (await ownerId())) return fail("this account is not authorised for Kunoch Command", 403);

  let body: any;
  try { body = await req.json(); } catch { return fail("invalid JSON body"); }
  const action = body?.action;

  try {
    // ── calendar meetings + open tasks ──────────────────────────────
    if (action === "feed") {
      const c = await cfg(["pc_bridge_ng_url", "pc_bridge_ng_key", "pc_bridge_ng_secret"]);
      if (!c.pc_bridge_ng_url || !c.pc_bridge_ng_key || !c.pc_bridge_ng_secret) return fail("Portfolio Command bridge is not configured", 500);
      const feed = await pcRpc(c.pc_bridge_ng_url, c.pc_bridge_ng_key, "kunoch_meetings", {
        p_secret: c.pc_bridge_ng_secret,
        p_days_back: Number(body.days_back ?? 7),
        p_days_fwd: Number(body.days_fwd ?? 7),
      });
      return json(feed);
    }

    // ── file debrief actions as tasks ───────────────────────────────
    if (action === "tasks_create") {
      const items = Array.isArray(body.items) ? body.items.slice(0, 15) : [];
      if (!items.length) return fail("no tasks supplied");
      const c = await cfg(["sentinel_portfolio_url", "sentinel_portfolio_key", "sentinel_portfolio_secret"]);
      if (!c.sentinel_portfolio_url || !c.sentinel_portfolio_key || !c.sentinel_portfolio_secret) return fail("task bridge is not configured", 500);
      const results: unknown[] = [];
      for (const it of items) {
        const title = str(it.title, 200);
        const business = str(it.business, 80);
        if (!title || !business) { results.push({ ok: false, title, error: "title and business are required" }); continue; }
        const due = /^\d{4}-\d{2}-\d{2}$/.test(it.due || "") ? it.due : null;
        const priority = ["low", "med", "high"].includes(it.priority) ? it.priority : "med";
        try {
          const r = await pcRpc(c.sentinel_portfolio_url, c.sentinel_portfolio_key, "sentinel_create_task", {
            p_secret: c.sentinel_portfolio_secret, p_business: business, p_title: title, p_due: due,
            p_assigned: str(it.assigned, 80) || null, p_priority: priority, p_description: str(it.description, 1000) || null,
          });
          results.push(r);
        } catch (e) { results.push({ ok: false, title, error: String((e as Error).message || e) }); }
      }
      return json({ results });
    }

    // ── adviser chat (streamed) ─────────────────────────────────────
    if (action === "chat") {
      const key = Deno.env.get("ANTHROPIC_API_KEY");
      if (!key) return fail("Server is missing ANTHROPIC_API_KEY", 500);
      const model = MODELS.has(body.model) ? body.model : "claude-sonnet-5-5";
      const max_tokens = Math.min(Math.max(Number(body.max_tokens) || 1500, 64), 8000);
      if (!Array.isArray(body.messages) || !body.messages.length) return fail("messages are required");
      const upstream = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-api-key": key, "anthropic-version": "2023-06-01" },
        body: JSON.stringify({ model, max_tokens, system: body.system, messages: body.messages, stream: body.stream !== false }),
      });
      if (!upstream.ok || body.stream === false) {
        const text = await upstream.text();
        const extra: Record<string, string> = {};
        const ra = upstream.headers.get("retry-after");
        if (ra) extra["retry-after"] = ra;
        return new Response(text, { status: upstream.status, headers: { ...CORS, "Content-Type": "application/json", ...extra } });
      }
      return new Response(upstream.body, {
        status: 200,
        headers: { ...CORS, "Content-Type": "text/event-stream", "Cache-Control": "no-cache", "X-Accel-Buffering": "no" },
      });
    }

    // ── email a briefing PDF ────────────────────────────────────────
    if (action === "email") {
      const rk = Deno.env.get("RESEND_API_KEY");
      if (!rk) return fail("Email is not set up on the server (RESEND_API_KEY missing). Use Download instead.", 500);
      const to = (Array.isArray(body.to) ? body.to : [body.to]).map((x: unknown) => str(x, 120)).filter((x: string) => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(x)).slice(0, 5);
      if (!to.length) return fail("a valid recipient email is required");
      const b64 = str(body.pdf_base64, 8_000_000);
      if (!b64) return fail("no PDF attached");
      const c = await cfg(["review_email_from"]);
      const from = `Insight360 Advisory <${c.review_email_from || "no-reply@mail.insight360.biz"}>`;
      const res = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${rk}` },
        body: JSON.stringify({
          from, to, reply_to: u.user.email,
          subject: str(body.subject, 160) || "Insight360 briefing",
          text: str(body.message, 4000) || "Please find the briefing attached.",
          attachments: [{ filename: str(body.filename, 120) || "Insight360-Briefing.pdf", content: b64 }],
        }),
      });
      const text = await res.text();
      if (!res.ok) return fail("Email provider rejected the message: " + text.slice(0, 200), 502);
      await admin.from("audit_log").insert({ user_id: u.user.id, action: "briefing.emailed", entity: "briefing", entity_id: str(body.briefing_id, 80), detail: { to, subject: str(body.subject, 160) } });
      return json({ ok: true });
    }

    return fail("unknown action");
  } catch (e) {
    return fail(String((e as Error).message || e), 502);
  }
});
