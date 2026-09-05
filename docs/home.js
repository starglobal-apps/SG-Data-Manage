// home.js — Home: only what is still pending today. Finished hours move to the Hourly tab.
(function () {
  'use strict';
  var S = window.SG, $ = S.$, esc = S.esc, state = S.state, icon = S.icon;
  var ui = { showOT: false };

  function outType(cat) { return cat === 'STITCH' ? 'STITCH' : cat === 'PACKING' ? 'PACKING' : ''; }
  function hhmm(h) { var H = Math.floor(h), ap = H >= 12 ? 'PM' : 'AM', h12 = H % 12 || 12; return h12 + ':00 ' + ap; }

  // per-slot summary shared with hourly.js
  S.slotInfo = function (d, s) {
    var sl = d.slots[s.key] || {}, outLines = d.depts.filter(function (x) { return outType(x.cat) && d.att[x.dept + '|Final']; });
    var done = 0, pcs = 0, st = 0, pk = 0, pass = 0, eLines = 0;
    outLines.forEach(function (x) { var t = outType(x.cat), v = sl[t] && sl[t][x.dept]; if (v) { done++; pcs += v; if (t === 'PACKING') pk += v; else st += v; } });
    Object.keys(sl.ENDLINE || {}).forEach(function (k) { eLines++; pass += sl.ENDLINE[k]; });
    return { done: done, total: outLines.length, pcs: pcs, st: st, pk: pk, pass: pass, eLines: eLines, full: outLines.length > 0 && done >= outLines.length };
  };
  function triVal(inf) {
    if (!inf.done && !inf.eLines) return '';
    return '<span class="v tri"><span class="st">St <b>' + inf.st + '</b></span><span>End <b>' + inf.pass + '</b></span><span>Pk <b>' + inf.pk + '</b></span></span>';
  }

  S.tabs.home = function () {
    var cached = S.factoryData();
    if (cached) render(cached, true); else $('#home-now').innerHTML = '<div class="nowcard"><div class="k">Loading…</div><div class="t">&nbsp;</div></div>';
    S.loadFactory().then(function (d) { render(d, false); S.maybeTransferPopup(d); })
      .catch(function (e) { if (!cached) { $('#home-now').innerHTML = '<div class="nowcard warn"><div class="k">Error</div><div class="t">' + esc(e.message) + '</div><button class="btn" data-go="retry">Dobara try</button></div>'; $('#home-timeline').innerHTML = ''; } });
  };

  function render(d, stale) {
    var now = S.isToday() ? S.nowHour() : 24, todayFlag = S.isToday();
    var nAll = d.depts.length;
    var attDone = d.depts.filter(function (x) { return d.att[x.dept + '|Final']; }).length;
    var nOut = d.depts.filter(function (x) { return outType(x.cat) && d.att[x.dept + '|Final']; }).length;
    var attMp = d.depts.reduce(function (t, x) { return t + (d.att[x.dept + '|Final'] || 0); }, 0);
    var otAttDone = d.depts.filter(function (x) { return d.att[x.dept + '|OT']; }).length;
    var locked = function (dept, t) { var s = d.statuses[dept + '|' + t]; return s === 'Submitted' || s === 'Approved' || s === 'Sent'; };
    var lockedLines = d.depts.filter(function (x) { return locked(x.dept, outType(x.cat) || 'ATT') || locked(x.dept, 'ATT'); }).length;
    var b = $('#nav-rv-count'); if (S.isAdmin()) { b.hidden = !d.pending; b.textContent = d.pending || ''; }

    var anyOT = S.slots('OT').some(function (s) { return d.slots[s.key]; });
    var showOT = ui.showOT || anyOT || now >= 18;
    var pending = [], current = null, upcoming = null, doneSlots = 0, totalPcs = 0;
    S.slots('Final').concat(showOT ? S.slots('OT') : []).forEach(function (s) {
      var st = S.slotStart(s.key), inf = S.slotInfo(d, s);
      totalPcs += inf.pcs;
      var isNow = todayFlag && now >= st && now < st + 1, past = now >= st + 1, future = now < st;
      if (inf.full) { doneSlots++; return; }                       // finished -> lives in the Hourly tab
      if (isNow) current = { s: s, inf: inf };
      if (future && !upcoming) upcoming = s;
      if (!future || inf.done) pending.push({ s: s, inf: inf, isNow: isNow, past: past && s.shift === 'Final' });
    });
    var hasOTout = S.slots('OT').some(function (s) { return S.slotInfo(d, s).done; });
    var missed = pending.filter(function (p) { return p.past; });

    var nc;
    if (!nAll) nc = { cls: 'warn', k: 'Setup', t: 'Koi line nahi mili', s: 'USERS depts / MASTERS check karo', btn: 'Main', go: 'main' };
    else if (!todayFlag && missed.length) nc = { cls: 'warn', k: S.fmtDay(state.date) + ' · purana din', t: missed.length + ' slot adhoore', s: missed.map(function (m) { return m.s.label + ' (' + m.inf.done + '/' + m.inf.total + ')'; }).slice(0, 3).join(', ') + ' · OT / night bhi yahin bharo', btn: missed[0].s.label + ' bharo', go: 'hour:' + missed[0].s.key };
    else if (!todayFlag && lockedLines < nAll) nc = { cls: '', k: S.fmtDay(state.date) + ' · purana din', t: 'Din band karna baaki', s: totalPcs + ' pcs · ' + attMp + ' mp · ' + lockedLines + '/' + nAll + ' submitted', btn: 'Din band karo', go: 'dayclose' };
    else if (!todayFlag) nc = { cls: 'done', k: S.fmtDay(state.date), t: totalPcs + ' pcs · ' + attMp + ' mp', s: lockedLines + '/' + nAll + ' lines submitted', btn: 'Reports dekho', go: 'reports' };
    else if (lockedLines === nAll) nc = { cls: 'done', k: 'Aaj', t: 'Sab lines submit ho gayi', s: totalPcs + ' pcs · manager review me', btn: 'Reports dekho', go: 'reports' };
    else if (now < 8.5) nc = { cls: '', k: 'Subah', t: 'Din shuru hone wala hai', s: '9:00 par ' + nAll + ' lines ki attendance + SRN', btn: 'Attendance shuru karo', go: 'attlist:Final' };
    else if (attDone < nAll) nc = { cls: 'warn', k: 'Pehla kaam', t: 'Attendance: ' + (nAll - attDone) + ' line baaki', s: attDone + '/' + nAll + ' ho gayi · ' + attMp + ' mp', btn: 'Attendance bharo', go: 'attlist:Final' };
    else if (current) nc = { cls: '', k: 'Abhi · ' + current.s.label, t: 'Output update karo', s: current.inf.done + '/' + current.inf.total + ' lines' + (missed.length ? ' · ' + missed.length + ' purana slot adhoora' : ''), btn: current.s.label + ' bharo', go: 'hour:' + current.s.key };
    else if (missed.length) nc = { cls: 'warn', k: 'Adhoora', t: missed.length + ' slot adhoore', s: missed.map(function (m) { return m.s.label + ' (' + m.inf.done + '/' + m.inf.total + ')'; }).slice(0, 3).join(', '), btn: missed[0].s.label + ' poora karo', go: 'hour:' + missed[0].s.key };
    else if (now >= 18 && hasOTout && otAttDone < nAll) nc = { cls: 'warn', k: 'Shaam', t: 'OT attendance baaki', s: otAttDone + '/' + nAll + ' lines', btn: 'OT attendance', go: 'attlist:OT' };
    else if (now >= 17.75) nc = { cls: '', k: 'Shaam', t: 'Din band karo', s: lockedLines + '/' + nAll + ' submitted · ' + totalPcs + ' pcs', btn: 'Din band karo', go: 'dayclose' };
    else nc = { cls: 'done', k: 'Sab up to date', t: totalPcs + ' pcs · ' + attMp + ' mp', s: upcoming ? 'Agla: ' + hhmm(S.slotStart(upcoming.key) + 1) + ' par ' + upcoming.label : 'Shaam ko din band karna hai', btn: upcoming ? upcoming.label + ' pehle se bharo' : 'Reports dekho', go: upcoming ? 'hour:' + upcoming.key : 'reports' };

    var slotsSoFar = S.slots('Final').filter(function (s) { return now >= S.slotStart(s.key) + 1 || (todayFlag && now >= S.slotStart(s.key)); }).length;
    var total = nAll + slotsSoFar + nAll, done = attDone + doneSlots + lockedLines, pct = total ? Math.round(done / total * 100) : 0;
    $('#home-now').innerHTML = '<div class="nowcard ' + nc.cls + '"><div class="k">' + esc(nc.k) + (stale ? ' · refresh…' : '') + '</div><div class="t">' + esc(nc.t) + '</div><div class="s">' + esc(nc.s) + '</div><button class="btn" data-go="' + esc(nc.go) + '">' + esc(nc.btn) + '</button>' +
      '<div class="prog"><i style="width:' + pct + '%"></i></div><div class="meta"><span>' + doneSlots + ' ghante ho gaye</span><span>' + totalPcs + ' pcs · ' + nAll + ' lines</span></div></div>';

    // ---- pending timeline
    var task = function (o) {
      return '<div class="task ' + (o.cls || '') + (o.sub ? ' sub' : '') + '" data-go="' + esc(o.go) + '"><div class="ic">' + icon(o.ic) + '</div><div class="b"><div class="n">' + o.n + '</div>' + (o.s ? '<div class="s">' + o.s + '</div>' : '') + '</div>' + (o.raw ? o.raw : (o.v !== undefined && o.v !== '' ? '<span class="v ' + (o.cls === 'done' ? 'ok' : '') + '">' + o.v + '</span>' : '')) + '<span class="chev">' + icon('chev') + '</span></div>';
    };
    var hour = function (time, dotCls, future, inner) { return '<div class="tl-h' + (future ? ' future' : '') + '"><span class="time' + (dotCls === 'now' ? ' now' : '') + '">' + time + '</span><span class="dotp ' + dotCls + '"></span>' + inner + '</div>'; };
    var html = '';

    if (todayFlag && (d.openDays || []).length) {
      d.openDays.forEach(function (od) {
        html += task({ go: 'day:' + od.date, ic: 'moon', cls: 'warn', n: 'Kal ka din adhoora · ' + esc(S.fmtDay(od.date)), s: od.lines + ' line band nahi hui — night / OT bharo, phir Day Close', v: '' });
      });
    }
    var attCls = attDone === nAll ? 'done' : now >= 9 ? 'warn' : '';
    var attTask = task({ go: 'attlist:Final', ic: 'att', cls: attCls, n: 'Attendance + SRN', s: attDone + '/' + nAll + ' lines' + (attDone < nAll && now >= 9 ? ' · baaki hai' : ''), v: attMp ? attMp + ' mp' : '' });
    if (attDone) attTask += task({ go: 'wa:Final', ic: 'wa', sub: true, cls: '', n: 'Send to group', s: 'WhatsApp me ' + attDone + ' lines ka manpower', v: '' });
    if (attDone < nAll || now < 9.5 || (attDone && now < 11)) html += hour('9:00', attCls, false, attTask);
    else if (attDone) html += '<button class="lnk tl-more" data-go="wa:Final">' + icon('wa') + ' Attendance group me bhejo</button>';
    pending.forEach(function (p) {
      var cls = p.isNow ? 'now' : p.past ? 'warn' : '';
      var future = !p.past && !p.isNow;
      html += hour(p.s.label.replace(/\s?(AM|PM)$/, ''), cls, future && !p.inf.done, task({ go: 'hour:' + p.s.key, ic: 'out', cls: p.isNow ? '' : cls, n: 'Output' + (p.isNow ? ' <small style="color:var(--primary)">· abhi</small>' : ''),
        s: p.inf.done ? p.inf.done + '/' + p.inf.total + ' lines · baaki ' + (p.inf.total - p.inf.done) : (p.past ? 'Entry baaki' : p.isNow ? 'Tap karke sab lines bharo' : ''), raw: triVal(p.inf) }));
    });
    if (!showOT && nAll) html += '<button class="lnk tl-more" data-go="showOT">+ OT slots (6–10 PM)</button>';
    if (showOT && (hasOTout || now >= 18) && otAttDone < nAll) {
      html += '<div class="tl-label">OT</div>' + hour('6:00', hasOTout ? 'warn' : '', false, task({ go: 'attlist:OT', ic: 'att', cls: hasOTout ? 'warn' : '', n: 'OT attendance', s: otAttDone + '/' + nAll + ' lines' + (hasOTout ? ' · OT output hai' : ''), v: '' }));
    }
    var tr = d.transfers || { incoming: [], outgoing: [] };
    tr.incoming.forEach(function (t) {
      html += task({ go: 'transfer:' + t.id, ic: 'mp', cls: 'warn', n: 'Manpower aaya · ' + t.count + ' log', s: (t.items || []).map(function (x) { return x.count + ' ' + x.role; }).join(', ') + ' · ' + esc(S.shortLine(t.from_dept)) + ' se · ' + esc(t.by), v: 'Adjust' });
    });
    tr.outgoing.forEach(function (t) {
      html += task({ go: 'noop', ic: 'mp', sub: true, cls: '', n: 'Transfer bheja · ' + esc(S.shortLine(t.from_dept)) + ' se ' + t.count + ' log', s: (t.items || []).map(function (x) { return x.count + ' ' + x.role; }).join(', ') + ' · adjust ka wait', v: '' });
    });
    if (d.events) html += task({ go: 'manpower', ic: 'mp', sub: true, cls: 'done', n: 'Manpower change', s: d.events + ' event aaj', v: '' });
    else html += '<button class="lnk tl-more" data-go="manpower">+ Manpower change (koi gaya / late aaya)</button>';
    var sub = {}; Object.keys(d.statuses).forEach(function (k) { sub[d.statuses[k]] = (sub[d.statuses[k]] || 0) + 1; });
    html += '<div class="tl-label">Shaam</div>';
    if (lockedLines < nAll) html += hour('End', '', now < 17.5, task({ go: 'dayclose', ic: 'moon', cls: '', n: 'Din band karo', s: Object.keys(sub).length ? Object.keys(sub).map(function (k) { return sub[k] + ' ' + k; }).join(' · ') : 'Sab bhar ke submit karo', v: lockedLines ? lockedLines + '/' + nAll : '' }));
    if (doneSlots) html += task({ go: 'report', ic: 'table', sub: true, cls: '', n: 'Day report (image)', s: 'Line · SRN ka Making / Packing report group me', v: '' });
    if (!html) html = '<div class="empty">Aaj ka sab kaam ho gaya ✓</div>';
    $('#home-timeline').innerHTML = '<div class="tl">' + html + '</div>';
    if (!stale && (current || missed.length)) S.swr('hour.get', { date: state.date, factory: state.factory, slot: (current ? current.s : missed[0].s).key }, 10000).promise.catch(function () {});
  }

  // Receiving recorder places every transferred person on one of their lines / floors
  var shownPopup = {};
  function transferSheet(id) {
    var d = S.factoryData(); if (!d) return;
    var t = (d.transfers.incoming || []).filter(function (x) { return x.id === id; })[0]; if (!t) return;
    var mine = d.depts;
    var html = '<div class="card" style="margin:0 0 8px"><b>' + t.count + ' manpower aaye</b> · ' + esc(S.shortLine(t.from_dept)) + ' se · ' + esc(t.by) + (t.time ? ' · ' + esc(t.time) : '') + (t.note ? '<br><span class="muted">' + esc(t.note) + '</span>' : '') + '<br><span class="muted">Kis line / floor par lagana hai — role-wise qty bharo</span></div>';
    (t.items || []).forEach(function (it, i) {
      html += '<div class="alloc-h" data-role="' + esc(it.role) + '">' + esc(it.role) + ' × ' + it.count + '<span>0 / ' + it.count + '</span></div>';
      mine.forEach(function (x) { html += '<div class="tr-role"><span class="n">' + esc(S.shortLine(x.dept)) + '</span><span class="av">' + esc(S.catLabel(x.cat)) + '</span><input type="number" inputmode="numeric" min="0" placeholder="0" data-role="' + esc(it.role) + '" data-dept="' + esc(x.dept) + '"' + (mine.length === 1 ? ' value="' + it.count + '"' : '') + '></div>'; });
    });
    html += '<div class="actions" style="margin-top:12px"><button class="btn danger" data-dec="reject">Reject</button><button class="btn ok" data-dec="accept">Adjust & accept</button></div>';
    S.sheet.open('Manpower adjust karo', html);
    var c = $('#sheet-content');
    var tally = function () {
      (t.items || []).forEach(function (it) {
        var sum = 0; S.$$('input[data-role="' + it.role + '"]', c).forEach(function (i) { sum += Number(i.value) || 0; });
        var h = S.$$('.alloc-h', c).filter(function (x) { return x.dataset.role === it.role; })[0];
        if (h) { h.querySelector('span').textContent = sum + ' / ' + it.count; h.className = 'alloc-h ' + (sum === it.count ? 'ok' : 'bad'); }
      });
    };
    tally();
    c.oninput = tally;
    c.onclick = function (e) {
      var b = e.target.closest('button[data-dec]'); if (!b) return;
      if (b.dataset.dec === 'reject') {
        S.ask('Transfer reject karein? Log bhejne wali line par wapas dikhenge.', { danger: true, ok: 'Reject' }).then(function (ok) { if (ok) decide('reject', []); });
        return;
      }
      var allocs = S.$$('input[data-role]', c).map(function (i) { return { dept: i.dataset.dept, role: i.dataset.role, count: Number(i.value) || 0 }; }).filter(function (a) { return a.count > 0; });
      var bad = (t.items || []).filter(function (it) { var sum = 0; allocs.forEach(function (a) { if (a.role === it.role) sum += a.count; }); return sum !== it.count; })[0];
      if (bad) { S.toast(bad.role + ': ' + bad.count + ' aaye — utne hi adjust karo', 'bad'); return; }
      decide('accept', allocs);
    };
    function decide(action, allocs) {
      S.api('transfer.decide', { id: id, action: action, allocations: allocs }).then(function () { S.toast(action === 'accept' ? 'Adjust ho gaya · manpower lines me jud gayi' : 'Reject kiya', 'ok'); S.sheet.close(); S.invalidateAll(); S.clearLocalCaches(); S.refresh(); }).catch(function (er) { S.toast(er.message, 'bad'); });
    }
  }
  // bell: list of pending incoming transfers; popup once per transfer when the app opens
  S.transferInbox = function () {
    var d = S.factoryData(), inc = (d && d.transfers && d.transfers.incoming) || [];
    if (!inc.length) { S.toast('Koi naya transfer nahi', ''); return; }
    if (inc.length === 1) { transferSheet(inc[0].id); return; }
    S.sheet.open('Manpower aaya · ' + inc.length, inc.map(function (t) { return '<div class="task" data-tid="' + esc(t.id) + '"><div class="ic">' + icon('mp') + '</div><div class="b"><div class="n">' + t.count + ' log · ' + esc(S.shortLine(t.from_dept)) + ' se</div><div class="s">' + (t.items || []).map(function (x) { return x.count + ' ' + x.role; }).join(', ') + ' · ' + esc(t.by) + '</div></div><span class="chev">' + icon('chev') + '</span></div>'; }).join(''));
    $('#sheet-content').onclick = function (e) { var x = e.target.closest('[data-tid]'); if (x) { S.sheet.close(); transferSheet(x.dataset.tid); } };
  };
  S.maybeTransferPopup = function (d) {
    var inc = (d.transfers && d.transfers.incoming) || [];
    var fresh = inc.filter(function (t) { return !shownPopup[t.id]; });
    if (!fresh.length || !$('#sheet').hidden) return;
    fresh.forEach(function (t) { shownPopup[t.id] = true; });
    transferSheet(fresh[0].id);
  };

  function attList(shift) {
    var d = S.factoryData(); if (!d) return;
    var html = '<div class="line-list">' + d.depts.map(function (x) {
      var mp = d.att[x.dept + '|' + shift], srn = d.attSrn && d.attSrn[x.dept];
      return '<div class="task ' + (mp ? 'done' : '') + '" data-att="' + esc(x.dept) + '"><div class="ic">' + icon(x.cat === 'PACKING' ? 'box' : 'att') + '</div><div class="b"><div class="n">' + esc(S.shortLine(x.dept)) + '</div><div class="s">' + esc(srn ? 'SRN ' + srn : S.catLabel(x.cat)) + '</div></div><span class="v ' + (mp ? 'ok' : '') + '">' + (mp ? mp + ' mp' : 'baaki') + '</span><span class="chev">' + icon('chev') + '</span></div>';
    }).join('') + '</div>';
    html += '<button class="btn big wa" data-wa="' + shift + '" style="display:flex;align-items:center;justify-content:center;gap:8px">' + icon('wa') + ' Send to group (WhatsApp)</button>';
    S.sheet.open((shift === 'Final' ? 'Attendance' : 'OT attendance') + ' · line chuno', html);
    $('#sheet-content').onclick = function (e) {
      var w = e.target.closest('[data-wa]'); if (w) { S.sendToGroup(w.dataset.wa); return; }
      var t = e.target.closest('[data-att]'); if (!t) return; S.sheet.close(); S.openAttendance(shift, t.dataset.att);
    };
  }

  $('#tab-home').addEventListener('click', function (e) { var el = e.target.closest('[data-go]'); if (el) S.go(el.dataset.go); });

  S.go = function (go) {
    var p = go.split(':');
    if (go === 'ctx') S.openContext();
    else if (go === 'retry') { S.invalidateAll(); S.refresh(); }
    else if (go === 'data') S.tab('data');
    else if (go === 'reports') S.tab('reports');
    else if (p[0] === 'day') S.setDate(p[1]);
    else if (go === 'main') S.tab('main');
    else if (p[0] === 'attlist') attList(p[1] || 'Final');
    else if (p[0] === 'wa') S.sendToGroup(p[1] || 'Final');
    else if (p[0] === 'transfer') transferSheet(p[1]);
    else if (go === 'noop') return;
    else if (p[0] === 'att') S.openAttendance(p[1]);
    else if (p[0] === 'hour') S.screens.hour(p[1], p[2]);
    else if (p[0] === 'slot') S.quick(p[1], p[2]);
    else if (p[0] === 'pick') S.pickSlot(p[1]);
    else if (p[0] === 'table') S.screens.hourly(state.line, p[1]);
    else if (go === 'manpower') S.screens.manpower(state.line);
    else if (go === 'dayclose') S.screens.dayclose('');
    else if (go === 'report') S.reportPicker();
    else if (go === 'review') S.tab('review');
    else if (go === 'showOT') { ui.showOT = true; S.refresh(); }
  };
})();
