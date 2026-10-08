// home.js — Home: only what is still pending today. Finished hours move to the Hourly tab.
(function () {
  'use strict';
  var S = window.SG, $ = S.$, esc = S.esc, state = S.state, icon = S.icon;
  var ui = { showOT: false };

  function outType(cat) { return cat === 'STITCH' ? 'STITCH' : cat === 'PACKING' ? 'PACKING' : ''; }
  function hhmm(h) { var H = Math.floor(h), ap = H >= 12 ? 'PM' : 'AM', h12 = H % 12 || 12; return h12 + ':00 ' + ap; }

  // per-slot summary shared with hourly.js
  S.slotInfo = function (d, s) {
    var sl = d.slots[s.key] || {}, stH = S.slotStart(s.key), closed = d.closed || {};
    var attLines = d.depts.filter(function (x) { return outType(x.cat) && d.att[x.dept + '|Final']; });
    // a line closed (band) before this slot starts is not pending for it
    var outLines = attLines.filter(function (x) { return !(closed[x.dept] && closed[x.dept].hour <= stH + 0.01); });
    var done = 0, pcs = 0, st = 0, pk = 0, pass = 0, eLines = 0;
    outLines.forEach(function (x) { var t = outType(x.cat), v = sl[t] && sl[t][x.dept]; if (v) { done++; pcs += v; if (t === 'PACKING') pk += v; else st += v; } });
    Object.keys(sl.ENDLINE || {}).forEach(function (k) { eLines++; pass += sl.ENDLINE[k]; });
    return { done: done, total: outLines.length, closedN: attLines.length - outLines.length, pcs: pcs, st: st, pk: pk, pass: pass, eLines: eLines, full: attLines.length > 0 && done >= outLines.length };
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
    var now = S.isToday() ? S.nowHour() : 24, todayFlag = S.isToday(), closed = d.closed || {};
    var nAll = d.depts.length;
    var attDone = d.depts.filter(function (x) { return d.att[x.dept + '|Final']; }).length;
    var attMp = d.depts.reduce(function (t, x) { return t + (d.att[x.dept + '|Final'] || 0); }, 0);
    var otAttDone = d.depts.filter(function (x) { return d.att[x.dept + '|OT']; }).length;
    var locked = function (dept, t) { var s = d.statuses[dept + '|' + t]; return s === 'Submitted' || s === 'Approved' || s === 'Sent'; };
    var lockedLines = d.depts.filter(function (x) { return locked(x.dept, outType(x.cat) || 'ATT') || locked(x.dept, 'ATT'); }).length;
    var b = $('#nav-rv-count'); if (S.isAdmin()) { b.hidden = !d.pending; b.textContent = d.pending || ''; }

    var anyOT = S.slots('OT').some(function (s) { return d.slots[s.key]; });
    var showOT = ui.showOT || anyOT || now >= 18;
    var rows = [], current = null, upcoming = null, doneSlots = 0, totalPcs = 0, missed = [];
    S.slots('Final').concat(showOT ? S.slots('OT') : []).forEach(function (s) {
      var st = S.slotStart(s.key), inf = S.slotInfo(d, s);
      totalPcs += inf.pcs;
      var isNow = todayFlag && now >= st && now < st + 1, past = now >= st + 1, future = now < st;
      var state_ = inf.full ? 'done' : isNow ? 'now' : (past && s.shift === 'Final') ? 'miss' : (inf.done ? 'part' : 'todo');
      if (inf.full) doneSlots++;
      if (isNow) current = { s: s, inf: inf };
      if (future && !inf.full && !upcoming) upcoming = s;
      if (state_ === 'miss') missed.push({ s: s, inf: inf });
      rows.push({ s: s, inf: inf, st: state_, future: future });
    });
    var hasOTout = S.slots('OT').some(function (s) { return S.slotInfo(d, s).done; });

    // ---- hero: the one thing to do now
    var nc;
    if (!nAll) nc = { cls: 'warn', k: 'Setup', t: 'Koi line nahi mili', s: 'Admin se line access lo', btn: 'Main', go: 'main' };
    else if (!todayFlag && missed.length) nc = { cls: 'warn', k: S.fmtDay(state.date) + ' · purana din', t: missed.length + ' ghante adhoore', s: missed.map(function (m) { return m.s.label + ' (' + m.inf.done + '/' + m.inf.total + ')'; }).slice(0, 3).join(', ') + (otAttDone < nAll ? ' · OT hua ho to pehle OT attendance' : ''), btn: missed[0].s.label + ' bharo', go: 'wiz:' + missed[0].s.key };
    else if (!todayFlag && lockedLines < nAll) nc = { cls: '', k: S.fmtDay(state.date) + ' · purana din', t: 'Din band karna baaki', s: totalPcs + ' pcs · ' + attMp + ' log · ' + lockedLines + '/' + nAll + ' submitted', btn: 'Din band karo', go: 'dayclose' };
    else if (!todayFlag) nc = { cls: 'done', k: S.fmtDay(state.date), t: totalPcs + ' pcs · ' + attMp + ' log', s: lockedLines + '/' + nAll + ' lines submitted', btn: 'Aaj par wapas', go: 'day:' + S.todayStr() };
    else if (lockedLines === nAll) nc = { cls: 'done', k: 'Aaj', t: 'Sab submit ho gaya ✓', s: totalPcs + ' pcs · admin review me', btn: 'Ghante dekho', go: 'grid' };
    else if (now < 8.5) nc = { cls: '', k: 'Subah', t: 'Din shuru hone wala hai', s: '9:00 par ' + nAll + ' lines ki attendance', btn: 'Attendance shuru karo', go: 'attlist' };
    else if (attDone < nAll) nc = { cls: 'warn', k: 'Pehla kaam', t: 'Attendance: ' + (nAll - attDone) + ' line baaki', s: attDone + '/' + nAll + ' ho gayi · ' + attMp + ' log', btn: 'Attendance bharo', go: 'attlist' };
    else if (missed.length) nc = { cls: 'warn', k: 'Chhoot gaya', t: missed[0].s.label + ' ka output baaki', s: missed[0].inf.done + '/' + missed[0].inf.total + ' lines' + (missed.length > 1 ? ' · +' + (missed.length - 1) + ' aur ghante' : ''), btn: missed[0].s.label + ' bharo', go: 'wiz:' + missed[0].s.key };
    else if (current) nc = { cls: '', k: 'Agla kaam · ' + current.s.label, t: current.s.label + ' ka output bharo', s: current.inf.done + '/' + current.inf.total + ' lines ho gayi', btn: current.inf.done ? 'Baaki lines bharo' : 'Shuru karo · ' + current.inf.total + ' lines', go: 'wiz:' + current.s.key };
    else if (now >= 18 && hasOTout && otAttDone < nAll) nc = { cls: 'warn', k: 'Shaam', t: 'OT attendance baaki', s: otAttDone + '/' + nAll + ' lines', btn: 'OT attendance', go: 'attlist:OT' };
    else if (now >= 17.75) nc = { cls: '', k: 'Shaam', t: 'Din band karo', s: lockedLines + '/' + nAll + ' submitted · ' + totalPcs + ' pcs', btn: 'Din band karo', go: 'dayclose' };
    else nc = { cls: 'done', k: 'Sab up to date', t: totalPcs + ' pcs · ' + attMp + ' log', s: upcoming ? 'Agla: ' + hhmm(S.slotStart(upcoming.key) + 1) + ' par ' + upcoming.label : 'Shaam ko din band karna hai', btn: upcoming ? upcoming.label + ' pehle se bharo' : 'Ghante dekho', go: upcoming ? 'wiz:' + upcoming.key : 'grid' };

    var slotsSoFar = S.slots('Final').filter(function (s) { return now >= S.slotStart(s.key) + 1 || (todayFlag && now >= S.slotStart(s.key)); }).length;
    var total = nAll + slotsSoFar + nAll, done = attDone + doneSlots + lockedLines, pct = total ? Math.round(done / total * 100) : 0;
    $('#home-now').innerHTML = '<div class="nowcard ' + nc.cls + '"><div class="k">' + esc(nc.k) + (stale ? ' · refresh…' : '') + '</div><div class="t">' + esc(nc.t) + '</div><div class="s">' + esc(nc.s) + '</div><button class="btn hero-btn" data-go="' + esc(nc.go) + '">' + esc(nc.btn) + '</button>' +
      '<div class="prog"><i style="width:' + pct + '%"></i></div><div class="meta"><span>' + doneSlots + ' ghante ho gaye</span><span>' + totalPcs + ' pcs · ' + nAll + ' lines</span></div></div>';

    // ---- checklist
    var task = function (o) {
      return '<div class="task aj ' + (o.cls || '') + '" data-go="' + esc(o.go) + '"><div class="ic ' + (o.ic || '') + '">' + (o.mark || '') + '</div><div class="b"><div class="n">' + o.n + '</div>' + (o.s ? '<div class="s">' + o.s + '</div>' : '') + '</div>' + (o.v ? '<span class="v">' + o.v + '</span>' : '') + '<span class="chev">' + icon('chev') + '</span></div>';
    };
    var html = '';
    if (todayFlag && (d.openDays || []).length) d.openDays.forEach(function (od) {
      html += task({ go: 'day:' + od.date, ic: 'warn', mark: '!', cls: 'warn', n: 'Kal ka din adhoora · ' + esc(S.fmtDay(od.date)), s: od.lines + ' line band nahi hui — OT / night bharo, phir din band' });
    });
    var attOk = attDone === nAll;
    html += task({ go: 'attlist', ic: attOk ? 'done' : (now >= 9 ? 'warn' : 'todo'), mark: attOk ? '✓' : (now >= 9 ? '!' : '○'), cls: attOk ? 'done' : '', n: 'Attendance', s: attDone + '/' + nAll + ' lines' + (attMp ? ' · ' + attMp + ' log' : '') + (attOk ? ' · group me bhejne ke liye tap' : ' · kal jaisa hai to ek tap'), v: '' });
    rows.forEach(function (r) {
      var lab = r.s.label, inf = r.inf, m = { done: '✓', now: '●', miss: '!', part: '●', todo: '○' }[r.st];
      var s = r.st === 'done' ? inf.pcs + ' pcs' + (inf.eLines ? ' · endline ' + inf.pass : '') : r.st === 'now' ? (inf.done ? inf.done + '/' + inf.total + ' ho gayi · baaki ' + (inf.total - inf.done) : 'Abhi bharna hai') : r.st === 'miss' ? 'Chhoot gaya · ' + inf.done + '/' + inf.total : r.st === 'part' ? inf.done + '/' + inf.total + ' lines' : (todayFlag ? hhmm(S.slotStart(r.s.key) + 1) + ' ke baad' : '');
      html += task({ go: 'wiz:' + r.s.key, ic: r.st === 'done' ? 'done' : r.st === 'now' ? 'now' : r.st === 'miss' ? 'warn' : 'todo', mark: m, cls: r.st === 'now' ? 'now' : r.st === 'done' ? 'done' : r.st === 'todo' && r.future ? 'dim' : '', n: lab, s: s, v: inf.closedN ? '<small>' + inf.closedN + ' band</small>' : '' });
    });
    if (!showOT && nAll) html += '<button class="lnk tl-more" data-go="showOT">+ OT slots (6–10 PM)</button>';
    if (showOT && (hasOTout || now >= 18) && otAttDone < nAll) html += task({ go: 'attlist:OT', ic: hasOTout ? 'warn' : 'todo', mark: hasOTout ? '!' : '○', n: 'OT attendance', s: otAttDone + '/' + nAll + ' lines' + (hasOTout ? ' · OT output hai, attendance nahi' : '') });
    var tr = d.transfers || { incoming: [], outgoing: [] };
    tr.incoming.forEach(function (t) { html += task({ go: 'transfer:' + t.id, ic: 'warn', mark: '↓', cls: 'warn', n: 'Manpower aaya · ' + t.count + ' log', s: (t.items || []).map(function (x) { return x.count + ' ' + x.role; }).join(', ') + ' · ' + esc(S.shortLine(t.from_dept)) + ' se', v: 'Adjust' }); });
    tr.outgoing.forEach(function (t) { html += task({ go: 'noop', ic: 'todo', mark: '↑', n: 'Transfer bheja · ' + t.count + ' log', s: esc(S.shortLine(t.from_dept)) + ' se · adjust ka wait' }); });
    var closedN = Object.keys(closed).length;
    html += task({ go: 'mpq', ic: d.events ? 'done' : 'todo', mark: '±', n: 'Koi gaya / aaya?', s: d.events ? d.events + ' badlav aaj' + (closedN ? ' · ' + closedN + ' line band' : '') : 'Line se koi nikla, late aaya, transfer, ya line band' });
    if (lockedLines < nAll) html += task({ go: 'dayclose', ic: now >= 17.5 ? 'now' : 'todo', mark: '☾', cls: now < 17.5 && todayFlag ? 'dim' : '', n: 'Din band karo', s: now < 17.5 && todayFlag ? '6 PM ke baad · sab bharne par' : 'Sab check karke admin ko bhejo', v: lockedLines ? lockedLines + '/' + nAll : '' });
    if (!S.isRecorder() && doneSlots) html += task({ go: 'report', ic: 'todo', mark: '▤', n: 'Day report (image)', s: 'Line · SRN ka Making / Packing report group me' });
    $('#home-timeline').innerHTML = '<div class="aj-list">' + html + '</div>';
    if (!stale && (current || missed.length)) S.swr('hour.get', { date: state.date, factory: state.factory, slot: (current ? current.s : missed[0].s).key }, 10000).promise.catch(function () {});
  }

  // ---------- attendance list: "kal jaisa hi?" ----------
  var AL = { items: [], shift: 'Final', busy: {}, box: '#attlist-body', srns: {}, pick: {}, fd: null };
  function box() { return $(AL.box); }
  function phone() { return AL.box === '#matt-body'; }
  S.screens.attlist = function (shift) {
    AL.shift = shift || 'Final';
    AL.box = '#attlist-body';
    S.push('attlist', (AL.shift === 'Final' ? 'Attendance' : AL.shift + ' attendance') + ' · ' + S.fmtDay(state.date));
    box().innerHTML = '<div class="empty">Lines aa rahi hain…</div>';
    loadAttList();
  };
  function loadAttList() {
    if (AL.shift !== 'Final') { renderAttOT(); return; }
    if (phone()) { loadPhoneAtt(); return; }
    S.api('att.prev', { date: state.date, factory: state.factory }, { quiet: true }).then(function (d) { AL.items = d.items; renderAttList(); })
      .catch(function (e) { box().innerHTML = '<div class="empty">' + esc(e.message) + '</div>'; });
  }
  function evText(x) {
    var lab = { HALF_DAY: 'half day', LEFT_AT: 'left early', LATE_JOIN: 'came late', ABSENT: 'absent', EXTRA: 'extra', TRANSFER_OUT: 'transferred out', TRANSFER_IN: 'transferred in', LINE_CLOSED: 'line closed' };
    return (x.events || []).filter(function (e) { return e.event !== 'TRANSFER_OUT' && e.event !== 'TRANSFER_IN'; }).map(function (e) { return e.event === 'LINE_CLOSED' ? 'Line closed ' + e.time : e.count + ' ' + e.role + ' ' + (lab[e.event] || e.event) + (e.time ? ' ' + e.time : ''); }).join(', ');
  }
  function renderAttList() {
    var done = AL.items.filter(function (x) { return x.today; }).length, n = AL.items.length;
    var pend = AL.items.filter(function (x) { return !x.today && x.prev; }).length;
    var html = '<p class="hint" style="margin:0 0 8px">Kal jaisa hai to <b>Same</b> dabao — SRN, supervisor, incharge, QC sab kal ke lag jayenge. Kuch badla ho to <b>Badlo</b>.</p>';
    if (pend > 1) html += '<button class="btn big ok" data-sameall="1" style="margin:0 0 10px">Sab ' + pend + ' lines kal jaisa hi</button>';
    html += AL.items.map(function (x) {
      var t = x.today, p = x.prev, busy = AL.busy[x.dept];
      var sub = t ? t.count + ' log · ' + (t.srn || 'SRN nahi') + (t.by ? ' · ' + esc(t.by) : '') : p ? esc(S.fmtDay(p.date)) + ' ko ' + p.count + ' log' + (p.srn ? ' · ' + esc(p.srn) : '') : 'Pehli baar — bharo';
      return '<div class="chk-line' + (t ? ' done' : '') + '"><div class="b"><div class="n">' + esc(S.shortLine(x.dept)) + '</div><div class="m">' + sub + '</div></div>' +
        (t ? '<button class="btn small ghost" data-edit="' + esc(x.dept) + '">✓ ' + t.count + ' · Badlo</button>'
           : (p ? '<button class="btn small same" data-same="' + esc(x.dept) + '"' + (busy ? ' disabled' : '') + '>' + (busy ? '…' : 'Same ' + p.count) + '</button>' : '') + '<button class="btn small ghost" data-edit="' + esc(x.dept) + '">' + (p ? 'Badlo' : 'Bharo') + '</button>') + '</div>';
    }).join('');
    html += '<div class="sticky-bottom">' + (done === n && n ? '<button class="btn big wa" data-wa="Final" style="display:flex;align-items:center;justify-content:center;gap:8px">' + icon('wa') + ' Sab ho gayi · WhatsApp group me bhejo</button>' : '<button class="btn big" disabled>' + (n - done) + ' line baaki</button>') + '</div>';
    box().innerHTML = html;
  }
  function renderAttOT() {
    var d = S.factoryData() || { depts: [], att: {} };
    var html = '<p class="hint" style="margin:0 0 8px">OT ke log aur ghante bharo.</p>' + d.depts.map(function (x) {
      var mp = d.att[x.dept + '|OT'];
      return '<div class="chk-line' + (mp ? ' done' : '') + '"><div class="b"><div class="n">' + esc(S.shortLine(x.dept)) + '</div><div class="m">' + (mp ? mp + ' log OT' : 'OT attendance nahi') + '</div></div><button class="btn small ghost" data-edit="' + esc(x.dept) + '">' + (mp ? 'Badlo' : 'Bharo') + '</button></div>';
    }).join('');
    html += '<div class="sticky-bottom"><button class="btn big wa" data-wa="OT" style="display:flex;align-items:center;justify-content:center;gap:8px">' + icon('wa') + ' OT attendance group me bhejo</button></div>';
    box().innerHTML = html;
  }
  function saveSame(dept, quiet) {
    var x = AL.items.filter(function (i) { return i.dept === dept; })[0]; if (!x || !x.prev) return Promise.resolve();
    var p = x.prev, srn = phone() && x.cat === 'STITCH' && AL.pick[dept] ? AL.pick[dept] : p.srn;
    if (phone() && x.cat === 'STITCH' && AL.srns[dept] && AL.srns[dept].length && !srn) { S.toast('Pehle SRN chuno', 'bad'); return Promise.resolve(); }
    AL.busy[dept] = true; renderAttList();
    return S.api('att.save', { date: state.date, factory: state.factory, dept: dept, shift: 'Final', srn: srn, supervisor: p.supervisor, incharge: p.incharge, qc_names: p.qc_names, rows: p.rows.map(function (r) { return { role: r.role, hours: r.hours, count: r.count }; }) })
      .then(function () { delete AL.busy[dept]; x.today = { count: p.count, srn: srn, by: state.user.name }; if (!quiet) { S.invalidateAll(); S.clearLocalCaches(); loadAttList(); } else renderAttList(); })
      .catch(function (e) { delete AL.busy[dept]; renderAttList(); S.toast(S.shortLine(dept) + ': ' + e.message + ' — Badlo dabao', 'bad', 7000); });
  }
  // ---------- phone Attendance tab: date + line code on top; below only the lines filled for that date ----------
  var PA = { items: [], lines: [], wa: null, incoming: [], allLines: [] };
  // data comes from the phone store (phone.js): drawn at once, fetched only when missing / old / after a save
  function applyAtt(d) {
    PA.loading = !!d.loading; PA.items = d.items || []; PA.lines = d.lines || []; PA.wa = d.wa; S.samMap = d.sam || {}; S.planMap = d.plan || {}; PA.incoming = d.incoming || []; PA.allLines = d.allLines || [];
    trBadge(PA.incoming.length);
    renderPhoneAtt();
  }
  function loadPhoneAtt() {
    var d = S.pd.need();
    if (d && d.att && d.att.ok !== false) applyAtt(d.att);
    else if (d && d.att) attFail(new Error(d.att.message || 'Error'));
    else box().innerHTML = '<div class="empty">Loading…</div>';
  }
  function attFail(e) { box().innerHTML = '<div class="empty">' + esc(e.message) + '<br><button class="btn primary" data-retry="1" style="margin-top:10px">Try again</button></div>'; }
  S.pdRender.matt = function () { if (AL.box !== '#matt-body' || AL.shift !== 'Final') return; var d = S.pd.get(); if (d && d.att && d.att.ok !== false) applyAtt(d.att); };
  S.pdFail.matt = attFail;
  // saves still on their way (or failed) shown on their line at once: new numbers for an attendance save, a status line
  // "Saving… / Not saved · Resend" for every pending save of the line
  function withPending(items) {
    var list = items.map(function (x) { return Object.assign({}, x, { ob: [] }); });
    S.pd.pending(state.date).forEach(function (it) {
      var x = list.filter(function (i) { return i.dept === it.dept; })[0];
      if (it.kind === 'att' && it.shift === 'Final' && it.payload.rows && it.payload.rows.length) {
        var roles = {}, n = 0; it.payload.rows.forEach(function (r) { roles[r.role] = (roles[r.role] || 0) + r.count; n += r.count; });
        if (!x) { var l = PA.lines.filter(function (p) { return p.dept === it.dept; })[0] || {}; x = { dept: it.dept, cat: l.cat || 'STITCH', events: [], transfers: [], ot: 0, night: 0, ob: [] }; list.push(x); }
        Object.assign(x, { count: n, mpNow: n, roles: roles, srn: it.payload.srn || '', by: S.state.user.name, fromSheet: false });
      }
      if (x) x.ob.push(it);
    });
    return list;
  }
  function obLine(it) {
    var what = it.kind === 'att' && it.payload.rows && !it.payload.rows.length ? (it.label === 'Line change' ? 'Line change' : 'Cancel') : it.label || 'Attendance';
    if (it.state === 'failed') return '<div class="ob-line bad"><span>⚠ ' + esc(what) + ' not saved' + (it.error ? ' — ' + esc(it.error) : '') + '</span><button class="btn small" data-resend="' + esc(it.id) + '">Resend</button></div>';
    return '<div class="ob-line"><span class="ob-spin"></span>' + esc(what) + ' — saving…</div>';
  }
  function renderPhoneAtt() {
    var today = S.todayStr(), past = state.date !== today;
    var html = '<div class="card pa-top"><div class="row">' +
      '<div class="field small"><label>Date</label><input type="date" id="pa-date" value="' + esc(state.date) + '" max="' + today + '"></div>' +
      '<div class="field"><label>Line code</label><select id="pa-line"><option value="">— select line —</option>' +
        PA.lines.map(function (l) { return '<option value="' + esc(l.dept) + '">' + esc(S.shortLine(l.dept)) + (l.filled ? '  ✓' : '') + '</option>'; }).join('') + '</select></div></div>' +
      '<div class="hint">' + (past ? '<b style="color:var(--warn)">' + esc(S.fmtDay(state.date)) + ' attendance</b> · <button class="lnk" data-day="' + today + '">back to today</button>' : 'Select line → fill attendance → Save. Filled lines show below.') + '</div></div>';
    PA.incoming.forEach(function (t) {
      html += '<div class="card tr-in"><div class="tr-h">Transfer request</div><div class="tr-b"><b>' + esc(S.shortLine(t.from)) + ' → ' + esc(S.shortLine(t.to)) + '</b> · ' + t.total + (t.total > 1 ? ' people' : ' person') + '</div>' +
        '<div class="m">' + t.items.map(function (i) { return i.count + ' ' + esc(i.role); }).join(', ') + '</div>' +
        '<div class="m">From <b>' + hourLabel(t.hour) + '</b>' + (t.date !== S.todayStr() ? ' · ' + esc(S.fmtDay(t.date)) : '') + ' · by ' + esc(t.by) + '</div>' +
        '<div class="tr-acts"><button class="btn small danger" data-trno="' + esc(t.id) + '">Reject</button><button class="btn small ok" data-trok="' + esc(t.id) + '">Accept</button></div></div>';
    });
    var shown = withPending(PA.items);
    if (PA.loading) html += '<div class="ob-line" style="margin:4px 4px 10px"><span class="ob-spin"></span>Updating ' + esc(S.fmtDay(state.date)) + '…</div>';
    else if (!shown.length) html += '<div class="empty">' + (past ? 'No attendance on this date' : 'No attendance filled today yet') + '</div>';
    shown.forEach(function (x) {
      var st = x.status || '', lock = st === 'Submitted' || st === 'Approved' || st === 'Sent', ev = evText(x);
      var tg = x.srn && x.cat === 'STITCH' ? S.hourlyTarget(x.srn, S.targetMp(x.roles), x.dept) : null;
      html += '<div class="chk-line done al-done"><div class="b"><div class="n">' + esc(S.shortLine(x.dept)) + (x.fromSheet ? ' <em class="ot">from sheet</em>' : '') + '</div>' +
        '<div class="m">' + (x.srn ? esc(x.srn) + ' · ' : '') + x.count + ' people' + (!x.fromSheet && x.mpNow !== x.count ? ' · now <b>' + x.mpNow + '</b>' : '') + (x.ot ? ' · OT ' + x.ot : '') + (x.night ? ' · Night ' + x.night : '') + (x.by ? ' · ' + esc(x.by) : '') + '</div>' +
        (ev ? '<div class="m al-ev">' + esc(ev) + '</div>' : '') + x.ob.map(obLine).join('') + trText(x) + (st === 'Synced' && !x.ob.length ? '<div class="m" style="color:var(--ok)">In main sheet ✓</div>' : '') + (tg ? '<div class="al-tg">' + tg.html + '</div>' : '') +
        (lock ? '<div class="m">' + (st === 'Submitted' ? 'In admin review' : st === 'Sent' ? 'In main sheet ✓' : esc(st)) + '</div>' : '') +
        (x.fromSheet && !lock ? '<div class="m">Filled in main sheet — Update / Change writes to the main sheet</div>' : '') + '</div>' +
        (lock ? '' : '<div class="pa-acts">' +
          '<button class="btn small ghost" data-chg="' + esc(x.dept) + '">Change attendance<small>line, SRN, all</small></button>' +
          '<button class="btn small ghost" data-ot="' + esc(x.dept) + '">OT / Night<small>' + (x.ot || x.night ? (x.ot ? 'OT ' + x.ot : '') + (x.ot && x.night ? ' · ' : '') + (x.night ? 'Night ' + x.night : '') : 'fill') + '</small></button>' +
          '<button class="btn small ghost upd" data-upd="' + esc(x.dept) + '">Update attendance<small>half day / absent</small></button>' +
          '<button class="btn small ghost trb" data-tr="' + esc(x.dept) + '">Transfer manpower<small>to another line</small></button></div>') + '</div>';
    });
    if (PA.items.length) html += '<div class="sticky-bottom"><button class="btn big wa" data-wa="Final" style="display:flex;align-items:center;justify-content:center;gap:8px">' + icon('wa') + ' Send attendance to group · ' + PA.items.length + (PA.items.length > 1 ? ' lines' : ' line') + '</button></div>';
    box().innerHTML = html;
  }
  // ---------- "Transfer manpower": people of a line go to another line from a whole hour; that line's recorder accepts ----------
  function hourLabel(h) { return (h % 12 || 12) + (h >= 12 ? ' PM' : ' AM'); }
  S.trBadge = trBadge;
  function trBadge(n) { var b = $('#nav button[data-tab="matt"]'); if (!b) return; var dot = b.querySelector('.nav-dot'); if (!n) { if (dot) dot.remove(); return; } if (!dot) { dot = document.createElement('i'); dot.className = 'nav-dot'; b.appendChild(dot); } dot.textContent = n; }
  function trText(x) {
    return (x.transfers || []).map(function (t) {
      var out = t.from === x.dept, who = t.items.map(function (i) { return i.count + ' ' + i.role; }).join(', ');
      var st = t.status === 'Pending' ? 'waiting for ' + S.shortLine(t.to) + ' to accept' : t.status === 'Rejected' ? 'rejected by ' + S.shortLine(t.to) : 'accepted';
      return '<div class="m tr-st ' + (t.status === 'Rejected' ? 'bad' : t.status === 'Pending' ? 'wait' : 'ok') + '">' + (out ? '→ ' + esc(S.shortLine(t.to)) : '← ' + esc(S.shortLine(t.from))) + ' · ' + esc(who) + ' · from ' + hourLabel(t.hour) + (out ? ' · ' + esc(st) : '') + '</div>';
    }).join('');
  }
  // hours on the old / new line for a transfer at hour h (9–6 shift, lunch 1–2)
  function trSplit(h) { var b = Math.max(0, Math.min(8, h - 9 - (h > 13 ? 1 : 0))); return { before: b, after: 8 - b }; }
  function trSheet(x) {
    if (!x) return;
    var roles = Object.keys(x.roles || {}).filter(function (r) { return x.roles[r] > 0; });
    var lines = PA.allLines.filter(function (l) { return l.dept !== x.dept; });
    var now = new Date().getHours(), def = state.date === S.todayStr() ? Math.max(9, Math.min(17, now)) : 9;
    var hours = [9, 10, 11, 12, 13, 14, 15, 16, 17];
    var html = '<label>Transfer to line</label><select id="tr-to"><option value="">— select line —</option>' + lines.map(function (l) { return '<option value="' + esc(l.dept) + '">' + esc(S.shortLine(l.dept)) + '</option>'; }).join('') + '</select>' +
      '<label>Transfer time</label><select id="tr-hour">' + hours.map(function (h) { return '<option value="' + h + '"' + (h === def ? ' selected' : '') + '>' + hourLabel(h) + '</option>'; }).join('') + '</select>' +
      '<div class="hint" id="tr-split" style="margin:4px 0 10px"></div>' +
      '<label>How many people</label><div class="list tr-roles">' + roles.map(function (r) {
        return '<div class="item"><div><div class="name">' + esc(r) + '</div><div class="sub">' + x.roles[r] + ' on line</div></div><input type="number" inputmode="numeric" min="0" max="' + x.roles[r] + '" placeholder="0" data-trrole="' + esc(r) + '" class="tr-n"></div>';
      }).join('') + '</div>' +
      '<p class="hint" style="margin:8px 0">The recorder of the other line gets a request and must accept it.</p>' +
      '<button class="btn primary big" id="tr-save">Send transfer</button>';
    S.sheet.open(S.shortLine(x.dept) + ' · transfer manpower', html);
    var c = $('#sheet-content');
    function split() { var s = trSplit(Number($('#tr-hour').value)); $('#tr-split').innerHTML = 'They work <b>' + s.before + ' hrs</b> on ' + esc(S.shortLine(x.dept)) + ' and <b>' + s.after + ' hrs</b> on the new line'; }
    split(); c.onchange = function (e) { if (e.target.id === 'tr-hour') split(); };
    c.onclick = function (e) {
      if (!e.target.closest('#tr-save')) return;
      var to = $('#tr-to').value, hour = Number($('#tr-hour').value), items = [], bad = '';
      S.$$('.tr-n', c).forEach(function (i) { var v = String(i.value).trim(), n = Number(v || 0); if (v && (!/^\d+$/.test(v))) bad = 'How many — enter a whole number'; else if (n > (x.roles[i.dataset.trrole] || 0)) bad = 'Only ' + x.roles[i.dataset.trrole] + ' ' + i.dataset.trrole + ' on this line'; else if (n > 0) items.push({ role: i.dataset.trrole, count: n }); });
      if (!to) { S.toast('Select the line to transfer to', 'bad'); return; }
      if (bad) { S.toast(bad, 'bad'); return; }
      if (!items.length) { S.toast('Enter how many people to transfer', 'bad'); return; }
      var total = items.reduce(function (t, i) { return t + i.count; }, 0);
      S.ask('Transfer ' + total + (total > 1 ? ' people' : ' person') + ' from ' + S.shortLine(x.dept) + ' to ' + S.shortLine(to) + ' from ' + hourLabel(hour) + '?', { ok: 'Send transfer', cancel: 'Cancel' }).then(function (ok) {
        if (!ok) return;
        S.api('m.trCreate', { date: state.date, factory: state.factory, from_dept: x.dept, to_dept: to, hour: hour, items: items }, { busy: true })
          .then(function (r) { S.sheet.close(); if (r.sheetError) S.toast(r.sheetError, 'bad', 9000); else S.toast('Transfer sent — waiting for ' + S.shortLine(to) + ' to accept', 'ok', 6000); loadAttList(); })
          .catch(function (er) { S.toast(er.message, 'bad', 7000); });
      });
    };
  }
  function trDecide(id, action) {
    var t = PA.incoming.filter(function (i) { return i.id === id; })[0]; if (!t) return;
    var msg = action === 'accept' ? 'Accept ' + t.total + (t.total > 1 ? ' people' : ' person') + ' from ' + S.shortLine(t.from) + ' on ' + S.shortLine(t.to) + ' from ' + hourLabel(t.hour) + '?' : 'Reject this transfer? The people stay on ' + S.shortLine(t.from) + '.';
    S.ask(msg, { ok: action === 'accept' ? 'Accept' : 'Reject', cancel: 'Cancel', danger: action !== 'accept' }).then(function (ok) {
      if (!ok) return;
      S.api('m.trDecide', { id: id, decision: action }, { busy: true })
        .then(function (r) { if (r.sheetError) S.toast(r.sheetError, 'bad', 9000); else S.toast(action === 'accept' ? 'Accepted · added to ' + S.shortLine(t.to) + ' from ' + hourLabel(t.hour) : 'Transfer rejected', 'ok', 6000); loadAttList(); })
        .catch(function (er) { S.toast(er.message, 'bad', 7000); loadAttList(); });
    });
  }

  // "Update attendance": mark absent / half day for a manpower type of the line (half day asks the hours worked)
  S.phoneLineFilled = function (dept) { return PA.items.some(function (i) { return i.dept === dept && !i.fromSheet; }); };
  var EV_NAME = { ABSENT: 'absent', HALF_DAY: 'half day', LEFT_AT: 'left early', LATE_JOIN: 'came late', EXTRA: 'extra', TRANSFER_OUT: 'transferred out', TRANSFER_IN: 'transferred in', LINE_CLOSED: 'line closed' };
  function updSheet(x) {
    if (!x) return;
    var roles = Object.keys(x.roles || {}).filter(function (r) { return x.roles[r] > 0; });
    var hrs = [1, 1.5, 2, 2.5, 3, 3.5, 4, 4.5, 5, 5.5, 6, 6.5, 7, 7.5];
    var html = '<label>Manpower type</label><select id="u-role">' + roles.map(function (r) { return '<option value="' + esc(r) + '">' + esc(r) + ' (' + x.roles[r] + ' people)</option>'; }).join('') + '</select>' +
      '<div class="upd-box hd"><div class="t">Half day</div><div class="row">' +
        '<div class="field"><label>How many</label><input id="u-hd" type="number" inputmode="numeric" min="0" placeholder="0"></div>' +
        '<div class="field"><label>Working hour</label><select id="u-hours">' + hrs.map(function (h) { return '<option value="' + h + '"' + (h === 4 ? ' selected' : '') + '>' + h + ' hrs</option>'; }).join('') + '</select></div></div></div>' +
      '<div class="upd-box ab"><div class="t">Absent</div><div class="field"><label>How many</label><input id="u-ab" type="number" inputmode="numeric" min="0" placeholder="0"></div></div>' +
      (x.inSheet ? '<p class="hint" style="margin:0 0 8px">This attendance is in the main sheet — on Save the <b>main sheet is updated</b>. HR status stays as it is.</p>' : '') +
      '<button class="btn primary big" id="u-save">' + 'Save' + '</button>';
    if ((x.events || []).length) html += '<label style="margin-top:14px">Updates on this date</label><div class="list">' + x.events.map(function (e) {
      return '<div class="item"><div><div class="name">' + e.count + ' ' + esc(e.role) + ' · ' + esc(EV_NAME[e.event] || e.event) + '</div><div class="sub">' + (e.event === 'HALF_DAY' ? e.hours + ' hrs worked' : e.time ? esc(e.time) : '') + '</div></div>' + (e.id ? '<button class="btn danger small" data-del="' + esc(e.id) + '">✕</button>' : '') + '</div>';
    }).join('') + '</div>';
    S.sheet.open(S.shortLine(x.dept) + ' · update attendance', html);
    var c = $('#sheet-content');
    c.onclick = function (e) {
      var b = e.target.closest('button'); if (!b) return;
      if (b.dataset.del) { S.ask('Remove this update?', { danger: true, ok: 'Remove' }).then(function (ok) { if (ok) S.api('manpower.delete', { id: b.dataset.del }).then(function () { S.sheet.close(); S.toast('Removed', 'ok'); loadAttList(); }).catch(function (er) { S.toast(er.message, 'bad'); }); }); return; }
      if (b.id !== 'u-save') return;
      var role = $('#u-role').value, hd = Number($('#u-hd').value || 0), ab = Number($('#u-ab').value || 0), max = (x.roles || {})[role] || 0;
      if (hd < 0 || ab < 0 || Math.floor(hd) !== hd || Math.floor(ab) !== ab) { S.toast('How many — enter a whole number', 'bad'); return; }
      if (!hd && !ab) { S.toast('Enter how many for half day or absent', 'bad'); return; }
      if (hd + ab > max) { S.toast('Only ' + max + ' ' + role + ' on this line (half day + absent = ' + (hd + ab) + ')', 'bad'); return; }
      var msg = [];
      if (hd) msg.push(hd + ' half day (' + $('#u-hours').value + ' hrs)');
      if (ab) msg.push(ab + ' absent');
      // shown at once, sent in the background (phone.js outbox)
      S.pd.send('m.attUpd', { date: state.date, factory: state.factory, dept: x.dept, role: role, halfDay: hd, hours: Number($('#u-hours').value), absent: ab },
                { dept: x.dept, date: state.date, shift: 'Final', kind: 'upd', label: role + ': ' + msg.join(', ') });
      S.sheet.close(); S.toast(role + ': ' + msg.join(', ') + ' ✓', 'ok');
    };
  }

  $('#matt-body').addEventListener('change', function (e) {
    if (e.target.id === 'pa-date') { var v = e.target.value; if (v && v <= S.todayStr()) S.setDate(v); else e.target.value = state.date; return; }
    if (e.target.id === 'pa-line' && e.target.value) { var dept = e.target.value; e.target.value = ''; S.openAttendance('Final', dept); }
  });

  // phone: the same list is the Attendance tab
  S.tabs.matt = function () { AL.box = '#matt-body'; AL.shift = 'Final'; loadAttList(); };
  function attListClick(e) {
    var b = e.target.closest('button'); if (!b) return;
    if (b.dataset.same) { saveSame(b.dataset.same); return; }
    if (b.dataset.sameall) { S.ask('Baaki sab lines ki attendance kal jaisi save karein?', { ok: 'Haan, sab same' }).then(function (ok) { if (!ok) return; var list = AL.items.filter(function (x) { return !x.today && x.prev; }).map(function (x) { return x.dept; }); var seq = Promise.resolve(); list.forEach(function (dept) { seq = seq.then(function () { return saveSame(dept, true); }); }); seq.then(function () { S.invalidateAll(); S.clearLocalCaches(); loadAttList(); }); }); return; }
    if (b.dataset.edit) { S.openAttendance(AL.shift, b.dataset.edit); return; }
    if (b.dataset.wa) {
      if (phone() && PA.wa) { var txt = S.waAttendanceText(PA.wa, 'Final'); if (txt) S.shareText('Send attendance to group', txt); else S.toast('No attendance filled yet', 'bad'); return; }
      S.sendToGroup(b.dataset.wa); return;
    }
    if (b.dataset.retry) { box().innerHTML = '<div class="empty">Loading…</div>'; S.pd.load(false).catch(attFail); return; }
    if (b.dataset.setsam) {
      var srn = b.dataset.setsam;
      S.askText(S.tx(srn + ' ka SAM (making, minute per piece)', 'SAM of ' + srn + ' (making, minutes per piece)'), { ok: 'Save' }).then(function (v) {
        var n = Number(v); if (!v) return; if (!(n > 0)) { S.toast(S.tx('SAM minute me daalo (jaise 12.5)', 'Enter SAM in minutes (e.g. 12.5)'), 'bad'); return; }
        S.api('target.sam', { srn: srn, sam: n }).then(function () { S.samMap = S.samMap || {}; S.samMap[srn.toUpperCase()] = n; S.toast(S.tx(srn + ' ka SAM ' + n + ' saved', 'SAM of ' + srn + ' saved: ' + n), 'ok'); if (phone()) renderPhoneAtt(); else renderAttList(); }).catch(function (er) { S.toast(er.message, 'bad'); });
      });
      return;
    }
    if (b.dataset.ot) { var xo = PA.items.filter(function (i) { return i.dept === b.dataset.ot; })[0]; S.openAttendance(xo && !xo.ot && xo.night ? 'Night' : 'OT', b.dataset.ot); return; }
    if (b.dataset.chg) { S.openAttendance('Final', b.dataset.chg, { change: true }); return; }
    if (b.dataset.upd) { updSheet(PA.items.filter(function (i) { return i.dept === b.dataset.upd; })[0]); return; }
    if (b.dataset.tr) { trSheet(PA.items.filter(function (i) { return i.dept === b.dataset.tr; })[0]); return; }
    if (b.dataset.trok) { trDecide(b.dataset.trok, 'accept'); return; }
    if (b.dataset.trno) { trDecide(b.dataset.trno, 'reject'); return; }
    if (b.dataset.resend) { S.pd.resend(b.dataset.resend); S.toast('Sending again…', ''); return; }
    if (b.dataset.day) { S.setDate(b.dataset.day); return; }
    if (b.dataset.mp) {
      var all = PA.items.filter(function (x) { return !x.fromSheet; }).map(function (x) { return { dept: x.dept }; });
      S.mpSheet({ dept: b.dataset.mp }, all, function () { loadAttList(); }, true);
      return;
    }
  }
  $('#attlist-body').addEventListener('click', attListClick);
  $('#matt-body').addEventListener('click', attListClick);
  
  // "Koi gaya / aaya?" — pick the line, then the manpower change sheet (same one the hour screen uses)
  function mpQuick() {
    var d = S.factoryData(); if (!d) { S.loadFactory().then(mpQuick); return; }
    var lines = d.depts.filter(function (x) { return d.att[x.dept + '|Final']; });
    if (!lines.length) { S.toast('Pehle attendance bharo', 'bad'); return; }
    S.sheet.open('Kis line par?', '<div class="chips" style="flex-wrap:wrap">' + lines.map(function (x) { return '<button data-l="' + esc(x.dept) + '">' + esc(S.shortLine(x.dept)) + '<small>' + (d.mpNow && d.mpNow[x.dept] !== undefined ? d.mpNow[x.dept] + ' log abhi' : '') + '</small></button>'; }).join('') + '</div>' +
      '<p class="hint">Transfer (dusre recorder ko log dena) bhi yahin se.</p>');
    $('#sheet-content').onclick = function (e) {
      var b = e.target.closest('[data-l]'); if (!b) return;
      var dept = b.dataset.l; S.sheet.close();
      S.sheet.open(S.shortLine(dept), '<div class="chips" style="flex-wrap:wrap"><button data-do="mp">Koi gaya / late aaya / line band</button><button data-do="tr">Transfer dusri line ko</button></div>');
      $('#sheet-content').onclick = function (ev) {
        var x = ev.target.closest('[data-do]'); if (!x) return;
        var slot = S.slots('Final').filter(function (s) { var st = S.slotStart(s.key); return S.nowHour() >= st && S.nowHour() < st + 1; })[0] || S.slots('Final')[0];
        S.sheet.close();
        S.api('hour.get', { date: state.date, factory: state.factory, slot: slot.key }, { quiet: true }).then(function (h) {
          var dd = h.depts.filter(function (q) { return q.dept === dept; })[0]; if (!dd) { S.toast('Line nahi mili', 'bad'); return; }
          if (x.dataset.do === 'mp') S.mpSheet(dd, h.depts, function () { S.invalidateAll(); S.refresh(); });
          else S.trSheet(dd, function () { S.invalidateAll(); S.refresh(); });
        }).catch(function (er) { S.toast(er.message, 'bad'); });
      };
    };
  }
  S.mpQuick = mpQuick;

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

  $('#tab-home').addEventListener('click', function (e) { var el = e.target.closest('[data-go]'); if (el) S.go(el.dataset.go); });

  S.go = function (go) {
    var p = go.split(':');
    if (go === 'ctx') S.openContext();
    else if (go === 'retry') { S.invalidateAll(); S.refresh(); }
    else if (go === 'data') S.tab('data');
    else if (go === 'reports') S.tab('reports');
    else if (p[0] === 'day') S.setDate(p[1]);
    else if (go === 'main') S.tab('main');
    else if (p[0] === 'attlist') S.screens.attlist(p[1] || 'Final');
    else if (p[0] === 'wa') S.sendToGroup(p[1] || 'Final');
    else if (p[0] === 'transfer') transferSheet(p[1]);
    else if (go === 'noop') return;
    else if (p[0] === 'att') S.openAttendance(p[1]);
    else if (p[0] === 'hour') S.screens.wiz(p[1], p[2]);
    else if (p[0] === 'wiz') S.screens.wiz(p[1], p[2]);
    else if (go === 'grid') S.tab('grid');
    else if (go === 'mpq') mpQuick();
    else if (p[0] === 'hourold') S.screens.hour(p[1], p[2]);
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
