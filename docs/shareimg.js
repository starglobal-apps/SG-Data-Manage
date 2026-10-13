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
