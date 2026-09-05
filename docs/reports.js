// reports.js — Report tab: every report of the selected day (Making / Endline FTR per line, Packing per floor),
// always built from the latest data; tap to preview & share. Below it, the day's hours (tap to edit).
(function () {
  'use strict';
  var S = window.SG, $ = S.$, esc = S.esc, state = S.state, icon = S.icon;

  var AL = { alerts: null };
  S.tabs.reports = function () {
    var cached = S.factoryData();
    if (cached) render(cached); else $('#reports-list').innerHTML = '<div class="empty">Loading…</div>';
    S.loadFactory().then(render).catch(function (e) { if (!cached) $('#reports-list').innerHTML = '<div class="empty">' + esc(e.message) + '</div>'; });
    S.reportAlerts(true).then(function (a) { AL.alerts = a; var d = S.factoryData(); if (d) render(d); }).catch(function () {});
  };
  S.alertsHtml = function (alerts) {
    if (!alerts || !alerts.length) return '';
    return '<div class="banner bad" style="margin:0 0 10px"><b>⚠️ ' + alerts.length + ' mismatch — pehle theek karo, tab send / submit hoga</b>' + alerts.map(function (a) { return '<div style="margin-top:6px"><b>' + esc(S.shortLine(a.dept)) + ' · ' + esc(a.srn) + '</b><br>' + esc(a.msg) + '</div>'; }).join('') + '</div>';
  };

  function render(d) {
    var html = '', now = S.isToday() ? S.nowHour() : 24, totalPcs = 0;
    var lines = d.depts.filter(function (x) { return d.att[x.dept + '|Final']; });
    html += '<h2>Reports · ' + esc(S.fmtDay(state.date)) + ' · ' + lines.length + ' line</h2>';
    var alerts = AL.alerts, blocked = alerts && alerts.length;
    if (lines.length) html += S.alertsHtml(alerts) + '<button class="btn primary big" data-all="1" style="margin:0 0 10px;display:flex;align-items:center;justify-content:center;gap:8px"' + (blocked ? ' disabled' : '') + '>' + icon('review') + (blocked ? ' Mismatch hai — send band' : alerts === null ? ' Check ho raha hai…' : ' Review & send all reports') + '</button>';
    if (!lines.length) html += '<div class="empty">Is din kisi line ki attendance nahi — report attendance ke baad banti hai</div>';
    lines.forEach(function (x) {
      var attS = (d.attSrn && d.attSrn[x.dept]) || '', srn = attS || (d.daySrn && d.daySrn[x.dept]) || '', pk = x.cat === 'PACKING';
      var closedAt = d.closed && d.closed[x.dept] ? d.closed[x.dept].time : '';
      var st = 0, ep = 0, pkq = 0;
      Object.keys(d.slots || {}).forEach(function (k) { var sl = d.slots[k]; st += (sl.STITCH && sl.STITCH[x.dept]) || 0; ep += (sl.ENDLINE && sl.ENDLINE[x.dept]) || 0; pkq += (sl.PACKING && sl.PACKING[x.dept]) || 0; });
      var myAl = (AL.alerts || []).filter(function (a) { return a.srn === srn && (a.type === 'PACKING' ? pk : a.dept === x.dept); });
      html += '<div class="rep-card' + (myAl.length ? ' flag' : '') + '"' + (myAl.length ? ' style="border-left:3px solid var(--bad)"' : '') + '><div class="h"><span class="nm">' + esc(S.shortLine(x.dept)) + '</span><span class="srn">' + (srn ? esc(srn) + (!attS ? ' <small style="color:var(--warn)">hourly se</small>' : '') : '<span style="color:var(--warn)">SRN nahi</span>') + ' · ' + d.att[x.dept + '|Final'] + ' mp' + (closedAt ? ' · band ' + esc(closedAt) : '') + '</span></div>' +
        (!attS ? '<button class="lnk" data-att="' + esc(x.dept) + '" style="margin:0 0 6px;font-size:12px">' + (srn ? '✎ Attendance me SRN bharo (abhi hourly wala ' + esc(srn) + ' use ho raha hai)' : '✎ SRN bharo — attendance kholo') + '</button>' : '') +
        (myAl.length ? '<div class="flag block" style="margin:0 0 6px">' + myAl.map(function (a) { return esc(a.msg); }).join('<br>') + '</div>' : '') +
        (srn ? '<div class="rep-btns">' + (pk
          ? '<button data-rep="PACKING|' + esc(x.dept) + '|' + esc(srn) + '">' + icon('box') + 'Packing report<small>' + pkq + ' pcs aaj</small></button>'
          : '<button data-rep="STITCH|' + esc(x.dept) + '|' + esc(srn) + '">' + icon('out') + 'Making report<small>' + st + ' pcs aaj</small></button><button data-rep="ENDLINE|' + esc(x.dept) + '|' + esc(srn) + '">' + icon('qc') + 'Endline FTR<small>pass ' + ep + ' aaj</small></button>') + '</div>' : '') + '</div>';
    });
    html += '<button class="lnk" data-print="1" style="margin:4px 0 10px">🖨 Poora SRN print karo (PDF)</button>';

    // hours of the day (edit access for finished slots)
    var anyOT = S.slots('OT').some(function (s) { return d.slots[s.key] || now >= 18; });
    var list = S.slots('Final').concat(anyOT ? S.slots('OT') : []).concat(S.slots('Night').filter(function (s) { return d.slots[s.key]; }));
    var hrs = '';
    list.forEach(function (s) {
      var inf = S.slotInfo(d, s), st = S.slotStart(s.key), future = now < st;
      totalPcs += inf.pcs;
      hrs += '<div class="hourly-slot" data-go="hour:' + esc(s.key) + '" style="' + (future && !inf.done ? 'opacity:.5' : '') + '"><span class="t">' + esc(s.label) + '</span><div class="b">' +
        (inf.done ? '<b>' + inf.pcs + ' pcs</b> · ' + inf.done + '/' + inf.total + ' lines' + (inf.eLines ? ' · end pass ' + inf.pass : '') : (future ? '—' : '<span style="color:var(--warn);font-weight:600">baaki</span>')) +
        '</div>' + (inf.full ? '<span style="color:var(--ok);font-weight:800">✓</span>' : '') + '<span class="chev">' + icon('chev') + '</span></div>';
    });
    html += '<h2>Ghante · ' + totalPcs + ' pcs · tap = edit</h2>' + hrs;
    $('#reports-list').innerHTML = html;
  }

  $('#tab-reports').addEventListener('click', function (e) {
    var r = e.target.closest('[data-rep]'); if (r) { var p = r.dataset.rep.split('|'); S.report(p[0], p[1], p[2]); return; }
    var a = e.target.closest('[data-att]'); if (a) { S.openAttendance('Final', a.dataset.att); return; }
    if (e.target.closest('[data-print]')) { S.printSrn(); return; }
    if (e.target.closest('[data-all]')) { S.reportAll(); return; }
    var g = e.target.closest('[data-go]'); if (g) S.go(g.dataset.go);
  });
})();
