import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const ANTHROPIC_API_KEY = Deno.env.get('ANTHROPIC_API_KEY')!
const RESEND_API_KEY = Deno.env.get('RESEND_API_KEY') || ''

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)

const WEEKLY_SYSTEM = `You are Fredrick, Chief of Staff to the Group CEO of Kunoch Family Office.
Write a weekly portfolio intelligence brief based on the meeting data provided.

Output format (Markdown):
# WEEKLY PORTFOLIO BRIEF — [BUSINESS NAME]
## 1. STATE OF PLAY
[2-3 sentences on meeting cadence, sentiment, key themes]
## 2. DECISIONS THIS WEEK
[Bullet list with decision maker where known]
## 3. ACTION ITEMS
[Table: Task | Owner | Due | Status]
## 4. OPEN QUESTIONS
[Bullet list with recommended owner to resolve]
## 5. FLAGS & RISKS
[Red / Yellow / Green classification with rationale]
## 6. NEXT WEEK PRIORITIES
[3 specific, time-bound items]

If the input carries an "ops" object (live snapshot from Portfolio Command —
open/overdue task counts, active projects, top overdue items), ground the
brief in it: cite the real numbers in STATE OF PLAY, surface overdue items in
FLAGS & RISKS, and make at least one NEXT WEEK priority address the oldest
overdue item. Never invent operational numbers not present in the data.

Tone: investor-grade, numbers over opinions, USD/NGN/GBP clarity where relevant.
Max 500 words.`

async function callClaude(system: string, content: string) {
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: 'claude-sonnet-4-6',
      max_tokens: 4096,
      system,
      messages: [{ role: 'user', content }],
    }),
  })
  if (!res.ok) throw new Error(`Claude error ${res.status}: ${await res.text()}`)
  const data = await res.json()
  // Scan for the first text block (thinking-capable models put a thinking block first)
  if (data.content && data.content.length) {
    for (const bl of data.content) { if (bl && bl.type === 'text' && bl.text) return bl.text }
  }
  return ''
}

/* ── Portfolio Command bridge (ops snapshot) ─────────────────────────
 * Both Portfolio Command instances expose kunoch_ops_snapshot(p_secret) —
 * a secret-gated SECURITY DEFINER RPC (same pattern as sentinel_digest).
 * URLs / anon keys / secrets live in this project's app_config. Failures
 * degrade silently: reviews still generate without ops data. */

interface OpsRow {
  business: string; open_tasks: number; overdue: number; due_7d: number;
  active_projects: number; last_activity: string | null;
  top_overdue: { title: string; due: string; priority: string }[];
}

function normName(s: string): string {
  return (s || '').toLowerCase().replace(/[^a-z0-9]/g, '')
}

async function fetchOpsSnapshots(): Promise<OpsRow[]> {
  const { data: cfgRows } = await supabase
    .from('app_config').select('key, value')
    .in('key', ['pc_bridge_ng_url','pc_bridge_ng_key','pc_bridge_ng_secret',
                'pc_bridge_lr_url','pc_bridge_lr_key','pc_bridge_lr_secret'])
  const cfg: Record<string, string> = {}
  for (const r of cfgRows || []) cfg[r.key] = r.value
  const instances = [
    { url: cfg.pc_bridge_ng_url, key: cfg.pc_bridge_ng_key, secret: cfg.pc_bridge_ng_secret },
    { url: cfg.pc_bridge_lr_url, key: cfg.pc_bridge_lr_key, secret: cfg.pc_bridge_lr_secret },
  ]
  const rows: OpsRow[] = []
  for (const inst of instances) {
    if (!inst.url || !inst.key || !inst.secret) continue
    try {
      const res = await fetch(`${inst.url}/rest/v1/rpc/kunoch_ops_snapshot`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'apikey': inst.key, 'Authorization': `Bearer ${inst.key}` },
        body: JSON.stringify({ p_secret: inst.secret }),
      })
      if (!res.ok) continue
      const j = await res.json()
      for (const b of (j && j.businesses) || []) rows.push(b as OpsRow)
    } catch (_e) { /* bridge down — reviews proceed without ops */ }
  }
  return rows
}

/** Match a Kunoch business to its Portfolio Command row by normalized name
 * (containment either way covers "IFTA" vs "IFTA Farms", "D4ULogistics" vs
 * "D4U Logistics"). */
function opsFor(rows: OpsRow[], kunochName: string): OpsRow | null {
  const target = normName(kunochName)
  if (!target) return null
  for (const r of rows) {
    const n = normName(r.business)
    if (n === target || n.includes(target) || target.includes(n)) return r
  }
  return null
}

function mdToBasicHtml(md: string) {
  const esc = md.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  return esc.split('\n').map((l) => {
    const t = l.trim()
    if (t.startsWith('# ')) return `<h2 style="font-family:Georgia,serif;color:#9A7830;margin:14px 0 8px">${t.slice(2)}</h2>`
    if (t.startsWith('## ')) return `<h3 style="color:#1A1D24;margin:12px 0 6px">${t.slice(3)}</h3>`
    if (t.startsWith('- ') || t.startsWith('* ')) return `<div style="margin:2px 0 2px 14px">&rsaquo; ${t.slice(2)}</div>`
    if (!t) return '<div style="height:6px"></div>'
    return `<div style="margin:2px 0">${t}</div>`
  }).join('').replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
}

