// data.js — Data tab: what has been recorded for the selected line & date. Summary + per-type tables; tap a row to edit.
(function () {
  'use strict';
  var S = window.SG, $ = S.$, esc = S.esc, state = S.state;
  var seg = 'out';
  function sum(rows, f) { var t = 0; (rows || []).forEach(function (r) { t += Number(r[f]) || 0; }); return t; }
  function flat(m) { var o = []; Object.keys(m || {}).forEach(function (k) { o = o.concat(m[k]); }); return o; }

  S.tabs.data = function () {
    if (!state.line) { $('#data-summary').innerHTML = '<div class="empty">Pehle upar se line chuno</div>'; $('#data-seg').innerHTML = ''; $('#data-body').innerHTML = ''; return; }
    $('#data-body').innerHTML = '<div class="empty">Loading…</div>';
    S.loadToday().then(render).catch(function (e) { $('#data-body').innerHTML = '<div class="empty">' + esc(e.message) + '</div>'; });
  };

  function render(d) {
    var type = S.hourlyType(), cat = S.lineCat();
    var sl = (d.slots || {})[type] || {}, el = (d.slots || {}).ENDLINE || {};
    var out = sum(flat(sl), 'qty'), mp = d.att.Final ? d.att.Final.manpower : 0, mh = d.att.Final ? d.att.Final.manhours : 0;
    var eChk = sum(flat(el), 'checked'), ePass = sum(flat(el), 'pass');
    var statuses = d.statuses || {}, stKeys = Object.keys(statuses);
    var stats = '<div class="stats">';
    if (type) stats += '<div class="stat"><div class="k">' + (type === 'PACKING' ? 'Packed' : 'Output') + '</div><div class="v">' + out + '<small> pcs</small></div></div>';
    var aF = d.att.Final || {}, mhNote = aF.closedAt ? ' · band ' + aF.closedAt : (aF.rawManhours && aF.rawManhours !== mh ? ' · events ke baad' : '');
    stats += '<div class="stat"><div class="k">Manpower</div><div class="v">' + mp + '<small> · ' + mh + ' hrs' + esc(mhNote) + '</small></div></div>';
    if (type) stats += '<div class="stat"><div class="k">Pcs / man-hr</div><div class="v">' + (mh ? (out / mh).toFixed(1) : '—') + '</div></div>';
    if (cat === 'STITCH') stats += '<div class="stat"><div class="k">Endline pass</div><div class="v">' + (eChk ? Math.round(ePass / eChk * 100) + '<small>%</small>' : '—') + '</div></div>';
    if (type === 'PACKING') stats += '<div class="stat"><div class="k">Cartons</div><div class="v">' + sum(flat(sl), 'cartons') + '</div></div>';
    stats += '<div class="stat"><div class="k">Status</div><div class="v" style="font-size:14px;margin-top:6px">' + (stKeys.length ? stKeys.map(function (k) { return S.pill(statuses[k].status); }).filter(function (v, i, a) { return a.indexOf(v) === i; }).join('') : '<span class="muted">Draft</span>') + '</div></div>';
    stats += '</div>';
    $('#data-summary').innerHTML = stats;

    var segs = [];
    if (type) segs.push({ k: 'out', l: type === 'PACKING' ? 'Packing' : 'Output' });
    segs.push({ k: 'att', l: 'Attendance' });
    if (cat === 'STITCH') segs.push({ k: 'end', l: 'Endline' });
    segs.push({ k: 'ev', l: 'Manpower' });
    if (!segs.some(function (x) { return x.k === seg; })) seg = segs[0].k;
    $('#data-seg').innerHTML = segs.map(function (x) { return '<button data-seg="' + x.k + '" class="' + (x.k === seg ? 'on' : '') + '">' + x.l + '</button>'; }).join('');

    var body = '';
    if (seg === 'out') {
      var keys = S.slots().filter(function (s) { return sl[s.key]; });
      if (!keys.length) body = '<div class="empty">Aaj koi output entry nahi<br><button class="btn primary" data-go="pick:' + type + '" style="margin-top:10px">Bharo</button></div>';
      else {
        body = '<table class="tbl"><thead><tr><th>Slot</th><th>SRN</th><th class="num">' + (type === 'PACKING' ? 'Pcs' : 'Output') + '</th>' + (type === 'PACKING' ? '<th class="num">Ctn</th>' : '') + '</tr></thead><tbody>';
        keys.forEach(function (s) {
          sl[s.key].forEach(function (r, i) {
            body += '<tr data-tap="slot:' + type + ':' + esc(s.key) + '" class="filled"><td>' + (i === 0 ? esc(s.label) : '') + '</td><td>' + esc(r.srn) + '</td><td class="num">' + r.qty + '</td>' + (type === 'PACKING' ? '<td class="num">' + r.cartons + '</td>' : '') + '</tr>';
          });
        });
        body += '</tbody><tfoot><tr><td>Total</td><td>' + keys.length + ' slot</td><td class="num">' + out + '</td>' + (type === 'PACKING' ? '<td class="num">' + sum(flat(sl), 'cartons') + '</td>' : '') + '</tr></tfoot></table>';
      }
    } else if (seg === 'att') {
      body = '';
      ['Final', 'OT', 'Night'].forEach(function (sh) {
        var a = d.att[sh]; if (!a && sh !== 'Final') return;
        body += '<h2>' + (sh === 'Final' ? 'Day' : sh) + (a ? ' · ' + a.manpower + ' mp · ' + a.manhours + ' hrs' : '') + '</h2>';
        if (!a) { body += '<div class="empty">Attendance nahi bhari<br><button class="btn primary" data-go="att:Final" style="margin-top:10px">Bharo</button></div>'; return; }
        body += '<table class="tbl" data-tap="att:' + sh + '"><thead><tr><th>Role</th><th class="num">Hrs</th><th class="num">Count</th></tr></thead><tbody>' +
          a.rows.map(function (r) { return '<tr data-tap="att:' + sh + '"><td>' + esc(r.role) + '</td><td class="num">' + r.hours + '</td><td class="num">' + r.count + '</td></tr>'; }).join('') + '</tbody></table>';
      });
      if (!d.att.OT) body += '<button class="lnk" data-go="att:OT" style="margin-top:10px">+ OT attendance</button>';
    } else if (seg === 'end') {
      var ek = S.slots().filter(function (s) { return el[s.key]; });
      if (!ek.length) body = '<div class="empty">Aaj koi endline entry nahi<br><button class="btn primary" data-go="pick:ENDLINE" style="margin-top:10px">Bharo</button></div>';
      else {
        body = '<table class="tbl"><thead><tr><th>Slot</th><th>Checker</th><th class="num">Chk</th><th class="num">Pass</th><th class="num">Rej</th></tr></thead><tbody>';
        ek.forEach(function (s) { el[s.key].forEach(function (r, i) { body += '<tr data-tap="slot:ENDLINE:' + esc(s.key) + '" class="filled"><td>' + (i === 0 ? esc(s.label) : '') + '</td><td>' + esc(r.checker) + '<div class="muted" style="font-size:11px">' + esc(r.srn) + '</div></td><td class="num">' + r.checked + '</td><td class="num">' + r.pass + '</td><td class="num">' + r.reject + '</td></tr>'; }); });
        body += '</tbody><tfoot><tr><td colspan="2">Total</td><td class="num">' + eChk + '</td><td class="num">' + ePass + '</td><td class="num">' + sum(flat(el), 'reject') + '</td></tr></tfoot></table>';
      }
    } else if (seg === 'ev') {
      var evs = d.events || [], defs = state.masters.mpEvents || [];
      body = evs.length ? '<div class="list">' + evs.map(function (e) { var lab = (defs.filter(function (x) { return x.key === e.event; })[0] || {}).label || e.event; return '<div class="item" data-go="manpower"><div><div class="name">' + esc(e.role) + ' × ' + e.count + '</div><div class="sub">' + esc(lab) + (e.time ? ' @ ' + esc(e.time) : '') + ' → ' + e.eff_hours + ' hrs' + (e.note ? ' · ' + esc(e.note) : '') + '</div></div></div>'; }).join('') + '</div>'
        : '<div class="empty">Aaj koi manpower change nahi<br><button class="btn primary" data-go="manpower" style="margin-top:10px">Add karo</button></div>';
    }
    $('#data-body').innerHTML = body;
  }

  $('#data-seg').addEventListener('click', function (e) { var b = e.target.closest('button[data-seg]'); if (!b) return; seg = b.dataset.seg; S.tabs.data(); });
  $('#data-body').addEventListener('click', function (e) {
    var g = e.target.closest('[data-go]'); if (g) { S.go(g.dataset.go); return; }
    var t = e.target.closest('[data-tap]'); if (t) S.go(t.dataset.tap);
  });
})();
