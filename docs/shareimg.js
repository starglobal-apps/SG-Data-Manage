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

// ---------- Production Output Report image: plain tables, one row per line, readable on a phone; height follows the data ----------
(function () {
  'use strict';
  var S = window.SG;
  var FONT = '-apple-system, Roboto, "Segoe UI", Arial, sans-serif';
  var C = { ink: '#111827', sub: '#6b7280', line: '#e5e7eb', soft: '#f3f4f6', head: '#1e3a8a', ov: '#f5f3ff', ovHead: '#6d28d9', good: '#15803d', bad: '#dc2626', warn: '#b45309' };
  function n(v) { return v === '' || v === null || v === undefined ? '–' : Math.round(+v).toLocaleString('en-IN'); }
  function sg(v) { return v === '' || v === null || v === undefined ? '–' : (v > 0 ? '+' : '') + n(v); }
  function vc(v) { return v === '' || v == null ? C.sub : v < 0 ? C.bad : C.good; }
  function nm(v) { return String(v || '').replace(/^[A-Z]{1,4}\d{3,}\s*-\s*/i, ''); }
  function sl(v) { return String(v || '').replace(/^FAC\d+-/i, ''); }
  function sum(a, f) { return a.reduce(function (t, x) { return t + (+f(x) || 0); }, 0); }

  // d: m.pdr reply. only: a master's name -> that master; '__packing' -> packing only; empty -> everything
  S.pdrImage = function (d, only) {
    var mode = only === '__packing' ? 'packing' : only ? 'master' : 'all';
    var masters = mode === 'packing' ? [] : d.masters.filter(function (m) { return mode === 'all' || m.master === only; });
    var lines = [].concat.apply([], masters.map(function (m) { return m.lines; }));
    var depts = {}; lines.forEach(function (l) { depts[l.dept] = 1; });
    var endl = mode === 'packing' ? [] : (d.endline || []).filter(function (e) { return mode === 'all' || depts[e.dept]; });
    var floors = mode === 'master' ? [] : (d.packing || []);
    var T = { planOut: sum(masters, function (m) { return m.planOut; }), out: sum(masters, function (m) { return m.out; }), mp: sum(lines, function (l) { return l.mp; }),
              ovPlan: sum(masters, function (m) { return m.ovPlan; }), ovOut: sum(masters, function (m) { return m.ovOut; }), endPass: sum(lines, function (l) { return l.endPass; }) };
    var varT = T.planOut ? T.out - T.planOut : '', ovVarT = T.ovPlan ? T.ovOut - T.ovPlan : '';
    var endChk = sum(endl, function (e) { return e.checked; }), endPass = sum(endl, function (e) { return e.pass; }), endFail = sum(endl, function (e) { return e.fail; });
    var fq = sum(floors, function (f) { return f.qty; }), fc = sum(floors, function (f) { return f.cartons; });
    var wk = !!d.weekly, dOf = function (s) { var q = s.split('-'); return new Date(+q[0], +q[1] - 1, +q[2]); };
    var day = wk ? dOf(d.from).toLocaleDateString('en-IN', { weekday: 'short', day: '2-digit', month: 'short' }) + ' – ' + dOf(d.to).toLocaleDateString('en-IN', { weekday: 'short', day: '2-digit', month: 'short', year: 'numeric' })
                 : dOf(d.date).toLocaleDateString('en-IN', { weekday: 'short', day: '2-digit', month: 'short', year: 'numeric' });

    var W = 900, X = 20, IW = W - X * 2, c = null, y = 0;
    var mc = document.createElement('canvas').getContext('2d');
    var setFont = function (ctx, o) { ctx.font = (o.w || 500) + ' ' + (o.size || 19) + 'px ' + FONT; };
    var fit = function (s, o, max) { setFont(mc, o); s = String(s == null ? '' : s); if (max) while (s.length > 1 && mc.measureText(s).width > max) s = s.slice(0, -2) + '…'; return s; };
    var text = function (t, x, yy, o) { o = o || {}; if (!c) return; setFont(c, o); c.fillStyle = o.color || C.ink; c.textAlign = o.align || 'left'; c.fillText(fit(t, o, o.max), x, yy); };
    var rect = function (x, yy, w, h, color) { if (c) { c.fillStyle = color; c.fillRect(x, yy, w, h); } };
    var section = function (title, right) {
      y += 20;
      text(title, X, y + 16, { size: 23, w: 800, color: C.head });
      if (right) text(right, W - X, y + 16, { size: 16, w: 600, color: C.sub, align: 'right', max: IW - 220 });
      y += 34; rect(X, y, IW, 3, C.head); y += 3;
    };
    // a table: cols [{ t, w (share), a: 'l' | centre, ov }]; returns x of each column
    var layout = function (cols) { var tot = sum(cols, function (x) { return x.w; }), ax = X; cols.forEach(function (col) { col.x = ax; col.w = col.w / tot * IW; ax += col.w; }); return cols; };
    var cx = function (col) { return col.a === 'l' ? col.x + 8 : col.x + col.w / 2; };

    var draw = function () {
      y = 0;
      // header
      rect(0, 0, W, 96, C.head);
      text((wk ? 'Weekly ' : '') + (mode === 'packing' ? 'Packing Report' : 'Production Report'), X, 38, { size: 28, w: 800, color: '#fff' });
      text('FAC' + d.factory + '  ·  ' + day + (mode === 'master' ? '  ·  ' + nm(only) : ''), X, 72, { size: 18, w: 500, color: '#dbeafe', max: IW });
      y = 96 + 16;

      // KPI cards: 3 per row
      var k = mode === 'packing' ? [['Packed pcs', n(fq), C.ink, ''], ['Cartons', n(fc), C.ink, ''], ['Floors', String(floors.length), C.ink, '']] :
        [['Stitch plan output', n(T.planOut), C.ink, ''], ['Stitch actual output', n(T.out), C.ink, ''], ['Stitch variance', sg(varT), vc(varT), 'overall ' + sg(ovVarT)],
         ['Endline pass', n(endPass), C.ink, endChk ? 'of ' + n(endChk) + ' checked' : ''], ['Endline fail', n(endFail), endFail ? C.bad : C.ink, endChk ? Math.round(endFail / endChk * 1000) / 10 + '%' : '']]
          .concat(mode === 'all' ? [['Packed pcs', n(fq), C.ink, floors.length ? n(fc) + ' cartons' : '']] : []);
      var kw = (IW - 24) / 3, kh = 96;
      k.forEach(function (t, i) {
        var kx = X + (i % 3) * (kw + 12), ky = y + Math.floor(i / 3) * (kh + 12);
        rect(kx, ky, kw, kh, C.soft);
        text(t[0].toUpperCase(), kx + 14, ky + 24, { size: 14, w: 700, color: C.sub, max: kw - 24 });
        text(t[1], kx + 14, ky + 56, { size: 30, w: 800, color: t[2], max: kw - 24 });
        if (t[3]) text(t[3], kx + 14, ky + 84, { size: 15, w: 500, color: C.sub, max: kw - 24 });
      });
      y += Math.ceil(k.length / 3) * (kh + 12) - 12;

      // stitching: one row per line — the day (or week) and the overall (every day of that line on that SRN up to the last date)
      if (masters.length) {
        section('Stitching', (wk ? 'week · ' : '') + n(T.out) + ' / ' + n(T.planOut) + ' pcs');
        var cols = layout([{ t: 'Line · SRN', w: 250, a: 'l' }, { t: 'Act MP', w: 70 }, { t: 'Plan', w: 82 }, { t: 'Actual', w: 82 }, { t: 'Var', w: 78 }, { t: 'End pass', w: 80 },
                           { t: 'Plan', w: 84, ov: 1 }, { t: 'Actual', w: 84, ov: 1 }, { t: 'Var', w: 80, ov: 1 }]);
        var ovX = cols[6].x, ovW = X + IW - ovX;
        // group labels + column names
        rect(ovX, y, ovW, 58, C.ov);
        text(wk ? 'WEEK' : 'DAY', cols[1].x + (ovX - cols[1].x) / 2, y + 14, { size: 13, w: 800, color: C.head, align: 'center' });
        text('OVERALL' + (wk ? ' (till Sat)' : ''), ovX + ovW / 2, y + 14, { size: 13, w: 800, color: C.ovHead, align: 'center' });
        cols.forEach(function (col) { text(col.t, cx(col), y + 42, { size: 14, w: 700, color: col.ov ? C.ovHead : C.sub, align: col.a === 'l' ? 'left' : 'center', max: col.w - 8 }); });
        y += 58; rect(X, y, IW, 2, C.line);
        var row = function (vals, h, o) {
          rect(ovX, y, ovW, h, C.ov);
          if (o.fill) rect(X, y, ovX - X, h, o.fill);
          vals.forEach(function (v, i) {
            if (i === 0) return;
            var col = cols[i], st = { size: o.bold ? 19 : 19, w: o.bold || i === 3 || i === 7 ? 800 : 500, color: i === 4 ? vc(o.v1) : i === 8 ? vc(o.v2) : C.ink, align: 'center', max: col.w - 6 };
            if (i === 4 || i === 8) st.w = 800;
            text(v, cx(col), y + h / 2 + 1, st);
          });
          y += h; rect(X, y, IW, 1, C.line);
        };
        masters.forEach(function (m) {
          var mv = m.planOut ? m.out - m.planOut : '', mov = m.ovPlan ? m.ovOut - m.ovPlan : '';
          var y0 = y;
          row(['', n(sum(m.lines, function (l) { return l.mp; })), n(m.planOut), n(m.out), sg(mv), n(m.endPass || 0), n(m.ovPlan), n(m.ovOut), sg(mov)], 42, { bold: 1, fill: C.soft, v1: mv, v2: mov });
          text(nm(m.master), cx(cols[0]), y0 + 22, { size: 19, w: 800, max: cols[0].w - 12 });
          m.lines.forEach(function (l) {
            var y1 = y;
            row(['', n(l.mp) + (l.mpOt ? '+' + l.mpOt : ''), n(l.planOut), l.endOnly ? '–' : n(l.out), sg(l.variance), n(l.endPass || 0), n(l.ovPlan), l.endOnly ? '–' : n(l.ovOut), sg(l.ovVar)], 54, { v1: l.variance, v2: l.ovVar });
            text(sl(l.dept) + (l.pending ? ' ●' : ''), cx(cols[0]), y1 + 19, { size: 19, w: 700, max: cols[0].w - 12 });
            text(l.srn + (nm(l.supervisor) ? ' · ' + nm(l.supervisor) : ''), cx(cols[0]), y1 + 40, { size: 14, w: 500, color: C.sub, max: cols[0].w - 12 });
          });
        });
        rect(X, y, IW, 3, C.head); y += 3;
        var yt = y;
        row(['', n(T.mp), n(T.planOut), n(T.out), sg(varT), n(T.endPass), n(T.ovPlan), n(T.ovOut), sg(ovVarT)], 46, { bold: 1, v1: varT, v2: ovVarT });
        text('Total · ' + lines.length + (lines.length > 1 ? ' lines' : ' line'), cx(cols[0]), yt + 24, { size: 19, w: 800, max: cols[0].w - 12 });
      }

      // endline: line-wise checked / pass / fail
      if (endl.length) {
        section('Endline', n(endChk) + ' checked');
        var ec = layout([{ t: 'Line', w: 30, a: 'l' }, { t: 'SRN', w: 22, a: 'l' }, { t: 'Checked', w: 16 }, { t: 'Pass', w: 16 }, { t: 'Fail', w: 16 }]);
        var erow = function (vals, h, o) { vals.forEach(function (v, i) { text(v, cx(ec[i]), y + h / 2 + 1, { size: o.size || 19, w: o.w ? o.w[i] : 500, color: o.color ? o.color[i] : C.ink, align: ec[i].a === 'l' ? 'left' : 'center', max: ec[i].w - 10 }); }); y += h; };
        erow(ec.map(function (col) { return col.t; }), 36, { size: 14, w: [700, 700, 700, 700, 700], color: [C.sub, C.sub, C.sub, C.sub, C.sub] });
        endl.forEach(function (e) {
          rect(X, y, IW, 1, C.line);
          erow([sl(e.dept) + (e.pending ? ' ●' : ''), e.srn, n(e.checked), n(e.pass), n(e.fail)], 42, { w: [700, 500, 500, 800, 800], color: [C.ink, C.ink, C.ink, C.ink, e.fail ? C.bad : C.ink] });
        });
        rect(X, y, IW, 3, C.head); y += 3;
        erow(['Total', '', n(endChk), n(endPass), n(endFail)], 44, { w: [800, 800, 800, 800, 800], color: [C.ink, C.ink, C.ink, C.ink, endFail ? C.bad : C.ink] });
      }

      // packing: floor -> SRN -> packed pcs
      if (floors.length) {
        section('Packing', n(fq) + ' pcs · ' + n(fc) + ' cartons');
        var pc = layout([{ t: 'Floor / SRN', w: 24, a: 'l' }, { t: 'Style', w: 40, a: 'l' }, { t: 'Packed', w: 18 }, { t: 'Cartons', w: 18 }]);
        var prow = function (vals, h, o) { vals.forEach(function (v, i) { text(v, cx(pc[i]) + (o.indent && i === 0 ? 12 : 0), y + h / 2 + 1, { size: o.size || 19, w: o.w ? o.w[i] : 500, color: o.color ? o.color[i] : C.ink, align: pc[i].a === 'l' ? 'left' : 'center', max: pc[i].w - 12 }); }); y += h; };
        prow(pc.map(function (col) { return col.t; }), 36, { size: 14, w: [700, 700, 700, 700], color: [C.sub, C.sub, C.sub, C.sub] });
        floors.forEach(function (f) {
          rect(X, y, IW, 40, C.soft);
          prow([sl(f.floor), '', n(f.qty), n(f.cartons)], 40, { w: [800, 500, 800, 800] });
          f.rows.forEach(function (r) {
            prow([r.srn + (r.pending ? ' ●' : ''), r.item || '', n(r.qty), n(r.cartons)], 40, { indent: 1, w: [700, 500, 500, 500], color: [C.ink, C.sub, C.ink, C.ink] });
            rect(X, y, IW, 1, C.line);
          });
        });
        rect(X, y, IW, 3, C.head); y += 3;
        prow(['Total', '', n(fq), n(fc)], 44, { w: [800, 800, 800, 800] });
      }

      // notes
      y += 14;
      (mode === 'packing' ? ['Packed pcs and cartons from the packing sheet.'] :
        ['Plan = actual man-hours × plan rate of the day (learning curve; 100% after the plan ends; else bulletin SAM).' + (wk ? ' Week = Mon–Sat, days added up, Act MP = average a day.' : ''),
         'Overall = every day of that line on that SRN up to ' + (wk ? 'Saturday' : 'this date') + '.  Act MP = actual manpower (+OT).'])
        .concat(['● = waiting approval, included.', S.imgStamp ? S.imgStamp() : '']).forEach(function (t) {
          setFont(mc, { size: 14 }); var ln = '';
          String(t).split(' ').forEach(function (wd) { var tt = ln ? ln + ' ' + wd : wd; if (ln && mc.measureText(tt).width > IW) { text(ln, X, y + 10, { size: 14, color: C.sub }); y += 21; ln = wd; } else ln = tt; });
          if (ln) { text(ln, X, y + 10, { size: 14, color: C.sub }); y += 21; }
        });
      y += 10;
    };

    draw();   // measure
    var H = Math.ceil(y), Z = Math.max(1, Math.min(2, Math.floor(Math.sqrt(16000000 / (W * H)) * 100) / 100));   // phone canvas size limit
    var cv = document.createElement('canvas'); cv.width = Math.round(W * Z); cv.height = Math.round(H * Z);
    c = cv.getContext('2d'); c.scale(Z, Z); c.textBaseline = 'middle';
    c.fillStyle = '#fff'; c.fillRect(0, 0, W, H);
    draw();
    return cv;
  };
})();
