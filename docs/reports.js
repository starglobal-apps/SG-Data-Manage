// reports.js — Report tab: every report of the selected day (Making / Endline FTR per line, Packing per floor),
// always built from the latest data; tap to preview & share. Below it, the day's hours (tap to edit).
(function () {
  'use strict';
  var S = window.SG, $ = S.$, esc = S.esc, state = S.state, icon = S.icon;

  S.tabs.reports = function () {
    var cached = S.factoryData();
    if (cached) render(cached); else $('#reports-list').innerHTML = '<div class="empty">Loading…</div>';
    S.loadFactory().then(render).catch(function (e) { if (!cached) $('#reports-list').innerHTML = '<div class="empty">' + esc(e.message) + '</div>'; });
  };

  function render(d) {
    var html = '', now = S.isToday() ? S.nowHour() : 24, totalPcs = 0;
    var lines = d.depts.filter(function (x) { return d.att[x.dept + '|Final']; });
    html += '<h2>Reports · ' + esc(S.fmtDay(state.date)) + ' · ' + lines.length + ' line</h2>';
    if (!lines.length) html += '<div class="empty">Is din kisi line ki attendance nahi — report attendance ke baad banti hai</div>';
    lines.forEach(function (x) {
      var srn = (d.attSrn && d.attSrn[x.dept]) || '', pk = x.cat === 'PACKING';
      var st = 0, ep = 0, pkq = 0;
      Object.keys(d.slots || {}).forEach(function (k) { var sl = d.slots[k]; st += (sl.STITCH && sl.STITCH[x.dept]) || 0; ep += (sl.ENDLINE && sl.ENDLINE[x.dept]) || 0; pkq += (sl.PACKING && sl.PACKING[x.dept]) || 0; });
      html += '<div class="rep-card"><div class="h"><span class="nm">' + esc(S.shortLine(x.dept)) + '</span><span class="srn">' + (srn ? esc(srn) : '<span style="color:var(--warn)">SRN nahi</span>') + ' · ' + d.att[x.dept + '|Final'] + ' mp</span></div>' +
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
    if (e.target.closest('[data-print]')) { S.printSrn(); return; }
    var g = e.target.closest('[data-go]'); if (g) S.go(g.dataset.go);
  });
})();
