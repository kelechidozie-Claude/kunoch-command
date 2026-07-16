# KUNOCH COMMAND — ENGINEERING HANDOFF BRIEF
# Owner: Kelechi Dozie · Group CEO, Kunoch Family Office
# This file is the single source of truth for the build. Read fully before acting.

## WHAT THIS IS
Kunoch Command is a single-file HTML multi-agent advisory app (index.html in this folder).
- Orchestrator agent "Fredrick" (Chief of Staff) plans tasks, delegates to 7 specialists
  (cfo, legal, ma, ppp, board, tech, research), then writes an executive synthesis.
- Calls the Anthropic API directly from the browser (key stored in localStorage: kc_api_key).
- Per-business workspaces: 10 businesses (Cirquu, IFTA Farms, Hertunba, Insight360,
  Disrupt DNA, Kunoch Foods, Iamloyal Africa, Getabar, D4ULogistics, LID Stores).
  Active business profile + brand spec is injected into every agent call.
- Hosted on GitHub Pages: https://kelechidozie-claude.github.io/kunoch-command/
  Repo: github.com/kelechidozie-Claude/kunoch-command (this folder is a clone; push to main deploys).
- Git push uses osxkeychain credentials. If push fails with auth error, stop and tell Kelechi.

## DESIGN SYSTEM (preserve exactly)
- Dark theme: bg #08090D, surface #0E1018, gold #C9A84C accents.
- Fonts: Playfair Display (headings), DM Mono (labels), DM Sans (body).
- Board-level tone everywhere. No emoji in UI.

## CURRENT STATE OF index.html IN THIS FOLDER
The repo copy is one generation behind the finished V3.1. It already has: business
switcher + profile/brand modal, context injection, markdown rendering (mdToHtml),
redesigned PDF export, readability CSS. It is MISSING the V3.1 items specified below.
manifest.json and sw.js already exist in this folder (written tonight). Icons are missing.

## IMMEDIATE TASK — SHIP V3.1 (do this first, end-to-end)
Shortcut: if /Users/kelechidozie/Downloads/index.html exists AND its sha256 is
3cfc74beb31455fab8846000dbc274efb3e920f97b114e97fbcd5e9bd105549a, it is the finished
V3.1 — copy it over index.html here and skip to step 9. Otherwise implement steps 1-8
on the existing index.html:

1. MODELS: add near the API code:
   var MODELS={orchestrator:'claude-fable-5',specialist:'claude-sonnet-4-6'};
   var TOKENS={plan:2048,specialist:4096,synthesis:8192};
   callAPI(system,content,attempt,model,maxTok) — model/maxTok default to specialist values.
   Fredrick planning + synthesis calls pass MODELS.orchestrator with TOKENS.plan / TOKENS.synthesis.
   Specialist calls use defaults. Replace the hardcoded claude-sonnet-4-20250514.

2. RATE-LIMIT RESILIENCE in callAPI:
   - HTTP 429: retry up to 5 times; honor retry-after header (seconds) + 250ms, else
     exponential backoff min(1500 * 1.7^(attempt-1), 12000)ms.
   - HTTP 529/500/503: retry up to 4 times, min(2000*attempt, 10000)ms.
   - Pass model/maxTok through the retry recursion.

3. STAGGERED DISPATCH: in runWithPlan, launch each specialist i*600ms apart
   (setTimeout wrapper per agent) so parallel calls do not spike the per-minute limit.
   They still run concurrently once launched; Promise.all semantics preserved.

4. FRIENDLY ERRORS: friendlyError(msg) maps raw API errors to plain guidance:
   rate_limit/429 -> wait ~30s + RETRY or raise tier; 529 -> servers overloaded, retry;
   401 -> key rejected, check sidebar + billing; 402/credit -> add credits.
   Agent cards render friendlyError(out) when status is error; raw text stays in lastOutputs.

5. FULL-RUN HISTORY (localStorage key kc_history_v3, per business id):
   Each run saves {id:'run_'+Date.now().toString(36), task, summary, agents (array),
   briefs (obj), outputs (obj), synthesis, time, date}. Cap 8 runs per business.
   Quota-safe write: on setItem exception, trim oldest run from every business (min 2 kept)
   and retry up to 6 times; if still failing, showErr advising EXPORT DATA.
   History items with outputs show an "OPEN >" marker; clicking calls openRun(h) which:
   resetAll(), restores task/lastTask/lastSummary/lastAgents/lastBriefs/lastOutputs/
   lastSynthesis/currentPlan, setFredrick('done',...), showAgentCard('done') per agent,
   renders synthesis via mdToHtml, shows results + reset + pdf buttons,
   setPhase('ARCHIVED RUN · date time','var(--board)'), scrolls to results.

