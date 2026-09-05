// report.js — printed-style day reports on an A4 canvas: Making Output Report (line × SRN) and Packing Output Report
// (floor × SRN). Share the latest page as PNG (WhatsApp), or print: every line of a SRN, every page, as one PDF.
(function () {
  'use strict';
  var S = window.SG, $ = S.$, esc = S.esc, api = S.api, state = S.state, toast = S.toast;
  var W = 1654, H = 2339, ROWS = 34;              // A4 portrait @ 200 dpi
  var R = { canvas: null, blob: null, name: '' };

  function d2(iso) { var p = (iso || '').split('-'); return p.length === 3 ? p[2] + '.' + p[1] + '.' + p[0].slice(2) : iso; }
  function stamp() { var d = new Date(); return ('0' + d.getDate()).slice(-2) + '.' + ('0' + (d.getMonth() + 1)).slice(-2) + '.' + String(d.getFullYear()).slice(2) + ' ' + ('0' + d.getHours()).slice(-2) + ':' + ('0' + d.getMinutes()).slice(-2); }

  function painter(cv) {
    var c = cv.getContext('2d');
    c.fillStyle = '#fff'; c.fillRect(0, 0, cv.width, cv.height);
    c.strokeStyle = '#111'; c.lineWidth = 1.4; c.textBaseline = 'middle';
    var font = function (o) { return (o.bold ? '700 ' : '500 ') + (o.size || 22) + 'px -apple-system, Roboto, "Segoe UI", sans-serif'; };
    return {
      text: function (t, x, y, o) { o = o || {}; c.font = font(o); c.fillStyle = o.color || '#111'; c.textAlign = o.align || 'left'; c.fillText(String(t == null ? '' : t), x, y); },
      fit: function (t, x, y, w, o) { o = o || {}; c.font = font(o); var s = String(t == null ? '' : t); while (s.length > 1 && c.measureText(s).width > w - 8) s = s.slice(0, -1); this.text(s, x, y, o); },
      // up to two lines inside the cell
      wrap: function (t, x, y, w, h, o) {
        o = o || {}; c.font = font(o); var s = String(t == null ? '' : t);
        if (c.measureText(s).width <= w - 8) { this.text(s, x, y + h / 2, o); return; }
        var words = s.split(/[\s-]+/), l1 = '', l2 = '';
        for (var i = 0; i < words.length; i++) { var t1 = (l1 ? l1 + ' ' : '') + words[i]; if (c.measureText(t1).width <= w - 8 && !l2) l1 = t1; else l2 = (l2 ? l2 + ' ' : '') + words[i]; }
        if (!l1) { l1 = s.slice(0, Math.floor(s.length / 2)); l2 = s.slice(Math.floor(s.length / 2)); }
        this.fit(l1, x, y + h * 0.3, w, o); this.fit(l2, x, y + h * 0.7, w, o);
      },
      rect: function (x, y, w, h, fill) { if (fill) { c.fillStyle = fill; c.fillRect(x, y, w, h); } c.strokeRect(x + .5, y + .5, w, h); }
    };
  }

  // ---------- Making Output Report ----------
  var LCOLS = [
    { k: 'date', t: 'Date', w: 104 }, { k: 'op', t: 'Operation', w: 96 }, { k: 'output', t: 'Output', w: 86 }, { k: 'cum', t: 'Total Output', w: 110 },
    { k: 'operator', t: 'Operator', w: 82 }, { k: 'helper', t: 'Helper', w: 74 }, { k: 'paster', t: 'Paster', w: 74 }, { k: 'eqc', t: 'Endline QC', w: 92 }, { k: 'tc', t: 'Thread Cut', w: 92 }, { k: 'other', t: 'Other', w: 70 }, { k: 'hours', t: 'Work Hr', w: 78 },
    { k: 'supervisor', t: 'Supervisor Name', w: 190 }, { k: 'recorder', t: 'Data Recorder', w: 170 },
    { k: 'challan', t: 'Chalaan No.', w: 100 }, { k: 'lqty', t: 'Load qty', w: 88 }, { k: 'lcum', t: 'Total Load', w: 100 }
  ];
  var LGROUPS = [{ t: 'Output Detail', n: 4 }, { t: 'Manpower Detail', n: 9 }, { t: 'Loading Details', n: 3 }];

  function mergeLine(d) {
    var rows = d.rows.map(function (r) { return Object.assign({}, r); }), loads = d.loading.slice(), merged = [], li = 0;
    rows.forEach(function (r) {
      while (li < loads.length && loads[li].date < r.date) { merged.push({ date: loads[li].date, loadOnly: true, challan: loads[li].challan, lqty: loads[li].qty }); li++; }
      if (li < loads.length && loads[li].date === r.date) { r.challan = loads[li].challan; r.lqty = loads[li].qty; li++; }
      merged.push(r);
    });
    while (li < loads.length) { merged.push({ date: loads[li].date, loadOnly: true, challan: loads[li].challan, lqty: loads[li].qty }); li++; }
    var cum = 0, lcum = 0;
    merged.forEach(function (r) { if (!r.loadOnly) { cum += r.output; r.cum = cum; } if (r.lqty) { lcum += r.lqty; r.lcum = lcum; } });
    return { merged: merged, cum: cum, lcum: lcum };
  }

  // page: 1-based; null = latest page
  function drawLine(d, page) {
    var m = mergeLine(d), merged = m.merged, pages = Math.max(1, Math.ceil(merged.length / ROWS));
    page = page || pages;
    var pageRows = merged.slice((page - 1) * ROWS, page * ROWS);
    if (page > 1) {
      var prev = merged.slice(0, (page - 1) * ROWS), pOut = 0, pLoad = 0;
      prev.forEach(function (r) { if (!r.loadOnly) pOut += r.output; if (r.lqty) pLoad += r.lqty; });
      pageRows = [{ cf: true, date: 'C/F', op: 'Page ' + (page - 1), output: pOut, cum: pOut, lqty: pLoad, lcum: pLoad }].concat(pageRows.slice(0, ROWS - 1));
    }
    var totalW = LCOLS.reduce(function (t, c) { return t + c.w; }, 0), pad = Math.round((W - totalW) / 2);
    var cv = document.createElement('canvas'); cv.width = W; cv.height = H;
    var p = painter(cv);
    p.text('Making Output Report', W / 2, 60, { bold: true, size: 40, align: 'center' });
    var hy = 110, hh = 56, lw = 700;
    [['Factory', d.header.factory], ['SRN', d.header.srn + (d.header.item ? '  —  ' + d.header.item : '')], ['Line', d.header.line]].forEach(function (kv, i) {
      p.rect(pad, hy + i * hh, 150, hh, '#f3f4f6'); p.text(kv[0], pad + 12, hy + i * hh + hh / 2, { bold: true, size: 22 });
      p.rect(pad + 150, hy + i * hh, lw - 150, hh); p.fit(kv[1], pad + 162, hy + i * hh + hh / 2, lw - 162, { size: 26, bold: i === 1 });
    });
    var rw = 700, rx = W - pad - rw;
    [['Floor', d.header.floor], ['Supervisor', d.header.supervisor], ['Incharge', d.header.incharge]].forEach(function (kv, i) {
      p.rect(rx, hy + i * hh, 170, hh, '#f3f4f6'); p.text(kv[0], rx + 12, hy + i * hh + hh / 2, { bold: true, size: 22 });
      p.rect(rx + 170, hy + i * hh, rw - 170, hh); p.fit(kv[1], rx + 182, hy + i * hh + hh / 2, rw - 182, { size: 26 });
    });
    var y = hy + 3 * hh + 40, gx = pad, ci = 0;
    LGROUPS.forEach(function (g) { var w = 0; for (var i = 0; i < g.n; i++) w += LCOLS[ci + i].w; p.rect(gx, y, w, 40, '#e5e7eb'); p.text(g.t, gx + w / 2, y + 20, { bold: true, size: 22, align: 'center' }); gx += w; ci += g.n; });
    y += 40; var x = pad;
    LCOLS.forEach(function (c) { p.rect(x, y, c.w, 44, '#f3f4f6'); p.fit(c.t, x + c.w / 2, y + 22, c.w, { bold: true, size: 17, align: 'center' }); x += c.w; });
    y += 44;
    var rowH = Math.floor((H - y - 70) / ROWS);
    for (var r = 0; r < ROWS; r++) {
      var row = pageRows[r], x2 = pad;
      LCOLS.forEach(function (c) {
        p.rect(x2, y, c.w, rowH, row && row.cf ? '#fef3c7' : null);
        if (row) {
          var v = row[c.k];
          if (c.k === 'date' && !row.cf) v = d2(row.date);
          if (row.loadOnly && ['op', 'output', 'cum', 'operator', 'helper', 'paster', 'eqc', 'tc', 'other', 'hours', 'supervisor', 'recorder'].indexOf(c.k) >= 0) v = '';
          if (v !== undefined && v !== null && v !== '') {
            if (c.k === 'supervisor' || c.k === 'recorder') p.wrap(v, x2 + 6, y, c.w, rowH, { size: 17 });
            else p.fit(v, x2 + c.w / 2, y + rowH / 2, c.w, { size: 22, bold: c.k === 'cum' || c.k === 'lcum' || !!row.cf, align: 'center' });
          }
        }
        x2 += c.w;
      });
      y += rowH;
    }
    p.text('Page ' + page + ' / ' + pages + (page > 1 ? '   ·   C/F = page ' + (page - 1) + ' tak ka total' : '') + '   ·   SG Data · ' + stamp(), W / 2, y + 34, { size: 18, color: '#6b7280', align: 'center' });
    return { canvas: cv, page: page, pages: pages, rows: merged.length, total: m.cum, loaded: m.lcum };
  }

  // ---------- Packing Output Report ----------
  var PCOLS = [
    { k: 'date', t: 'Date', w: 110 }, { k: 'checker', t: 'Checker', w: 90 }, { k: 'tc', t: 'Thread cutter', w: 110 }, { k: 'helper', t: 'Helper', w: 90 }, { k: 'pressman', t: 'Press man', w: 100 },
    { k: 'op', t: 'Operation', w: 110 }, { k: 'hours', t: 'Work Hr', w: 90 }, { k: 'pcs', t: 'Pack pcs', w: 100 }, { k: 'cum', t: 'Total Pack PC', w: 130 }, { k: 'box', t: 'Box', w: 90 }, { k: 'bcum', t: 'Total Box', w: 110 },
    { k: 'supervisor', t: 'Supervisor', w: 210 }, { k: 'sign', t: 'Warehouse Sign', w: 200 }
  ];
  function drawPacking(d, page) {
    var rows = d.rows.map(function (r) { return Object.assign({}, r); }), cum = 0, bcum = 0;
    rows.forEach(function (r) { cum += r.pcs; bcum += r.box; r.cum = cum; r.bcum = bcum; });
    var pages = Math.max(1, Math.ceil(rows.length / ROWS)); page = page || pages;
    var pageRows = rows.slice((page - 1) * ROWS, page * ROWS);
    if (page > 1) { var pp = 0, pb = 0; rows.slice(0, (page - 1) * ROWS).forEach(function (r) { pp += r.pcs; pb += r.box; }); pageRows = [{ cf: true, date: 'C/F', op: 'Page ' + (page - 1), pcs: pp, cum: pp, box: pb, bcum: pb }].concat(pageRows.slice(0, ROWS - 1)); }
    var totalW = PCOLS.reduce(function (t, c) { return t + c.w; }, 0), pad = Math.round((W - totalW) / 2);
    var cv = document.createElement('canvas'); cv.width = W; cv.height = H;
    var p = painter(cv);
    p.text('Star Global', W / 2, 52, { bold: true, size: 40, align: 'center' });
    p.text('Packing Output Report', W / 2, 98, { bold: true, size: 30, align: 'center' });
    var hy = 140, hh = 56;
    [['SRN', d.header.srn + (d.header.item ? '  —  ' + d.header.item : '')], ['Floor', d.header.floor]].forEach(function (kv, i) { p.rect(pad, hy + i * hh, 130, hh, '#f3f4f6'); p.text(kv[0], pad + 12, hy + i * hh + hh / 2, { bold: true, size: 22 }); p.rect(pad + 130, hy + i * hh, 560, hh); p.fit(kv[1], pad + 142, hy + i * hh + hh / 2, 548, { size: 26, bold: i === 0 }); });
    var mx = pad + 720; p.rect(mx, hy, 150, hh * 2, '#f3f4f6'); p.text('PCS Per Box', mx + 12, hy + hh, { bold: true, size: 22 }); p.rect(mx + 150, hy, 130, hh * 2); p.text(d.header.pcsPerBox || '', mx + 215, hy + hh, { size: 36, bold: true, align: 'center' });
    var rx = W - pad - 520;
    [['Factory', d.header.factory], ['Supervisor', d.header.supervisor]].forEach(function (kv, i) { p.rect(rx, hy + i * hh, 150, hh, '#f3f4f6'); p.text(kv[0], rx + 12, hy + i * hh + hh / 2, { bold: true, size: 22 }); p.rect(rx + 150, hy + i * hh, 370, hh); p.fit(kv[1], rx + 162, hy + i * hh + hh / 2, 358, { size: 26 }); });
    var y = hy + 2 * hh + 40, x = pad;
    PCOLS.forEach(function (c) { p.rect(x, y, c.w, 48, '#f3f4f6'); p.fit(c.t, x + c.w / 2, y + 24, c.w, { bold: true, size: 18, align: 'center' }); x += c.w; });
    y += 48;
    var rowH = Math.floor((H - y - 70) / ROWS);
    for (var r = 0; r < ROWS; r++) {
      var row = pageRows[r], x2 = pad;
      PCOLS.forEach(function (c) {
        p.rect(x2, y, c.w, rowH, row && row.cf ? '#fef3c7' : null);
        if (row) { var v = row[c.k]; if (c.k === 'date' && !row.cf) v = d2(row.date); if (c.k === 'sign') v = ''; if (v !== undefined && v !== null && v !== '') { if (c.k === 'supervisor') p.wrap(v, x2 + 6, y, c.w, rowH, { size: 17 }); else p.fit(v, x2 + c.w / 2, y + rowH / 2, c.w, { size: 22, bold: c.k === 'cum' || c.k === 'bcum' || !!row.cf, align: 'center' }); } }
        x2 += c.w;
      });
      y += rowH;
    }
    p.text('Page ' + page + ' / ' + pages + (page > 1 ? '   ·   C/F = page ' + (page - 1) + ' tak ka total' : '') + '   ·   SG Data · ' + stamp(), W / 2, y + 34, { size: 18, color: '#6b7280', align: 'center' });
    return { canvas: cv, page: page, pages: pages, rows: rows.length, total: cum, loaded: null };
  }

  // ---------- Quality Department - Endline FTR ----------
  var ECOLS = [
    { k: 'date', t: 'Date', w: 104 }, { k: 'output', t: 'Line Output', w: 100 }, { k: 'ocum', t: 'Total Output', w: 110 }, { k: 'mp', t: 'Quality Manpower', w: 110 }, { k: 'hours', t: 'Working Hour', w: 96 },
    { k: 'checked', t: 'Check PCS', w: 96 }, { k: 'ccum', t: 'Total Check Pcs', w: 118 }, { k: 'pass', t: 'Pass PCS', w: 96 }, { k: 'pcum', t: 'Total Pass PCS', w: 118 }, { k: 'fail', t: 'Fail PCS', w: 90 }, { k: 'fcum', t: 'Total Fail PCS', w: 110 },
    { k: 'qc', t: 'Qc Sign', w: 200 }, { k: 'sheet', t: 'Sheet Code', w: 100 }
  ];
  function drawEndline(d, page) {
    var rows = d.rows.map(function (r) { return Object.assign({}, r); }), oc = 0, cc = 0, pc = 0, fc = 0;
    rows.forEach(function (r) { oc += r.output; cc += r.checked; pc += r.pass; fc += r.fail; r.ocum = oc; r.ccum = cc; r.pcum = pc; r.fcum = fc; });
    var pages = Math.max(1, Math.ceil(rows.length / ROWS)); page = page || pages;
    var pageRows = rows.slice((page - 1) * ROWS, page * ROWS);
    if (page > 1) { var a = { output: 0, checked: 0, pass: 0, fail: 0 }; rows.slice(0, (page - 1) * ROWS).forEach(function (r) { a.output += r.output; a.checked += r.checked; a.pass += r.pass; a.fail += r.fail; }); pageRows = [{ cf: true, date: 'C/F', output: a.output, ocum: a.output, checked: a.checked, ccum: a.checked, pass: a.pass, pcum: a.pass, fail: a.fail, fcum: a.fail }].concat(pageRows.slice(0, ROWS - 1)); }
    var totalW = ECOLS.reduce(function (t, c) { return t + c.w; }, 0), pad = Math.round((W - totalW) / 2);
    var cv = document.createElement('canvas'); cv.width = W; cv.height = H;
    var p = painter(cv);
    p.text('STAR GLOBAL', W / 2, 52, { bold: true, size: 40, align: 'center' });
    p.text('Quality Department - Endline FTR', W / 2, 98, { bold: true, size: 30, align: 'center' });
    var hy = 140, hh = 56, cw = Math.floor((W - 2 * pad) / 3);
    var box = function (col, i, k, v, big) { var x = pad + col * cw; p.rect(x, hy + i * hh, 150, hh, '#f3f4f6'); p.text(k, x + 12, hy + i * hh + hh / 2, { bold: true, size: 22 }); p.rect(x + 150, hy + i * hh, cw - 150, hh); p.fit(v, x + 162, hy + i * hh + hh / 2, cw - 162, { size: 26, bold: !!big }); };
    box(0, 0, 'SRN', d.header.srn + (d.header.item ? '  —  ' + d.header.item : ''), true); box(0, 1, 'Line Code', d.header.line);
    box(1, 0, 'Factory', d.header.factory); box(1, 1, 'Floor', d.header.floor);
    box(2, 0, 'Incharge', d.header.incharge); box(2, 1, 'IP QC', d.header.ipqc);
    var y = hy + 2 * hh + 40, x = pad;
    ECOLS.forEach(function (c) { p.rect(x, y, c.w, 48, '#f3f4f6'); p.wrap(c.t, x + 4, y, c.w, 48, { bold: true, size: 17 }); x += c.w; });
    y += 48;
    var rowH = Math.floor((H - y - 70) / ROWS);
    for (var r = 0; r < ROWS; r++) {
      var row = pageRows[r], x2 = pad;
      ECOLS.forEach(function (c) {
        p.rect(x2, y, c.w, rowH, row && row.cf ? '#fef3c7' : null);
        if (row) { var v = row[c.k]; if (c.k === 'date' && !row.cf) v = d2(row.date); if (c.k === 'sheet') v = ''; if (v !== undefined && v !== null && v !== '') { if (c.k === 'qc') p.wrap(v, x2 + 6, y, c.w, rowH, { size: 17 }); else p.fit(v, x2 + c.w / 2, y + rowH / 2, c.w, { size: 22, bold: /cum$/.test(c.k) || !!row.cf, align: 'center' }); } }
        x2 += c.w;
      });
      y += rowH;
    }
    p.text('Page ' + page + ' / ' + pages + (page > 1 ? '   ·   C/F = page ' + (page - 1) + ' tak ka total' : '') + '   ·   SG Data · ' + stamp(), W / 2, y + 34, { size: 18, color: '#6b7280', align: 'center' });
    return { canvas: cv, page: page, pages: pages, rows: rows.length, total: pc, loaded: null };
  }
  function drawBy(type, d, page) { return type === 'PACKING' ? drawPacking(d, page) : type === 'ENDLINE' ? drawEndline(d, page) : drawLine(d, page); }
  function actionOf(type) { return type === 'PACKING' ? 'report.packing' : type === 'ENDLINE' ? 'report.endline' : 'report.line'; }
  function labelOf(type) { return type === 'PACKING' ? 'Packing' : type === 'ENDLINE' ? 'Endline FTR' : 'Making'; }

  // ---------- single report screen (latest page, share PNG) ----------
  S.report = function (type, dept, srn) {
    S.push('report', labelOf(type) + ' report · ' + srn);
    $('#report-info').innerHTML = '<div class="empty">Data aa raha hai…</div>'; $('#report-canvas-wrap').innerHTML = '';
    api(actionOf(type), { factory: state.factory, dept: dept, srn: srn })
      .then(function (d) {
        var out = drawBy(type, d);
        R.canvas = out.canvas; R.name = labelOf(type).replace(/\s+/g, '') + '_' + S.shortLine(dept).replace(/\s+/g, '') + '_' + srn + '_' + state.date + '.png';
        $('#report-info').innerHTML = '<b>' + esc(S.shortLine(dept)) + ' · ' + esc(srn) + '</b><div class="muted" style="font-size:12px">' + out.rows + ' rows · page ' + out.page + '/' + out.pages + (out.pages > 1 ? ' (pehli row C/F)' : '') + ' · total ' + out.total + (out.loaded !== null ? ' · loaded ' + out.loaded : '') + ' · A4</div>';
        $('#report-canvas-wrap').innerHTML = ''; $('#report-canvas-wrap').appendChild(out.canvas);
        R.blob = null; out.canvas.toBlob(function (b) { R.blob = b; }, 'image/png');
      })
      .catch(function (e) { $('#report-info').innerHTML = '<div class="empty">' + esc(e.message) + '</div>'; });
  };
  function shareFile(blob, name, mime) {
    var file = new File([blob], name, { type: mime });
    if (navigator.canShare && navigator.canShare({ files: [file] })) navigator.share({ files: [file], title: name }).catch(function () {});
    else { toast('Is browser me direct share nahi — download ho raha hai', '', 4000); downloadBlob(blob, name); }
  }
  function downloadBlob(blob, name) { var a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name; document.body.appendChild(a); a.click(); setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 2000); }
  $('#btn-rep-share').addEventListener('click', function () { if (!R.blob) { toast('Image abhi ban rahi hai…', ''); return; } shareFile(R.blob, R.name, 'image/png'); });
  $('#btn-rep-dl').addEventListener('click', function () { if (R.blob) downloadBlob(R.blob, R.name); });

  // ---------- minimal PDF writer: one JPEG per A4 page ----------
  function makePdf(jpegs) {
    var enc = function (s) { return new TextEncoder().encode(s); };
    var parts = [], offsets = [], pos = 0;
    var push = function (u8) { parts.push(u8); pos += u8.length; };
    var obj = function (n, body) { offsets[n] = pos; push(enc(n + ' 0 obj\n')); if (typeof body === 'string') push(enc(body)); else { push(enc(body.head)); push(body.data); push(enc('\nendstream')); } push(enc('\nendobj\n')); };
    push(enc('%PDF-1.4\n%\xe2\xe3\xcf\xd3\n'));
    var n = jpegs.length, pageIds = [], objN = 3;
    var pw = 595.28, ph = 841.89;
    for (var i = 0; i < n; i++) { pageIds.push(objN); objN += 3; }
    obj(1, '<< /Type /Catalog /Pages 2 0 R >>');
    obj(2, '<< /Type /Pages /Kids [' + pageIds.map(function (id) { return id + ' 0 R'; }).join(' ') + '] /Count ' + n + ' >>');
    jpegs.forEach(function (j, i) {
      var id = pageIds[i], content = 'q ' + pw + ' 0 0 ' + ph + ' 0 0 cm /Im' + i + ' Do Q';
      obj(id, '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ' + pw + ' ' + ph + '] /Resources << /XObject << /Im' + i + ' ' + (id + 2) + ' 0 R >> >> /Contents ' + (id + 1) + ' 0 R >>');
      obj(id + 1, { head: '<< /Length ' + content.length + ' >>\nstream\n', data: enc(content) });
      obj(id + 2, { head: '<< /Type /XObject /Subtype /Image /Width ' + j.w + ' /Height ' + j.h + ' /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ' + j.data.length + ' >>\nstream\n', data: j.data });
    });
    var xref = pos, total = objN;
    var x = 'xref\n0 ' + total + '\n0000000000 65535 f \n';
    for (var k = 1; k < total; k++) x += ('0000000000' + (offsets[k] || 0)).slice(-10) + ' 00000 n \n';
    push(enc(x + 'trailer\n<< /Size ' + total + ' /Root 1 0 R >>\nstartxref\n' + xref + '\n%%EOF'));
    return new Blob(parts, { type: 'application/pdf' });
  }
  function canvasJpeg(cv) {
    return new Promise(function (res) { cv.toBlob(function (b) { b.arrayBuffer().then(function (ab) { res({ w: cv.width, h: cv.height, data: new Uint8Array(ab) }); }); }, 'image/jpeg', 0.85); });
  }

  // ---------- print: one SRN, every line / floor, every page ----------
  S.printSrn = function (preset) {
    var html = '<label>SRN</label><div id="pr-srn"></div><p class="hint">Us SRN ki saari lines aur packing floors — line-wise, saare pages — ek PDF me.</p><button class="btn primary big" id="pr-go" disabled>PDF banao</button>';
    S.sheet.open('Print SRN report', html);
    var chosen = preset || '';
    api('orders.active', { factory: state.factory, dept: '', type: 'PACKING' }, { quiet: true }).then(function (d) {
      S.srnPicker($('#pr-srn'), { list: d.srns, value: chosen, autofocus: !chosen, placeholder: 'SRN number (597)', onPick: function (v) { chosen = v; $('#pr-go').disabled = !v; } });
      $('#pr-go').disabled = !chosen;
    }).catch(function (e) { toast(e.message, 'bad'); });
    $('#sheet-content').addEventListener('click', function (e) {
      if (!e.target.closest('#pr-go') || !chosen) return;
      S.sheet.close(); buildPdf(chosen);
    });
  };

  function buildPdf(srn) {
    S.busy(true);
    api('report.srn', { factory: state.factory, srn: srn }, { quiet: true }).then(function (d) {
      if (!d.targets.length) { S.busy(false); toast(srn + ' ka koi data nahi mila', 'bad'); return; }
      var seq = Promise.resolve(), pages = [];
      d.targets.forEach(function (t) {
        seq = seq.then(function () {
          return api(actionOf(t.type), { factory: state.factory, dept: t.dept, srn: srn }, { quiet: true }).then(function (rd) {
            if (!rd.rows.length) return;
            var first = drawBy(t.type, rd, 1), all = [first.canvas];
            for (var pg = 2; pg <= first.pages; pg++) all.push(drawBy(t.type, rd, pg).canvas);
            return Promise.all(all.map(canvasJpeg)).then(function (js) { js.forEach(function (j) { pages.push(j); }); });
          });
        });
      });
      return seq.then(function () {
        var blob = makePdf(pages), name = 'SRN_' + srn + '_report_' + state.date + '.pdf';
        S.busy(false);
        S.sheet.open('PDF ready · ' + srn, '<div class="card" style="margin:0 0 8px"><b>' + pages.length + ' page' + (pages.length > 1 ? 's' : '') + '</b> · ' + d.targets.length + ' line/floor' + (d.item ? '<br><span class="muted">' + esc(d.item) + '</span>' : '') + '</div>' +
          '<div class="actions"><button class="btn ghost" id="pdf-dl">Download</button><button class="btn wa" id="pdf-share">Share / Print</button></div>');
        $('#sheet-content').onclick = function (e) { if (e.target.closest('#pdf-dl')) downloadBlob(blob, name); if (e.target.closest('#pdf-share')) shareFile(blob, name, 'application/pdf'); };
      });
    }).catch(function (e) { S.busy(false); toast(e.message, 'bad', 6000); });
  }

  // ---------- review all of today's reports, then send them together ----------
  var RA = { files: [], alerts: [] };
  S.reportAlerts = function (fresh) {
    var r = S.swr('report.check', { factory: state.factory, date: state.date }, fresh ? 0 : 30000);
    return r.promise.then(function (d) { return d.alerts || []; });
  };
  S.reportAll = function () {
    S.push('reportall', 'Review & send · ' + S.fmtDay(state.date));
    $('#ra-info').innerHTML = '<div class="empty">PMS check + reports ban rahe hain…</div>'; $('#ra-list').innerHTML = ''; RA.files = []; RA.alerts = [];
    $('#btn-ra-share').disabled = true; $('#btn-ra-dl').disabled = true;
    S.reportAlerts(true).then(function (alerts) { RA.alerts = alerts; return S.loadFactory(); }).then(function (d) {
      var list = [];
      d.depts.forEach(function (x) { var srn = d.attSrn && d.attSrn[x.dept]; if (!srn) return; if (x.cat === 'PACKING') list.push({ t: 'PACKING', dept: x.dept, srn: srn }); else { list.push({ t: 'STITCH', dept: x.dept, srn: srn }); list.push({ t: 'ENDLINE', dept: x.dept, srn: srn }); } });
      if (!list.length) { $('#ra-info').innerHTML = '<div class="empty">Is din kisi line ka SRN / attendance nahi</div>'; return; }
      var seq = Promise.resolve(), done = 0;
      list.forEach(function (x) {
        seq = seq.then(function () {
          return api(actionOf(x.t), { factory: state.factory, dept: x.dept, srn: x.srn }, { quiet: true }).then(function (rd) {
            var out = drawBy(x.t, rd), name = labelOf(x.t).replace(/\s+/g, '') + '_' + S.shortLine(x.dept).replace(/\s+/g, '') + '_' + x.srn + '_' + state.date + '.png';
            var wrap = document.createElement('div'); wrap.className = 'ra-item';
            wrap.innerHTML = '<div class="t"><span>' + esc(S.shortLine(x.dept)) + ' · ' + esc(labelOf(x.t)) + '</span><span class="muted">' + esc(x.srn) + ' · ' + out.rows + ' rows · p' + out.page + '/' + out.pages + '</span></div>';
            wrap.appendChild(out.canvas); $('#ra-list').appendChild(wrap);
            done++; $('#ra-info').innerHTML = (RA.alerts.length ? S.alertsHtml(RA.alerts) : '') + '<b>' + done + ' / ' + list.length + ' reports</b><div class="muted" style="font-size:12px">' + (RA.alerts.length ? 'Mismatch theek hone tak send band hai — reports sirf dekh sakte ho' : 'Neeche ek-ek karke dekho, phir "Send all" — sab ek saath WhatsApp me') + '</div>';
            return new Promise(function (res) { out.canvas.toBlob(function (b) { RA.files.push(new File([b], name, { type: 'image/png' })); res(); }, 'image/png'); });
          }).catch(function (e) { $('#ra-list').insertAdjacentHTML('beforeend', '<div class="ra-item"><div class="t">' + esc(S.shortLine(x.dept)) + ' · ' + esc(labelOf(x.t)) + '</div><div class="empty">' + esc(e.message) + '</div></div>'); });
        });
      });
      return seq.then(function () { var blocked = RA.alerts.length > 0; $('#btn-ra-share').disabled = blocked || !RA.files.length; $('#btn-ra-share').textContent = blocked ? 'Send band — mismatch' : 'Send all (WhatsApp)'; $('#btn-ra-dl').disabled = blocked || !RA.files.length; });
    }).catch(function (e) { $('#ra-info').innerHTML = '<div class="empty">' + esc(e.message) + '</div>'; });
  };
  $('#btn-ra-share').addEventListener('click', function () {
    if (!RA.files.length) return;
    if (navigator.canShare && navigator.canShare({ files: RA.files })) navigator.share({ files: RA.files, title: 'SG Data reports ' + state.date }).catch(function () {});
    else { toast('Is browser me multi-file share nahi — ek-ek download ho raha hai', '', 5000); RA.files.forEach(function (f, i) { setTimeout(function () { downloadBlob(f, f.name); }, i * 400); }); }
  });
  $('#btn-ra-dl').addEventListener('click', function () { RA.files.forEach(function (f, i) { setTimeout(function () { downloadBlob(f, f.name); }, i * 400); }); });

  // today's line×SRN list -> single report
  S.reportPicker = function () {
    S.loadFactory().then(function (d) {
      var list = [];
      d.depts.forEach(function (x) { var srn = d.attSrn && d.attSrn[x.dept]; if (!srn) return; if (x.cat === 'PACKING') list.push({ t: 'PACKING', dept: x.dept, srn: srn }); else { list.push({ t: 'STITCH', dept: x.dept, srn: srn }); list.push({ t: 'ENDLINE', dept: x.dept, srn: srn }); } });
      if (!list.length) { toast('Aaj kisi line ka SRN nahi mila — pehle attendance', 'bad'); return; }
      S.sheet.open('Day report · line chuno', '<div class="rep-list">' + list.map(function (x) { return '<button class="task" data-rep="' + esc(x.t) + '|' + esc(x.dept) + '|' + esc(x.srn) + '" style="border:0;text-align:left;width:100%"><div class="ic">' + S.icon(x.t === 'PACKING' ? 'box' : 'out') + '</div><div class="b"><div class="n">' + esc(S.shortLine(x.dept)) + '</div><div class="s">' + esc(x.srn) + ' · ' + (x.t === 'PACKING' ? 'Packing Output Report' : x.t === 'ENDLINE' ? 'Endline FTR' : 'Making Output Report') + '</div></div><span class="chev">' + S.icon('chev') + '</span></button>'; }).join('') + '<button class="lnk" id="rep-print">🖨 Ya poora SRN print karo (PDF)</button></div>');
      $('#sheet-content').onclick = function (e) { if (e.target.closest('#rep-print')) { S.sheet.close(); S.printSrn(list[0].srn); return; } var b = e.target.closest('[data-rep]'); if (!b) return; var p = b.dataset.rep.split('|'); S.sheet.close(); S.report(p[0], p[1], p[2]); };
    }).catch(function (e) { toast(e.message, 'bad'); });
  };
})();
