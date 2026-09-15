// grid.js — "Ghante" tab: lines × hours at a glance. ✓ filled, ● this hour, ! missed, — not yet / line band. Tap a cell to fill it.
(function () {
  'use strict';
  var S = window.SG, $ = S.$, esc = S.esc, state = S.state;
  var ui = { ot: false };

  S.tabs.grid = function () {
    var cached = S.factoryData();
    if (cached) render(cached); else $('#grid-body').innerHTML = '<div class="empty">Loading…</div>';
    S.loadFactory().then(render).catch(function (e) { if (!cached) $('#grid-body').innerHTML = '<div class="empty">' + esc(e.message) + '</div>'; });
  };

  function render(d) {
    var now = S.isToday() ? S.nowHour() : 24, closed = d.closed || {};
    var lines = d.depts.filter(function (x) { return (x.cat === 'STITCH' || x.cat === 'PACKING') && d.att[x.dept + '|Final']; });
    if (!lines.length) { $('#grid-body').innerHTML = '<div class="empty">Aaj kisi line ki attendance nahi<br><button class="btn primary" data-go="attlist" style="margin-top:10px">Attendance bharo</button></div>'; return; }
    var anyOT = S.slots('OT').some(function (s) { return d.slots[s.key]; });
    var slots = S.slots('Final').concat(ui.ot || anyOT || now >= 18 ? S.slots('OT') : []);
    var missed = [], html = '<div class="gridwrap"><table class="hgrid"><tr><th></th>' + slots.map(function (s) { return '<th>' + esc(s.label.replace(/\s?(AM|PM)$/, '').split('–')[0]) + '</th>'; }).join('') + '</tr>';
    lines.forEach(function (x) {
      var t = x.cat === 'PACKING' ? 'PACKING' : 'STITCH', c = closed[x.dept];
      html += '<tr><td class="ln">' + esc(S.shortLine(x.dept)) + '</td>';
      slots.forEach(function (s) {
        var st = S.slotStart(s.key), sl = d.slots[s.key] || {}, v = sl[t] && sl[t][x.dept], e = t === 'STITCH' && sl.ENDLINE && sl.ENDLINE[x.dept];
        var cls, txt;
        if (c && c.hour <= st + 0.01) { cls = 'na'; txt = '—'; }
        else if (v) { cls = t === 'STITCH' && !e ? 'half' : 'ok'; txt = v; }
        else if (S.isToday() && now >= st && now < st + 1) { cls = 'now'; txt = '●'; }
        else if (now >= st + 1) { cls = 'miss'; txt = '!'; missed.push({ s: s, dept: x.dept }); }
        else { cls = 'fut'; txt = ''; }
        html += '<td class="' + cls + '" data-cell="' + esc(s.key) + '|' + esc(x.dept) + '"' + (cls === 'na' || cls === 'fut' ? '' : '') + '>' + txt + '</td>';
      });
      html += '</tr>';
    });
    html += '</table></div>';
    html += '<div class="card" style="margin-top:10px;font-size:13px;display:flex;gap:12px;flex-wrap:wrap"><span><i class="lg ok"></i> bhara</span><span><i class="lg half"></i> endline baaki</span><span><i class="lg now"></i> abhi</span><span><i class="lg miss"></i> chhoota</span><span>— line band</span></div>';
    if (!ui.ot && !anyOT && now < 18) html += '<button class="lnk" data-ot="1">+ OT slots (6–10 PM)</button>';
    if (missed.length) {
      var byS = {}; missed.forEach(function (m) { (byS[m.s.key] = byS[m.s.key] || { s: m.s, n: 0 }).n++; });
      html += '<h2>Chhoote hue ghante</h2>' + Object.keys(byS).map(function (k) { var g = byS[k]; return '<div class="task warn" data-go="wiz:' + esc(k) + '"><div class="ic">!</div><div class="b"><div class="n">' + esc(g.s.label) + '</div><div class="s">' + g.n + ' line baaki</div></div><span class="chev">' + S.icon('chev') + '</span></div>'; }).join('');
    }
    $('#grid-body').innerHTML = html;
  }

  $('#tab-grid').addEventListener('click', function (e) {
    var c = e.target.closest('[data-cell]'); if (c) { var p = c.dataset.cell.split('|'); if (!c.classList.contains('na')) S.screens.wiz(p[0], p[1]); return; }
    if (e.target.closest('[data-ot]')) { ui.ot = true; S.tabs.grid(); return; }
    var g = e.target.closest('[data-go]'); if (g) S.go(g.dataset.go);
  });
})();
