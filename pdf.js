/* Insight360 briefing PDF — fixed template, hard two-page cap.
 * KCPDF.build(JsPDF, briefing, assets) → jsPDF document.
 *   briefing: { business, title, bottom_line, context, numbers[{label,value}],
 *               points[{head,body}], risks[], next_steps[{action,owner,due}], date, prepared_for }
 *   assets:   { regular, semibold (base64 TTF), logo (PNG data URL) }
 */
(function (root) {
  'use strict';

  var RED = [236, 32, 39], INK = [17, 17, 19], BODY = [38, 38, 42], MUTE = [113, 113, 122],
      LINE = [226, 226, 230], WASH = [245, 245, 246], BLACK = [11, 11, 12];
  var PW = 210, PH = 297, M = 18, CW = PW - 2 * M, FOOT = 20;
  var LOGO_RATIO = 1920 / 554;

  /* Characters the embedded Inter subset can draw. Anything else is mapped or dropped. */
  var EXTRA = [0x2013, 0x2014, 0x2018, 0x2019, 0x201C, 0x201D, 0x2022, 0x2026, 0x20A6, 0x20AC, 0x2192, 0x2190,
    0x2191, 0x2193, 0x2212, 0x2264, 0x2265, 0x2248, 0x2713, 0x2030, 0x2122, 0x203A, 0x2039];
  var MAP = { ' ': ' ', ' ': ' ', ' ': ' ', '‑': '-', '‐': '-', '―': '—',
    '‣': '•', '●': '•', '▪': '•', '➔': '→', '⟶': '→', '⇒': '→',
    '✔': '✓', '✅': '✓', '·': '·', '\t': ' ' };
  function clean(s) {
    s = (s === null || s === undefined) ? '' : String(s);
    var out = '';
    for (var i = 0; i < s.length; i++) {
      var ch = s[i], c = s.charCodeAt(i);
      if (MAP[ch] !== undefined) { out += MAP[ch]; continue; }
      if ((c >= 0x20 && c <= 0x7E) || (c >= 0xA1 && c <= 0x17F) || EXTRA.indexOf(c) >= 0) out += ch;
      else if (c === 10 || c === 13) out += ' ';
      /* emoji, CJK and other unsupported glyphs are dropped rather than printed as boxes */
    }
    return out.replace(/\*\*|__|`/g, '').replace(/\s+/g, ' ').trim();
  }
  function cut(s, n) { s = clean(s); return s.length > n ? s.slice(0, n - 1).replace(/[\s,;:.\-]+$/, '') + '…' : s; }

  function normalise(b, level) {
    /* level 0 = as supplied (within template caps); higher levels trim progressively to hold two pages */
    var caps = [
      { pts: 4, risks: 4, steps: 6, nums: 6, body: 330, ctx: 420, risk: 190, bl: 330 },
      { pts: 4, risks: 4, steps: 5, nums: 6, body: 260, ctx: 300, risk: 160, bl: 300 },
      { pts: 3, risks: 3, steps: 5, nums: 6, body: 220, ctx: 0,   risk: 140, bl: 280 },
      { pts: 3, risks: 3, steps: 4, nums: 3, body: 170, ctx: 0,   risk: 110, bl: 240 }
    ][Math.min(level, 3)];
    var arr = function (a) { return Array.isArray(a) ? a : []; };
    return {
      business: cut(b.business || 'Portfolio', 60),
      title: cut(b.title || 'Advisory briefing', 110),
      bottom_line: cut(b.bottom_line, caps.bl),
      context: caps.ctx ? cut(b.context, caps.ctx) : '',
      numbers: arr(b.numbers).filter(function (n) { return n && clean(n.value); }).slice(0, caps.nums)
        .map(function (n) { return { label: cut(n.label, 42), value: cut(n.value, 22) }; }),
      points: arr(b.points).filter(function (p) { return p && (clean(p.head) || clean(p.body)); }).slice(0, caps.pts)
        .map(function (p) { return { head: cut(p.head, 70), body: cut(p.body, caps.body) }; }),
      risks: arr(b.risks).map(function (r) { return cut(typeof r === 'string' ? r : (r && (r.risk || r.text)), caps.risk); })
        .filter(Boolean).slice(0, caps.risks),
      next_steps: arr(b.next_steps).filter(function (s) { return s && clean(s.action); }).slice(0, caps.steps)
        .map(function (s) { return { action: cut(s.action, 130), owner: cut(s.owner || '—', 24), due: cut(s.due || '—', 16) }; }),
      date: clean(b.date) || new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' }),
      prepared_for: cut(b.prepared_for || 'Kelechi Dozie', 60)
    };
  }

  function render(JsPDF, b, assets, scale) {
    var doc = new JsPDF({ unit: 'mm', format: 'a4', compress: true });
    var hasFont = false;
    if (assets && assets.regular && assets.semibold) {
      try {
        doc.addFileToVFS('Inter-Regular.ttf', assets.regular); doc.addFont('Inter-Regular.ttf', 'Inter', 'normal');
        doc.addFileToVFS('Inter-SemiBold.ttf', assets.semibold); doc.addFont('Inter-SemiBold.ttf', 'Inter', 'bold');
        hasFont = true;
      } catch (e) { hasFont = false; }
    }
    var FAM = hasFont ? 'Inter' : 'helvetica';
    var fix = function (s) { return hasFont ? s : s.replace(/₦/g, 'NGN ').replace(/[^\x20-\x7E\xA1-\xFF]/g, ''); };
    var y = 0;
    var cur = null;
    var font = function (w, size, col) { cur = [w, size, col]; doc.setFont(FAM, w); doc.setFontSize(size * scale); doc.setTextColor(col[0], col[1], col[2]); };
    var lh = function (size, k) { return size * scale * 0.3528 * (k || 1.42); };
    var wrap = function (t, w) { return doc.splitTextToSize(fix(t), w); };
    var text = function (t, x, yy, o) { doc.text(typeof t === 'string' ? fix(t) : t.map(fix), x, yy, o || {}); };

    function slimHeader() {
      doc.setFillColor(BLACK[0], BLACK[1], BLACK[2]); doc.rect(0, 0, PW, 13, 'F');
      doc.setFillColor(RED[0], RED[1], RED[2]); doc.rect(0, 13, PW, 0.7, 'F');
      if (assets && assets.logo) { try { doc.addImage(assets.logo, 'PNG', M, 3.6, 5.8 * LOGO_RATIO, 5.8, 'logo', 'FAST'); } catch (e) {} }
      else { doc.setFont(FAM, 'bold'); doc.setFontSize(9); doc.setTextColor(255, 255, 255); doc.text('Insight360', M, 8.3); }
      doc.setFont(FAM, 'normal'); doc.setFontSize(7.5); doc.setTextColor(200, 200, 205);
      doc.text(fix(cut(b.title, 70)), PW - M, 8.2, { align: 'right' });
      y = 25;
    }
    function ensure(h) {
      if (y + h <= PH - FOOT) return false;
      doc.addPage(); slimHeader();
      if (cur) font(cur[0], cur[1], cur[2]); /* the header changed the font; restore the caller's */
      return true;
    }
    function section(label) {
      ensure(16); y += 3;
      font('bold', 7.6, MUTE); text(label.toUpperCase(), M, y, { charSpace: 0.45 });
      doc.setDrawColor(LINE[0], LINE[1], LINE[2]); doc.setLineWidth(0.25); doc.line(M, y + 2.2, PW - M, y + 2.2);
      y += 8;
    }
    function para(t, size, col, weight, x, w, k) {
      font(weight || 'normal', size, col || BODY);
      var lines = wrap(t, w || CW), step = lh(size, k);
      for (var i = 0; i < lines.length; i++) { ensure(step); text(lines[i], x || M, y); y += step; }
    }

    /* ── page 1 masthead ── */
    doc.setFillColor(BLACK[0], BLACK[1], BLACK[2]); doc.rect(0, 0, PW, 33, 'F');
    doc.setFillColor(RED[0], RED[1], RED[2]); doc.rect(0, 33, PW, 0.9, 'F');
    if (assets && assets.logo) { try { doc.addImage(assets.logo, 'PNG', M, 9.2, 14.6 * LOGO_RATIO, 14.6, 'logo', 'FAST'); } catch (e) {} }
    else { doc.setFont(FAM, 'bold'); doc.setFontSize(20); doc.setTextColor(255, 255, 255); doc.text('Insight360', M, 20); }
    doc.setFont(FAM, 'bold'); doc.setFontSize(7.6); doc.setTextColor(255, 255, 255);
    doc.text('ADVISORY BRIEFING', PW - M, 15.2, { align: 'right', charSpace: 0.5 });
    doc.setFont(FAM, 'normal'); doc.setFontSize(8.4); doc.setTextColor(190, 190, 196);
    doc.text(fix(b.date), PW - M, 20.6, { align: 'right' });

    /* ── title block ── */
    y = 47;
    font('bold', 8, RED); text(b.business.toUpperCase(), M, y, { charSpace: 0.5 }); y += 8.4;
    font('bold', 19, INK);
    var tl = wrap(b.title, CW), ts = lh(19, 1.22);
    for (var i = 0; i < tl.length && i < 3; i++) { text(tl[i], M, y); y += ts; }
    y += 0.5;
    font('normal', 8.4, MUTE); text('Prepared for ' + b.prepared_for + '  ·  Confidential', M, y); y += 9;

    /* ── bottom line ── */
    if (b.bottom_line) {
      font('bold', 11.4, INK);
      var bl = wrap(b.bottom_line, CW - 13), bs = lh(11.4, 1.42), bh = 11 + bl.length * bs + 2.5;
      doc.setFillColor(WASH[0], WASH[1], WASH[2]); doc.rect(M, y, CW, bh, 'F');
      doc.setFillColor(RED[0], RED[1], RED[2]); doc.rect(M, y, 1.3, bh, 'F');
      font('bold', 7.2, RED); text('BOTTOM LINE', M + 7, y + 6.6, { charSpace: 0.45 });
      font('bold', 11.4, INK);
      var by = y + 12.6; for (var j = 0; j < bl.length; j++) { text(bl[j], M + 7, by); by += bs; }
      y += bh + 7;
    }

    /* ── numbers ── */
    if (b.numbers.length) {
      var cols = b.numbers.length <= 2 ? b.numbers.length : 3, gap = 4, tw = (CW - gap * (cols - 1)) / cols, th = 19.5;
      for (var n = 0; n < b.numbers.length; n++) {
        var c = n % cols; if (c === 0 && n > 0) y += th + gap; if (c === 0) ensure(th + 2);
        var x = M + c * (tw + gap);
        doc.setDrawColor(LINE[0], LINE[1], LINE[2]); doc.setLineWidth(0.25); doc.rect(x, y, tw, th);
        var vs = 14; font('bold', vs, INK);
        while (vs > 9 && doc.getTextWidth(fix(b.numbers[n].value)) > tw - 8) { vs -= 0.5; font('bold', vs, INK); }
        text(b.numbers[n].value, x + 4, y + 8.6);
        font('normal', 7.6, MUTE); var ll = wrap(b.numbers[n].label, tw - 8);
        text(ll.slice(0, 2), x + 4, y + 13.4, { lineHeightFactor: 1.25 });
      }
      y += th + 6;
    }

    /* ── context ── */
    if (b.context) { section('Context'); para(b.context, 9.8, BODY); y += 2; }

    /* ── key points ── */
    if (b.points.length) {
      section('Analysis');
      b.points.forEach(function (p) {
        font('normal', 9.8, BODY); var pl = wrap(p.body, CW - 6);
        ensure(lh(10.2) + Math.min(pl.length, 2) * lh(9.8) + 1);
        doc.setFillColor(RED[0], RED[1], RED[2]); doc.rect(M, y - 2.5, 1.6, 1.6, 'F');
        if (p.head) { font('bold', 10.2, INK); text(p.head, M + 6, y); y += lh(10.2, 1.36); }
        if (p.body) para(p.body, 9.8, BODY, 'normal', M + 6, CW - 6);
        y += 2.4;
      });
    }

    /* ── risks ── */
    if (b.risks.length) {
      section('Risks');
      b.risks.forEach(function (r) {
        font('normal', 9.8, BODY); var rl = wrap(r, CW - 6), step = lh(9.8);
        ensure(Math.min(rl.length, 2) * step);
        doc.setFillColor(RED[0], RED[1], RED[2]); doc.rect(M, y - 1.5, 2.6, 0.55, 'F');
        for (var k = 0; k < rl.length; k++) { if (k > 0) ensure(step); text(rl[k], M + 6, y); y += step; }
        y += 1.4;
      });
    }

    /* ── next steps ── */
    if (b.next_steps.length) {
      section('Next steps');
      var cA = M + 8, wOwner = 32, wDue = 24, wA = CW - 8 - wOwner - wDue - 6, cO = cA + wA + 4, cD = cO + wOwner + 2;
      font('bold', 7.2, MUTE);
      text('ACTION', cA, y, { charSpace: 0.35 }); text('OWNER', cO, y, { charSpace: 0.35 }); text('DUE', cD, y, { charSpace: 0.35 });
      y += 5.4;
      b.next_steps.forEach(function (s, idx) {
        font('normal', 9.6, BODY); var al = wrap(s.action, wA), step = lh(9.6, 1.36), rh = al.length * step + 3.2;
        if (ensure(rh)) { /* new page: no repeated header needed for a short table */ }
        doc.setDrawColor(LINE[0], LINE[1], LINE[2]); doc.setLineWidth(0.2); doc.line(M, y - 4.2, PW - M, y - 4.2);
        font('bold', 9.6, RED); text(String(idx + 1), M + 1, y);
        font('normal', 9.6, BODY); text(al, cA, y, { lineHeightFactor: 1.36 });
        font('normal', 9.2, INK); text(wrap(s.owner, wOwner)[0] || '', cO, y);
        font('normal', 9.2, INK); text(wrap(s.due, wDue)[0] || '', cD, y);
        y += rh;
      });
    }

    /* ── footers ── */
    var pages = doc.getNumberOfPages();
    for (var p = 1; p <= pages; p++) {
      doc.setPage(p);
      doc.setDrawColor(LINE[0], LINE[1], LINE[2]); doc.setLineWidth(0.25); doc.line(M, PH - 14, PW - M, PH - 14);
      doc.setFont(FAM, 'normal'); doc.setFontSize(7.4); doc.setTextColor(MUTE[0], MUTE[1], MUTE[2]);
      doc.text('Insight360 by IONEC  ·  Advisory briefing  ·  Confidential', M, PH - 9.2);
      doc.text('Page ' + p + ' of ' + pages, PW - M, PH - 9.2, { align: 'right' });
    }
    doc.setProperties({ title: fix(b.title), subject: 'Insight360 advisory briefing', author: 'Insight360', creator: 'Kunoch Command' });
    return doc;
  }

  /* Try the full content first; shrink type slightly, then trim content, until it fits two pages. */
  function build(JsPDF, briefing, assets) {
    var plan = [[0, 1], [0, 0.95], [1, 0.95], [1, 0.9], [2, 0.9], [3, 0.9], [3, 0.86]], doc = null;
    for (var i = 0; i < plan.length; i++) {
      doc = render(JsPDF, normalise(briefing, plan[i][0]), assets, plan[i][1]);
      if (doc.getNumberOfPages() <= 2) break;
    }
    while (doc.getNumberOfPages() > 2) doc.deletePage(doc.getNumberOfPages());
    return doc;
  }

  var api = { build: build, clean: clean };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.KCPDF = api;
})(typeof window !== 'undefined' ? window : globalThis);
