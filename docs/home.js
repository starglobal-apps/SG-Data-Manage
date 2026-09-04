// home.js — Home tab: "Abhi" card + today's hour-by-hour timeline for the selected line.
(function () {
  'use strict';
  var S = window.SG, $ = S.$, esc = S.esc, state = S.state, icon = S.icon;
  var ui = { showOT: false, showNight: false };

  function sum(rows, f) { var t = 0; (rows || []).forEach(function (r) { t += Number(r[f]) || 0; }); return t; }
  function hhmm(h) { var H = Math.floor(h), ap = H >= 12 ? 'PM' : 'AM', h12 = H % 12 || 12; return h12 + ':00 ' + ap; }

  S.tabs.home = function () {
    if (!state.line) { $('#home-now').innerHTML = '<div class="now warn"><div class="k">Setup</div><div class="t">Apni line chuno</div><div class="s">Upar title par tap karo</div><button class="btn" data-go="ctx">Line chuno</button></div>'; $('#home-timeline').innerHTML = ''; return; }
    $('#home-now').innerHTML = '<div class="now"><div class="k">Loading…</div><div class="t">&nbsp;</div></div>';
    if (S.isManager()) S.api('review.count', { factory: state.factory }, { quiet: true }).then(function (r) { var b = $('#nav-rv-count'); b.hidden = !r.count; b.textContent = r.count; }).catch(function () {});
    S.loadToday().then(render).catch(function (e) { $('#home-now').innerHTML = '<div class="now warn"><div class="k">Error</div><div class="t">' + esc(e.message) + '</div><button class="btn" data-go="retry">Dobara try</button></div>'; $('#home-timeline').innerHTML = ''; });
  };

  function render(d) {
    var type = S.hourlyType(), cat = S.lineCat(), now = S.isToday() ? S.nowHour() : 24, todayFlag = S.isToday();
    var sl = (d.slots || {})[type] || {}, el = (d.slots || {}).ENDLINE || {};
    var showEndline = cat === 'STITCH' && (S.recall('show_endline') === '1' || Object.keys(el).length > 0);
    var anyOT = S.slots('OT').some(function (s) { return sl[s.key] || el[s.key]; }), anyNight = S.slots('Night').some(function (s) { return sl[s.key]; });
    var showOT = ui.showOT || anyOT || now >= 18, showNight = ui.showNight || anyNight;
    var locked = function (t) { return S.lockedType(t); };
    var statusAll = Object.keys(d.statuses || {}).map(function (k) { return d.statuses[k].status; })[0] || '';
    var submitted = locked(type || 'ATT') || locked('ATT');

    // ---- collect tasks for the NOW card + progress
    var done = 0, total = 0, missed = [], current = null, upcoming = null;
    total++; if (d.att.Final) done++;
    if (type) {
      S.slots('Final').concat(showOT ? S.slots('OT') : []).forEach(function (s) {
        var st = S.slotStart(s.key), rows = sl[s.key] || [];
        var isNow = todayFlag && now >= st && now < st + 1, past = now >= st + 1, future = now < st;
        if (s.shift === 'Final' ? !future : rows.length || isNow) { total++; if (rows.length) done++; }
        if (isNow && !rows.length) current = s;
        if (past && !rows.length && s.shift === 'Final') missed.push(s);
        if (future && !upcoming) upcoming = s;
      });
    }
    var hasOTout = S.slots('OT').some(function (s) { return sl[s.key]; });
    if (hasOTout || now >= 18) { total++; if (d.att.OT) done++; }
    total++; if (submitted) done++;
    var pct = total ? Math.round(done / total * 100) : 0;

    // ---- NOW card
    var nowCard;
    if (!todayFlag) nowCard = { cls: 'done', k: S.fmtDay(state.date), t: (type ? sum(flat(sl), 'qty') + ' pcs' : (d.att.Final ? d.att.Final.manpower + ' mp' : 'Data nahi')), s: statusAll ? 'Status: ' + statusAll : 'Purana din — Data tab me dekho', btn: 'Data dekho', go: 'data' };
    else if (submitted) nowCard = { cls: 'done', k: 'Aaj', t: 'Din submit ho gaya', s: statusAll === 'Sent' ? 'Final sheets me chala gaya' : statusAll === 'Approved' ? 'Manager ne approve kiya' : 'Manager review me hai', btn: 'Data dekho', go: 'data' };
    else if (now < 8.5) nowCard = { cls: '', k: 'Subah', t: 'Din shuru hone wala hai', s: '9:00 par attendance bharni hai', btn: 'Attendance abhi bharo', go: 'att:Final' };
    else if (!d.att.Final) nowCard = { cls: 'warn', k: 'Pehla kaam', t: 'Attendance baaki hai', s: 'Role-wise count bharo, kal ka data prefill milega', btn: 'Attendance bharo', go: 'att:Final' };
    else if (current) nowCard = { cls: '', k: 'Abhi · ' + current.label, t: (type === 'PACKING' ? 'Packing' : 'Output') + ' bharo', s: missed.length ? missed.length + ' purana slot bhi baaki hai' : 'SRN chuno, qty daalo, save', btn: current.label + ' bharo', go: 'slot:' + type + ':' + current.key };
    else if (missed.length) nowCard = { cls: 'warn', k: 'Chhoot gaya', t: missed.length + ' slot baaki: ' + missed.map(function (s) { return s.label; }).slice(0, 3).join(', '), s: 'Pehle ye bharo, phir aage', btn: missed[0].label + ' bharo', go: 'slot:' + type + ':' + missed[0].key };
    else if (now >= 18 && hasOTout && !d.att.OT) nowCard = { cls: 'warn', k: 'Shaam', t: 'OT attendance baaki', s: 'OT output hai par OT attendance nahi', btn: 'OT attendance bharo', go: 'att:OT' };
    else if (now >= 17.75 && !type) nowCard = { cls: '', k: 'Shaam', t: 'Din band karo', s: 'Attendance submit karke manager ko bhejo', btn: 'Din band karo', go: 'dayclose' };
    else if (now >= 18 && !current) nowCard = { cls: '', k: 'Shaam', t: 'Sab bhar gaya — din band karo', s: 'Preview dekho, submit karo. OT laga ho to pehle OT slots bharo.', btn: 'Din band karo', go: 'dayclose' };
    else nowCard = { cls: 'done', k: 'Sab up to date', t: type ? sum(flat(sl), 'qty') + ' pcs aaj tak' : d.att.Final.manpower + ' mp', s: upcoming ? 'Agla: ' + hhmm(S.slotStart(upcoming.key) + 1) + ' par ' + upcoming.label + ' ka output' : 'Shaam ko din band karna hai', btn: upcoming ? 'Pehle se bharna ho to' : 'Data dekho', go: upcoming ? 'slot:' + type + ':' + upcoming.key : 'data' };

    $('#home-now').innerHTML = '<div class="now ' + nowCard.cls + '"><div class="k">' + esc(nowCard.k) + '</div><div class="t">' + esc(nowCard.t) + '</div><div class="s">' + esc(nowCard.s) + '</div>' +
      '<button class="btn" data-go="' + esc(nowCard.go) + '">' + esc(nowCard.btn) + '</button>' +
      '<div class="prog"><i style="width:' + pct + '%"></i></div><div class="meta"><span>' + done + '/' + total + ' kaam</span><span>' + (type ? sum(flat(sl), 'qty') + ' pcs' : '') + (d.att.Final ? ' · ' + d.att.Final.manpower + ' mp' : '') + '</span></div></div>';

    // ---- TIMELINE
    var html = '', outName = type === 'PACKING' ? 'Packing' : 'Stitching output', outIcon = type === 'PACKING' ? 'box' : 'out';
    var task = function (o) {
      return '<div class="task ' + (o.cls || '') + (o.sub ? ' sub' : '') + '" data-go="' + esc(o.go) + '"><div class="ic">' + icon(o.ic) + '</div><div class="b"><div class="n">' + o.n + '</div>' + (o.s ? '<div class="s">' + o.s + '</div>' : '') + '</div>' + (o.v !== undefined && o.v !== '' ? '<span class="v ' + (o.cls === 'done' ? 'ok' : '') + '">' + o.v + '</span>' : '') + '<span class="chev">' + icon('chev') + '</span></div>';
    };
    var hour = function (time, dotCls, future, inner) { return '<div class="tl-h' + (future ? ' future' : '') + '"><span class="time' + (dotCls === 'now' ? ' now' : '') + '">' + time + '</span><span class="dotp ' + dotCls + '"></span>' + inner + '</div>'; };

    // 9:00 attendance + manpower
    var af = d.att.Final, attCls = locked('ATT') ? 'lock' : af ? 'done' : now >= 9 ? 'warn' : '';
    var evN = (d.events || []).length;
    html += hour('9:00', attCls, false,
      task({ go: 'att:Final', ic: 'att', cls: attCls, n: 'Attendance', s: af ? esc(af.rows.length + ' roles · ' + af.manhours + ' hrs · ' + af.by) : (now >= 9 ? 'Baaki hai' : 'Subah bharo'), v: af ? af.manpower + ' mp' : '' }) +
      (af || evN ? task({ go: 'manpower', ic: 'mp', sub: true, cls: evN ? 'done' : '', n: 'Manpower change', s: evN ? evN + ' event' : 'Koi gaya / late aaya to yahan', v: '' }) : ''));

    var slotRow = function (s) {
      var st = S.slotStart(s.key), rows = sl[s.key] || [], q = sum(rows, 'qty');
      var isNow = todayFlag && now >= st && now < st + 1, past = now >= st + 1, future = now < st;
      var cls = locked(type) ? 'lock' : rows.length ? 'done' : isNow ? 'now' : (past && s.shift === 'Final') ? 'warn' : '';
      var srns = rows.map(function (r) { return r.srn; }).filter(function (v, i, a) { return a.indexOf(v) === i; });
      var inner = type ? task({ go: 'slot:' + type + ':' + s.key, ic: outIcon, cls: cls === 'now' ? '' : cls, n: outName + (isNow ? ' <small style="color:var(--primary)">· abhi</small>' : ''),
        s: rows.length ? esc(srns.join(', ')) + (type === 'PACKING' ? ' · ' + sum(rows, 'cartons') + ' ctn' : '') : (cls === 'warn' ? 'Entry baaki' : isNow ? 'Tap karke bharo' : ''), v: rows.length ? q : '' }) : '';
      if (showEndline) {
        var er = el[s.key] || [], ecls = locked('ENDLINE') ? 'lock' : er.length ? 'done' : '';
        inner += task({ go: 'slot:ENDLINE:' + s.key, ic: 'qc', sub: true, cls: ecls, n: 'Endline check', s: er.length ? 'checked ' + sum(er, 'checked') + ' · rej ' + sum(er, 'reject') + ' · ' + esc(er.map(function (r) { return r.checker; }).filter(function (v, i, a) { return v && a.indexOf(v) === i; }).join(', ')) : '', v: er.length ? 'pass ' + sum(er, 'pass') : '' });
      }
      return hour(s.label.replace(/\s?(AM|PM)$/, ''), cls === '' && future ? '' : cls, future && !rows.length, inner);
    };
    if (type || showEndline) {
      S.slots('Final').forEach(function (s) { html += slotRow(s); });
      if (!showEndline && cat === 'STITCH') html += '<button class="lnk tl-more" data-go="showEndline">+ Endline checking bhi dikhao</button>';
    }

    // 6 PM: OT attendance, OT slots
    if (type || showEndline) {
      if (showOT) {
        var ao = d.att.OT, otCls = locked('ATT') ? 'lock' : ao ? 'done' : hasOTout ? 'warn' : '';
        html += '<div class="tl-label">OT</div>';
        html += hour('6:00', otCls, now < 18 && !ao, task({ go: 'att:OT', ic: 'att', cls: otCls, n: 'OT attendance', s: ao ? esc(ao.manhours + ' hrs · ' + ao.by) : hasOTout ? 'OT output hai, attendance baaki' : 'Agar OT laga ho', v: ao ? ao.manpower + ' mp' : '' }));
        S.slots('OT').forEach(function (s) { html += slotRow(s); });
        if (showNight) { html += '<div class="tl-label">Night</div>'; S.slots('Night').forEach(function (s) { html += slotRow(s); }); }
        else html += '<button class="lnk tl-more" data-go="showNight">+ Night slots</button>';
      } else html += '<button class="lnk tl-more" data-go="showOT">+ OT slots (6–10 PM)</button>';
    }

    // Shaam: day close
    var dcCls = submitted ? (statusAll === 'Sent' ? 'done' : 'lock') : statusAll === 'Rejected' ? 'warn' : '';
    html += '<div class="tl-label">Shaam</div>';
    html += hour('End', dcCls, false, task({ go: 'dayclose', ic: 'moon', cls: dcCls, n: 'Din band karo', s: submitted ? 'Submitted · manager review' + (statusAll === 'Sent' ? ' · Final me gaya' : '') : statusAll === 'Rejected' ? 'Reject: ' + esc((d.statuses[Object.keys(d.statuses)[0]] || {}).remark || '') : 'Sab bhar ke submit karo', v: statusAll ? S.pill(statusAll) : '' }));

    $('#home-timeline').innerHTML = '<div class="tl">' + html + '</div>';
  }

  function flat(slotMap) { var out = []; Object.keys(slotMap || {}).forEach(function (k) { out = out.concat(slotMap[k]); }); return out; }

  $('#tab-home').addEventListener('click', function (e) {
    var el = e.target.closest('[data-go]'); if (!el) return;
    S.go(el.dataset.go);
  });

  // shared action router (used by Home / Entry / Data)
  S.go = function (go) {
    var p = go.split(':');
    if (go === 'ctx') S.openContext();
    else if (go === 'retry') { S.invalidate(); S.refresh(); }
    else if (go === 'data') S.tab('data');
    else if (p[0] === 'att') S.openAttendance(p[1]);
    else if (p[0] === 'slot') S.quick(p[1], p[2]);
    else if (p[0] === 'pick') S.pickSlot(p[1]);
    else if (p[0] === 'table') S.screens.hourly(state.line, p[1]);
    else if (go === 'manpower') S.screens.manpower(state.line);
    else if (go === 'dayclose') S.screens.dayclose(state.line);
    else if (go === 'review') S.tab('review');
    else if (go === 'showOT') { ui.showOT = true; S.refresh(); }
    else if (go === 'showNight') { ui.showNight = true; S.refresh(); }
    else if (go === 'showEndline') { S.remember('show_endline', '1'); S.refresh(); }
  };
})();
