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

// ---------- Production Output Report image: phone-first (narrow, big text, plain colours); height follows the data ----------
(function () {
  'use strict';
  var S = window.SG;
  var FONT = '-apple-system, Roboto, "Segoe UI", Arial, sans-serif';
  var C = { ink: '#111827', sub: '#6b7280', line: '#e5e7eb', soft: '#f3f4f6', head: '#1e3a8a', good: '#15803d', bad: '#dc2626', warn: '#b45309' };
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
    var T = { planOut: sum(masters, function (m) { return m.planOut; }), out: sum(masters, function (m) { return m.out; }), planMp: sum(masters, function (m) { return m.planMp; }), mp: sum(masters, function (m) { return m.mp; }),
              ovPlan: sum(masters, function (m) { return m.ovPlan; }), ovOut: sum(masters, function (m) { return m.ovOut; }), endPass: sum(lines, function (l) { return l.endPass; }) };
    var varT = T.planOut ? T.out - T.planOut : '', ovVarT = T.ovPlan ? T.ovOut - T.ovPlan : '';
    var endChk = sum(endl, function (e) { return e.checked; }), endPass = sum(endl, function (e) { return e.pass; }), endFail = sum(endl, function (e) { return e.fail; });
    var fq = sum(floors, function (f) { return f.qty; }), fc = sum(floors, function (f) { return f.cartons; });
    var p = d.date.split('-'), day = new Date(+p[0], +p[1] - 1, +p[2]).toLocaleDateString('en-IN', { weekday: 'short', day: '2-digit', month: 'short', year: 'numeric' });

    var W = 720, X = 24, IW = W - X * 2, c = null, y = 0;
    var mc = document.createElement('canvas').getContext('2d');
    var setFont = function (ctx, o) { ctx.font = (o.w || 500) + ' ' + (o.size || 22) + 'px ' + FONT; };
    var fit = function (s, o, max) { setFont(mc, o); s = String(s == null ? '' : s); if (max) while (s.length > 1 && mc.measureText(s).width > max) s = s.slice(0, -2) + '…'; return s; };
    var text = function (t, x, yy, o) {
      o = o || {}; if (!c) return;
      setFont(c, o); c.fillStyle = o.color || C.ink; c.textAlign = o.align || 'left'; c.fillText(fit(t, o, o.max), x, yy);
    };
    var rect = function (x, yy, w, h, color) { if (c) { c.fillStyle = color; c.fillRect(x, yy, w, h); } };
    var hr = function (yy) { rect(X, yy, IW, 1.5, C.line); };
    var section = function (title, right) {
      y += 22;
      text(title, X, y + 18, { size: 26, w: 800, color: C.head });
      if (right) text(right, W - X, y + 18, { size: 19, w: 600, color: C.sub, align: 'right', max: IW - 260 });
      y += 40; rect(X, y, IW, 3, C.head); y += 3;
    };

    var draw = function () {
      y = 0;
      // header
      rect(0, 0, W, 118, C.head);
      text(mode === 'packing' ? 'Packing Output Report' : 'Production Output Report', X, 46, { size: 32, w: 800, color: '#fff' });
      text('FAC' + d.factory + '  ·  ' + day + (mode === 'master' ? '  ·  ' + nm(only) : ''), X, 88, { size: 21, w: 500, color: '#dbeafe', max: IW });
      y = 118 + 18;

      // KPI cards: 2 per row
      var k = mode === 'packing' ? [['Packed pcs', n(fq), C.ink, ''], ['Cartons', n(fc), C.ink, floors.length + (floors.length > 1 ? ' floors' : ' floor')]] :
        [['Stitching plan output', n(T.planOut), C.ink, 'plan MP ' + n(T.planMp)], ['Stitching actual output', n(T.out), C.ink, 'actual MP ' + n(T.mp)],
         ['Stitching variance', sg(varT), vc(varT), 'overall ' + sg(ovVarT)], ['Endline pass', n(endPass), C.ink, endChk ? n(endChk) + ' checked' : 'no endline'],
         ['Endline fail', n(endFail), endFail ? C.bad : C.ink, endChk ? Math.round(endFail / endChk * 1000) / 10 + '% of checked' : '']].concat(mode === 'all' ? [['Packed pcs', n(fq), C.ink, floors.length ? n(fc) + ' cartons' : 'no packing']] : []);
      var kw = (IW - 14) / 2, kh = 118;
      k.forEach(function (t, i) {
        var kx = X + (i % 2) * (kw + 14), ky = y + Math.floor(i / 2) * (kh + 14);
        rect(kx, ky, kw, kh, C.soft);
        text(t[0].toUpperCase(), kx + 16, ky + 30, { size: 16, w: 700, color: C.sub, max: kw - 28 });
        text(t[1], kx + 16, ky + 70, { size: 36, w: 800, color: t[2], max: kw - 28 });
        if (t[3]) text(t[3], kx + 16, ky + 102, { size: 17, w: 500, color: C.sub, max: kw - 28 });
      });
      y += Math.ceil(k.length / 2) * (kh + 14) - 14 + 6;

      // stitching: per line a small table — day and overall (every day of that line on that SRN up to this date)
      if (masters.length) {
        section('Stitching', n(T.out) + ' / ' + n(T.planOut) + ' pcs');
        var cw = (IW - 150) / 4, colX = function (i) { return X + 150 + cw * i + cw / 2; };
        var mini = function (rows, bold) {   // rows: [label, plan, actual, variance text, end pass, variance number]
          [['', 'Plan', 'Actual', 'Variance', 'End pass']].concat(rows).forEach(function (r, ri) {
            var h = ri ? 40 : 30, cy = y + h / 2 + 2;
            if (ri) rect(X, y, IW, 1, C.line);
            text(r[0], X + 2, cy, { size: ri ? 20 : 16, w: ri ? 700 : 600, color: ri ? C.ink : C.sub, max: 146 });
            for (var j = 1; j <= 4; j++) text(r[j], colX(j - 1), cy, { size: ri ? (bold ? 23 : 22) : 16, w: ri ? (j === 2 || j === 3 || bold ? 800 : 500) : 600, color: !ri ? C.sub : j === 3 ? vc(r[5]) : C.ink, align: 'center', max: cw - 6 });
            y += h;
          });
        };
        masters.forEach(function (m) {
          y += 14;
          rect(X, y, IW, 50, C.soft);
          text(nm(m.master), X + 14, y + 26, { size: 23, w: 800, max: IW - 250 });
          text(n(m.out) + ' / ' + n(m.planOut), W - X - 14, y + 26, { size: 20, w: 700, color: C.sub, align: 'right' });
          y += 50;
          m.lines.forEach(function (l) {
            y += 14;
            text(sl(l.dept), X + 2, y + 16, { size: 24, w: 800, max: 260 });
            text(l.srn, X + 2 + Math.min(260, (setFont(mc, { size: 24, w: 800 }), mc.measureText(sl(l.dept)).width)) + 14, y + 16, { size: 21, w: 600, color: C.sub });
            text(nm(l.supervisor), W - X, y + 16, { size: 19, w: 600, color: C.sub, align: 'right', max: 230 });
            y += 34;
            text('MP plan ' + n(l.planMp) + ' · actual ' + n(l.mp) + (l.mpOt ? ' (+' + l.mpOt + ' OT)' : '') + (S.pdrPlanSrc && l.planOut !== '' ? '  ·  ' + S.pdrPlanSrc(l) : ''), X + 2, y + 12, { size: 17, w: 500, color: C.sub, max: l.pending ? IW - 200 : IW });
            if (l.pending) text('● waiting approval', W - X, y + 12, { size: 17, w: 700, color: C.warn, align: 'right' });
            y += 26;
            mini([['Day', n(l.planOut), l.endOnly ? '–' : n(l.out), sg(l.variance), n(l.endPass || 0), l.variance],
                  [l.ovDays ? 'Overall · ' + l.ovDays + 'd' : 'Overall', n(l.ovPlan), l.endOnly ? '–' : n(l.ovOut), sg(l.ovVar), '', l.ovVar]]);
            hr(y); y += 2;
          });
        });
        y += 14;
        rect(X, y, IW, 4, C.head); y += 10;
        text('Stitching total', X + 2, y + 16, { size: 24, w: 800 });
        text(lines.length + (lines.length > 1 ? ' lines' : ' line'), W - X, y + 16, { size: 19, w: 600, color: C.sub, align: 'right' });
        y += 34;
        mini([['Day', n(T.planOut), n(T.out), sg(varT), n(T.endPass), varT], ['Overall', n(T.ovPlan), n(T.ovOut), sg(ovVarT), '', ovVarT]], true);
      }

      // endline: line-wise checked / pass / fail
      if (endl.length) {
        section('Endline', n(endChk) + ' checked');
        var ec = [{ t: 'Line', w: 0.30, a: 'l' }, { t: 'SRN', w: 0.22, a: 'l' }, { t: 'Checked', w: 0.16 }, { t: 'Pass', w: 0.16 }, { t: 'Fail', w: 0.16 }];
        var ex = []; var ax = X; ec.forEach(function (col) { col.w *= IW; ex.push(ax); ax += col.w; });
        var cell = function (r, h, o) {
          r.forEach(function (v, i) { text(v, ec[i].a === 'l' ? ex[i] + 2 : ex[i] + ec[i].w / 2, y + h / 2 + 2 - (o.up || 0), { size: o.size || 22, w: o.w && o.w[i] || 500, color: o.color && o.color[i] || C.ink, align: ec[i].a === 'l' ? 'left' : 'center', max: ec[i].w - 8 }); });
          y += h;
        };
        cell(ec.map(function (col) { return col.t; }), 36, { size: 16, w: [600, 600, 600, 600, 600], color: [C.sub, C.sub, C.sub, C.sub, C.sub] });
        endl.forEach(function (e) {
          rect(X, y, IW, 1, C.line);
          cell([sl(e.dept), e.srn, n(e.checked), n(e.pass), n(e.fail)], e.pending ? 62 : 46, { up: e.pending ? 9 : 0, w: [800, 500, 500, 800, 800], color: [C.ink, C.ink, C.ink, C.ink, e.fail ? C.bad : C.ink] });
          if (e.pending) text('● waiting approval', X + 2, y - 13, { size: 15, w: 700, color: C.warn });
        });
        rect(X, y, IW, 3, C.head); y += 3;
        cell(['Total', '', n(endChk), n(endPass), n(endFail)], 48, { size: 23, w: [800, 800, 800, 800, 800], color: [C.ink, C.ink, C.ink, C.ink, endFail ? C.bad : C.ink] });
      }

      // packing: floor -> SRN -> packed pcs
      if (floors.length) {
        section('Packing', n(fq) + ' pcs · ' + n(fc) + ' cartons');
        var pw = [IW * 0.56, IW * 0.24, IW * 0.20], px = [X, X + pw[0], X + pw[0] + pw[1]];
        text('FLOOR / SRN', px[0] + 2, y + 18, { size: 16, w: 600, color: C.sub });
        text('PACKED', px[1] + pw[1] / 2, y + 18, { size: 16, w: 600, color: C.sub, align: 'center' });
        text('CARTONS', px[2] + pw[2] / 2, y + 18, { size: 16, w: 600, color: C.sub, align: 'center' });
        y += 36;
        floors.forEach(function (f) {
          rect(X, y, IW, 46, C.soft);
          text(sl(f.floor), px[0] + 12, y + 24, { size: 22, w: 800, max: pw[0] - 20 });
          text(n(f.qty), px[1] + pw[1] / 2, y + 24, { size: 22, w: 800, align: 'center' });
          text(n(f.cartons), px[2] + pw[2] / 2, y + 24, { size: 22, w: 800, align: 'center' });
          y += 46;
          f.rows.forEach(function (r, i) {
            if (i) rect(X + 12, y, IW - 12, 1, C.line);
            var h = r.item || r.pending ? 64 : 46;
            text(r.srn, px[0] + 12, y + (h > 46 ? 22 : 24), { size: 22, w: 700 });
            if (r.item || r.pending) text((r.item || '') + (r.pending ? (r.item ? '  ·  ' : '') + '● waiting approval' : ''), px[0] + 12, y + 48, { size: 17, w: 500, color: r.pending ? C.warn : C.sub, max: pw[0] - 20 });
            text(n(r.qty), px[1] + pw[1] / 2, y + h / 2 + 2, { size: 22, w: 500, align: 'center' });
            text(n(r.cartons), px[2] + pw[2] / 2, y + h / 2 + 2, { size: 22, w: 500, align: 'center' });
            y += h;
          });
        });
        rect(X, y, IW, 3, C.head); y += 3;
        text('Total', px[0] + 2, y + 25, { size: 23, w: 800 });
        text(n(fq), px[1] + pw[1] / 2, y + 25, { size: 23, w: 800, align: 'center' });
        text(n(fc), px[2] + pw[2] / 2, y + 25, { size: 23, w: 800, align: 'center' });
        y += 48;
      }

      // notes
      y += 18; hr(y); y += 14;
      (mode === 'packing' ? ['Packed pcs and cartons of that date from the packing sheet.'] :
        ['Plan output = actual man-hours × plan rate of the day (learning curve; 100% after the plan ends; else Making Bulletin SAM).', 'Overall = every day of that line on that SRN up to this date.'])
        .concat(['● = waiting approval, included.', S.imgStamp ? S.imgStamp() : '']).forEach(function (t) {
          // wrap long notes over lines
          setFont(mc, { size: 16 }); var words = String(t).split(' '), ln = '';
          words.forEach(function (wd) { var tt = ln ? ln + ' ' + wd : wd; if (ln && mc.measureText(tt).width > IW) { text(ln, X, y + 11, { size: 16, color: C.sub }); y += 24; ln = wd; } else ln = tt; });
          if (ln) { text(ln, X, y + 11, { size: 16, color: C.sub }); y += 24; }
        });
      y += 14;
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