6. EXPORT / IMPORT: two small buttons under the API panel in the sidebar footer
   (#backup-row, .bk-btn styling consistent with theme).
   exportData(): downloads kunoch-backup-YYYY-MM-DD.json containing
   {v:3, exported, businesses, active, history}. NEVER include kc_api_key.
   importData(): file input; validates businesses array; confirm() warning that it
   REPLACES local data; writes the three keys; reloads businesses/UI/history.

7. RUN BUTTON DISCIPLINE FIX: updateRunBtn() sets the run button text to
   "▶ ISSUE — {ACTIVE BUSINESS NAME UPPERCASE}". Call it on load, on business switch,
   and in doneState instead of the static "▶ ISSUE DIRECTIVE" string.

8. PWA: in <head> add manifest link (./manifest.json), theme-color #08090D,
   apple-mobile-web-app-capable, apple-mobile-web-app-title "Kunoch",
   apple-touch-icon ./icon-192.png. In window.onload register ./sw.js (try/catch).
   Generate icon-192.png and icon-512.png: #08090D background, rounded gold
   (#C9A84C) border ring at 6% margin, centered bold serif "K" in gold at ~52% height.
   Python3 + Pillow if available (pip3 install --user pillow), else any equivalent method.

8b. READABILITY PASS — apply in BOTH paths (also on the sha-verified downloaded file;
   its checksum no longer needs to match after this edit):
   Kelechi reports the colour scheme is hard to read. Keep the dark-gold identity but
   raise contrast and minimum sizes:
   - :root token changes: --text #E2E6F0 -> #EDF0F7; --text-dim #8892A4 -> #B4BCCB;
     --text-muted #374151 -> #8A94A6.
   - Small gold labels (7-9px gold text on dark): use #D9BC6B instead of #C9A84C for
     text only; keep #C9A84C for borders, buttons, and large headings.
   - Minimum font size anywhere in the app: 9px. Bump all 7px -> 9px and 8px -> 10px
     (sidebar labels, hist-meta, brief text, badges, api labels, biz menu stages).
     Where letter-spacing is 3px on text now sized <11px, reduce to 2px.
   - Agent roster: names 10px, role lines 11px --text-dim.
   - Verify nothing overflows: sidebar is 278px wide; if a bumped label wraps badly,
     shorten its text rather than shrinking the font.

9. VERIFY + DEPLOY:
   - Sanity: extract the main <script> block and confirm it parses (node --check on the
     extracted JS, or new Function). Confirm markers exist: MODELS.orchestrator,
     exportData, openRun, manifest.json link, updateRunBtn.
   - git add -A; commit "V3.1 — Fable 5 models, full-run history, backup, PWA, rate-limit resilience";
     push origin main.
   - Wait ~90s, then curl the live URL and confirm the markers are present in the served HTML.
   - Report result to Kelechi. STOP after Phase 1 and summarize before starting Phase 2.

## CONSTRAINTS (all phases)
- Keep index.html a single self-contained file until Phase 3 says otherwise.
- Never break existing localStorage keys: kc_api_key, kc_businesses, kc_active_biz, kc_history_v3.
- Never commit or log the API key. Never put credentials in backup files.
- Preserve the design system and existing UX patterns; extend, don't restyle.
- After every phase: parse-check JS, commit with a clear message, push, verify live.

## ROADMAP — EXECUTE IN ORDER, ONE PHASE PER SESSION UNLESS TOLD OTHERWISE

PHASE 2 — Conversation depth (frontend only):
- Follow-up input on a completed run: continue with ONLY relevant agent(s); append to that
  run's thread; store follow-ups inside the run record.
- Memory loop: inject the last 2-3 run summaries for the active business into Fredrick's
  context block (formatBizContext) so new directives build on prior conclusions.
- Cost meter: read usage from API responses; show per-run cost estimate + running monthly
  total (localStorage kc_costs). Sonnet 4.6 and Fable 5 pricing — look up current rates.

PHASE 3 — Supabase backend (Kelechi has a Supabase account; ask him to run `supabase login`
or provide project ref when needed):
- Tables: businesses, runs, meetings, audit_log (append-only; hash chain optional).
- Storage bucket: meeting-files (transcripts + audio originals).
- Edge Function proxy for Anthropic calls so the API key moves server-side.
- One-time migration from localStorage; keep localStorage as offline cache.
- Result: phone + desktop share one dataset.

PHASE 4 — Meeting intelligence:
- Sources: Zoho Meeting, Zoom, Google Meet, Teams transcripts (.vtt/.srt/.docx/.pdf/.txt)
  plus third-party notes in ANY format. Voice audio is an edge case: transcribe via
  Deepgram or AssemblyAI (diarization preferred) before analysis.
- Universal intake: store original untouched + SHA-256 + timestamp + uploader + provenance
  (own transcript vs imported notes) in audit_log; extract text; Claude normalizes into a
  canonical record: {date, platform, attendees, business_id, agenda, decisions,
  action_items[{owner, due}], open_questions, flags}. Store both, linked.
- Weekly per-business review: summarize the week's meetings, track open action items from
  prior weeks, surface risks. Meetings tab in the UI per business.

PHASE 5 — Scheduled auto-runs:
- Supabase pg_cron / scheduled Edge Function: Monday 07:00 Africa/Lagos weekly portfolio
  review per business (uses Phase 4 data + business profile), writes results into runs,
  visible in-app; optional email delivery later.
- Add a per-business toggle + schedule field in the profile modal.

PHASE 6 — Cross-business directives:
- Directive scoped to 2+ selected businesses; Fredrick receives both profiles and briefs
  agents on synergy/conflict analysis; output tagged to all involved businesses.

## BUSINESS CONTEXT (for judgment calls)
Kelechi runs Kunoch Family Office (Lagos; Nigeria/Liberia/UK). Decision framework:
ROI timeline, asset control, jurisdictional protection, scalability, valuation multiple
expansion, leverage, exit optionality. Output standard: investor-grade, numbers over
opinions, USD/NGN/GBP clarity, no fluff. Four-brother board governs family subsidiaries —
hence the audit requirements in Phase 4.
