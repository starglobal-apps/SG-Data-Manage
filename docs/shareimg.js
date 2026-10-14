// shareimg.js — phone: reports go to WhatsApp as an image of the proper format (attendance stays text).
//  S.tableImage(spec) draws a printed-style table on a canvas; S.shareImage(title, canvas, name) shows it and shares the PNG
//  through the phone's share sheet (WhatsApp, …), or downloads it where sharing files is not possible.
(function () {
  'use strict';
  var S = window.SG, $ = S.$, esc = S.esc;
  var FONT = '-apple-system, Roboto, "Segoe UI", Arial, sans-serif';

  // spec: { title, sub, info: [[label, value], …] (two per row), groups: [{ t, n }], cols: [{ t, w, align }],
  //         rows: [{ cells: [...], fill, bold }], foot: [text, …], stamp }
  S.tableImage = function (spec) {
    var Z = 2, pad = 24, rowH = 40, headH = 54, cols = spec.cols, tw = cols.reduce(function (a, c) { return a + c.w; }, 0);
    var infoRows = Math.ceil((spec.info || []).length / 2), W = tw + pad * 2;
    var H = pad + 44 + (spec.sub ? 30 : 0) + 10 + infoRows * 34 + (infoRows ? 12 : 0) + (spec.groups ? 36 : 0) + headH + spec.rows.length * rowH + 16 + (spec.foot || []).length * 30 + 34 + pad;
    var cv = document.createElement('canvas'); cv.width = W * Z; cv.height = H * Z;
    var c = cv.getContext('2d'); c.scale(Z, Z);
    c.fillStyle = '#fff'; c.fillRect(0, 0, W, H); c.textBaseline = 'middle';
    var font = function (sz, b) { c.font = (b ? '700 ' : '500 ') + sz + 'px ' + FONT; };
    var text = function (t, x, y, o) {
      o = o || {}; font(o.size || 17, o.bold); c.fillStyle = o.color || '#111827'; c.textAlign = o.align || 'left';
      var s = String(t == null ? '' : t), max = o.max;
      if (max) while (s.length > 1 && c.measureText(s).width > max) s = s.slice(0, -2) + '…';
      c.fillText(s, x, y);
    };
    var box = function (x, y, w, h, fill) { if (fill) { c.fillStyle = fill; c.fillRect(x, y, w, h); } c.strokeStyle = '#9ca3af'; c.lineWidth = 1; c.strokeRect(x + .5, y + .5, w, h); };
    var y = pad;
    text(spec.title, pad, y + 20, { size: 26, bold: true }); y += 44;
    if (spec.sub) { text(spec.sub, pad, y + 12, { size: 17, color: '#4b5563' }); y += 30; }
    y += 10;
    // info block: label | value, two pairs a row
    var info = spec.info || [], half = tw / 2;
    for (var i = 0; i < info.length; i += 2) {
      [info[i], info[i + 1]].forEach(function (p, k) {
        if (!p) return; var x = pad + k * half;
        box(x, y, 150, 34, '#f3f4f6'); text(p[0], x + 10, y + 17, { size: 15, bold: true, color: '#374151', max: 136 });
        box(x + 150, y, half - 150, 34); text(p[1], x + 160, y + 17, { size: 16, max: half - 170 });
      });
      y += 34;
    }
    if (info.length) y += 12;
    // group header
    if (spec.groups) {
      var gx = pad, ci = 0;
      spec.groups.forEach(function (g) {
        var w = 0; for (var k = 0; k < g.n; k++) w += cols[ci + k].w; ci += g.n;
        box(gx, y, w, 36, '#e5e7eb'); text(g.t, gx + w / 2, y + 18, { size: 16, bold: true, align: 'center' }); gx += w;
      });
      y += 36;
    }
    // column header (up to two lines)
    var x = pad;
    cols.forEach(function (col) {
      box(x, y, col.w, headH, '#f3f4f6');
      var words = String(col.t).split(' '), l1 = col.t, l2 = '';
      font(14, true);
      if (c.measureText(col.t).width > col.w - 10 && words.length > 1) { l1 = words.slice(0, Math.ceil(words.length / 2)).join(' '); l2 = words.slice(Math.ceil(words.length / 2)).join(' '); }
      if (l2) { text(l1, x + col.w / 2, y + headH * 0.32, { size: 14, bold: true, align: 'center', max: col.w - 8 }); text(l2, x + col.w / 2, y + headH * 0.7, { size: 14, bold: true, align: 'center', max: col.w - 8 }); }
      else text(l1, x + col.w / 2, y + headH / 2, { size: 14, bold: true, align: 'center', max: col.w - 8 });
      x += col.w;
    });
    y += headH;
    // rows
    spec.rows.forEach(function (r) {
      var rx = pad;
      cols.forEach(function (col, k) {
        box(rx, y, col.w, rowH, r.fill);
        var v = r.cells[k], al = col.align || 'center';
        text(v, al === 'left' ? rx + 8 : al === 'right' ? rx + col.w - 8 : rx + col.w / 2, y + rowH / 2, { size: 16, bold: !!r.bold || (r.boldCols && r.boldCols.indexOf(k) >= 0), align: al, max: col.w - 12, color: r.colors && r.colors[k] });
        rx += col.w;
      });
      y += rowH;
    });
    y += 16;
    (spec.foot || []).forEach(function (f) { text(f, pad, y + 14, { size: 18, bold: true }); y += 30; });
    text(spec.stamp || '', W - pad, H - pad - 10, { size: 13, color: '#6b7280', align: 'right' });
    return cv;
  };

  // preview + share (needs the tap: the image is made first, the share button then shares at once)
  S.shareImage = function (title, canvas, name) {
    S.sheet.open(title, '<div class="si-prev"><div class="empty">Making the image…</div></div>' +
      '<button class="btn big wa" id="si-share" disabled style="display:flex;align-items:center;justify-content:center;gap:8px">' + S.icon('wa') + ' Share image (WhatsApp)</button>' +
      '<button class="btn ghost big" id="si-dl" disabled>Download image</button>');
    var blob = null;
    canvas.toBlob(function (b) {
      blob = b; var url = URL.createObjectURL(b), pv = $('.si-prev');
      if (pv) pv.innerHTML = '<img src="' + url + '" alt="' + esc(title) + '">';
      $('#si-share').disabled = false; $('#si-dl').disabled = false;
    }, 'image/png');
    var download = function () { var a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name; document.body.appendChild(a); a.click(); setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 2000); };
    $('#sheet-content').onclick = function (e) {
      var b = e.target.closest('button'); if (!b || !blob) return;
      if (b.id === 'si-dl') { download(); return; }
      if (b.id === 'si-share') {
        var file = new File([blob], name, { type: 'image/png' });
        if (navigator.canShare && navigator.canShare({ files: [file] })) navigator.share({ files: [file], title: title }).then(function () { S.sheet.close(); }).catch(function () {});
        else { S.toast('This phone cannot share images from the app — the image is downloaded, send it from the gallery', '', 6000); download(); }
      }
    };
  };
  S.imgStamp = function () { var d = new Date(), p = function (v) { return ('0' + v).slice(-2); }; return 'SG Data · ' + p(d.getDate()) + '/' + p(d.getMonth() + 1) + '/' + d.getFullYear() + ' ' + p(d.getHours()) + ':' + p(d.getMinutes()) + ' · ' + ((S.state.user && S.state.user.name) || ''); };
})();

