// entry.js — Entry tab: direct entry hub. Every kind of entry for the selected line, one tap away.
(function () {
  'use strict';
  var S = window.SG, $ = S.$, esc = S.esc, state = S.state, icon = S.icon;

  function card(o) {
    return '<button class="egrid' + (o.wide ? ' wide' : '') + '" data-go="' + esc(o.go) + '">' + (o.st ? '<span class="st ' + esc(o.stCls || '') + '">' + esc(o.st) + '</span>' : '') +
      '<div class="ic">' + icon(o.ic) + '</div><div><div class="n">' + esc(o.n) + '</div><div class="s">' + esc(o.s || '') + '</div></div></button>';
  }

  S.tabs.entry = function () {
    if (!state.line) { $('#entry-grid').innerHTML = '<div class="empty">Pehle upar se line chuno</div>'; return; }
    $('#entry-grid').innerHTML = '<div class="empty">Loading…</div>';
    S.loadToday().then(render).catch(function (e) { $('#entry-grid').innerHTML = '<div class="empty">' + esc(e.message) + '</div>'; });
  };

  function render(d) {
    var type = S.hourlyType(), cat = S.lineCat(), lock = function (t) { return S.lockedType(t); };
    var sl = (d.slots || {})[type] || {}, el = (d.slots || {}).ENDLINE || {};
    var nSlots = Object.keys(sl).length, nE = Object.keys(el).length, tot = d.totals[type] || {};
    var html = '<div class="grid">';
    html += card({ go: 'att:Final', ic: 'att', n: 'Attendance', s: 'Day 9–6 · role-wise', st: lock('ATT') ? 'Locked' : d.att.Final ? d.att.Final.manpower + ' mp' : 'Baaki', stCls: lock('ATT') ? '' : d.att.Final ? 'done' : 'warn' });
    html += card({ go: 'att:OT', ic: 'att', n: 'OT attendance', s: '6–10 PM', st: d.att.OT ? d.att.OT.manpower + ' mp' : '', stCls: 'done' });
    if (type) html += card({ go: 'pick:' + type, ic: type === 'PACKING' ? 'box' : 'out', n: type === 'PACKING' ? 'Packing' : 'Stitching output', s: 'Ghante ka slot chun ke bharo', st: lock(type) ? 'Locked' : nSlots ? nSlots + ' slot · ' + (tot.qty || 0) : 'Baaki', stCls: lock(type) ? '' : nSlots ? 'done' : 'warn' });
    if (cat === 'STITCH') html += card({ go: 'pick:ENDLINE', ic: 'qc', n: 'Endline checking', s: 'Checked · pass · reject', st: lock('ENDLINE') ? 'Locked' : nE ? nE + ' slot' : '', stCls: nE ? 'done' : '' });
    html += card({ go: 'manpower', ic: 'mp', n: 'Manpower change', s: 'Half day · gaya · late', st: (d.events || []).length ? (d.events.length + ' event') : '', stCls: 'done' });
    html += card({ go: 'dayclose', ic: 'moon', n: 'Din band karo', s: 'Preview → submit', st: Object.keys(d.statuses || {}).length ? d.statuses[Object.keys(d.statuses)[0]].status : '', stCls: 'done' });
    html += '</div>';
    if (type) html += '<h2>Advanced</h2><div class="grid">' + card({ go: 'table:' + type, ic: 'table', wide: true, n: 'Poori hourly table', s: 'Saare slots ek saath, kai SRN' }) + '</div>';
    $('#entry-grid').innerHTML = html;
  }

  $('#tab-entry').addEventListener('click', function (e) { var el = e.target.closest('[data-go]'); if (el) S.go(el.dataset.go); });
})();
