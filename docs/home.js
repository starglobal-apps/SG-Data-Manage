// home.js — Home tab: factory-wide day. NOW card names the next thing to do; the timeline shows every hour
// with how many lines are done. Tapping an hour opens the whole-factory "Update output" screen.
(function () {
  'use strict';
  var S = window.SG, $ = S.$, esc = S.esc, state = S.state, icon = S.icon, api = S.api;
  var ui = { showOT: false, showNight: false, data: null };

  function short(d) { return (d || '').replace(/^FAC\d+-/, ''); }
  function hhmm(h) { var H = Math.floor(h), ap = H >= 12 ? 'PM' : 'AM', h12 = H % 12 || 12; return h12 + ':00 ' + ap; }
  function outType(cat) { return cat === 'STITCH' ? 'STITCH' : cat === 'PACKING' ? 'PACKING' : ''; }

  S.tabs.home = function () {
    $('#home-now').innerHTML = '<div class="nowcard"><div class="k">Loading…</div><div class="t">&nbsp;</div></div>';
    if (S.isManager()) api('review.count', { factory: state.factory }, { quiet: true }).then(function (r) { var b = $('#nav-rv-count'); b.hidden = !r.count; b.textContent = r.count; }).catch(function () {});
    api('factory.today', { date: state.date, factory: state.factory }, { quiet: true })
      .then(function (d) { ui.data = d; render(d); })
      .catch(function (e) { $('#home-now').innerHTML = '<div class="nowcard warn"><div class="k">Error</div><div class="t">' + esc(e.message) + '</div><button class="btn" data-go="retry">Dobara try</button></div>'; $('#home-timeline').innerHTML = ''; });
  };

  function render(d) {
    var now = S.isToday() ? S.nowHour() : 24, todayFlag = S.isToday();
    var outLines = d.depts.filter(function (x) { return outType(x.cat); });
    var nLines = outLines.length, nAll = d.depts.length;
    var attDone = d.depts.filter(function (x) { return d.att[x.dept + '|Final']; }).length;
    var attMp = d.depts.reduce(function (t, x) { return t + (d.att[x.dept + '|Final'] || 0); }, 0);
    var otAttDone = d.depts.filter(function (x) { return d.att[x.dept + '|OT']; }).length;
    var locked = function (dept, t) { var s = d.statuses[dept + '|' + t]; return s === 'Submitted' || s === 'Approved' || s === 'Sent'; };
    var lockedLines = d.depts.filter(function (x) { return locked(x.dept, outType(x.cat) || 'ATT') || locked(x.dept, 'ATT'); }).length;

    // per slot: lines done + pcs
    var slotInfo = function (s) {
      var sl = d.slots[s.key] || { STITCH: {}, ENDLINE: {}, PACKING: {} }, done = 0, pcs = 0, pass = 0, eLines = 0;
      outLines.forEach(function (x) { var t = outType(x.cat), v = sl[t] && sl[t][x.dept]; if (v) { done++; pcs += v; } });
      Object.keys(sl.ENDLINE || {}).forEach(function (k) { eLines++; pass += sl.ENDLINE[k]; });
      return { done: done, pcs: pcs, pass: pass, eLines: eLines };
    };
    var anyOT = S.slots('OT').some(function (s) { return d.slots[s.key]; }), anyNight = S.slots('Night').some(function (s) { return d.slots[s.key]; });
    var showOT = ui.showOT || anyOT || now >= 18, showNight = ui.showNight || anyNight;

    // ---- progress + NOW
    var done = attDone, total = nAll, current = null, missed = [], upcoming = null;
    S.slots('Final').concat(showOT ? S.slots('OT') : []).forEach(function (s) {
      var st = S.slotStart(s.key), inf = slotInfo(s);
      var isNow = todayFlag && now >= st && now < st + 1, past = now >= st + 1, future = now < st;
      if (s.shift === 'Final' ? !future : inf.done || isNow) { total += nLines; done += inf.done; }
      if (isNow && inf.done < nLines) current = { s: s, inf: inf };
      if (past && s.shift === 'Final' && inf.done < nLines) missed.push({ s: s, inf: inf });
      if (future && !upcoming) upcoming = s;
    });
    var hasOTout = S.slots('OT').some(function (s) { return slotInfo(s).done; });
    if (hasOTout || now >= 18) { total += nAll; done += otAttDone; }
    total += nAll; done += lockedLines;
    var pct = total ? Math.round(done / total * 100) : 0;
    var totalPcs = 0; S.slots().forEach(function (s) { totalPcs += slotInfo(s).pcs; });

    var nc;
    if (!nAll) nc = { cls: 'warn', k: 'Setup', t: 'Koi line nahi mili', s: 'USERS me depts / MASTERS check karo', btn: 'Main', go: 'main' };
    else if (!todayFlag) nc = { cls: 'done', k: S.fmtDay(state.date), t: totalPcs + ' pcs · ' + attMp + ' mp', s: lockedLines + '/' + nAll + ' lines submitted', btn: 'Data dekho', go: 'data' };
    else if (lockedLines === nAll) nc = { cls: 'done', k: 'Aaj', t: 'Sab lines submit ho gayi', s: totalPcs + ' pcs · manager review me', btn: 'Data dekho', go: 'data' };
    else if (now < 8.5) nc = { cls: '', k: 'Subah', t: 'Din shuru hone wala hai', s: '9:00 par ' + nAll + ' lines ki attendance', btn: 'Attendance shuru karo', go: 'attlist:Final' };
    else if (attDone < nAll) nc = { cls: 'warn', k: 'Pehla kaam', t: 'Attendance: ' + (nAll - attDone) + ' line baaki', s: attDone + '/' + nAll + ' ho gayi · ' + attMp + ' mp', btn: 'Attendance bharo', go: 'attlist:Final' };
    else if (current) nc = { cls: '', k: 'Abhi · ' + current.s.label, t: 'Output update karo', s: current.inf.done + '/' + nLines + ' lines ho gayi' + (missed.length ? ' · ' + missed.length + ' purana slot bhi adhoora' : ''), btn: current.s.label + ' bharo', go: 'hour:' + current.s.key };
    else if (missed.length) nc = { cls: 'warn', k: 'Adhoora', t: missed.length + ' slot adhoore: ' + missed.map(function (m) { return m.s.label; }).slice(0, 3).join(', '), s: missed[0].inf.done + '/' + nLines + ' lines in ' + missed[0].s.label, btn: missed[0].s.label + ' poora karo', go: 'hour:' + missed[0].s.key };
    else if (now >= 18 && hasOTout && otAttDone < nAll) nc = { cls: 'warn', k: 'Shaam', t: 'OT attendance baaki', s: otAttDone + '/' + nAll + ' lines', btn: 'OT attendance', go: 'attlist:OT' };
    else if (now >= 17.75) nc = { cls: '', k: 'Shaam', t: 'Din band karo', s: lockedLines + '/' + nAll + ' submitted · ' + totalPcs + ' pcs', btn: 'Din band karo', go: 'dayclose' };
    else nc = { cls: 'done', k: 'Sab up to date', t: totalPcs + ' pcs · ' + attMp + ' mp', s: upcoming ? 'Agla: ' + hhmm(S.slotStart(upcoming.key) + 1) + ' par ' + upcoming.label + ' ka output' : 'Shaam ko din band karna hai', btn: upcoming ? upcoming.label + ' pehle se bharo' : 'Data dekho', go: upcoming ? 'hour:' + upcoming.key : 'data' };

    $('#home-now').innerHTML = '<div class="nowcard ' + nc.cls + '"><div class="k">' + esc(nc.k) + '</div><div class="t">' + esc(nc.t) + '</div><div class="s">' + esc(nc.s) + '</div><button class="btn" data-go="' + esc(nc.go) + '">' + esc(nc.btn) + '</button>' +
      '<div class="prog"><i style="width:' + pct + '%"></i></div><div class="meta"><span>' + done + '/' + total + ' kaam</span><span>' + nAll + ' lines · FAC' + esc(state.factory) + '</span></div></div>';

    // ---- timeline
    var task = function (o) {
      return '<div class="task ' + (o.cls || '') + (o.sub ? ' sub' : '') + '" data-go="' + esc(o.go) + '"><div class="ic">' + icon(o.ic) + '</div><div class="b"><div class="n">' + o.n + '</div>' + (o.s ? '<div class="s">' + o.s + '</div>' : '') + '</div>' + (o.v !== undefined && o.v !== '' ? '<span class="v ' + (o.cls === 'done' ? 'ok' : '') + '">' + o.v + '</span>' : '') + '<span class="chev">' + icon('chev') + '</span></div>';
    };
    var hour = function (time, dotCls, future, inner) { return '<div class="tl-h' + (future ? ' future' : '') + '"><span class="time' + (dotCls === 'now' ? ' now' : '') + '">' + time + '</span><span class="dotp ' + dotCls + '"></span>' + inner + '</div>'; };
    var html = '';

    var attCls = attDone === nAll ? 'done' : now >= 9 ? 'warn' : '';
    html += hour('9:00', attCls, false,
      task({ go: 'attlist:Final', ic: 'att', cls: attCls, n: 'Attendance', s: attDone + '/' + nAll + ' lines' + (attDone < nAll && now >= 9 ? ' · baaki hai' : ''), v: attMp ? attMp + ' mp' : '' }) +
      task({ go: 'manpower', ic: 'mp', sub: true, cls: d.events ? 'done' : '', n: 'Manpower change', s: d.events ? d.events + ' event' : 'Koi gaya / late aaya to yahan' }));

    var slotRow = function (s) {
      var st = S.slotStart(s.key), inf = slotInfo(s);
      var isNow = todayFlag && now >= st && now < st + 1, past = now >= st + 1, future = now < st;
      var full = nLines && inf.done >= nLines;
      var cls = full ? 'done' : isNow ? 'now' : (past && s.shift === 'Final' && inf.done < nLines) ? 'warn' : '';
      var inner = task({ go: 'hour:' + s.key, ic: 'out', cls: cls === 'now' ? '' : cls, n: 'Output' + (isNow ? ' <small style="color:var(--primary)">· abhi</small>' : ''),
        s: inf.done ? inf.done + '/' + nLines + ' lines' + (inf.eLines ? ' · endline pass ' + inf.pass : '') : (cls === 'warn' ? 'Entry baaki' : isNow ? 'Tap karke sab lines bharo' : ''), v: inf.pcs ? inf.pcs : '' });
      return hour(s.label.replace(/\s?(AM|PM)$/, ''), cls === '' && future ? '' : cls, future && !inf.done, inner);
    };
    if (nLines) {
      S.slots('Final').forEach(function (s) { html += slotRow(s); });
      if (showOT) {
        var otCls = otAttDone === nAll ? 'done' : hasOTout ? 'warn' : '';
        html += '<div class="tl-label">OT</div>';
        html += hour('6:00', otCls, now < 18 && !otAttDone, task({ go: 'attlist:OT', ic: 'att', cls: otCls, n: 'OT attendance', s: otAttDone ? otAttDone + '/' + nAll + ' lines' : hasOTout ? 'OT output hai, attendance baaki' : 'Agar OT laga ho' }));
        S.slots('OT').forEach(function (s) { html += slotRow(s); });
        if (showNight) { html += '<div class="tl-label">Night</div>'; S.slots('Night').forEach(function (s) { html += slotRow(s); }); }
        else html += '<button class="lnk tl-more" data-go="showNight">+ Night slots</button>';
      } else html += '<button class="lnk tl-more" data-go="showOT">+ OT slots (6–10 PM)</button>';
    }
    var sub = {}; Object.keys(d.statuses).forEach(function (k) { sub[d.statuses[k]] = (sub[d.statuses[k]] || 0) + 1; });
    var dcCls = lockedLines === nAll && nAll ? 'done' : lockedLines ? '' : '';
    html += '<div class="tl-label">Shaam</div>';
    html += hour('End', dcCls, false, task({ go: 'dayclose', ic: 'moon', cls: dcCls, n: 'Din band karo', s: Object.keys(sub).length ? Object.keys(sub).map(function (k) { return sub[k] + ' ' + k; }).join(' · ') : 'Sab bhar ke submit karo', v: lockedLines ? lockedLines + '/' + nAll : '' }));

    $('#home-timeline').innerHTML = '<div class="tl">' + html + '</div>';
  }

  // attendance per line -> sheet
  function attList(shift) {
    var d = ui.data; if (!d) return;
    var html = '<div class="line-list">' + d.depts.map(function (x) {
      var mp = d.att[x.dept + '|' + shift];
      return '<div class="task ' + (mp ? 'done' : '') + '" data-att="' + esc(x.dept) + '"><div class="ic">' + icon('att') + '</div><div class="b"><div class="n">' + esc(short(x.dept)) + '</div><div class="s">' + esc(S.catLabel(x.cat)) + '</div></div><span class="v ' + (mp ? 'ok' : '') + '">' + (mp ? mp + ' mp' : 'baaki') + '</span><span class="chev">' + icon('chev') + '</span></div>';
    }).join('') + '</div>';
    S.sheet.open((shift === 'Final' ? 'Attendance' : 'OT attendance') + ' · line chuno', html);
    $('#sheet-content').onclick = function (e) { var t = e.target.closest('[data-att]'); if (!t) return; S.sheet.close(); S.openAttendance(shift, t.dataset.att); };
  }

  $('#tab-home').addEventListener('click', function (e) { var el = e.target.closest('[data-go]'); if (el) S.go(el.dataset.go); });

  // shared action router (Home / Entry / Data)
  S.go = function (go) {
    var p = go.split(':');
    if (go === 'ctx') S.openContext();
    else if (go === 'retry') { S.invalidate(); S.refresh(); }
    else if (go === 'data') S.tab('data');
    else if (go === 'main') S.tab('main');
    else if (p[0] === 'attlist') attList(p[1] || 'Final');
    else if (p[0] === 'att') S.openAttendance(p[1]);
    else if (p[0] === 'hour') S.screens.hour(p[1]);
    else if (p[0] === 'slot') S.quick(p[1], p[2]);
    else if (p[0] === 'pick') S.pickSlot(p[1]);
    else if (p[0] === 'table') S.screens.hourly(state.line, p[1]);
    else if (go === 'manpower') S.screens.manpower(state.line);
    else if (go === 'dayclose') S.screens.dayclose('');
    else if (go === 'review') S.tab('review');
    else if (go === 'showOT') { ui.showOT = true; S.refresh(); }
    else if (go === 'showNight') { ui.showNight = true; S.refresh(); }
  };
})();
