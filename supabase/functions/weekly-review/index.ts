import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const ANTHROPIC_API_KEY = Deno.env.get('ANTHROPIC_API_KEY')!

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
  return data.content?.[0]?.text || ''
}

Deno.serve(async (req) => {
  // Fetch all businesses with auto_review enabled
  const { data: businesses, error: bizErr } = await supabase
    .from('businesses')
    .select('biz_id, data')
    .eq('data->auto_review', true)

  if (bizErr) {
    return new Response(JSON.stringify({ error: bizErr.message }), { status: 500 })
  }

  const results: string[] = []

  for (const biz of businesses || []) {
    const bizData = biz.data || {}
    if (!bizData.auto_review) continue

    // Fetch meetings from last 7 days
    const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString()
    const { data: meetings } = await supabase
      .from('meetings')
      .select('*')
      .eq('biz_id', biz.biz_id)
      .gte('created_at', since)
      .order('created_at', { ascending: false })

    // Build context
    const context = {
      business: {
        name: bizData.name,
        stage: bizData.stage,
        positioning: bizData.positioning,
        priorities: [bizData.p1, bizData.p2, bizData.p3].filter(Boolean),
      },
      meetings: (meetings || []).map((m: any) => ({
        title: m.title,
        date: m.meeting_date,
        decisions: m.decisions || [],
        action_items: m.action_items || [],
        open_questions: m.open_questions || [],
        flags: m.flags || [],
        summary: m.summary || '',
      })),
    }

    try {
      const synthesis = await callClaude(WEEKLY_SYSTEM, JSON.stringify(context))

      // Store as a run
      const runId = `auto_${biz.biz_id}_${Date.now().toString(36)}`
      await supabase.from('runs').insert({
        run_id: runId,
        biz_id: biz.biz_id,
        data: {
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
        },
      })

      results.push(`${bizData.name}: generated`)
    } catch (e: any) {
      results.push(`${bizData.name}: error — ${e.message}`)
    }
  }

  return new Response(JSON.stringify({ success: true, results, generatedAt: new Date().toISOString() }), {
    headers: { 'Content-Type': 'application/json' },
  })
})
