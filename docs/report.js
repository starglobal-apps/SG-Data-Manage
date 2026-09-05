// report.js — renders the printed-style day reports to a canvas image and shares it (WhatsApp via Web Share).
// Making Output Report (stitching line × SRN) and Packing Output Report (floor × SRN). One page = ROWS rows;
// when history is longer, only the latest page is produced and its first row carries forward earlier totals.
(function () {
  'use strict';
  var S = window.SG, $ = S.$, esc = S.esc, api = S.api, state = S.state, toast = S.toast;
  var ROWS = 22, W = 1400, R = { canvas: null, blob: null, name: '' };

  function d2(iso) { var p = (iso || '').split('-'); return p.length === 3 ? p[2] + '.' + p[1] + '.' + p[0].slice(2) : iso; }
  function today() { var d = new Date(); return ('0' + d.getDate()).slice(-2) + '.' + ('0' + (d.getMonth() + 1)).slice(-2) + '.' + String(d.getFullYear()).slice(2) + ' ' + ('0' + d.getHours()).slice(-2) + ':' + ('0' + d.getMinutes()).slice(-2); }

  // ---- generic grid painter ----
  function painter(cv) {
    var c = cv.getContext('2d');
    c.fillStyle = '#fff'; c.fillRect(0, 0, cv.width, cv.height);
    c.strokeStyle = '#111'; c.lineWidth = 1.2; c.textBaseline = 'middle';
    return {
      c: c,
      text: function (t, x, y, o) { o = o || {}; c.font = (o.bold ? '700 ' : '500 ') + (o.size || 20) + 'px -apple-system, Roboto, "Segoe UI", sans-serif'; c.fillStyle = o.color || '#111'; c.textAlign = o.align || 'left'; c.fillText(String(t == null ? '' : t), x, y); },
      fit: function (t, x, y, w, o) { o = o || {}; c.font = (o.bold ? '700 ' : '500 ') + (o.size || 20) + 'px -apple-system, Roboto, "Segoe UI", sans-serif'; var s = String(t == null ? '' : t); while (s.length > 1 && c.measureText(s).width > w - 8) s = s.slice(0, -1); this.text(s, x, y, o); },
      rect: function (x, y, w, h, fill) { if (fill) { c.fillStyle = fill; c.fillRect(x, y, w, h); } c.strokeRect(x + .5, y + .5, w, h); },
      line: function (x1, y1, x2, y2) { c.beginPath(); c.moveTo(x1 + .5, y1 + .5); c.lineTo(x2 + .5, y2 + .5); c.stroke(); }
    };
  }

  // ---- Making Output Report ----
  function drawLine(d) {
    var cols = [
      { k: 'date', t: 'Date', w: 92 }, { k: 'op', t: 'Operation', w: 90 }, { k: 'output', t: 'Output', w: 78 }, { k: 'cum', t: 'Total Output', w: 100 },
      { k: 'operator', t: 'Operator', w: 72 }, { k: 'helper', t: 'Helper', w: 64 }, { k: 'paster', t: 'Paster', w: 64 }, { k: 'eqc', t: 'Endline QC', w: 84 }, { k: 'tc', t: 'Thread Cut', w: 80 }, { k: 'other', t: 'Other', w: 60 }, { k: 'hours', t: 'Work Hr', w: 70 },
      { k: 'supervisor', t: 'Supervisor Name', w: 130 }, { k: 'recorder', t: 'Data Recorder', w: 120 },
      { k: 'challan', t: 'Chalaan No.', w: 96 }, { k: 'lqty', t: 'Load qty', w: 80 }, { k: 'lcum', t: 'Total Load', w: 92 }
    ];
    var groups = [{ t: 'Output Detail', n: 4 }, { t: 'Manpower Detail', n: 9 }, { t: 'Loading Details', n: 3 }];
    // merge loading challans into production rows by date (or standalone rows)
    var rows = d.rows.map(function (r) { return Object.assign({}, r); }), loads = d.loading.slice();
    var merged = [], li = 0;
    rows.forEach(function (r) {
      while (li < loads.length && loads[li].date < r.date) { merged.push({ date: loads[li].date, loadOnly: true, challan: loads[li].challan, lqty: loads[li].qty }); li++; }
      if (li < loads.length && loads[li].date === r.date && !merged.some(function (m) { return m.challan === loads[li].challan; })) { r.challan = loads[li].challan; r.lqty = loads[li].qty; li++; }
      merged.push(r);
    });
    while (li < loads.length) { merged.push({ date: loads[li].date, loadOnly: true, challan: loads[li].challan, lqty: loads[li].qty }); li++; }
    // cumulative
    var cum = 0, lcum = 0;
    merged.forEach(function (r) { if (!r.loadOnly) { cum += r.output; r.cum = cum; } if (r.lqty) { lcum += r.lqty; r.lcum = lcum; } });
    // paging: latest page with carry-forward
    var pages = Math.max(1, Math.ceil(merged.length / ROWS)), pageRows = merged.slice((pages - 1) * ROWS);
    if (pages > 1) {
      var prev = merged.slice(0, (pages - 1) * ROWS), pOut = 0, pLoad = 0;
      prev.forEach(function (r) { if (!r.loadOnly) pOut += r.output; if (r.lqty) pLoad += r.lqty; });
      pageRows.unshift({ cf: true, date: 'C/F', op: 'Page ' + (pages - 1) + ' tak', output: pOut, cum: pOut, lqty: pLoad, lcum: pLoad });
    }
    var totalW = cols.reduce(function (t, c) { return t + c.w; }, 0), pad = Math.round((W - totalW) / 2);
    var rowH = 40, top = 250, H = top + 70 + (ROWS + 1) * rowH + 60;
    var cv = document.createElement('canvas'); cv.width = W; cv.height = H;
    var p = painter(cv);
    p.text('Making Output Report', W / 2, 40, { bold: true, size: 30, align: 'center' });
    // header boxes
    var hx = pad, hy = 70, hw = 560, hh = 44;
    [['Factory', d.header.factory], ['SRN', d.header.srn + (d.header.item ? '  —  ' + d.header.item : '')], ['Line', d.header.line]].forEach(function (kv, i) {
      p.rect(hx, hy + i * hh, 120, hh, '#f3f4f6'); p.text(kv[0], hx + 10, hy + i * hh + hh / 2, { bold: true, size: 18 });
      p.rect(hx + 120, hy + i * hh, hw - 120, hh); p.fit(kv[1], hx + 130, hy + i * hh + hh / 2, hw - 130, { size: 22, bold: i === 1 });
    });
    var rx = W - pad - 620;
    [['Floor', d.header.floor], ['Supervisor', d.header.supervisor], ['Incharge', d.header.incharge]].forEach(function (kv, i) {
      p.rect(rx, hy + i * hh, 150, hh, '#f3f4f6'); p.text(kv[0], rx + 10, hy + i * hh + hh / 2, { bold: true, size: 18 });
      p.rect(rx + 150, hy + i * hh, 470, hh); p.fit(kv[1], rx + 160, hy + i * hh + hh / 2, 460, { size: 22 });
    });
    // column headers
    var x = pad, y = top;
    groups.forEach(function (g) { var w = 0; for (var i = 0; i < g.n; i++) w += cols[cols.indexOf(cols.filter(function (c) { return true; })[0]) + 0] ? 0 : 0; });
    var gx = pad, ci = 0;
    groups.forEach(function (g) { var w = 0; for (var i = 0; i < g.n; i++) w += cols[ci + i].w; p.rect(gx, y, w, 34, '#e5e7eb'); p.text(g.t, gx + w / 2, y + 17, { bold: true, size: 18, align: 'center' }); gx += w; ci += g.n; });
    y += 34;
    cols.forEach(function (c) { p.rect(x, y, c.w, 36, '#f3f4f6'); p.fit(c.t, x + c.w / 2, y + 18, c.w, { bold: true, size: 13, align: 'center' }); x += c.w; });
    y += 36;
    for (var r = 0; r < ROWS + 1; r++) {
      var row = pageRows[r], x2 = pad;
      cols.forEach(function (c) {
        p.rect(x2, y, c.w, rowH, row && row.cf ? '#fef3c7' : null);
        if (row) {
          var v = row[c.k];
          if (c.k === 'date' && !row.cf) v = d2(row.date);
          if (row.loadOnly && ['op', 'output', 'cum', 'operator', 'helper', 'paster', 'eqc', 'tc', 'other', 'hours', 'supervisor', 'recorder'].indexOf(c.k) >= 0) v = '';
          if (v !== undefined && v !== null && v !== '') p.fit(v, c.k === 'supervisor' || c.k === 'recorder' ? x2 + 6 : x2 + c.w / 2, y + rowH / 2, c.w, { size: 18, bold: c.k === 'cum' || c.k === 'lcum' || !!row.cf, align: c.k === 'supervisor' || c.k === 'recorder' ? 'left' : 'center' });
        }
        x2 += c.w;
      });
      y += rowH;
    }
    p.text('Page ' + pages + ' / ' + pages + '   ·   ' + (pages > 1 ? 'C/F = pichle ' + (pages - 1) + ' page ka total   ·   ' : '') + 'SG Data · ' + today(), W / 2, y + 28, { size: 16, color: '#6b7280', align: 'center' });
    return { canvas: cv, pages: pages, rows: merged.length, total: cum, loaded: lcum };
  }

  // ---- Packing Output Report ----
  function drawPacking(d) {
    var cols = [
      { k: 'date', t: 'Date', w: 100 }, { k: 'checker', t: 'Checker', w: 80 }, { k: 'tc', t: 'Thread cutter', w: 90 }, { k: 'helper', t: 'Helper', w: 80 }, { k: 'pressman', t: 'Press man', w: 84 },
      { k: 'op', t: 'Operation', w: 100 }, { k: 'hours', t: 'Work Hr', w: 80 }, { k: 'pcs', t: 'Pack pcs', w: 90 }, { k: 'cum', t: 'Total Pack PC', w: 110 }, { k: 'box', t: 'Box', w: 80 }, { k: 'bcum', t: 'Total Box', w: 100 },
      { k: 'incharge', t: 'Incharge', w: 150 }, { k: 'sign', t: 'Warehouse Sign', w: 150 }
    ];
    var rows = d.rows.map(function (r) { return Object.assign({}, r); }), cum = 0, bcum = 0;
    rows.forEach(function (r) { cum += r.pcs; bcum += r.box; r.cum = cum; r.bcum = bcum; });
    var pages = Math.max(1, Math.ceil(rows.length / ROWS)), pageRows = rows.slice((pages - 1) * ROWS);
    if (pages > 1) { var pp = 0, pb = 0; rows.slice(0, (pages - 1) * ROWS).forEach(function (r) { pp += r.pcs; pb += r.box; }); pageRows.unshift({ cf: true, date: 'C/F', op: 'Page ' + (pages - 1) + ' tak', pcs: pp, cum: pp, box: pb, bcum: pb }); }
    var totalW = cols.reduce(function (t, c) { return t + c.w; }, 0), pad = Math.round((W - totalW) / 2);
    var rowH = 40, top = 210, H = top + 40 + (ROWS + 1) * rowH + 60;
    var cv = document.createElement('canvas'); cv.width = W; cv.height = H;
    var p = painter(cv);
    p.text('Star Global', W / 2, 36, { bold: true, size: 30, align: 'center' });
    p.text('Packing Output Report', W / 2, 70, { bold: true, size: 24, align: 'center' });
    var hy = 100, hh = 44;
    [['SRN', d.header.srn + (d.header.item ? '  —  ' + d.header.item : '')], ['Floor', d.header.floor]].forEach(function (kv, i) { p.rect(pad, hy + i * hh, 110, hh, '#f3f4f6'); p.text(kv[0], pad + 10, hy + i * hh + hh / 2, { bold: true, size: 18 }); p.rect(pad + 110, hy + i * hh, 430, hh); p.fit(kv[1], pad + 120, hy + i * hh + hh / 2, 420, { size: 22, bold: i === 0 }); });
    var mx = pad + 560; p.rect(mx, hy, 120, hh * 2, '#f3f4f6'); p.text('PCS Per Box', mx + 10, hy + hh, { bold: true, size: 18 }); p.rect(mx + 120, hy, 120, hh * 2); p.text(d.header.pcsPerBox || '', mx + 180, hy + hh, { size: 28, bold: true, align: 'center' });
    var rx = W - pad - 420;
    [['Factory', d.header.factory], ['Incharge', d.header.incharge]].forEach(function (kv, i) { p.rect(rx, hy + i * hh, 120, hh, '#f3f4f6'); p.text(kv[0], rx + 10, hy + i * hh + hh / 2, { bold: true, size: 18 }); p.rect(rx + 120, hy + i * hh, 300, hh); p.fit(kv[1], rx + 130, hy + i * hh + hh / 2, 290, { size: 22 }); });
    var x = pad, y = top;
    cols.forEach(function (c) { p.rect(x, y, c.w, 40, '#f3f4f6'); p.fit(c.t, x + c.w / 2, y + 20, c.w, { bold: true, size: 14, align: 'center' }); x += c.w; });
    y += 40;
    for (var r = 0; r < ROWS + 1; r++) {
      var row = pageRows[r], x2 = pad;
      cols.forEach(function (c) {
        p.rect(x2, y, c.w, rowH, row && row.cf ? '#fef3c7' : null);
        if (row) { var v = row[c.k]; if (c.k === 'date' && !row.cf) v = d2(row.date); if (c.k === 'sign') v = ''; if (v !== undefined && v !== null && v !== '') p.fit(v, c.k === 'incharge' ? x2 + 6 : x2 + c.w / 2, y + rowH / 2, c.w, { size: 18, bold: c.k === 'cum' || c.k === 'bcum' || !!row.cf, align: c.k === 'incharge' ? 'left' : 'center' }); }
        x2 += c.w;
      });
      y += rowH;
    }
    p.text('Page ' + pages + ' / ' + pages + '   ·   ' + (pages > 1 ? 'C/F = pichle ' + (pages - 1) + ' page ka total   ·   ' : '') + 'SG Data · ' + today(), W / 2, y + 28, { size: 16, color: '#6b7280', align: 'center' });
    return { canvas: cv, pages: pages, rows: rows.length, total: cum, loaded: null };
  }

  // ---- screen ----
  S.report = function (type, dept, srn) {
    S.push('report', (type === 'PACKING' ? 'Packing' : 'Making') + ' report · ' + srn);
    $('#report-info').innerHTML = '<div class="empty">Data aa raha hai…</div>'; $('#report-canvas-wrap').innerHTML = '';
    api(type === 'PACKING' ? 'report.packing' : 'report.line', { factory: state.factory, dept: dept, srn: srn })
      .then(function (d) {
        var out = type === 'PACKING' ? drawPacking(d) : drawLine(d);
        R.canvas = out.canvas; R.name = (type === 'PACKING' ? 'Packing' : 'Making') + '_' + S.shortLine(dept).replace(/\s+/g, '') + '_' + srn + '_' + state.date + '.png';
        $('#report-info').innerHTML = '<b>' + esc(S.shortLine(dept)) + ' · ' + esc(srn) + '</b><div class="muted" style="font-size:12px">' + out.rows + ' rows · page ' + out.pages + '/' + out.pages + (out.pages > 1 ? ' (pehli row C/F)' : '') + ' · total ' + out.total + (out.loaded !== null ? ' · loaded ' + out.loaded : '') + '</div>';
        $('#report-canvas-wrap').innerHTML = ''; $('#report-canvas-wrap').appendChild(out.canvas);
        R.blob = null; out.canvas.toBlob(function (b) { R.blob = b; }, 'image/png');
      })
      .catch(function (e) { $('#report-info').innerHTML = '<div class="empty">' + esc(e.message) + '</div>'; });
  };

  function share() {
    if (!R.blob) { toast('Image abhi ban rahi hai…', ''); return; }
    var file = new File([R.blob], R.name, { type: 'image/png' });
    if (navigator.canShare && navigator.canShare({ files: [file] })) {
      navigator.share({ files: [file], title: R.name }).catch(function () {});
    } else { toast('Is browser me direct share nahi — Download karke bhejo', 'bad', 5000); download(); }
  }
  function download() {
    if (!R.canvas) return;
    var a = document.createElement('a'); a.href = R.canvas.toDataURL('image/png'); a.download = R.name; document.body.appendChild(a); a.click(); a.remove();
  }
  $('#btn-rep-share').addEventListener('click', share);
  $('#btn-rep-dl').addEventListener('click', download);

  // list of today's line×SRN combos -> sheet with report buttons
  S.reportPicker = function () {
    S.loadFactory().then(function (d) {
      var combos = {}, list = [];
      Object.keys(d.slots || {}).forEach(function (sk) { var sl = d.slots[sk]; ['STITCH', 'PACKING'].forEach(function (t) { Object.keys(sl[t] || {}).forEach(function (dept) { combos[t + '|' + dept] = true; }); }); });
      d.depts.forEach(function (x) { var srn = d.attSrn && d.attSrn[x.dept]; var t = x.cat === 'PACKING' ? 'PACKING' : 'STITCH'; if (srn) list.push({ t: t, dept: x.dept, srn: srn }); });
      if (!list.length) { toast('Aaj kisi line ka SRN nahi mila — pehle attendance', 'bad'); return; }
      S.sheet.open('Day report · line chuno', '<div class="rep-list">' + list.map(function (x) { return '<button class="task" data-rep="' + esc(x.t) + '|' + esc(x.dept) + '|' + esc(x.srn) + '" style="border:0;text-align:left;width:100%"><div class="ic">' + S.icon(x.t === 'PACKING' ? 'box' : 'out') + '</div><div class="b"><div class="n">' + esc(S.shortLine(x.dept)) + '</div><div class="s">' + esc(x.srn) + ' · ' + (x.t === 'PACKING' ? 'Packing Output Report' : 'Making Output Report') + '</div></div><span class="chev">' + S.icon('chev') + '</span></button>'; }).join('') + '</div>');
      $('#sheet-content').onclick = function (e) { var b = e.target.closest('[data-rep]'); if (!b) return; var p = b.dataset.rep.split('|'); S.sheet.close(); S.report(p[0], p[1], p[2]); };
    }).catch(function (e) { toast(e.message, 'bad'); });
  };
})();