// ---------- Production Output Report image: a dashboard (KPI tiles, charts, detail tables) to share in WhatsApp ----------
(function () {
  'use strict';
  var S = window.SG;
  var FONT = '-apple-system, Roboto, "Segoe UI", Arial, sans-serif';
  var C = { bg: '#f3f4f8', card: '#ffffff', border: '#e3e6ec', ink: '#111827', sub: '#6b7280', grid: '#eef0f4', navy: '#0f2a5f', blue: '#2563eb',
            plan: '#cbd5e1', good: '#16a34a', mid: '#d97706', bad: '#dc2626', teal: '#0d9488', purple: '#7c3aed', orange: '#ea580c', head: '#f3f5f9' };
  function achC(a) { return a === '' || a == null ? C.sub : a >= 100 ? C.good : a >= 85 ? C.mid : C.bad; }
  function n(v) { return v === '' || v === null || v === undefined ? '–' : Math.round(+v).toLocaleString('en-IN'); }
  function nm(v) { return String(v || '').replace(/^[A-Z]{1,4}\d{3,}\s*-\s*/i, ''); }
  function sl(v) { return String(v || '').replace(/^FAC\d+-/i, ''); }
  function sum(a, f) { return a.reduce(function (t, x) { return t + (+f(x) || 0); }, 0); }
  function rr(c, x, y, w, h, r) { c.beginPath(); c.moveTo(x + r, y); c.arcTo(x + w, y, x + w, y + h, r); c.arcTo(x + w, y + h, x, y + h, r); c.arcTo(x, y + h, x, y, r); c.arcTo(x, y, x + w, y, r); c.closePath(); }

  // d: m.pdr reply. only: a master's name -> that master; '__packing' -> finishing; '__cutting' -> cutting; empty -> everything
  S.pdrImage = function (d, only) {
    var mode = only === '__packing' ? 'packing' : only === '__cutting' ? 'cutting' : only ? 'master' : 'all';
    var masters = mode === 'all' || mode === 'master' ? d.masters.filter(function (m) { return mode === 'all' || m.master === only; }) : [];
    var floors = mode === 'all' || mode === 'packing' ? (d.packing || []) : [];
    var cuts = mode === 'all' || mode === 'cutting' ? (d.cutting || []) : [];
    var lines = [].concat.apply([], masters.map(function (m) { return m.lines; }));
    var W = 1600, pad = 28, gap = 20, IW = W - pad * 2;
    var mc = document.createElement('canvas').getContext('2d');
    var wrap = function (s, max, sz) {   // up to 2 lines
      mc.font = '500 ' + sz + 'px ' + FONT; s = String(s == null ? '' : s);
      if (mc.measureText(s).width <= max) return [s];
      var out = [], a = '';
      s.split(' ').forEach(function (wd) { var t = a ? a + ' ' + wd : wd; if (a && mc.measureText(t).width > max) { out.push(a); a = wd; } else a = t; });
      if (a) out.push(a);
      return out.length > 2 ? [out[0], out.slice(1).join(' ')] : out;
    };

    // ---- totals
    var T = mode === 'all' ? d.total : { planOut: sum(masters, function (m) { return m.planOut; }), out: sum(masters, function (m) { return m.out; }), mp: sum(masters, function (m) { return m.mp; }), planMp: sum(masters, function (m) { return m.planMp; }), ach: masters[0] ? masters[0].ach : '' };
    var endChk = sum(lines, function (l) { return l.endChecked; }), endPass = sum(lines, function (l) { return l.endPass; });
    var fq = sum(floors, function (f) { return f.qty; }), fc = sum(floors, function (f) { return f.cartons; }), fm = sum(floors, function (f) { return f.mp; });
    var cq = sum(cuts, function (x) { return x.qty; }), nfab = sum(cuts, function (x) { return x.rows.length; });

    // ---- blocks: heights first, then draw
    var HEAD = 104, KPI = 122, TITLE = 54;
    var sRow = 40, stitchH = masters.length ? TITLE + 40 + sum(masters, function (m) { return 36 + m.lines.length * sRow; }) + 40 + 16 : 0;
    var both = floors.length && cuts.length, halfW = both ? (IW - gap) / 2 : IW;
    // finishing / cutting: bar chart + table, rows built for the card width
    var tbl = function (cols, rows, w) {
      var iw = w - 32; cols.forEach(function (col) { col.w = col.f * iw; });
      rows.forEach(function (r) {
        var nl = 1;
        r.cells = r.cells.map(function (v, k) { if (!cols[k].wrap || r.kind) return v; var l = wrap(v, cols[k].w - 20, 14.5); nl = Math.max(nl, l.length); return l; });
        r.h = r.kind === 'sub' ? 32 : r.kind === 'tot' ? 38 : Math.max(r.pending ? 46 : 36, nl * 18 + 14 + (r.pending ? 10 : 0));
      });
      return { cols: cols, rows: rows, h: 36 + sum(rows, function (r) { return r.h; }) };
    };
    var finT = null, cutT = null;
    if (floors.length) {
      var fr = [];
      floors.forEach(function (f) {
        f.rows.forEach(function (r, i) { fr.push({ cells: [i ? '' : sl(f.floor), r.srn, r.item || '–', n(r.qty), n(r.cartons), n(r.mp), r.hours || '–'], pending: r.pending, sep: i === 0 && fr.length > 0 }); });
        if (f.rows.length > 1) fr.push({ cells: ['', sl(f.floor) + ' total', '', n(f.qty), n(f.cartons), n(f.mp), ''], kind: 'sub' });
      });
      fr.push({ cells: ['Total', '', '', n(fq), n(fc), n(fm), ''], kind: 'tot' });
      finT = tbl([{ t: 'Floor', f: .15, a: 'l', b: 1, wrap: 1 }, { t: 'SRN', f: .15, a: 'l', b: 1 }, { t: 'Style', f: .25, a: 'l', wrap: 1 }, { t: 'Packed', f: .13, b: 1, c: C.purple }, { t: 'Cartons', f: .11 }, { t: 'MP', f: .1 }, { t: 'Hours', f: .11 }], fr, halfW);
      finT.chartH = 0;
      finT.h += TITLE + 14;
    }
    if (cuts.length) {
      var cr = [];
      cuts.forEach(function (x) { x.rows.forEach(function (r, i) { cr.push({ cells: [i ? '' : x.srn, r.intent || '–', r.fabric || '–', n(r.qty)], sep: i === 0 && cr.length > 0 }); }); });
      cr.push({ cells: ['Total', '', cuts.length + ' SRN · ' + nfab + (nfab > 1 ? ' fabrics' : ' fabric'), n(cq)], kind: 'tot' });
      cutT = tbl([{ t: 'SRN', f: .17, a: 'l', b: 1 }, { t: 'Intent', f: .18, a: 'l' }, { t: 'Fabric', f: .5, a: 'l', wrap: 1 }, { t: 'Cut qty', f: .15, b: 1, c: C.orange }], cr, halfW);
      cutT.chartH = 0;
      cutT.h += TITLE + 14;
    }
    var bottomH = both ? Math.max(finT.h, cutT.h) : finT ? finT.h : cutT ? cutT.h : 0;
    var FOOT = 70;
    var H = HEAD + 24 + KPI + gap + (stitchH ? stitchH + gap : 0) + (bottomH ? bottomH + gap : 0) + FOOT;
    var Z = Math.max(1, Math.min(2, Math.floor(Math.sqrt(16000000 / (W * H)) * 100) / 100));   // phone canvas size limit

    var cv = document.createElement('canvas'); cv.width = Math.round(W * Z); cv.height = Math.round(H * Z);
    var c = cv.getContext('2d'); c.scale(Z, Z); c.textBaseline = 'middle';
    var text = function (t, x, y, o) {
      o = o || {}; c.font = (o.w || 500) + ' ' + (o.size || 15) + 'px ' + FONT; c.fillStyle = o.color || C.ink; c.textAlign = o.align || 'left';
      var s = String(t == null ? '' : t); if (o.max) while (s.length > 1 && c.measureText(s).width > o.max) s = s.slice(0, -2) + '…';
      c.fillText(s, x, y); return c.measureText(s).width;
    };
    var card = function (x, y, w, h, title, sub) {
      c.save(); c.shadowColor = 'rgba(15,23,42,.06)'; c.shadowBlur = 10; c.shadowOffsetY = 2; c.fillStyle = C.card; rr(c, x, y, w, h, 12); c.fill(); c.restore();
      c.strokeStyle = C.border; c.lineWidth = 1; rr(c, x + .5, y + .5, w - 1, h - 1, 12); c.stroke();
      if (title) text(title, x + 18, y + 28, { size: 17, w: 700 });
      if (sub) text(sub, x + w - 18, y + 28, { size: 13, w: 600, color: C.sub, align: 'right', max: w * 0.55 });
    };

    c.fillStyle = C.bg; c.fillRect(0, 0, W, H);
    // ---- header
    var g = c.createLinearGradient(0, 0, W, 0); g.addColorStop(0, C.navy); g.addColorStop(1, '#1d4ed8');
    c.fillStyle = g; c.fillRect(0, 0, W, HEAD);
    var p = d.date.split('-'), day = new Date(+p[0], +p[1] - 1, +p[2]).toLocaleDateString('en-IN', { weekday: 'long', day: '2-digit', month: 'short', year: 'numeric' });
    var title = mode === 'packing' ? 'Finishing Output Report' : mode === 'cutting' ? 'Cutting Output Report' : 'Production Output Report';
    text(title, pad, 42, { size: 30, w: 800, color: '#fff' });
    var parts = mode === 'packing' ? ['Finishing'] : mode === 'cutting' ? ['Cutting'] : ['Stitching', 'Endline'].concat(floors.length ? ['Finishing'] : [], cuts.length ? ['Cutting'] : []);
    text('FAC' + d.factory + '  ·  ' + day + '  ·  ' + parts.join(' · ') + (mode === 'master' ? '  ·  Master: ' + nm(only) : ''), pad, 76, { size: 15, w: 500, color: '#c7d2fe' });
    text('SG Data', W - pad, 42, { size: 18, w: 800, color: '#fff', align: 'right' });
    text('Previous day report', W - pad, 74, { size: 13, w: 600, color: '#c7d2fe', align: 'right' });
    var y = HEAD + 24;

    // ---- KPI tiles
    var kpis;
    var varT = T.planOut ? T.out - T.planOut : '';
    var rate = endChk ? Math.round(endPass / endChk * 1000) / 10 : '';
    if (mode === 'packing') kpis = [{ l: 'Packed pcs', v: n(fq), c: C.purple }, { l: 'Cartons', v: n(fc), c: C.ink }, { l: 'Floors', v: String(floors.length), c: C.ink, s: sum(floors, function (f) { return f.rows.length; }) + ' SRN' }, { l: 'Manpower', v: n(fm), c: C.ink, s: 'pressman + checker + TC + helper' }];
    else if (mode === 'cutting') kpis = [{ l: 'Cut qty', v: n(cq), c: C.orange }, { l: 'SRN', v: String(cuts.length), c: C.ink }, { l: 'Fabrics', v: String(nfab), c: C.ink }];
    else {
      kpis = [{ l: 'Stitching plan output', v: n(T.planOut), c: C.ink, s: 'plan MP ' + n(T.planMp) },
              { l: 'Stitching actual output', v: n(T.out), c: C.blue, s: T.ach === '' ? 'no plan' : T.ach + '% achieved', sc: achC(T.ach) },
              { l: 'Stitching variance', v: varT === '' ? '–' : (varT > 0 ? '+' : '') + n(varT), c: varT === '' ? C.sub : varT < 0 ? C.bad : C.good, s: varT === '' ? 'no plan' : varT < 0 ? 'below plan' : 'above plan' },
              { l: 'Endline pass', v: n(endPass), c: C.teal, s: rate === '' ? 'no endline' : rate + '% of ' + n(endChk) + ' checked' }];
      if (mode === 'all') kpis.push({ l: 'Packed pcs', v: n(fq), c: C.purple, s: floors.length ? n(fc) + ' cartons' : 'no finishing' }, { l: 'Total cut pcs', v: n(cq), c: C.orange, s: cuts.length ? cuts.length + ' SRN · ' + nfab + ' fabrics' : 'no cutting' });
      else kpis.push({ l: 'Achievement', v: T.ach === '' ? '–' : T.ach + '%', c: achC(T.ach), s: lines.length + (lines.length > 1 ? ' lines' : ' line') + ' · actual MP ' + n(T.mp) });
    }
    var kw = (IW - (kpis.length - 1) * 16) / kpis.length;
    kpis.forEach(function (k, i) {
      var x = pad + i * (kw + 16);
      card(x, y, kw, KPI);
      c.fillStyle = k.c; rr(c, x, y, kw, 5, 2.5); c.fill(); c.fillRect(x + 6, y, kw - 12, 5);
      text(k.l.toUpperCase(), x + 18, y + 30, { size: 12.5, w: 700, color: C.sub });
      text(k.v, x + 18, y + 66, { size: 32, w: 800, color: k.c, max: kw - 30 });
      if (k.s) text(k.s, x + 18, y + 100, { size: 13, w: 600, color: k.sc || C.sub, max: kw - 30 });
    });
    y += KPI + gap;

    if (masters.length) {
      // ---- stitching detail table (matrix: master subtotal, lines, grand total)
      card(pad, y, IW, stitchH, 'Stitching detail · master-wise', 'plan output = actual man-hours × plan rate of the day');
      var cols = [{ t: 'Supervisor', w: 186, a: 'l' }, { t: 'Line', w: 150, a: 'l' }, { t: 'SRN', w: 106, a: 'l' }, { t: 'Plan MP', w: 78 }, { t: 'Plan output', w: 112 }, { t: 'Actual MP', w: 108 },
                  { t: 'Actual output', w: 112 }, { t: 'End check', w: 90 }, { t: 'End pass', w: 90 }, { t: 'Variance', w: 92 }, { t: 'Hours', w: 96 }];
      var used = sum(cols, function (x) { return x.w; }); cols.push({ t: 'Achievement', w: IW - 32 - used });
      var extra = cols[11].w - 150; if (extra > 0) { cols[11].w = 150; cols.forEach(function (col, k) { if (k < 11) col.w += extra * col.w / used; }); }
      var xs = [], cx = pad + 16; cols.forEach(function (col) { xs.push(cx); cx += col.w; });
      var cxOf = function (k) { return cols[k].a === 'l' ? xs[k] + 10 : xs[k] + cols[k].w / 2; };
      var ty = y + TITLE;
      c.fillStyle = C.navy; rr(c, pad + 16, ty, IW - 32, 40, 8); c.fill();
      cols.forEach(function (col, k) { text(col.t.toUpperCase(), cxOf(k), ty + 20, { size: 11.5, w: 800, color: '#fff', align: col.a === 'l' ? 'left' : 'center', max: col.w - 8 }); });
      ty += 40;
      var achCell = function (a, ry, h, bold) {
        var k = 11, cx0 = xs[k] + cols[k].w / 2, label = a === '' ? 'no plan' : a + '%', bg = a === '' ? '#f1f5f9' : a >= 100 ? '#dcfce7' : a >= 85 ? '#fef3c7' : '#fee2e2';
        c.font = '800 ' + (bold ? 15 : 14) + 'px ' + FONT; var pw = c.measureText(label).width + 26;
        c.fillStyle = bg; rr(c, cx0 - pw / 2, ry + h / 2 - 13, pw, 26, 13); c.fill();
        text(label, cx0, ry + h / 2, { size: bold ? 15 : 14, w: 800, color: achC(a), align: 'center' });
      };
      masters.forEach(function (m) {
        c.fillStyle = '#e8efff'; c.fillRect(pad + 16, ty, IW - 32, 36);
        var mv = m.planOut ? m.out - m.planOut : '';
        var mcells = [nm(m.master), m.lines.length + (m.lines.length > 1 ? ' lines' : ' line'), '', n(m.planMp), n(m.planOut), n(m.mp), n(m.out), n(m.endChecked || 0), n(m.endPass || 0), mv === '' ? '–' : (mv > 0 ? '+' : '') + n(mv), ''];
        mcells.forEach(function (v, k) { text(v, cxOf(k), ty + 18, { size: k === 0 ? 14.5 : 13.5, w: 800, color: k === 9 && mv !== '' ? (mv < 0 ? C.bad : C.good) : k === 8 ? C.teal : C.navy, align: cols[k].a === 'l' ? 'left' : 'center', max: k === 0 ? cols[0].w + cols[1].w - 20 : cols[k].w - 10 }); });
        achCell(m.ach, ty, 36, true);
        ty += 36;
        m.lines.forEach(function (l, i) {
          if (i % 2) { c.fillStyle = '#fafbfd'; c.fillRect(pad + 16, ty, IW - 32, sRow); }
          c.fillStyle = C.grid; c.fillRect(pad + 16, ty + sRow - 1, IW - 32, 1);
          var lv = l.variance;
          var cells = [nm(l.supervisor) || '–', sl(l.dept), l.srn, n(l.planMp), n(l.planOut), n(l.mp) + (l.mpOt ? ' +' + l.mpOt + ' OT' : ''), l.endOnly ? '–' : n(l.out), n(l.endChecked || 0), n(l.endPass || 0),
                       lv === '' ? '–' : (lv > 0 ? '+' : '') + n(lv), (l.hours || 0) + (l.hoursOt ? ' + ' + l.hoursOt : '')];
          cells.forEach(function (v, k) {
            var o = { size: 14, w: k === 1 || k === 6 ? 700 : 500, color: C.ink, align: cols[k].a === 'l' ? 'left' : 'center', max: cols[k].w - 12 };
            if (k === 0) { o.size = 13; o.color = '#374151'; }
            if (k === 8) { o.w = 700; o.color = C.teal; }
            if (k === 9 && lv !== '') o.color = lv < 0 ? C.bad : C.good;
            var yy = ty + sRow / 2 - (k === 4 && l.planOut !== '' && S.pdrPlanSrc ? 6 : k === 1 && l.pending ? 6 : 0);
            text(v, cxOf(k), yy, o);
          });
          if (S.pdrPlanSrc && l.planOut !== '') text(S.pdrPlanSrc(l), cxOf(4), ty + sRow - 9, { size: 10, w: 600, color: C.sub, align: 'center', max: cols[4].w - 6 });
          if (l.pending) text('● waiting approval', cxOf(1), ty + sRow - 9, { size: 10, w: 700, color: C.mid });
          achCell(l.ach, ty, sRow);
          ty += sRow;
        });
      });
      c.fillStyle = '#dbeafe'; rr(c, pad + 16, ty + 2, IW - 32, 36, 8); c.fill();
      var tv2 = T.planOut ? T.out - T.planOut : '';
      ['Total', lines.length + ' lines', '', n(T.planMp), n(T.planOut), n(T.mp), n(T.out), n(endChk), n(endPass), tv2 === '' ? '–' : (tv2 > 0 ? '+' : '') + n(tv2), ''].forEach(function (v, k) {
        text(v, cxOf(k), ty + 20, { size: 14.5, w: 800, color: k === 9 && tv2 !== '' ? (tv2 < 0 ? C.bad : C.good) : C.navy, align: cols[k].a === 'l' ? 'left' : 'center', max: cols[k].w - 10 });
      });
      achCell(T.ach, ty + 2, 36, true);
      y += stitchH + gap;
    }

    // ---- finishing / cutting: bar chart + table
    var block = function (x, w, t, h, ttl, sub, color) {
      card(x, y, w, h, ttl, sub);
      c.fillStyle = color; c.fillRect(x + 1, y + 16, 4, 24);
      var ty2 = y + TITLE;
      var xs2 = [], cx2 = x + 16; t.cols.forEach(function (col) { xs2.push(cx2); cx2 += col.w; });
      var cxo = function (k) { return t.cols[k].a === 'l' ? xs2[k] + 10 : xs2[k] + t.cols[k].w / 2; };
      c.fillStyle = C.head; rr(c, x + 16, ty2, w - 32, 36, 8); c.fill();
      t.cols.forEach(function (col, k) { text(col.t.toUpperCase(), cxo(k), ty2 + 18, { size: 11.5, w: 800, color: C.sub, align: col.a === 'l' ? 'left' : 'center', max: col.w - 8 }); });
      ty2 += 36;
      t.rows.forEach(function (r) {
        if (r.kind === 'sub') { c.fillStyle = '#f5f3ff'; c.fillRect(x + 16, ty2, w - 32, r.h); }
        else if (r.kind === 'tot') { c.fillStyle = '#dbeafe'; rr(c, x + 16, ty2 + 2, w - 32, r.h - 4, 8); c.fill(); }
        else if (r.sep) { c.fillStyle = C.border; c.fillRect(x + 16, ty2, w - 32, 1); }
        var up = r.pending ? 5 : 0;
        t.cols.forEach(function (col, k) {
          var v = r.cells[k], o = { size: 14.5, w: r.kind ? 800 : col.b ? 700 : 500, color: r.kind ? C.navy : col.c || C.ink, align: col.a === 'l' ? 'left' : 'center', max: col.w - 14 };
          if (Array.isArray(v)) v.forEach(function (ln, li) { text(ln, cxo(k), ty2 + r.h / 2 + (li - (v.length - 1) / 2) * 18 - up, o); });
          else text(v, cxo(k), ty2 + r.h / 2 - up, o);
        });
        if (r.pending) text('● waiting approval', cxo(1), ty2 + r.h - 9, { size: 10, w: 700, color: C.mid });
        ty2 += r.h;
      });
    };
    if (bottomH) {
      var bxL = pad;
      if (finT) { block(bxL, halfW, finT, bottomH, 'Finishing · floor-wise', n(fq) + ' pcs · ' + n(fc) + ' cartons', C.purple); bxL += halfW + gap; }
      if (cutT) block(bxL, halfW, cutT, bottomH, 'Cutting · fabric-wise', n(cq) + ' cut · ' + cuts.length + ' SRN', C.orange);
      y += bottomH + gap;
    }

    // ---- footer
    var note1 = mode === 'cutting' ? 'Cut qty from the cutting sheet, per SRN, intent number and fabric.' : mode === 'packing' ? 'Finishing manpower = pressman + checker + thread cutter + helper.' :
                'Plan output = actual man-hours (shift + OT) × plan rate of the day (learning curve %, 100% after the plan ends, else Making Bulletin SAM)  ·  Achievement = actual ÷ plan';
    var note2 = mode === 'cutting' ? '' : mode === 'packing' ? '● waiting approval = not yet approved, included' :
                'MP = operator + helper + paster + QC + thread cutter + hand needle' + (floors.length ? '  ·  Finishing MP = pressman + checker + thread cutter + helper' : '') + '  ·  ● waiting approval = included';
    text(note1, pad, H - 44, { size: 12.5, w: 500, color: C.sub, max: IW });
    text(note2, pad, H - 22, { size: 12.5, w: 500, color: C.sub, max: IW - 340 });
    text(S.imgStamp ? S.imgStamp() : '', W - pad, H - 22, { size: 12.5, w: 600, color: C.sub, align: 'right' });
    return cv;
  };
})();
