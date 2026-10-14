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

// ---------- PDR image: previous day report, master-wise, designed to read well in WhatsApp ----------
(function () {
  'use strict';
  var S = window.SG;
  var FONT = '-apple-system, Roboto, "Segoe UI", Arial, sans-serif';
  var NAVY = '#1e3a8a', BLUE = '#2563eb', INK = '#0f172a', MUTED = '#64748b', LINE = '#e2e8f0';
  function achColor(a) { return a === '' ? MUTED : a >= 100 ? '#15803d' : a >= 85 ? '#b45309' : '#c81e1e'; }
  function achBg(a) { return a === '' ? '#f1f5f9' : a >= 100 ? '#dcfce7' : a >= 85 ? '#fef3c7' : '#fee2e2'; }
  function n(v) { return v === '' || v === null || v === undefined ? '–' : Math.round(+v).toLocaleString('en-IN'); }
  function nm(v) { return String(v || '').replace(/^[A-Z]{1,4}\d{3,}\s*-\s*/i, ''); }
  function rr(c, x, y, w, h, r) { c.beginPath(); c.moveTo(x + r, y); c.arcTo(x + w, y, x + w, y + h, r); c.arcTo(x + w, y + h, x, y + h, r); c.arcTo(x, y + h, x, y, r); c.arcTo(x, y, x + w, y, r); c.closePath(); }

  // d: m.pdr reply. only: a master's name -> that master; '__packing' -> the packing report; empty -> everything
  S.pdrImage = function (d, only) {
    var mode = only === '__packing' ? 'packing' : only === '__cutting' ? 'cutting' : only ? 'master' : 'all';
    var masters = mode === 'packing' || mode === 'cutting' ? [] : d.masters.filter(function (m) { return mode === 'all' || m.master === only; });
    var floors = mode === 'master' || mode === 'cutting' ? [] : (d.packing || []);
    var cuts = mode === 'all' || mode === 'cutting' ? (d.cutting || []) : [], crows = cuts.reduce(function (a, x) { return a + x.rows.length; }, 0);
    var heads = mode === 'all' ? (cuts.length ? 1 : 0) + (masters.length && (cuts.length || floors.length) ? 1 : 0) + (floors.length ? 1 : 0) : 0;
    var Z = 2, W = 1590, pad = 32, rowH = 52, prowH = 46, tw = W - pad * 2;
    var cols = [
      { t: 'Supervisor', w: 170, a: 'left' }, { t: 'Line', w: 170, a: 'left' }, { t: 'SRN', w: 112, a: 'left' }, { t: 'Plan MP', w: 80 }, { t: 'Plan output', w: 108 },
      { t: 'Actual MP', w: 112 }, { t: 'Actual output', w: 130 }, { t: 'End check', w: 92, end: 1 }, { t: 'End pass', w: 92, end: 1 }, { t: 'Variance', w: 96 },
      { t: 'Hours shift+OT', w: 132 }, { t: 'Achievement', w: tw - 1294 }];
    var pcols = [{ t: 'SRN', w: 180, a: 'left' }, { t: 'Style', w: 360, a: 'left' }, { t: 'Packed pcs', w: 180 }, { t: 'Cartons', w: 150 }, { t: 'Manpower', w: 150 }, { t: 'Hours', w: 150 }, { t: 'Supervisor', w: tw - 1170, a: 'left' }];
    var ccols = [{ t: 'Intent number', w: 260, a: 'left' }, { t: 'Fabric name', w: tw - 500, a: 'left' }, { t: 'Cut qty', w: 240 }];
    var xOf = function (list, k) { var x = pad; for (var i = 0; i < k; i++) x += list[i].w; return x; };
    var lines = masters.reduce(function (a, m) { return a + m.lines.length; }, 0), prows = floors.reduce(function (a, f) { return a + f.rows.length; }, 0);
    var H = 170 + 140 + masters.length * (64 + 46 + 24) + lines * rowH + floors.length * (64 + 46 + 24) + prows * prowH + cuts.length * (64 + 46 + 24) + crows * prowH + heads * 60 + 96;
    var cv = document.createElement('canvas'); cv.width = W * Z; cv.height = H * Z;
    var c = cv.getContext('2d'); c.scale(Z, Z); c.textBaseline = 'middle';
    var font = function (sz, w) { c.font = (w || 500) + ' ' + sz + 'px ' + FONT; };
    var text = function (t, x, y, o) { o = o || {}; font(o.size || 18, o.w); c.fillStyle = o.color || INK; c.textAlign = o.align || 'left'; var s = String(t == null ? '' : t); if (o.max) while (s.length > 1 && c.measureText(s).width > o.max) s = s.slice(0, -2) + '…'; c.fillText(s, x, y); };
    var card = function (x, y, w, h, r, fill) { c.fillStyle = fill || '#fff'; rr(c, x, y, w, h, r); c.fill(); };
    c.fillStyle = '#f1f5f9'; c.fillRect(0, 0, W, H);
    // header band
    var g = c.createLinearGradient(0, 0, W, 0); g.addColorStop(0, NAVY); g.addColorStop(1, BLUE);
    c.fillStyle = g; c.fillRect(0, 0, W, 150);
    var p = d.date.split('-'), dt = new Date(+p[0], +p[1] - 1, +p[2]);
    var day = dt.toLocaleDateString('en-IN', { weekday: 'long', day: '2-digit', month: 'short', year: 'numeric' });
    text(mode === 'packing' ? 'Packing Output Report' : mode === 'cutting' ? 'Cutting Output Report' : 'Production Output Report', pad, 52, { size: 38, w: 800, color: '#fff' });
    text((mode === 'packing' ? 'Packing, floor-wise' : mode === 'cutting' ? 'Cutting, fabric-wise' : mode === 'all' ? ['Stitching', 'Endline', floors.length ? 'Packing' : '', cuts.length ? 'Cutting' : ''].filter(String).join(' · ') : 'Stitching') + ' · FAC' + d.factory + ' · ' + day + (mode === 'master' ? ' · Master: ' + nm(only) : ''), pad, 100, { size: 21, w: 500, color: '#dbeafe' });
    text('SG Data', W - pad, 52, { size: 20, w: 700, color: '#bfdbfe', align: 'right' });
    // KPI cards
    var cards;
    if (mode === 'cutting') {
      var cq = cuts.reduce(function (a, x) { return a + x.qty; }, 0);
      cards = [['Cut qty', n(cq), BLUE], ['SRN', String(cuts.length), INK], ['Fabrics', String(crows), INK]];
    } else if (mode === 'packing') {
      var pq = floors.reduce(function (a, f) { return a + f.qty; }, 0), pc = floors.reduce(function (a, f) { return a + f.cartons; }, 0), pm = floors.reduce(function (a, f) { return a + f.mp; }, 0);
      cards = [['Packed pcs', n(pq), BLUE], ['Cartons', n(pc), INK], ['Floors', String(floors.length), INK], ['Manpower', n(pm), INK]];
    } else {
      var t = mode === 'master' ? masters.reduce(function (a, m) { a.planOut += m.planOut; a.out += m.out; a.endPass += m.endPass || 0; return a; }, { planOut: 0, out: 0, endPass: 0 }) : d.total;
      var ach = mode === 'master' ? (masters[0] ? masters[0].ach : '') : d.total.ach, varT = t.planOut ? t.out - t.planOut : '';
      cards = [['Plan output', n(t.planOut), INK], ['Actual output', n(t.out), BLUE], ['Endline pass', n(t.endPass || 0), '#15803d'],
               ['Variance', varT === '' ? '–' : (varT > 0 ? '+' : '') + n(varT), varT === '' ? MUTED : varT < 0 ? '#c81e1e' : '#15803d'], ['Achievement', ach === '' ? '–' : ach + '%', achColor(ach)]];
    }
    var gap = 16, cw = (tw - (cards.length - 1) * gap) / cards.length, y0 = 172;
    cards.forEach(function (k, i) {
      var x = pad + i * (cw + gap);
      c.shadowColor = 'rgba(15,23,42,.08)'; c.shadowBlur = 12; c.shadowOffsetY = 3; card(x, y0, cw, 104, 16); c.shadowColor = 'transparent';
      text(k[0].toUpperCase(), x + 22, y0 + 32, { size: 15, w: 700, color: MUTED });
      text(k[1], x + 22, y0 + 72, { size: 34, w: 800, color: k[2] });
    });
    var y = y0 + 104 + 30;
    var section = function (label, title, right, pill, pillCls) {
      c.fillStyle = '#eef3ff'; rr(c, pad, y, tw, 64, 16); c.fill(); c.fillRect(pad, y + 40, tw, 24);
      text(label, pad + 22, y + 22, { size: 12, w: 800, color: BLUE });
      text(title, pad + 22, y + 45, { size: 23, w: 800, color: NAVY, max: 560 });
      var sx = W - pad - 22, pw = 0;
      if (pill !== undefined) { font(16, 700); pw = c.measureText(pill).width + 30; c.fillStyle = achBg(pillCls); rr(c, sx - pw, y + 16, pw, 34, 17); c.fill(); text(pill, sx - pw / 2, y + 33, { size: 17, w: 800, color: achColor(pillCls), align: 'center' }); pw += 18; }
      text(right, sx - pw, y + 33, { size: 17, w: 600, color: MUTED, align: 'right' });
      y += 64;
    };
    var headRow = function (list) {
      list.forEach(function (col, k) {
        var x = xOf(list, k);
        if (col.end) { c.fillStyle = '#ecfdf3'; c.fillRect(x, y, col.w, 46); }
        text(col.t.toUpperCase(), col.a === 'left' ? x + 18 : x + col.w / 2, y + 23, { size: 12, w: 800, color: col.end ? '#15803d' : MUTED, align: col.a === 'left' ? 'left' : 'center', max: col.w - 10 });
      });
      c.fillStyle = LINE; c.fillRect(pad + 14, y + 45, tw - 28, 1.5);
      y += 46;
    };
    var heading = function (t) { if (mode !== 'all') return; text(t, pad + 4, y + 26, { size: 20, w: 800, color: NAVY }); y += 60; };
    if (masters.length && (cuts.length || floors.length)) heading('STITCHING · MASTER-WISE');
    masters.forEach(function (m) {
      card(pad, y, tw, 64 + 46 + m.lines.length * rowH + 4, 16);
      section('MASTER', nm(m.master), m.lines.length + (m.lines.length > 1 ? ' lines' : ' line') + '  ·  ' + n(m.out) + ' / ' + n(m.planOut) + ' pcs  ·  end pass ' + n(m.endPass || 0), m.ach === '' ? 'no plan' : m.ach + '%', m.ach);
      headRow(cols);
      m.lines.forEach(function (l, i) {
        if (i % 2) { c.fillStyle = '#f8fafc'; c.fillRect(pad + 8, y, tw - 16, rowH); }
        c.fillStyle = 'rgba(22,163,74,.06)'; c.fillRect(xOf(cols, 7), y, cols[7].w + cols[8].w, rowH);
        var cells = [nm(l.supervisor) || '–', l.dept.replace(/^FAC\d+-/, ''), l.srn, n(l.planMp), n(l.planOut), n(l.mp) + (l.mpOt ? ' (+' + l.mpOt + ' OT)' : ''), l.endOnly ? '–' : n(l.out),
                     n(l.endChecked || 0), n(l.endPass || 0), l.variance === '' ? '–' : (l.variance > 0 ? '+' : '') + n(l.variance), (l.hours || 0) + (l.hoursOt ? ' + ' + l.hoursOt : ''), ''];
        cols.forEach(function (col, k) {
          var cx = xOf(cols, k), o = { size: 18, w: k === 1 || k === 6 ? 700 : 500, color: INK, align: col.a === 'left' ? 'left' : 'center', max: col.w - 14 };
          if (k === 9 && l.variance !== '') o.color = l.variance < 0 ? '#c81e1e' : '#15803d';
          if (k === 5 && l.mpOt) o.size = 16;
          if (k === 0) { o.size = 16; o.color = '#334155'; }
          if (k === 8) { o.w = 700; o.color = '#15803d'; }
          if (k < 11) text(cells[k], col.a === 'left' ? cx + 18 : cx + col.w / 2, k === 4 && l.planOut !== '' ? y + rowH / 2 - 6 : y + rowH / 2, o);
          if (k === 11) {   // achievement: pill + bar
            var a = l.ach, bw = col.w - 40, bx = cx + 14;
            c.fillStyle = '#e2e8f0'; rr(c, bx, y + rowH - 14, bw, 6, 3); c.fill();
            if (a !== '') { c.fillStyle = achColor(a); rr(c, bx, y + rowH - 14, Math.max(6, Math.min(1, a / 100) * bw), 6, 3); c.fill(); }
            text(a === '' ? (l.endOnly ? 'endline only' : 'no plan') : a + '%', bx + bw / 2, y + 20, { size: 18, w: 800, color: achColor(a), align: 'center' });
          }
        });
        if (l.pending) text('waiting approval', xOf(cols, 1) + 18, y + rowH - 9, { size: 11, w: 700, color: '#b45309' });
        if (S.pdrPlanSrc && l.planOut !== '') text(S.pdrPlanSrc(l), xOf(cols, 4) + cols[4].w / 2, y + rowH - 8, { size: 11, w: 600, color: MUTED, align: 'center', max: cols[4].w - 6 });
        y += rowH;
      });
      y += 4 + 20;
    });
    if (floors.length) {
      heading('PACKING · FLOOR-WISE');
      floors.forEach(function (f) {
        card(pad, y, tw, 64 + 46 + f.rows.length * prowH + 4, 16);
        section('FLOOR', f.floor.replace(/^FAC\d+-/, ''), f.rows.length + ' SRN  ·  ' + n(f.qty) + ' pcs  ·  ' + n(f.cartons) + ' cartons');
        headRow(pcols);
        f.rows.forEach(function (r, i) {
          if (i % 2) { c.fillStyle = '#f8fafc'; c.fillRect(pad + 8, y, tw - 16, prowH); }
          var cells = [r.srn, r.item || '–', n(r.qty), n(r.cartons), n(r.mp), r.hours || '–', nm(r.supervisor) || '–'];
          pcols.forEach(function (col, k) { var cx = xOf(pcols, k); text(cells[k], col.a === 'left' ? cx + 18 : cx + col.w / 2, y + prowH / 2, { size: 18, w: k === 0 || k === 2 ? 700 : 500, color: k === 2 ? BLUE : INK, align: col.a === 'left' ? 'left' : 'center', max: col.w - 14 }); });
          if (r.pending) text('waiting approval', xOf(pcols, 0) + 18, y + prowH - 7, { size: 11, w: 700, color: '#b45309' });
          y += prowH;
        });
        y += 4 + 20;
      });
    }
    if (cuts.length) {
      heading('CUTTING · FABRIC-WISE');
      cuts.forEach(function (x) {
        card(pad, y, tw, 64 + 46 + x.rows.length * prowH + 4, 16);
        section('SRN', x.srn + (x.style ? ' · ' + x.style : ''), x.rows.length + (x.rows.length > 1 ? ' fabrics' : ' fabric') + '  ·  ' + n(x.qty) + ' cut');
        headRow(ccols);
        x.rows.forEach(function (r, i) {
          if (i % 2) { c.fillStyle = '#f8fafc'; c.fillRect(pad + 8, y, tw - 16, prowH); }
          var cells = [r.intent || '–', r.fabric || '–', n(r.qty)];
          ccols.forEach(function (col, k) { var cx = xOf(ccols, k); text(cells[k], col.a === 'left' ? cx + 18 : cx + col.w / 2, y + prowH / 2, { size: 18, w: k === 2 ? 800 : 500, color: k === 2 ? BLUE : INK, align: col.a === 'left' ? 'left' : 'center', max: col.w - 24 }); });
          y += prowH;
        });
        y += 4 + 20;
      });
    }
    if (mode === 'master' || mode === 'all') text('Plan output = actual man-hours × plan rate of the day (learning curve %, 100% after the plan ends, else bulletin SAM) · Achievement = actual ÷ plan · End = endline of that date', pad, H - 58, { size: 13, color: MUTED, max: tw });
    text(mode === 'cutting' ? 'Cut qty from the cutting sheet, per SRN, intent number and fabric' : mode === 'packing' ? 'Manpower = pressman + checker + thread cutter + helper' : 'MP = production manpower (operator + helper + paster + QC + thread cutter + hand needle)', pad, H - 34, { size: 13, color: MUTED, max: tw - 330 });
    text(S.imgStamp ? S.imgStamp() : '', W - pad, H - 34, { size: 13, color: MUTED, align: 'right' });
    return cv;
  };
})();
