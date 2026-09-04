// hourly.js — Hourly tab: every slot of the day with what has been saved; tap to open/edit. The next empty slot is offered on top.
(function () {
  'use strict';
  var S = window.SG, $ = S.$, esc = S.esc, state = S.state, icon = S.icon;

  S.tabs.hourly = function () {
    var cached = S.factoryData();
    if (cached) render(cached); else $('#hourly-list').innerHTML = '<div class="empty">Loading…</div>';
    S.loadFactory().then(render).catch(function (e) { if (!cached) $('#hourly-list').innerHTML = '<div class="empty">' + esc(e.message) + '</div>'; });
  };

  function render(d) {
    var now = S.isToday() ? S.nowHour() : 24, html = '', next = null, totalPcs = 0;
    var anyOT = S.slots('OT').some(function (s) { return d.slots[s.key] || now >= 18; });
    var list = S.slots('Final').concat(anyOT ? S.slots('OT') : []).concat(S.slots('Night').filter(function (s) { return d.slots[s.key]; }));
    list.forEach(function (s) {
      var inf = S.slotInfo(d, s), st = S.slotStart(s.key);
      totalPcs += inf.pcs;
      if (!next && !inf.full && now >= st) next = { s: s, inf: inf };
    });
    if (next) html += '<div class="hourly-slot next" data-go="hour:' + esc(next.s.key) + '"><span class="t">' + esc(next.s.label) + '</span><div class="b"><b>' + (next.inf.done ? 'Adhoora · ' + next.inf.done + '/' + next.inf.total + ' lines' : 'Bharna baaki') + '</b><br>Tap karke saari lines bharo</div><span class="chev">' + icon('chev') + '</span></div>';
    html += '<h2>Aaj ke ghante · ' + totalPcs + ' pcs</h2>';
    list.forEach(function (s) {
      var inf = S.slotInfo(d, s), st = S.slotStart(s.key), future = now < st;
      html += '<div class="hourly-slot' + (future && !inf.done ? ' future' : '') + '" data-go="hour:' + esc(s.key) + '" style="' + (future && !inf.done ? 'opacity:.5' : '') + '"><span class="t">' + esc(s.label) + '</span><div class="b">' +
        (inf.done ? '<b>' + inf.pcs + ' pcs</b> · ' + inf.done + '/' + inf.total + ' lines' + (inf.eLines ? ' · endline pass ' + inf.pass : '') : (future ? '—' : '<span style="color:var(--warn);font-weight:600">baaki</span>')) +
        '</div>' + (inf.full ? '<span style="color:var(--ok);font-weight:800">✓</span>' : '') + '<span class="chev">' + icon('chev') + '</span></div>';
    });
    $('#hourly-list').innerHTML = html;
  }

  $('#tab-hourly').addEventListener('click', function (e) { var el = e.target.closest('[data-go]'); if (el) S.go(el.dataset.go); });
})();