async function sendReviewEmail(to: string, bizName: string, synthesis: string, from: string) {
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${RESEND_API_KEY}` },
    body: JSON.stringify({
      from: `Kunoch Command <${from}>`,
      to: [to],
      subject: `Weekly Review — ${bizName} · ${new Date().toLocaleDateString('en-GB', { day: '2-digit', month: 'short' })}`,
      html: `<div style="font-family:Arial,Helvetica,sans-serif;color:#23272F;max-width:640px;margin:0 auto;padding:18px">
        <div style="border-bottom:2px solid #9A7830;padding-bottom:10px;margin-bottom:16px">
          <div style="font-family:Georgia,serif;font-size:22px;color:#9A7830;font-weight:700">Kunoch Command</div>
          <div style="font-size:10px;color:#9AA0AB;letter-spacing:2px">FAMILY OFFICE · EXECUTIVE INTELLIGENCE · CONFIDENTIAL</div>
        </div>
        ${mdToBasicHtml(synthesis)}
        <div style="border-top:1px solid #EAEAEA;margin-top:18px;padding-top:8px;font-size:10px;color:#BFC4CC;letter-spacing:1px">KUNOCH COMMAND · ${bizName.toUpperCase()} · This review is also readable in-app under MEETINGS.</div>
      </div>`,
    }),
  })
  if (!res.ok) throw new Error(`Resend ${res.status}: ${(await res.text()).slice(0, 200)}`)
}

Deno.serve(async (_req) => {
  const { data: businesses, error: bizErr } = await supabase
    .from('businesses')
    .select('user_id, biz_id, data')
    .contains('data', { auto_review: true })

  if (bizErr) {
    return new Response(JSON.stringify({ error: bizErr.message }), { status: 500 })
  }

  // sender address for email delivery (optional)
  let emailFrom = ''
  try {
    const { data: cfg } = await supabase.from('app_config').select('value').eq('key', 'review_email_from').maybeSingle()
    emailFrom = (cfg && cfg.value) || ''
  } catch (_e) { /* email disabled */ }

  const results: string[] = []
  const userEmailCache: Record<string, string> = {}
  const opsRows = await fetchOpsSnapshots()

  for (const biz of businesses || []) {
    const bizData = biz.data || {}
    if (!bizData.auto_review) continue

    const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString()
    const { data: meetings } = await supabase
      .from('meetings')
      .select('*')
      .eq('user_id', biz.user_id)
      .eq('biz_id', biz.biz_id)
      .gte('created_at', since)
      .order('created_at', { ascending: false })

    const context = {
      business: {
        name: bizData.name,
        stage: bizData.stage,
        positioning: bizData.positioning,
        priorities: [bizData.p1, bizData.p2, bizData.p3].filter(Boolean),
      },
      ops: opsFor(opsRows, bizData.name || biz.biz_id),
      meetings: (meetings || []).map((m: any) => {
        const d = m.data || m
        return {
          title: d.title,
          date: d.meeting_date,
          decisions: d.decisions || [],
          action_items: d.action_items || [],
          open_questions: d.open_questions || [],
          flags: d.flags || [],
          summary: d.summary || '',
        }
      }),
    }

    try {
      const synthesis = await callClaude(WEEKLY_SYSTEM, JSON.stringify(context))

      const runId = `auto_${biz.biz_id}_${Date.now().toString(36)}`
      const record = {
        id: runId,
        task: `Weekly portfolio review — ${new Date().toLocaleDateString('en-GB')}`,
        summary: `Automated weekly review for ${bizData.name}`,
        agents: [],
        briefs: {},
        outputs: {},
        synthesis,
        kind: 'auto_review',
        date: new Date().toLocaleDateString('en-GB', { day: '2-digit', month: 'short' }),
        time: new Date().toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }),
      }
      const { error: insErr } = await supabase.from('runs').insert({
        user_id: biz.user_id,
        run_id: runId,
        biz_id: biz.biz_id,
        data: record,
      })
      if (insErr) throw new Error(`store failed: ${insErr.message}`)

      await supabase.from('audit_log').insert({
        user_id: biz.user_id, action: 'auto_review.generated', entity: 'run', entity_id: runId,
        detail: { biz: biz.biz_id, meetings: context.meetings.length },
      })

      let emailNote = ''
      if (bizData.auto_review_email && RESEND_API_KEY && emailFrom) {
        try {
          if (!userEmailCache[biz.user_id]) {
            const { data: u } = await supabase.auth.admin.getUserById(biz.user_id)
            userEmailCache[biz.user_id] = (u && u.user && u.user.email) || ''
          }
          const to = userEmailCache[biz.user_id]
          if (to) {
            await sendReviewEmail(to, bizData.name || biz.biz_id, synthesis, emailFrom)
            emailNote = ' · emailed'
            await supabase.from('audit_log').insert({ user_id: biz.user_id, action: 'auto_review.emailed', entity: 'run', entity_id: runId, detail: { to } })
          } else emailNote = ' · email skipped (no address)'
        } catch (e: any) {
          emailNote = ` · email failed: ${e.message}`
          await supabase.from('audit_log').insert({ user_id: biz.user_id, action: 'auto_review.email_failed', entity: 'run', entity_id: runId, detail: { error: String(e.message).slice(0, 200) } })
        }
      } else if (bizData.auto_review_email) {
        emailNote = ' · email skipped (RESEND_API_KEY or review_email_from not configured)'
      }

      results.push(`${bizData.name}: generated${emailNote}`)
    } catch (e: any) {
      results.push(`${bizData.name}: error — ${e.message}`)
    }
  }

  return new Response(JSON.stringify({ success: true, results, generatedAt: new Date().toISOString() }), {
    headers: { 'Content-Type': 'application/json' },
  })
})
