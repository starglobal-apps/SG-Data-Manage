// pms.js — PMS tab: Loading vs Stitching vs Endline pass vs Packing per line × SRN. Mismatches in light red.
// Default = the user's lines/floors (last 50 days of loading). Search by number shows every variant on any line; "+" pins it.
(function () {
  'use strict';
  var S = window.SG, $ = S.$, esc = S.esc, state = S.state;
  var P = { q: '', rows: null, watch: JSON.parse(localStorage.getItem('sg_pms_watch') || '[]') };

  function saveWatch() { localStorage.setItem('sg_pms_watch', JSON.stringify(P.watch)); }
  function bad(r) {
    return { st: r.loaded > 0 && r.stitched > r.loaded, en: r.endPass > r.stitched && r.stitched >= 0 && (r.stitched > 0 || r.endPass > 0) && r.endPass > r.stitched, pk: r.endPassSrn > 0 ? r.packed > r.endPassSrn : false };
  }
  function row(r, pinned) {
    var b = bad(r), any = b.st || b.en || b.pk;
    var pin = pinned ? '<button class="pin" data-unpin="' + esc(r.dept + '|' + r.srn) + '">✕</button>' : (P.q ? '<button class="pin" data-pin="' + esc(r.dept + '|' + r.srn) + '">+ add</button>' : '');
    return '<div class="pms' + (any ? ' flag' : '') + '" data-rep="' + esc((r.floor ? 'PACKING' : 'STITCH') + '|' + r.dept + '|' + r.srn) + '"><div class="pms-h"><span class="srn">' + esc(r.srn) + '</span><span class="it">' + esc(r.item) + '</span>' + (r.lastLoad ? '<span class="dt">' + esc(S.fmtDay(r.lastLoad)) + '</span>' : '') + pin + '</div>' +
      '<div class="pms-n"><div' + (b.st ? ' class="bad"' : '') + '><div class="k">Loading</div><div class="v">' + r.loaded + '</div></div>' +
      '<div' + (b.st ? ' class="bad"' : '') + '><div class="k">Stitch</div><div class="v">' + r.stitched + '</div></div>' +
      '<div' + (b.en || b.pk ? ' class="bad"' : '') + '><div class="k">End pass' + (b.pk && r.endPassSrn !== r.endPass ? ' <small>sab lines</small>' : '') + '</div><div class="v">' + (b.pk && r.endPassSrn !== r.endPass ? r.endPassSrn : r.endPass) + '</div></div>' +
      '<div' + (b.pk ? ' class="bad"' : '') + '><div class="k">Packed</div><div class="v">' + r.packed + '</div></div></div>' +
      (b.pk ? '<div class="pms-sub" style="color:var(--bad)">⚠ Packed ' + r.packed + ' (sab floors) &gt; endline pass ' + r.endPassSrn + ' (sab lines) — ' + (r.packed - r.endPassSrn) + ' ka endline data kam</div>' : '') +
      (r.floor ? '<div class="pms-sub">Is floor par packed: <b>' + r.packedHere + '</b> · SRN total: loaded ' + r.loadedSrn + ' · stitched ' + r.stitchedSrn + ' · end pass ' + r.endPassSrn + '</div>' : (r.loadedSrn !== r.loaded || r.endPassSrn !== r.endPass ? '<div class="pms-sub">' + (b.pk ? 'Is line: end pass ' + r.endPass + ' · ' : '') + 'SRN total (sab lines): loaded ' + r.loadedSrn + ' · stitched ' + r.stitchedSrn + ' · end pass ' + r.endPassSrn + ' · packed ' + r.packed + '</div>' : '')) + '</div>';
  }

  S.tabs.pms = function () {
    if (!$('#pms-search .srnp-in') && !P.q) $('#pms-search').innerHTML = '<input class="srnp-in" id="pms-q" type="text" inputmode="numeric" placeholder="SRN number search (597)" value="' + esc(P.q) + '">';
    load();
  };

  function load() {
    var r = S.swr('pms.get', { factory: state.factory, days: 50, q: P.q }, 60000);
    if (r.data) render(r.data); else $('#pms-list').innerHTML = '<div class="empty">Loading…</div>';
    r.promise.then(render).catch(function (e) { if (!r.data) $('#pms-list').innerHTML = '<div class="empty">' + esc(e.message) + '</div>'; });
  }

  function render(d) {
    P.rows = d.rows;
    var html = '';
    if (P.q) {
      html += '<div class="pms-grp"><span>"' + esc(P.q) + '" · ' + d.rows.length + ' result</span><button class="lnk" data-clear="1">✕ clear</button></div>';
      html += d.rows.length ? d.rows.map(function (r) { return row(r, false); }).join('') : '<div class="empty">Koi SRN nahi mila</div>';
    } else {
      var byDept = {}, order = [];
      d.rows.forEach(function (r) { var k = r.dept || 'Other'; if (!byDept[k]) { byDept[k] = []; order.push(k); } byDept[k].push(r); });
      var flagged = d.rows.filter(function (r) { var b = bad(r); return b.st || b.en || b.pk; }).length;
      html += '<div class="pms-grp"><span>Meri lines · last ' + d.days + ' din</span><span>' + (flagged ? '<span style="color:var(--bad)">' + flagged + ' mismatch</span>' : 'sab theek ✓') + '</span></div>';
      order.forEach(function (dept) {
        html += '<div class="pms-grp"><span>' + esc(S.shortLine(dept)) + '</span><span>' + byDept[dept].length + ' SRN</span></div>' + byDept[dept].map(function (r) { return row(r, false); }).join('');
      });
      if (!d.rows.length) html += '<div class="empty">Last ' + d.days + ' din me aapki lines par loading nahi</div>';
      if (P.watch.length) html += '<div class="pms-grp"><span>Meri watch list</span><span>' + P.watch.length + '</span></div><div id="pms-watch"><div class="empty">Loading…</div></div>';
    }
    $('#pms-list').innerHTML = html;
    if (!P.q && P.watch.length) loadWatch();
  }

  function loadWatch() {
    var nums = {}; P.watch.forEach(function (k) { nums[k.split('|')[1].replace(/\D/g, '').slice(0, 4)] = true; });
    Promise.all(Object.keys(nums).map(function (q) { return S.swr('pms.get', { factory: state.factory, days: 50, q: q }, 60000).promise; }))
      .then(function (res) {
        var all = []; res.forEach(function (d) { all = all.concat(d.rows); });
        var box = $('#pms-watch'); if (!box) return;
        box.innerHTML = P.watch.map(function (k) { var r = all.filter(function (x) { return x.dept + '|' + x.srn === k; })[0]; return r ? row(r, true) : ''; }).join('') || '<div class="empty">—</div>';
      }).catch(function () {});
  }

  var t;
  $('#tab-pms').addEventListener('input', function (e) {
    if (e.target.id !== 'pms-q') return;
    clearTimeout(t);
    var q = e.target.value.replace(/\D/g, '');
    t = setTimeout(function () { P.q = q; load(); }, 350);
  });
  $('#tab-pms').addEventListener('click', function (e) {
    var b = e.target.closest('button');
    if (!b) { var card = e.target.closest('[data-rep]'); if (card && card.dataset.rep.split('|')[1]) { var p = card.dataset.rep.split('|'); S.report(p[0], p[1], p[2]); } return; }
    if (b.id === 'pms-print') { S.printSrn(P.q ? (P.rows && P.rows[0] ? P.rows[0].srn : '') : ''); return; }
    if (b.dataset.clear) { P.q = ''; $('#pms-q').value = ''; load(); }
    else if (b.dataset.pin) { if (P.watch.indexOf(b.dataset.pin) < 0) P.watch.push(b.dataset.pin); saveWatch(); S.toast('Watch list me add · PMS tab me neeche dikhega', 'ok'); }
    else if (b.dataset.unpin) { P.watch = P.watch.filter(function (k) { return k !== b.dataset.unpin; }); saveWatch(); load(); }
  });
})();
