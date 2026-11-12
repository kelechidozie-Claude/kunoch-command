/* Kunoch Command v4 — daily adviser. One adviser (Fredrick), calendar-driven debriefs,
 * Insight360 briefing PDFs. Talks to Supabase (auth + own rows) and the kc-bridge function. */
(function () {
  'use strict';

  var VERSION = '4.0.1';
  var SUPABASE_URL = 'https://eplsmeenlwbglgtnzxau.supabase.co';
  var SUPABASE_ANON = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImVwbHNtZWVubHdiZ2xndG56eGF1Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODQyNDM3MTYsImV4cCI6MjA5OTgxOTcxNn0.ry8pf_93UetpE_TgTig438hayZwx-GOM2QxHgwjTqGg';
  var BRIDGE = SUPABASE_URL + '/functions/v1/kc-bridge';
  var MODEL_FAST = 'claude-sonnet-5-5', MODEL_DEEP = 'claude-fable-5-2', MODEL_FALLBACK = 'claude-sonnet-4-6';
  var TZ = 'Africa/Lagos';
  var DEMO = /[?&]demo=1/.test(location.search);
  var START_TAB = (/[?&]tab=(today|ask|library)/.exec(location.search) || [])[1];

  var S = { sb: null, user: null, businesses: [], biz: 'all', feed: null, feedErr: '', debriefs: {}, runs: [],
            tab: START_TAB || 'today', lib: 'briefings', thread: null, deep: false, busy: false, loaded: false, pdf: null };

  /* ───────── helpers ───────── */
  var $ = function (id) { return document.getElementById(id); };
  function esc(t) { return String(t === null || t === undefined ? '' : t).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
  function norm(s) { return String(s || '').toLowerCase().replace(/[^a-z0-9]/g, ''); }
  function uid(p) { return p + '_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6); }
  function fmt(d, o) { o.timeZone = TZ; return new Intl.DateTimeFormat('en-GB', o).format(new Date(d)); }
  function dayKey(d) { return new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(d)); }
  function hm(d) { return fmt(d, { hour: '2-digit', minute: '2-digit', hour12: false }); }
  function dayLabel(d) { return fmt(d, { weekday: 'short', day: 'numeric', month: 'short' }); }
  function longDate(d) { return fmt(d, { day: 'numeric', month: 'long', year: 'numeric' }); }
  function todayKey() { return dayKey(Date.now()); }
  function toast(msg) { var t = $('toast'); t.textContent = msg; t.classList.add('on'); clearTimeout(toast._t); toast._t = setTimeout(function () { t.classList.remove('on'); }, 3200); }
  function bizById(id) { return S.businesses.filter(function (b) { return b.biz_id === id; })[0]; }
  function bizName(id) { var b = bizById(id); return id === 'all' || !b ? 'All businesses' : (b.data.name || id); }
  /* Match a Portfolio Command business name to a Kunoch Command business id. */
  function matchBiz(pcName) {
    var n = norm(pcName); if (!n) return null;
    var exact = S.businesses.filter(function (b) { return norm(b.data.name) === n; })[0];
    if (exact) return exact.biz_id;
    var loose = S.businesses.filter(function (b) { var k = norm(b.data.name); return k && (n.indexOf(k) === 0 || k.indexOf(n) === 0); })[0];
    return loose ? loose.biz_id : null;
  }
  function inBiz(pcName) { return S.biz === 'all' || matchBiz(pcName) === S.biz; }

  /* Small, safe markdown renderer (escapes first, then formats). */
  function md(src) {
    var lines = esc(src || '').replace(/\r/g, '').split('\n'), out = [], i = 0;
    var inl = function (t) {
      return t.replace(/`([^`]+)`/g, '<code>$1</code>').replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
              .replace(/(^|[\s(])\*([^*\s][^*]*)\*(?=[\s).,;:!?]|$)/g, '$1<em>$2</em>');
    };
    while (i < lines.length) {
      var l = lines[i];
      if (!l.trim()) { i++; continue; }
      if (/^\s*\|.*\|\s*$/.test(l) && i + 1 < lines.length && /^\s*\|[\s:|-]+\|\s*$/.test(lines[i + 1])) {
        var cells = function (r) { return r.trim().replace(/^\||\|$/g, '').split('|').map(function (c) { return inl(c.trim()); }); };
        var h = cells(l), rows = []; i += 2;
        while (i < lines.length && /^\s*\|.*\|\s*$/.test(lines[i])) { rows.push(cells(lines[i])); i++; }
        out.push('<div class="tw"><table><thead><tr>' + h.map(function (c) { return '<th>' + c + '</th>'; }).join('') + '</tr></thead><tbody>' +
          rows.map(function (r) { return '<tr>' + r.map(function (c) { return '<td>' + c + '</td>'; }).join('') + '</tr>'; }).join('') + '</tbody></table></div>');
        continue;
      }
      if (/^#{1,6}\s+/.test(l)) { out.push('<h4>' + inl(l.replace(/^#{1,6}\s+/, '')) + '</h4>'); i++; continue; }
      if (/^\s*([-*•]|\d+[.)])\s+/.test(l)) {
        var ordered = /^\s*\d+[.)]\s+/.test(l), items = [];
        while (i < lines.length && /^\s*([-*•]|\d+[.)])\s+/.test(lines[i])) { items.push('<li>' + inl(lines[i].replace(/^\s*([-*•]|\d+[.)])\s+/, '')) + '</li>'); i++; }
        out.push((ordered ? '<ol>' : '<ul>') + items.join('') + (ordered ? '</ol>' : '</ul>'));
        continue;
      }
      if (/^\s*-{3,}\s*$/.test(l)) { i++; continue; }
      var p = [l]; i++;
      while (i < lines.length && lines[i].trim() && !/^\s*([-*•]|\d+[.)])\s+/.test(lines[i]) && !/^#{1,6}\s+/.test(lines[i]) && !/^\s*\|.*\|\s*$/.test(lines[i])) { p.push(lines[i]); i++; }
      out.push('<p>' + inl(p.join('<br>')) + '</p>');
    }
    return out.join('');
  }

  /* ───────── server calls ───────── */
  async function token() {
    var r = await S.sb.auth.getSession();
    if (!r.data || !r.data.session) throw new Error('Your session has expired. Sign in again.');
    return r.data.session.access_token;
  }
  async function bridgeRaw(action, payload) {
    if (DEMO) return demoBridge(action, payload);
    var body = Object.assign({ action: action }, payload || {});
    return fetch(BRIDGE, { method: 'POST', headers: { 'Content-Type': 'application/json', apikey: SUPABASE_ANON, Authorization: 'Bearer ' + (await token()) }, body: JSON.stringify(body) });
  }
  function errText(status, raw) {
    var m = raw; try { var j = JSON.parse(raw); m = (j.error && (j.error.message || j.error)) || j.message || raw; } catch (e) {}
    m = String(m || '').slice(0, 240);
    if (status === 429) return 'The adviser is rate-limited. Wait about 30 seconds and try again.';
    if (status === 529 || status === 503) return 'The AI service is overloaded. Try again in a moment.';
    if (status === 401) return 'Your session has expired. Sign in again.';
    if (status === 403) return 'This account is not authorised for Kunoch Command.';
    return m || ('Request failed (' + status + ')');
  }
  async function bridge(action, payload) {
    var res = await bridgeRaw(action, payload), raw = await res.text();
    if (!res.ok) throw new Error(errText(res.status, raw));
    return raw ? JSON.parse(raw) : null;
  }
  function modelMissing(status, raw) { return (status === 404 || status === 400) && /model/i.test(raw); }

  /* Streamed adviser reply. onText receives the full text so far. */
  async function streamChat(o) {
    var res = await bridgeRaw('chat', { system: o.system, messages: o.messages, model: o.model, max_tokens: o.max_tokens || 1400, stream: true });
    if (!res.ok) {
      var raw = await res.text();
      if (o.model !== MODEL_FALLBACK && modelMissing(res.status, raw)) return streamChat(Object.assign({}, o, { model: MODEL_FALLBACK }));
      throw new Error(errText(res.status, raw));
    }
    var reader = res.body.getReader(), dec = new TextDecoder(), buf = '', full = '';
    for (;;) {
      var r = await reader.read(); if (r.done) break;
      buf += dec.decode(r.value, { stream: true });
      var parts = buf.split('\n'); buf = parts.pop();
      for (var i = 0; i < parts.length; i++) {
        var line = parts[i].trim(); if (line.indexOf('data:') !== 0) continue;
        var d = line.slice(5).trim(); if (!d || d === '[DONE]') continue;
        var ev; try { ev = JSON.parse(d); } catch (e) { continue; }
        if (ev.type === 'content_block_delta' && ev.delta && ev.delta.type === 'text_delta') { full += ev.delta.text; o.onText && o.onText(full); }
        else if (ev.type === 'error') throw new Error((ev.error && ev.error.message) || 'The adviser stopped unexpectedly.');
      }
    }
    if (!full.trim()) throw new Error('The adviser returned an empty reply. Try again.');
    return full;
  }
  /* One-shot (non-streamed) call, used for structured JSON. */
  async function ask(o, attempt) {
    var res = await bridgeRaw('chat', { system: o.system, messages: o.messages, model: o.model || MODEL_FAST, max_tokens: o.max_tokens || 1800, stream: false });
    var raw = await res.text();
    if (!res.ok) {
      if ((o.model || MODEL_FAST) !== MODEL_FALLBACK && modelMissing(res.status, raw)) return ask(Object.assign({}, o, { model: MODEL_FALLBACK }));
      if ((res.status === 429 || res.status === 529 || res.status === 503) && (attempt || 1) < 3) { await new Promise(function (r) { setTimeout(r, 2500 * (attempt || 1)); }); return ask(o, (attempt || 1) + 1); }
      throw new Error(errText(res.status, raw));
    }
    var j = JSON.parse(raw), txt = '';
    (j.content || []).forEach(function (b) { if (b && b.type === 'text' && b.text) txt += b.text; });
    return txt;
  }
  function parseJSON(txt) {
    var a = txt.indexOf('{'), b = txt.lastIndexOf('}');
    if (a < 0 || b <= a) throw new Error('The adviser did not return a usable result. Try again.');
    try { return JSON.parse(txt.slice(a, b + 1)); } catch (e) { throw new Error('The adviser returned a malformed result. Try again.'); }
  }

  /* ───────── data ───────── */
  async function loadAll(quiet) {
    if (DEMO) { demoLoad(); S.loaded = true; render(); return; }
    var u = S.user.id;
    var jobs = [
      S.sb.from('businesses').select('biz_id,data,sort').eq('user_id', u).order('sort').then(function (r) { if (!r.error) S.businesses = r.data || []; }),
      S.sb.from('meetings').select('meeting_id,biz_id,data,created_at').eq('user_id', u).order('created_at', { ascending: false }).limit(300).then(function (r) {
        if (r.error) return; S.debriefs = {};
        (r.data || []).forEach(function (m) { var k = m.data && m.data.calendar_event_id; if (k) S.debriefs[k] = m; });
        S.meetingRows = r.data || [];
      }),
      S.sb.from('runs').select('run_id,biz_id,data,created_at').eq('user_id', u).order('created_at', { ascending: false }).limit(250).then(function (r) { if (!r.error) S.runs = r.data || []; }),
      loadFeed()
    ];
    await Promise.all(jobs);
    S.loaded = true; render();
  }
  async function loadFeed() {
    try { S.feed = await bridge('feed', { days_back: 7, days_fwd: 7 }); S.feedErr = ''; }
    catch (e) { S.feedErr = e.message || String(e); }
  }
  function meetings() { return ((S.feed && S.feed.meetings) || []).filter(function (m) { return !m.all_day && inBiz(m.business); }); }
  function tasks() { return ((S.feed && S.feed.tasks) || []).filter(function (t) { return inBiz(t.business); }); }
  function dueDebriefs() {
    var now = Date.now();
    return meetings().filter(function (m) { return new Date(m.end).getTime() < now && !S.debriefs[m.id]; })
      .sort(function (a, b) { return new Date(b.end) - new Date(a.end); });
  }
  function who(m) { var w = Array.isArray(m.who) ? m.who : []; return w.map(function (p) { return (p && (p.name || p.email)) || ''; }).filter(Boolean); }
  async function saveRun(id, biz, data) {
    var row = { run_id: id, biz_id: biz || 'all', data: data, created_at: new Date().toISOString() };
    var ix = -1; S.runs.forEach(function (r, i) { if (r.run_id === id) ix = i; });
    if (ix >= 0) { row.created_at = S.runs[ix].created_at; S.runs.splice(ix, 1); }
    S.runs.unshift(row);
    if (DEMO) return;
    var r = await S.sb.from('runs').upsert({ user_id: S.user.id, run_id: id, biz_id: row.biz_id, data: data }, { onConflict: 'user_id,run_id' });
    if (r.error) toast('Could not save: ' + r.error.message);
  }
  function audit(action, entity, id, detail) {
    if (DEMO) return;
    S.sb.from('audit_log').insert({ user_id: S.user.id, action: action, entity: entity, entity_id: id || '', detail: detail || {} }).then(function () {});
  }
  async function sha256(text) {
    var h = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
    return Array.prototype.map.call(new Uint8Array(h), function (b) { return ('0' + b.toString(16)).slice(-2); }).join('');
  }

  /* ───────── adviser prompts ───────── */
  var ADVISER = [
    'You are Fredrick, chief of staff and business adviser to Kelechi Dozie, Group CEO of Kunoch Family Office (Lagos; operating in Nigeria, Liberia and the UK). You advise across his whole portfolio.',
    '',
    'How to answer:',
    '- Put the answer or recommendation in the first sentence. If his idea has a flaw, gap or risky assumption, say so first.',
    '- Default to under 180 words: short paragraphs or a few bullets. Go longer only when he asks for depth.',
    '- Numbers over adjectives. State the currency (NGN, USD, GBP) on every figure. Never invent figures: if a number is missing, say exactly what you need.',
    '- Where it matters, mark a claim CERTAIN, LIKELY or GUESSING.',
    '- Weigh options on ROI timeline, asset control, jurisdictional protection, scalability and exit optionality.',
    '- Finish with the single next action when there is one. No preamble, no praise, no closing offers.',
    '- For facts about his calendar, meetings and tasks use only the live context below. If it is empty or silent on something, say so plainly instead of guessing.',
    '- Plain markdown only: bold labels, bullets, small tables. No headings larger than ###.'
  ].join('\n');
  var LENSES = {
    finance: { name: 'Finance view', brief: 'You are the CFO lens: cash, unit economics, IRR and payback, FX exposure across NGN/USD/GBP, leverage and downside cases.' },
    legal: { name: 'Legal view', brief: 'You are the legal lens: contract terms, liability, regulatory exposure and structuring across Nigeria (CAMA 2020, NDPR), Liberia and the UK. You are not a substitute for counsel; flag where counsel must review.' },
    deal: { name: 'Deal view', brief: 'You are the deal lens: valuation, structure, leverage in the negotiation, counterparty incentives, governance and exit.' }
  };

  function context(bizId) {
    var out = [], now = Date.now(), tk = todayKey();
    out.push('Now: ' + fmt(now, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }) + ', ' + hm(now) + ' Lagos time.');
    var b = bizById(bizId);
    if (b) {
      var d = b.data, f = function (k, v) { if (v) out.push(k + ': ' + v); };
      out.push('', 'ACTIVE BUSINESS');
      f('Name', d.name); f('Legal entity', d.legal_entity); f('Jurisdictions', d.jurisdictions); f('Positioning', d.positioning); f('Stage', d.stage);
      f('Revenue band', d.revenue ? (d.revenue + ' ' + (d.currency || '')) : ''); f('Business model', d.business_model); f('Target customer', d.target_customer);
      f('Key people', d.key_people); f('Priorities', [d.p1, d.p2, d.p3].filter(Boolean).join(' | ')); f('Constraints', d.constraints);
      f('Competitors', d.competitors); f('Current challenges', d.challenges);
    } else {
      out.push('', 'PORTFOLIO (no single business selected)');
      S.businesses.forEach(function (x) { out.push('- ' + x.data.name + (x.data.positioning ? ' — ' + x.data.positioning : '') + (x.data.stage ? ' [' + x.data.stage + ']' : '')); });
    }
    var keep = function (pc) { return bizId === 'all' || matchBiz(pc) === bizId; };
    var ms = ((S.feed && S.feed.meetings) || []).filter(function (m) { return !m.all_day && keep(m.business); });
    var up = ms.filter(function (m) { return new Date(m.end).getTime() >= now; }).slice(0, 16);
    out.push('', 'UPCOMING MEETINGS (next 7 days): ' + (up.length ? '' : 'none in the calendar'));
    up.forEach(function (m) { var w = who(m); out.push('- ' + dayLabel(m.start) + ' ' + hm(m.start) + '–' + hm(m.end) + ' · ' + m.title + (m.business ? ' · ' + m.business : '') + (w.length ? ' · with ' + w.slice(0, 5).join(', ') : '') + (m.notes ? ' · notes: ' + String(m.notes).slice(0, 240) : '')); });
    var past = ms.filter(function (m) { return new Date(m.end).getTime() < now; }).slice(-14).reverse();
    out.push('', 'MEETINGS IN THE LAST 7 DAYS: ' + (past.length ? '' : 'none in the calendar'));
    past.forEach(function (m) {
      var rec = S.debriefs[m.id], d = rec && rec.data, line = '- ' + dayLabel(m.start) + ' · ' + m.title + (m.business ? ' · ' + m.business : '');
      if (d && d.skipped) line += ' · (marked nothing to capture)';
      else if (d) {
        line += ' · DEBRIEF: ' + (d.summary || '');
        if (d.decisions && d.decisions.length) line += ' Decisions: ' + d.decisions.join('; ') + '.';
        if (d.action_items && d.action_items.length) line += ' Actions: ' + d.action_items.map(function (a) { return a.task + (a.owner ? ' (' + a.owner + (a.due ? ', ' + a.due : '') + ')' : ''); }).join('; ') + '.';
        if (d.open_questions && d.open_questions.length) line += ' Open: ' + d.open_questions.join('; ') + '.';
      } else line += ' · (no debrief recorded)';
      out.push(line);
    });
    var ts = ((S.feed && S.feed.tasks) || []).filter(function (t) { return keep(t.business); }).slice(0, 30);
    out.push('', 'OPEN TASKS (Portfolio Command): ' + (ts.length ? '' : 'none recorded'));
    ts.forEach(function (t) { out.push('- ' + t.title + (t.business ? ' · ' + t.business : '') + (t.due ? ' · due ' + t.due + (t.due < tk ? ' OVERDUE' : '') : ' · no due date') + (t.priority ? ' · ' + t.priority : '') + (t.assigned ? ' · ' + t.assigned : '')); });
    if (S.feedErr) out.push('', 'Note: live calendar and task data could not be loaded just now (' + S.feedErr + ').');
    return out.join('\n');
  }
  /* The API wants alternating turns; second opinions are folded into the preceding assistant turn. */
  function apiMessages(msgs) {
    var out = [];
    msgs.forEach(function (m) {
      var text = (m.label ? '[' + m.label + ']\n' : '') + m.content, last = out[out.length - 1];
      if (last && last.role === m.role) last.content += '\n\n' + text; else out.push({ role: m.role, content: text });
    });
    return out;
  }

  /* ───────── rendering ───────── */
  function render() {
    $('bizname').textContent = bizName(S.biz);
    Array.prototype.forEach.call(document.querySelectorAll('.tabs button'), function (b) { b.classList.toggle('on', b.dataset.tab === S.tab); });
    var v = $('view');
    if (!S.loaded) { v.innerHTML = '<div class="working"><span class="spin"></span>Loading your day…</div>'; return; }
    v.innerHTML = S.tab === 'today' ? viewToday() : S.tab === 'ask' ? viewAsk() : viewLibrary();
    if (S.tab === 'ask') { sizeComposer(); scrollEnd(); }
  }
  function meetingCard(m, due) {
    var w = who(m), meta = [];
    if (due) meta.push(dayLabel(m.start) + ', ' + hm(m.start));
    if (w.length) meta.push(w.length === 1 ? w[0] : w.length + ' people');
    if (m.loc && !/^https?:/i.test(m.loc)) meta.push(String(m.loc).slice(0, 40));
    return '<div class="card' + (due ? ' due' : '') + '"><div class="row">' +
      (due ? '' : '<div class="time">' + hm(m.start) + '<small>' + hm(m.end) + '</small></div>') +
      '<div class="grow"><div class="title">' + esc(m.title || 'Untitled meeting') + '</div>' +
      '<div class="meta">' + (m.business ? '<span class="chip">' + esc(m.business) + '</span> ' : '') + esc(meta.join(' · ')) + '</div>' +
      (due ? '<div class="actions"><button class="btn sm primary" data-act="debrief" data-id="' + esc(m.id) + '">Debrief</button>' +
             '<button class="btn sm ghost" data-act="skip-debrief" data-id="' + esc(m.id) + '">Nothing to capture</button></div>' : '') +
      '</div></div></div>';
  }
  function viewToday() {
    var now = Date.now(), tk = todayKey(), ms = meetings(), ts = tasks(), due = dueDebriefs();
    var today = ms.filter(function (m) { return dayKey(m.start) === tk; });
    var later = ms.filter(function (m) { return dayKey(m.start) > tk; });
    var overdue = ts.filter(function (t) { return t.due && t.due < tk; });
    var h = '<h1 class="day">' + esc(fmt(now, { weekday: 'long', day: 'numeric', month: 'long' })) + '</h1>' +
      '<p class="sub">' + esc(S.biz === 'all' ? 'Across the portfolio' : bizName(S.biz)) + '</p>';
    if (S.feedErr) h += '<div class="notice">Calendar and tasks could not be loaded: ' + esc(S.feedErr) + '<br><button class="btn sm" data-act="refresh">Try again</button></div>';
    h += '<div class="stats">' +
      '<div class="stat"><b>' + today.length + '</b><span>meeting' + (today.length === 1 ? '' : 's') + ' today</span></div>' +
      '<div class="stat' + (due.length ? ' alert' : '') + '"><b>' + due.length + '</b><span>debrief' + (due.length === 1 ? '' : 's') + ' due</span></div>' +
      '<div class="stat' + (overdue.length ? ' alert' : '') + '"><b>' + ts.length + '</b><span>open task' + (ts.length === 1 ? '' : 's') + (overdue.length ? ', ' + overdue.length + ' overdue' : '') + '</span></div></div>';

    if (due.length) {
      h += '<div class="sec"><h2>Debriefs due</h2><span class="count">last 7 days</span></div>';
      h += due.slice(0, 4).map(function (m) { return meetingCard(m, true); }).join('');
      if (due.length > 4) h += '<details class="more"><summary>' + (due.length - 4) + ' more</summary>' + due.slice(4).map(function (m) { return meetingCard(m, true); }).join('') + '</details>';
    }
    h += '<div class="sec"><h2>Today</h2></div>';
    h += today.length ? today.map(function (m) { return meetingCard(m, false); }).join('') : '<div class="empty">No meetings in the calendar today.</div>';
    if (later.length) {
      var groups = {}, order = [];
      later.forEach(function (m) { var k = dayKey(m.start); if (!groups[k]) { groups[k] = []; order.push(k); } groups[k].push(m); });
      h += '<details class="more"><summary>Next 7 days — ' + later.length + ' meeting' + (later.length === 1 ? '' : 's') + '</summary>' +
        order.map(function (k) { return '<div class="daylabel">' + esc(dayLabel(groups[k][0].start)) + '</div>' + groups[k].map(function (m) { return meetingCard(m, false); }).join(''); }).join('') + '</details>';
    }
    h += '<div class="sec"><h2>Open tasks</h2><span class="count">Portfolio Command</span></div>';
    if (!ts.length) h += '<div class="empty">No open tasks. Debrief a meeting to file the first ones.</div>';
    else {
      var row = function (t) { var od = t.due && t.due < tk; return '<div class="card"><div class="title">' + esc(t.title) + '</div><div class="meta">' +
        (t.business ? '<span class="chip">' + esc(t.business) + '</span> ' : '') + (t.due ? '<span class="chip' + (od ? ' red' : '') + '">' + (od ? 'Overdue ' : 'Due ') + esc(dayLabel(t.due + 'T12:00:00Z')) + '</span> ' : '') + esc(t.assigned || '') + '</div></div>'; };
      h += ts.slice(0, 6).map(row).join('');
      if (ts.length > 6) h += '<details class="more"><summary>' + (ts.length - 6) + ' more</summary>' + ts.slice(6).map(row).join('') + '</details>';
    }
    h += '<button class="btn primary block cta" data-act="brief-me">Brief me on today</button>';
    if (S.feed && S.feed.data_as_of) h += '<p class="foot">Calendar synced ' + esc(dayLabel(S.feed.data_as_of) + ' ' + hm(S.feed.data_as_of)) + ' · <button class="btn link" style="display:inline;min-height:0;padding:0" data-act="refresh">Refresh</button></p>';
    return h;
  }
  function msgHtml(m, i, last) {
    if (m.role === 'user') return '<div class="msg user">' + esc(m.content) + '</div>';
    var acts = '';
    if (!m.pending && !m.error) {
      acts = '<div class="msg-actions">';
      if (!m.label) Object.keys(LENSES).forEach(function (k) { acts += '<button class="btn sm ghost" data-act="lens" data-lens="' + k + '" data-i="' + i + '">' + esc(LENSES[k].name.replace(' view', '')) + '</button>'; });
      acts += '<button class="btn sm" data-act="make-pdf" data-i="' + i + '">Share as PDF</button><button class="btn sm ghost" data-act="copy" data-i="' + i + '">Copy</button></div>';
    }
    return '<div class="msg bot' + (m.label ? ' lens' : '') + '"><div class="who">' + esc(m.label || 'Fredrick') + '</div><div class="md" id="m' + i + '">' +
      (m.pending && !m.content ? '<span class="typing"><i></i><i></i><i></i></span>' : md(m.content)) + '</div>' +
      (m.error ? '<div class="notice">' + esc(m.error) + '<br><button class="btn sm" data-act="retry">Try again</button></div>' : '') + acts + '</div>';
  }
  function viewAsk() {
    var t = S.thread, h = '<div class="thread-head"><h1>' + esc(t && t.title ? t.title : 'Ask Fredrick') + '</h1>' +
      '<button class="toggle' + (S.deep ? ' on' : '') + '" data-act="deep" aria-pressed="' + S.deep + '" title="Slower, more thorough reasoning"><i></i>Deep</button>' +
      (t && t.messages.length ? '<button class="btn sm" data-act="new-thread">New</button>' : '') + '</div>';
    if (!t || !t.messages.length) {
      var b = S.biz === 'all' ? 'the portfolio' : bizName(S.biz);
      h += '<p class="hello">What do you need to decide?</p><p class="sub">Fredrick sees your calendar, debriefs and open tasks for ' + esc(b) + '.</p><div class="sec"><h2>Start with</h2></div><div class="starters">' +
        ['What should I focus on this week for ' + b + '?', 'Prepare me for my next meeting.', 'What is slipping? Check my overdue tasks and meetings without a debrief.', 'Stress-test a decision I am about to make.']
          .map(function (q) { return '<button class="starter" data-act="starter">' + esc(q) + '</button>'; }).join('') + '</div>';
    } else {
      h += '<div class="msgs">' + t.messages.map(function (m, i) { return msgHtml(m, i, i === t.messages.length - 1); }).join('') + '</div>';
    }
    h += '<div class="ask-pad"></div><div class="composer"><div class="composer-in"><textarea id="q" rows="1" placeholder="Ask about ' + esc(S.biz === 'all' ? 'the portfolio' : bizName(S.biz)) + '…" aria-label="Your question"></textarea>' +
      '<button class="send" id="send" data-act="send" aria-label="Send"' + (S.busy ? ' disabled' : '') + '><svg viewBox="0 0 24 24"><path d="M12 19V5M5.5 11.5L12 5l6.5 6.5"/></svg></button></div></div>';
    return h;
  }
  function libItems() {
    var keep = function (r) { return S.biz === 'all' || r.biz_id === S.biz || (r.data && r.data.biz_ids && r.data.biz_ids.indexOf(S.biz) >= 0); };
    var kind = function (r) { var k = r.data && r.data.kind; return k === 'briefing' ? 'briefings' : k === 'chat' ? 'chats' : (k === 'auto_review' || /^auto_/.test(r.run_id)) ? 'reviews' : 'classic'; };
    var runs = S.runs.filter(keep);
    return {
      briefings: runs.filter(function (r) { return kind(r) === 'briefings'; }),
      chats: runs.filter(function (r) { return kind(r) === 'chats'; }),
      reviews: runs.filter(function (r) { return kind(r) === 'reviews' || kind(r) === 'classic'; }),
      debriefs: (S.meetingRows || []).filter(function (m) { return m.data && !m.data.skipped && (S.biz === 'all' || m.biz_id === S.biz); })
    };
  }
  function viewLibrary() {
    var it = libItems(), tabs = [['briefings', 'Briefings'], ['chats', 'Conversations'], ['debriefs', 'Debriefs'], ['reviews', 'Reviews']];
    var h = '<h1 class="day">Library</h1><div class="seg">' + tabs.map(function (t) { return '<button data-act="lib" data-lib="' + t[0] + '" class="' + (S.lib === t[0] ? 'on' : '') + '">' + t[1] + ' ' + it[t[0]].length + '</button>'; }).join('') + '</div>';
    var list = it[S.lib], when = function (d) { return dayLabel(d) + ' ' + hm(d); };
    if (!list.length) return h + '<div class="empty">' + ({ briefings: 'No briefings yet. Ask Fredrick something, then tap “Share as PDF”.', chats: 'No conversations yet.', debriefs: 'No debriefs yet. They appear here after you debrief a meeting.', reviews: 'No reviews.' })[S.lib] + '</div>';
    if (S.lib === 'debriefs') return h + list.map(function (m) { var d = m.data; return '<button class="card item" data-act="open-debrief" data-id="' + esc(m.meeting_id) + '"><div class="title">' + esc(d.title || 'Meeting') + '</div><div class="meta">' + esc(when(m.created_at)) + ' · ' + (d.action_items || []).length + ' action' + ((d.action_items || []).length === 1 ? '' : 's') + '</div></button>'; }).join('');
    return h + list.slice(0, 80).map(function (r) {
      var d = r.data || {}, title = d.title || d.task || 'Untitled', sub = d.kind === 'briefing' ? 'PDF briefing' : d.kind === 'chat' ? ((d.messages || []).length + ' messages') : 'Weekly review';
      return '<button class="card item" data-act="open-run" data-id="' + esc(r.run_id) + '"><div class="title">' + esc(String(title).slice(0, 110)) + '</div><div class="meta"><span class="chip">' + esc(bizName(r.biz_id)) + '</span> ' + esc(sub + ' · ' + when(r.created_at)) + '</div></button>';
    }).join('');
  }
  function sizeComposer() { var q = $('q'); if (!q) return; q.style.height = 'auto'; q.style.height = Math.min(q.scrollHeight, 150) + 'px'; }
  function scrollEnd() { requestAnimationFrame(function () { window.scrollTo(0, document.documentElement.scrollHeight); }); }

  /* ───────── sheets ───────── */
  var X = '<button class="iconbtn x" data-act="close-sheet" aria-label="Close"><svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6L6 18"/></svg></button>';
  function sheet(html) { $('sheet-card').innerHTML = X + html; $('sheet').hidden = false; $('sheet-card').scrollTop = 0; }
  function closeSheet() { $('sheet').hidden = true; $('sheet-card').innerHTML = ''; stopMic(); }
  function working(title, note) { sheet('<h2>' + esc(title) + '</h2><div class="working"><span class="spin"></span>' + esc(note) + '</div>'); }

  function sheetBiz() {
    sheet('<h2>Business</h2><div style="margin-top:10px">' + [{ biz_id: 'all', data: { name: 'All businesses' } }].concat(S.businesses).map(function (b) {
      return '<button class="list-btn' + (S.biz === b.biz_id ? ' on' : '') + '" data-act="set-biz" data-id="' + esc(b.biz_id) + '">' + esc(b.data.name) + '<small>' + esc(b.data.stage || '') + '</small></button>';
    }).join('') + '</div>');
  }
  function sheetMenu() {
    sheet('<h2>Kunoch Command</h2><p class="meta">' + esc(DEMO ? 'Demo mode' : (S.user && S.user.email) || '') + ' · v' + VERSION + '</p><div class="stack">' +
      '<button class="btn block" data-act="refresh">Refresh calendar and tasks</button>' +
      (DEMO ? '' : '<button class="btn block" data-act="set-pw">Set or change password</button>') +
      '<a class="btn block" href="./legacy/" target="_blank" rel="noopener">Open the classic multi-agent app</a>' +
      '<button class="btn block ghost" data-act="signout">Sign out</button></div>');
  }

  function sheetPassword(recovery) {
    sheet('<h2>' + (recovery ? 'Choose a new password' : 'Set a password') + '</h2><p class="meta">Use it to sign in on any device, including the app on your home screen.</p>' +
      '<label for="pw-new">New password (8 characters or more)</label><input id="pw-new" type="password" autocomplete="new-password" minlength="8">' +
      '<div class="stack"><button class="btn primary block" data-act="pw-save">Save password</button></div>');
    setTimeout(function () { var n = $('pw-new'); if (n) n.focus(); }, 60);
  }
  async function savePassword() {
    var pw = $('pw-new').value; if (pw.length < 8) { toast('Use at least 8 characters.'); return; }
    working('Password', 'Saving…');
    var r = await S.sb.auth.updateUser({ password: pw });
    if (r.error) { sheet('<h2>Could not save</h2><div class="notice">' + esc(r.error.message) + '</div><div class="stack"><button class="btn block" data-act="set-pw">Try again</button></div>'); return; }
    closeSheet(); toast('Password saved. Use it in the home-screen app.');
  }

  /* ── debrief ── */
  var DB = null, mic = null;
  function pcBusinesses() { return (S.feed && S.feed.businesses) || S.businesses.map(function (b) { return b.data.name; }); }
  function findMeeting(id) { return ((S.feed && S.feed.meetings) || []).filter(function (m) { return m.id === id; })[0]; }
  function sheetDebrief(id) {
    var m = findMeeting(id); if (!m) return;
    DB = { m: m, business: m.business || '', notes: '', rec: null };
    var canMic = !!(window.SpeechRecognition || window.webkitSpeechRecognition);
    sheet('<h2>Debrief</h2><p class="meta">' + esc(m.title) + ' · ' + esc(dayLabel(m.start) + ' ' + hm(m.start)) + '</p>' +
      '<label for="db-biz">Business</label><select id="db-biz"><option value="">Choose…</option>' + pcBusinesses().map(function (n) { return '<option' + (n === DB.business ? ' selected' : '') + '>' + esc(n) + '</option>'; }).join('') + '</select>' +
      '<label for="db-notes">What was decided? Who does what, by when?</label><textarea id="db-notes" rows="6" placeholder="e.g. Agreed to pilot with two branches from January. Tolu sends the proposal by Friday. Still open: pricing per seat."></textarea>' +
      '<div class="stack">' + (canMic ? '<button class="btn block" data-act="mic" id="mic-btn">Dictate</button>' : '') +
      '<button class="btn primary block" data-act="db-extract">Extract actions</button></div>' +
      '<p class="meta" style="margin-top:12px">Actions you approve are filed as tasks in Portfolio Command.</p>');
    setTimeout(function () { var n = $('db-notes'); if (n) n.focus(); }, 60);
  }
  function stopMic() { if (mic) { try { mic.stop(); } catch (e) {} mic = null; } }
  function toggleMic() {
    var btn = $('mic-btn'), box = $('db-notes'); if (!box) return;
    if (mic) { stopMic(); if (btn) btn.textContent = 'Dictate'; return; }
    var R = window.SpeechRecognition || window.webkitSpeechRecognition; if (!R) return;
    var base = box.value ? box.value.replace(/\s*$/, ' ') : '';
    mic = new R(); mic.continuous = true; mic.interimResults = true; mic.lang = 'en-GB';
    mic.onresult = function (e) { var t = ''; for (var i = 0; i < e.results.length; i++) t += e.results[i][0].transcript; box.value = base + t; };
    mic.onend = function () { mic = null; var b = $('mic-btn'); if (b) b.textContent = 'Dictate'; };
    mic.onerror = function () { toast('Dictation is not available. Use the microphone on your keyboard.'); };
    try { mic.start(); if (btn) btn.textContent = 'Stop dictating'; } catch (e) { mic = null; }
  }
  async function debriefExtract() {
    DB.business = $('db-biz').value; DB.notes = $('db-notes').value.trim(); stopMic();
    if (DB.notes.length < 12) { toast('Add a line or two about what was decided.'); return; }
    working('Debrief', 'Reading your notes…');
    try {
      var m = DB.m, sys = 'You turn a CEO\'s spoken or typed debrief of a meeting into a structured record. Return ONLY a JSON object, no prose, no code fence:\n' +
        '{"summary":"<=40 words","decisions":["..."],"actions":[{"title":"imperative, <=14 words","owner":"first name, or \\"Kelechi\\" when he will do it himself, or \\"\\" if not stated","due":"YYYY-MM-DD or null","priority":"low|med|high"}],"open_questions":["..."],"flags":["risks or concerns he raised"]}\n' +
        'Rules: include only what the note states or directly implies. Resolve relative dates ("Friday", "next week") against today\'s date. Use empty arrays where there is nothing. Do not add advice.';
      var user = 'Today is ' + todayKey() + ' (' + fmt(Date.now(), { weekday: 'long' }) + ').\nMeeting: ' + m.title + '\nHeld: ' + dayLabel(m.start) + ' ' + hm(m.start) + '\nBusiness: ' + (DB.business || 'not specified') +
        '\nAttendees: ' + (who(m).join(', ') || 'not listed') + '\n\nDebrief note:\n' + DB.notes;
      var rec = parseJSON(await ask({ system: sys, messages: [{ role: 'user', content: user }], max_tokens: 1200 }));
      rec.actions = (Array.isArray(rec.actions) ? rec.actions : []).slice(0, 12);
      DB.rec = rec; sheetDebriefReview();
    } catch (e) {
      sheet('<h2>Debrief</h2><div class="notice">' + esc(e.message) + '</div><div class="stack"><button class="btn block" data-act="db-back">Back to my notes</button></div>');
    }
  }
  function sheetDebriefReview() {
    var r = DB.rec, list = function (label, a) { return a && a.length ? '<div class="kv"><b>' + label + '</b><ul>' + a.map(function (x) { return '<li>' + esc(x) + '</li>'; }).join('') + '</ul></div>' : ''; };
    var h = '<h2>Review and file</h2><p class="meta">' + esc(DB.m.title) + '</p><div class="kv"><b>Summary</b>' + esc(r.summary || '') + '</div>' +
      list('Decisions', r.decisions) + list('Still open', r.open_questions) + list('Flags', r.flags) +
      '<div class="kv"><b>Actions to file as tasks' + (DB.business ? ' — ' + esc(DB.business) : '') + '</b></div>';
    if (!r.actions.length) h += '<div class="empty">No actions found in your notes.</div>';
    r.actions.forEach(function (a, i) {
      h += '<div class="act-row"><div class="row"><input type="checkbox" id="a-on-' + i + '" checked aria-label="File this task"><div class="grow">' +
        '<input id="a-title-' + i + '" value="' + esc(a.title || '') + '" aria-label="Task">' +
        '<div class="fields"><input id="a-owner-' + i + '" value="' + esc(a.owner || '') + '" placeholder="Owner" aria-label="Owner">' +
        '<input id="a-due-' + i + '" type="date" value="' + esc(/^\d{4}-\d{2}-\d{2}$/.test(a.due || '') ? a.due : '') + '" aria-label="Due date">' +
        '<select id="a-pri-' + i + '" aria-label="Priority">' + ['low', 'med', 'high'].map(function (p) { return '<option value="' + p + '"' + ((a.priority || 'med') === p ? ' selected' : '') + '>' + ({ low: 'Low', med: 'Medium', high: 'High' })[p] + '</option>'; }).join('') + '</select></div></div></div></div>';
    });
    if (r.actions.length && !DB.business) h += '<div class="notice">Choose a business on the previous step to file tasks. You can still save the debrief without tasks.</div>';
    h += '<div class="stack"><button class="btn primary block" data-act="db-save">' + (r.actions.length && DB.business ? 'File tasks and save debrief' : 'Save debrief') + '</button><button class="btn block ghost" data-act="db-back">Back to my notes</button></div>';
    sheet(h);
  }
  async function debriefSave() {
    var r = DB.rec, m = DB.m, picked = [];
    r.actions.forEach(function (a, i) {
      if (!$('a-on-' + i) || !$('a-on-' + i).checked) return;
      var t = $('a-title-' + i).value.trim(); if (!t) return;
      picked.push({ title: t, owner: $('a-owner-' + i).value.trim(), due: $('a-due-' + i).value || null, priority: $('a-pri-' + i).value });
    });
    working('Saving', picked.length && DB.business ? 'Filing ' + picked.length + ' task' + (picked.length === 1 ? '' : 's') + ' in Portfolio Command…' : 'Saving your debrief…');
    var filed = [], failed = [];
    try {
      if (picked.length && DB.business) {
        var res = await bridge('tasks_create', { items: picked.map(function (a) {
          return { business: DB.business, title: a.title, due: a.due, priority: a.priority, assigned: a.owner,
                   description: 'From debrief of "' + m.title + '" (' + dayLabel(m.start) + '). ' + (r.summary || '') };
        }) });
        (res.results || []).forEach(function (x, i) { if (x && x.ok) filed.push({ task_id: x.task_id, title: picked[i].title }); else failed.push(picked[i].title + (x && x.error ? ' — ' + x.error : '')); });
      }
      var bizId = matchBiz(DB.business) || 'unassigned', id = 'cal_' + m.id;
      var data = {
        id: id, biz_id: bizId, title: m.title, platform: m.provider || 'calendar', meeting_date: dayKey(m.start), attendees: who(m),
        summary: r.summary || '', decisions: r.decisions || [], action_items: picked.map(function (a) { return { task: a.title, owner: a.owner, due: a.due, priority: a.priority }; }),
        open_questions: r.open_questions || [], flags: r.flags || [], transcript: DB.notes, provenance: 'debrief', source_type: 'debrief',
        sha256: await sha256(DB.notes), calendar_event_id: m.id, pc_business: DB.business, tasks_filed: filed, created_at: new Date().toISOString()
      };
      var row = { meeting_id: id, biz_id: bizId, data: data, created_at: data.created_at };
      if (!DEMO) {
        var up = await S.sb.from('meetings').upsert({ user_id: S.user.id, meeting_id: id, biz_id: bizId, data: data }, { onConflict: 'user_id,meeting_id' });
        if (up.error) throw new Error('Could not save the debrief: ' + up.error.message);
        audit('meeting.debriefed', 'meeting', id, { sha256: data.sha256, calendar_event_id: m.id, tasks_filed: filed.length, biz: bizId });
      }
      S.debriefs[m.id] = row; S.meetingRows = [row].concat((S.meetingRows || []).filter(function (x) { return x.meeting_id !== id; }));
      if (filed.length) await loadFeed();
      if (failed.length) sheet('<h2>Saved, with a problem</h2><div class="notice">' + filed.length + ' task' + (filed.length === 1 ? '' : 's') + ' filed. These were not:<br>' + failed.map(esc).join('<br>') + '</div><div class="stack"><button class="btn block" data-act="close-sheet">Close</button></div>');
      else { closeSheet(); toast(filed.length ? filed.length + ' task' + (filed.length === 1 ? '' : 's') + ' filed in Portfolio Command' : 'Debrief saved'); }
      render();
    } catch (e) {
      sheet('<h2>Could not save</h2><div class="notice">' + esc(e.message) + (filed.length ? '<br>' + filed.length + ' task(s) were already filed.' : '') + '</div><div class="stack"><button class="btn block" data-act="db-review">Back</button></div>');
    }
  }
  async function skipDebrief(id) {
    var m = findMeeting(id); if (!m) return;
    var mid = 'cal_' + m.id, bizId = matchBiz(m.business) || 'unassigned';
    var data = { id: mid, biz_id: bizId, title: m.title, meeting_date: dayKey(m.start), calendar_event_id: m.id, skipped: true, provenance: 'debrief', created_at: new Date().toISOString() };
    S.debriefs[m.id] = { meeting_id: mid, biz_id: bizId, data: data, created_at: data.created_at }; render();
    if (!DEMO) { var r = await S.sb.from('meetings').upsert({ user_id: S.user.id, meeting_id: mid, biz_id: bizId, data: data }, { onConflict: 'user_id,meeting_id' }); if (r.error) toast('Could not save: ' + r.error.message); }
  }
  function sheetDebriefView(mid) {
    var row = (S.meetingRows || []).filter(function (x) { return x.meeting_id === mid; })[0]; if (!row) return;
    var d = row.data, list = function (label, a) { return a && a.length ? '<div class="kv"><b>' + label + '</b><ul>' + a.map(function (x) { return '<li>' + esc(typeof x === 'string' ? x : (x.task + (x.owner ? ' — ' + x.owner : '') + (x.due ? ', ' + x.due : ''))) + '</li>'; }).join('') + '</ul></div>' : ''; };
    sheet('<h2>' + esc(d.title || 'Meeting') + '</h2><p class="meta">' + esc((d.meeting_date || '') + (d.pc_business ? ' · ' + d.pc_business : '')) + '</p>' +
      (d.summary ? '<div class="kv"><b>Summary</b>' + esc(d.summary) + '</div>' : '') + list('Decisions', d.decisions) + list('Actions', d.action_items) + list('Still open', d.open_questions) + list('Flags', d.flags) +
      (d.transcript ? '<div class="kv"><b>Your notes</b>' + esc(d.transcript) + '</div>' : '') + (d.sha256 && d.sha256 !== 'n/a' ? '<p class="meta" style="margin-top:14px;overflow-wrap:anywhere">Fingerprint ' + esc(String(d.sha256).slice(0, 24)) + '…</p>' : ''));
  }

  /* ── ask ── */
  function newThread() { S.thread = { id: uid('chat'), biz: S.biz, title: '', messages: [] }; }
  async function send(text) {
    text = (text || '').trim(); if (!text || S.busy) return;
    if (!S.thread || S.thread.biz !== S.biz && !S.thread.messages.length) newThread();
    var t = S.thread; if (!t.title) t.title = text.length > 64 ? text.slice(0, 62).replace(/\s+\S*$/, '') + '…' : text;
    t.messages.push({ role: 'user', content: text });
    await reply();
  }
  async function reply(lensKey) {
    var t = S.thread, lens = lensKey && LENSES[lensKey];
    var m = { role: 'assistant', content: '', pending: true }; if (lens) m.label = lens.name;
    var history = apiMessages(t.messages.filter(function (x) { return !x.error && x.content; }));
    if (lens) history.push({ role: 'user', content: 'Give a second opinion on your last answer from this lens only. Under 130 words. Use exactly three bold labels: **Verdict** (agree, or what you would change, one line), **Missing** (one or two bullets), **Decides it** (the single number, clause or term that settles the question).' });
    t.messages.push(m); S.busy = true; S.tab = 'ask'; render();
    var ix = t.messages.length - 1;
    try {
      var full = await streamChat({
        system: (lens ? lens.brief + '\n\n' : '') + ADVISER + '\n\n— LIVE CONTEXT —\n' + context(t.biz),
        messages: history, model: S.deep && !lens ? MODEL_DEEP : MODEL_FAST, max_tokens: lens ? 500 : (S.deep ? 3000 : 1400),
        onText: function (txt) { m.content = txt; var el = $('m' + ix); if (el) { el.innerHTML = md(txt); if (window.innerHeight + window.scrollY > document.documentElement.scrollHeight - 160) window.scrollTo(0, document.documentElement.scrollHeight); } }
      });
      m.content = full; m.pending = false;
    } catch (e) { m.pending = false; m.error = e.message || String(e); m.retryLens = lensKey || ''; }
    S.busy = false; render();
    if (!m.error) saveRun(t.id, t.biz, { kind: 'chat', id: t.id, title: t.title, task: t.title, summary: String(m.content).replace(/[#*`|]/g, '').slice(0, 160),
      messages: t.messages.map(function (x) { return { role: x.role, content: x.content, label: x.label }; }), date: todayKey(), time: hm(Date.now()) });
  }
  function retry() {
    var t = S.thread; if (!t) return; var last = t.messages[t.messages.length - 1];
    if (last && last.error) { t.messages.pop(); reply(last.retryLens || undefined); }
  }

  /* ── PDF briefing ── */
  var assetsP = null;
  function loadScript(src) { return new Promise(function (ok, no) { var s = document.createElement('script'); s.src = src; s.onload = ok; s.onerror = function () { no(new Error('Could not load the PDF engine. Check your connection.')); }; document.head.appendChild(s); }); }
  function b64(buf) { var u = new Uint8Array(buf), s = ''; for (var i = 0; i < u.length; i += 0x8000) s += String.fromCharCode.apply(null, u.subarray(i, i + 0x8000)); return btoa(s); }
  function pdfAssets() {
    if (assetsP) return assetsP;
    var bin = function (u) { return fetch(u).then(function (r) { if (!r.ok) throw new Error('asset'); return r.arrayBuffer(); }).then(b64); };
    assetsP = Promise.all([
      window.jspdf ? null : loadScript('./vendor/jspdf.umd.min.js'),
      bin('./brand/Inter-Regular.ttf').catch(function () { return null; }), bin('./brand/Inter-SemiBold.ttf').catch(function () { return null; }),
      bin('./brand/insight360-logo.png').then(function (x) { return 'data:image/png;base64,' + x; }).catch(function () { return null; })
    ]).then(function (a) { return { regular: a[1], semibold: a[2], logo: a[3] }; });
    assetsP.catch(function () { assetsP = null; });
    return assetsP;
  }
  var BRIEF_SYS = 'You turn advisory material into a board-ready one-to-two page briefing for an executive audience. Return ONLY a JSON object, no prose, no code fence:\n' +
    '{"title":"the decision or finding as a headline, <=11 words","bottom_line":"the recommendation and why, <=45 words","context":"what prompted this, <=50 words, or \\"\\"",' +
    '"numbers":[{"label":"<=6 words","value":"short figure with currency or unit"}],"points":[{"head":"<=7 words","body":"<=42 words"}],"risks":["<=22 words each"],' +
    '"next_steps":[{"action":"imperative, <=15 words","owner":"name or \\"\\"","due":"e.g. 18 Nov, or \\"\\""}]}\n' +
    'Limits: numbers 0-6, points 2-4, risks 0-4, next_steps 1-5. Use only facts and figures that appear in the material; never invent a number, name or date — leave "numbers" empty if there are none. ' +
    'Write for a reader who was not in the conversation: no "you", no reference to the chat, an AI or an adviser. Remove confidence tags such as CERTAIN/LIKELY/GUESSING. British English.';
  async function makeBriefing(source, bizId, sourceId) {
    working('Preparing briefing', 'Condensing to a two-page Insight360 briefing…');
    try {
      var both = await Promise.all([ask({ system: BRIEF_SYS, messages: [{ role: 'user', content: 'Business: ' + bizName(bizId) + '\nDate: ' + longDate(Date.now()) + '\n\nMaterial:\n' + source.slice(0, 24000) }], max_tokens: 1500 }), pdfAssets()]);
      var b = parseJSON(both[0]); b.business = bizId === 'all' ? 'Portfolio' : bizName(bizId); b.date = longDate(Date.now());
      var id = uid('brief');
      await saveRun(id, bizId, { kind: 'briefing', id: id, title: b.title, task: b.title, summary: b.bottom_line, briefing: b, source: sourceId || '', date: todayKey(), time: hm(Date.now()) });
      audit('briefing.created', 'briefing', id, { title: b.title, biz: bizId });
      await showBriefing(id);
    } catch (e) { sheet('<h2>Briefing</h2><div class="notice">' + esc(e.message) + '</div><div class="stack"><button class="btn block" data-act="close-sheet">Close</button></div>'); }
  }
  async function showBriefing(id) {
    var run = S.runs.filter(function (r) { return r.run_id === id; })[0]; if (!run) return;
    if ($('sheet').hidden) working('Briefing', 'Building the PDF…');
    try {
      var assets = await pdfAssets(), b = run.data.briefing, doc = window.KCPDF.build(window.jspdf.jsPDF, b, assets);
      var blob = doc.output('blob'), name = 'Insight360 Briefing - ' + String(b.title || 'Briefing').replace(/[^\w\s-]/g, '').trim().slice(0, 60) + '.pdf';
      var file = null; try { file = new File([blob], name, { type: 'application/pdf' }); } catch (e) {}
      if (S.pdf && S.pdf.url) URL.revokeObjectURL(S.pdf.url);
      S.pdf = { id: id, blob: blob, file: file, name: name, title: b.title, url: URL.createObjectURL(blob), pages: doc.getNumberOfPages() };
      var canShare = !!(file && navigator.canShare && navigator.canShare({ files: [file] }));
      sheet('<h2>Briefing ready</h2><div class="pdf-tile"><div class="pdf-ico"></div><div class="grow"><div class="title">' + esc(b.title) + '</div><div class="meta">' + esc(b.business) + ' · ' + S.pdf.pages + ' page' + (S.pdf.pages === 1 ? '' : 's') + ' · ' + Math.max(1, Math.round(blob.size / 1024)) + ' KB</div></div></div>' +
        '<div class="stack">' + (canShare ? '<button class="btn primary block" data-act="pdf-share">Share — WhatsApp, Mail…</button>' : '') +
        '<button class="btn block' + (canShare ? '' : ' primary') + '" data-act="pdf-download">Download PDF</button>' +
        '<button class="btn block" data-act="pdf-email">Send by email</button>' +
        '<a class="btn block ghost" href="' + S.pdf.url + '" target="_blank" rel="noopener">Preview</a></div>' +
        (canShare ? '' : '<p class="meta" style="margin-top:12px">To send on WhatsApp from a computer, download the PDF and attach it in WhatsApp Web. On your phone, a Share button appears here.</p>'));
    } catch (e) { sheet('<h2>Briefing</h2><div class="notice">' + esc(e.message || String(e)) + '</div>'); }
  }
  async function pdfShare() {
    try { await navigator.share({ files: [S.pdf.file], title: S.pdf.title }); audit('briefing.shared', 'briefing', S.pdf.id, {}); }
    catch (e) { if (e && e.name !== 'AbortError') { toast('Sharing is not available here. Downloading instead.'); pdfDownload(); } }
  }
  function pdfDownload() { var a = document.createElement('a'); a.href = S.pdf.url; a.download = S.pdf.name; document.body.appendChild(a); a.click(); a.remove(); toast('PDF downloaded'); }
  function sheetEmail() {
    sheet('<h2>Send by email</h2><p class="meta">' + esc(S.pdf.title) + '</p><label for="em-to">To (separate several with commas)</label><input id="em-to" type="text" inputmode="email" autocomplete="email" placeholder="name@company.com">' +
      '<label for="em-msg">Message</label><textarea id="em-msg" rows="4">Please find the briefing attached.\n\nKelechi</textarea>' +
      '<div class="stack"><button class="btn primary block" data-act="em-send">Send</button><button class="btn block ghost" data-act="pdf-back">Back</button></div>' +
      '<p class="meta" style="margin-top:12px">Sent from Insight360 Advisory. Replies come to you.</p>');
  }
  async function emailSend() {
    var to = $('em-to').value.split(/[,;\s]+/).filter(Boolean), msg = $('em-msg').value;
    if (!to.length || to.some(function (x) { return !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(x); })) { toast('Check the email address.'); return; }
    working('Sending', 'Emailing the briefing…');
    try {
      await bridge('email', { to: to, subject: 'Insight360 briefing — ' + S.pdf.title, message: msg, filename: S.pdf.name, pdf_base64: b64(await S.pdf.blob.arrayBuffer()), briefing_id: S.pdf.id });
      closeSheet(); toast('Sent to ' + to.join(', '));
    } catch (e) { sheet('<h2>Could not send</h2><div class="notice">' + esc(e.message) + '</div><div class="stack"><button class="btn block" data-act="pdf-back">Back</button></div>'); }
  }
  function openRun(id) {
    var r = S.runs.filter(function (x) { return x.run_id === id; })[0]; if (!r) return; var d = r.data || {};
    if (d.kind === 'briefing') { showBriefing(id); return; }
    if (d.kind === 'chat') { S.thread = { id: r.run_id, biz: r.biz_id, title: d.title || '', messages: (d.messages || []).map(function (m) { return { role: m.role, content: m.content, label: m.label }; }) }; S.tab = 'ask'; render(); return; }
    var body = d.synthesis || d.summary || '';
    S.viewing = { id: id, biz: r.biz_id, text: body };
    sheet('<h2>' + esc(String(d.task || d.title || 'Review').slice(0, 90)) + '</h2><p class="meta">' + esc(bizName(r.biz_id) + ' · ' + dayLabel(r.created_at)) + '</p><div class="md" style="margin-top:12px">' + md(body) + '</div>' +
      '<div class="stack"><button class="btn primary block" data-act="review-pdf">Share as PDF</button></div>');
  }

  /* ───────── events ───────── */
  document.addEventListener('click', function (e) {
    var el = e.target.closest('[data-act]'); if (!el) return;
    var a = el.dataset.act, t = S.thread;
    if (a === 'tab') { S.tab = el.dataset.tab; render(); window.scrollTo(0, 0); }
    else if (a === 'pick-biz') sheetBiz();
    else if (a === 'set-biz') { S.biz = el.dataset.id; try { localStorage.setItem('kc4_biz', S.biz); } catch (x) {} if (S.thread && !S.thread.messages.length) S.thread = null; closeSheet(); render(); }
    else if (a === 'menu') sheetMenu();
    else if (a === 'close-sheet') closeSheet();
    else if (a === 'refresh') { closeSheet(); toast('Refreshing…'); loadAll(true); }
    else if (a === 'set-pw') sheetPassword(false);
    else if (a === 'pw-save') savePassword();
    else if (a === 'signout') { closeSheet(); if (DEMO) location.search = ''; else S.sb.auth.signOut(); }
    else if (a === 'debrief') sheetDebrief(el.dataset.id);
    else if (a === 'skip-debrief') skipDebrief(el.dataset.id);
    else if (a === 'mic') toggleMic();
    else if (a === 'db-extract') debriefExtract();
    else if (a === 'db-back') { var keep = DB; sheetDebrief(DB.m.id); DB.notes = keep.notes; DB.business = keep.business; $('db-notes').value = keep.notes; $('db-biz').value = keep.business; }
    else if (a === 'db-review') sheetDebriefReview();
    else if (a === 'db-save') debriefSave();
    else if (a === 'open-debrief') sheetDebriefView(el.dataset.id);
    else if (a === 'brief-me') { newThread(); send('Brief me on today. What matters most, what I should prepare for, and what is slipping.'); }
    else if (a === 'starter') { send(el.textContent); }
    else if (a === 'send') { var q = $('q'), v = q.value; q.value = ''; send(v); }
    else if (a === 'new-thread') { S.thread = null; render(); var q2 = $('q'); if (q2) q2.focus(); }
    else if (a === 'deep') { S.deep = !S.deep; render(); toast(S.deep ? 'Deep mode on: slower, more thorough' : 'Deep mode off'); }
    else if (a === 'lens') { if (!S.busy) reply(el.dataset.lens); }
    else if (a === 'retry') retry();
    else if (a === 'copy') { var m = t.messages[+el.dataset.i]; navigator.clipboard && navigator.clipboard.writeText(m.content).then(function () { toast('Copied'); }); }
    else if (a === 'make-pdf') {
      var upto = +el.dataset.i, src = t.messages.slice(0, upto + 1).filter(function (x) { return x.content && !x.error; })
        .map(function (x) { return (x.role === 'user' ? 'QUESTION: ' : (x.label ? x.label.toUpperCase() : 'ADVICE') + ': ') + x.content; }).join('\n\n');
      makeBriefing(src, t.biz, t.id);
    }
    else if (a === 'pdf-share') pdfShare();
    else if (a === 'pdf-download') pdfDownload();
    else if (a === 'pdf-email') sheetEmail();
    else if (a === 'pdf-back') showBriefing(S.pdf.id);
    else if (a === 'em-send') emailSend();
    else if (a === 'lib') { S.lib = el.dataset.lib; render(); }
    else if (a === 'open-run') openRun(el.dataset.id);
    else if (a === 'review-pdf') makeBriefing(S.viewing.text, S.viewing.biz, S.viewing.id);
  });
  document.addEventListener('input', function (e) { if (e.target.id === 'q') sizeComposer(); });
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && !$('sheet').hidden) closeSheet();
    if (e.target.id === 'q' && e.key === 'Enter' && !e.shiftKey && !e.isComposing && window.matchMedia('(pointer:fine)').matches) { e.preventDefault(); var v = e.target.value; e.target.value = ''; send(v); }
  });

  /* ───────── sign-in ───────── */
  var usePw = false;
  function showAuth(msg, err) { $('app').hidden = true; $('auth').hidden = false; var m = $('auth-msg'); m.textContent = msg || ''; m.className = 'auth-msg' + (err ? ' err' : ''); }
  function showApp() { $('auth').hidden = true; $('app').hidden = false; try { var b = localStorage.getItem('kc4_biz'); if (b) S.biz = b; } catch (e) {} render(); loadAll().then(function () { if (S.biz !== 'all' && !bizById(S.biz)) { S.biz = 'all'; render(); } }); }
  var STANDALONE = (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches) || navigator.standalone === true;
  function setPwMode(on) {
    usePw = on; $('auth-pw-row').hidden = !on; $('auth-forgot').hidden = !on;
    $('auth-go').textContent = on ? 'Sign in' : 'Send sign-in link';
    $('auth-toggle').textContent = on ? 'Email me a sign-in link instead' : 'Use a password instead';
  }
  $('auth-toggle').addEventListener('click', function () { setPwMode(!usePw); showAuth(''); });
  $('auth-forgot').addEventListener('click', async function () {
    var email = $('auth-email').value.trim(); if (!email) { showAuth('Enter your email first.', true); return; }
    showAuth('Sending…');
    var r = await S.sb.auth.resetPasswordForEmail(email, { redirectTo: location.origin + location.pathname });
    if (r.error) showAuth(r.error.message, true);
    else showAuth('Reset link sent. Open it, choose a password, then come back here and sign in with it.');
  });
  /* The installed app has its own storage, and an emailed link opens in the browser instead,
     so the home-screen app signs in with a password. */
  if (STANDALONE) setPwMode(true);
  $('auth-form').addEventListener('submit', async function (e) {
    e.preventDefault(); var email = $('auth-email').value.trim(), go = $('auth-go'); if (!email) return;
    go.disabled = true; showAuth(usePw ? 'Signing in…' : 'Sending…');
    try {
      var r = usePw ? await S.sb.auth.signInWithPassword({ email: email, password: $('auth-pw').value })
                    : await S.sb.auth.signInWithOtp({ email: email, options: { emailRedirectTo: location.origin + location.pathname, shouldCreateUser: false } });
      if (r.error) throw r.error;
      if (!usePw) showAuth(STANDALONE ? 'Link sent, but it will open in Safari, not this app. To sign in here, use a password.' : 'Check your inbox for the sign-in link, and open it on this device.');
    } catch (x) { showAuth(x.message || 'Could not sign in.', true); }
    go.disabled = false;
  });

  /* ───────── demo mode (sample data, no network) ───────── */
  function demoLoad() {
    var at = function (dayOff, h, m) { var d = new Date(); d.setDate(d.getDate() + dayOff); d.setHours(h, m, 0, 0); return d.toISOString(); };
    S.businesses = [['d4ulogistics', 'D4U Logistics', 'Lagos dispatch on e-bikes', 'revenue'], ['cirquu', 'Cirquu', 'AI ERP for African SMEs', 'pilot'], ['getabar', 'Getabar', 'Mobile cocktail bar', 'revenue']]
      .map(function (b, i) { return { biz_id: b[0], sort: i, data: { name: b[1], positioning: b[2], stage: b[3] } }; });
    S.feed = { data_as_of: new Date().toISOString(), businesses: ['D4U Logistics', 'Cirquu', 'GetABar'], meetings: [
      { id: 'e1', title: 'Fleet supplier call — second e-bike tranche', start: at(-1, 14, 0), end: at(-1, 15, 0), business: 'D4U Logistics', who: [{ name: 'Tolu' }, { name: 'Emeka' }] },
      { id: 'e2', title: 'Cirquu pilot review', start: at(-2, 10, 0), end: at(-2, 11, 0), business: 'Cirquu', who: [{ name: 'Femi' }] },
      { id: 'e3', title: 'Corporate dispatch pitch', start: at(0, 9, 30), end: at(0, 10, 15), business: 'D4U Logistics', who: [{ name: 'Tolu' }] },
      { id: 'e4', title: 'Weekly operations stand-up', start: at(0, 16, 0), end: at(0, 16, 30), business: 'D4U Logistics', who: [{ name: 'Emeka' }, { name: 'Dare' }, { name: 'Tolu' }] },
      { id: 'e5', title: 'Event booking walkthrough', start: at(1, 11, 0), end: at(1, 12, 0), business: 'GetABar', who: [] },
      { id: 'e6', title: 'Cirquu pricing workshop', start: at(3, 13, 0), end: at(3, 15, 0), business: 'Cirquu', who: [{ name: 'Femi' }] }],
      tasks: [{ id: 't1', title: 'Send revised dispatch rate card', business: 'D4U Logistics', due: dayKey(Date.now() - 3 * 864e5), priority: 'high', assigned: 'Tolu' },
        { id: 't2', title: 'Confirm pilot branches for January', business: 'Cirquu', due: dayKey(Date.now() + 4 * 864e5), priority: 'med', assigned: 'Femi' }] };
    S.debriefs = {}; S.meetingRows = []; S.runs = []; S.user = { id: 'demo', email: 'demo' };
  }
  var DEMO_ANSWER = 'Hold the second tranche. **LIKELY**\n\nThe six e-bikes average 14 paid drops a day against a break-even of 17, so adding six more raises fixed cost by about NGN 740k a month before demand is there.\n\n| | Now | Needed |\n|---|---|---|\n| Drops per bike per day | 14 | 22 |\n| Monthly result | NGN −310k | NGN +1.1m |\n\n- **Price lock:** the 6% discount saves NGN 1.1m; two under-used months cost NGN 1.5m.\n- **What changes it:** two corporate accounts at 40 drops a day.\n\n**Next action:** ask the supplier in writing for a 30-day extension of the price lock.';
  function sse(text) {
    var enc = new TextEncoder(), words = text.match(/\S+\s*/g) || [], i = 0;
    return new ReadableStream({ pull: function (c) { return new Promise(function (r) { setTimeout(function () {
      if (i >= words.length) { c.enqueue(enc.encode('event: message_stop\ndata: {"type":"message_stop"}\n\n')); c.close(); return r(); }
      c.enqueue(enc.encode('event: content_block_delta\ndata: ' + JSON.stringify({ type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: words[i++] } }) + '\n\n')); r(); }, 12); }); } });
  }
  function demoBridge(action, p) {
    var J = function (o) { return new Response(JSON.stringify(o), { status: 200, headers: { 'Content-Type': 'application/json' } }); };
    if (action === 'feed') return J(S.feed);
    if (action === 'tasks_create') { p.items.forEach(function (it) { S.feed.tasks.push({ id: uid('t'), title: it.title, business: it.business, due: it.due, priority: it.priority, assigned: it.assigned }); }); return J({ results: p.items.map(function (it) { return { ok: true, task_id: uid('t'), title: it.title }; }) }); }
    if (action === 'email') return J({ ok: true });
    if (action === 'chat' && p.stream) return new Response(sse(/second opinion/i.test(p.messages[p.messages.length - 1].content) ? '**Verdict** Agree: hold.\n\n**Missing**\n- Battery replacement reserve is not in the payback.\n\n**Decides it** 22 paid drops per bike per day, sustained for 60 days.' : DEMO_ANSWER), { status: 200, headers: { 'Content-Type': 'text/event-stream' } });
    if (action === 'chat') {
      var isBrief = /board-ready/.test(p.system || '');
      var out = isBrief ? { title: 'Hold the second e-bike tranche until utilisation reaches 22 drops', bottom_line: 'Do not order six more e-bikes yet. The current fleet runs at 14 paid drops a day against a break-even of 17; expansion now adds NGN 740k of monthly cost without revenue.', context: 'The supplier has offered a 6% discount if the second tranche is ordered before year end.',
          numbers: [{ label: 'Current drops per bike per day', value: '14' }, { label: 'Break-even', value: '17' }, { label: 'Target before ordering', value: '22' }, { label: 'Monthly result now', value: 'NGN −310k' }, { label: 'Monthly result at target', value: 'NGN +1.1m' }, { label: 'Discount value', value: 'NGN 1.1m' }],
          points: [{ head: 'Utilisation is the constraint', body: 'Adding bikes before demand fills the existing fleet raises fixed cost by about NGN 740k a month.' }, { head: 'The discount is worth less than the delay', body: 'The 6% discount saves NGN 1.1m; two under-used months on a larger fleet cost NGN 1.5m.' }, { head: 'Corporate accounts change the case', body: 'Two accounts at 40 drops a day would lift the fleet average above the target.' }],
          risks: ['The supplier withdraws the discount and lead times lengthen.', 'Battery replacement cost is not yet reflected in the payback.'],
          next_steps: [{ action: 'Request a 30-day extension of the price lock in writing', owner: 'Kelechi', due: '18 Nov' }, { action: 'Close the two corporate dispatch accounts', owner: 'Tolu', due: '5 Dec' }] }
        : { summary: 'Supplier will hold the price to mid-December; decision on tranche two deferred until utilisation data is in.', decisions: ['Do not order tranche two this month'], actions: [{ title: 'Get the price-lock extension in writing', owner: 'Kelechi', due: dayKey(Date.now() + 5 * 864e5), priority: 'high' }, { title: 'Report drops per bike per day weekly', owner: 'Emeka', due: null, priority: 'med' }], open_questions: ['Battery warranty terms on the second batch'], flags: ['Three riders left in October'] };
      return J({ content: [{ type: 'text', text: JSON.stringify(out) }] });
    }
    return J({});
  }

  /* ───────── boot ───────── */
  if ('serviceWorker' in navigator && location.protocol === 'https:') navigator.serviceWorker.register('./sw.js').catch(function () {});
  if (DEMO) { $('demo-banner').hidden = false; $('auth').hidden = true; $('app').hidden = false; render(); loadAll(); }
  else {
    S.sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON, { auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true } });
    S.sb.auth.onAuthStateChange(function (ev, session) {
      var was = S.user && S.user.id; S.user = session ? session.user : null;
      if (S.user && S.user.id !== was) showApp(); else if (!S.user) { S.loaded = false; showAuth(); }
      if (ev === 'PASSWORD_RECOVERY' && S.user) setTimeout(function () { sheetPassword(true); }, 300);
    });
    S.sb.auth.getSession().then(function (r) { if (!r.data || !r.data.session) showAuth(); });
  }
  window.KC = { state: S, md: md };
})();
