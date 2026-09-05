// HourBatch.js — one hour, whole factory: read every line's rows for a slot and save them all in one call.
// Also the factory-level "today" view that feeds the Home timeline.

// SRN options for a dept/type with limits and balances (shared with orders.active)
function srnOptions_(L, dept, type) {
  var list = [];
  if (type === 'PACKING') {
    var seen = {};
    [L.srnInfo, L.endPassSrn, L.packed].forEach(function(m) { Object.keys(m || {}).forEach(function(k) { seen[k] = true; }); });
    Object.keys(seen).forEach(function(srn) {
      if (!/^SRN/i.test(srn)) return;
      var pass = num_(L.endPassSrn[srn]), packed = num_(L.packed[srn]);
      var info = L.srnInfo[srn] || {};
      list.push({ srn: srn, item: info.item || '', limit: pass, used: packed, balance: pass ? pass - packed : null, endline: pass > 0 });
    });
    list.sort(function(a, b) { return b.srn.localeCompare(a.srn); });
    return list;
  } else {
    Object.keys(L.deptSrns[dept] || {}).forEach(function(srn) {
      var loaded = num_(L.loaded[k2_(dept, srn)]), stitched = num_(L.stitched[k2_(dept, srn)]), checked = num_(L.endChecked[k2_(dept, srn)]);
      var info = L.srnInfo[srn] || {};
      var limit = type === 'STITCH' ? loaded : stitched, used = type === 'STITCH' ? stitched : checked;
      if (type === 'ENDLINE' && !stitched) return;
      list.push({ srn: srn, item: info.item || '', limit: limit, used: used, balance: limit - used });
    });
  }
  list.sort(function(a, b) { return b.balance - a.balance || a.srn.localeCompare(b.srn); });
  return list;
}

function writableDepts_(user, factory) {
  return mastersRows_().filter(function(r) {
    return str_(r.type) === 'DEPT' && isTrue_(r.active) && str_(r.factory) === factory &&
           CFG.ACTIVE_CATS.indexOf(str_(r.extra)) >= 0 && canWrite_(user, factory, str_(r.key));
  }).map(function(r) { return { dept: str_(r.key), cat: str_(r.extra) }; });
}

// SRN chosen at attendance time, per dept (Final shift first, then OT)
function attSrnMap_(date, factory) {
  var m = {};
  readDaily_(CFG.TABS.ATT_DAILY).forEach(function(r) {
    if (str_(r.date) !== date || str_(r.factory) !== factory || !str_(r.srn)) return;
    var d = str_(r.dept);
    if (!m[d] || str_(r.shift) === 'Final') m[d] = str_(r.srn);
  });
  return m;
}

function statusMap_(date, factory) {
  var m = {}, order = ['Sent', 'Approved', 'Submitted', 'Rejected', 'Draft'];
  readDaily_(CFG.TABS.DAY_SUMMARY).forEach(function(r) {
    if (str_(r.date) !== date || str_(r.factory) !== factory) return;
    var k = str_(r.dept) + '|' + str_(r.type), s = str_(r.status);
    if (!m[k] || order.indexOf(s) < order.indexOf(m[k])) m[k] = s;
  });
  return m;
}

// { date, factory, slot } -> everything the "Update output" screen needs for every line/dept
function hourGet_(req, user) {
  var date = str_(req.date), factory = str_(req.factory), slot = str_(req.slot);
  if (!isDateStr_(date)) return fail_('DATE', 'Date galat');
  if (!slotDef_(slot)) return fail_('SLOT', 'Slot galat');
  var L = ledger_();
  var st = statusMap_(date, factory), attSrn = attSrnMap_(date, factory);
  var attRows = readDaily_(CFG.TABS.ATT_DAILY).filter(function(r) { return str_(r.date) === date && str_(r.factory) === factory; });
  var hasAtt = {}; attRows.forEach(function(r) { hasAtt[str_(r.dept)] = true; });
  // only lines / floors whose attendance was entered that day
  var depts = writableDepts_(user, factory).filter(function(d) { return (d.cat === 'STITCH' || d.cat === 'PACKING') && hasAtt[d.dept]; });
  var events = readDaily_(CFG.TABS.MANPOWER_EVENTS).filter(function(r) { return str_(r.date) === date && str_(r.factory) === factory; });

  var rowsBy = {}, lastSrn = {}, lastChecker = {}, lastFloor = {};
  readDaily_(CFG.TABS.HOURLY_LOG).forEach(function(r) {
    if (str_(r.date) !== date || str_(r.factory) !== factory) return;
    var dept = str_(r.dept), t = str_(r.type), at = str_(r.entered_at);
    var lk = dept + '|' + t;
    if (!lastSrn[lk] || lastSrn[lk].at < at) lastSrn[lk] = { srn: str_(r.srn), at: at };
    if (t === 'ENDLINE' && str_(r.checker) && (!lastChecker[dept] || lastChecker[dept].at < at)) lastChecker[dept] = { v: str_(r.checker), at: at };
    if (str_(r.floor) && (!lastFloor[dept] || lastFloor[dept].at < at)) lastFloor[dept] = { v: str_(r.floor), at: at };
    if (str_(r.slot) !== slot) return;
    if (!rowsBy[lk]) rowsBy[lk] = [];
    rowsBy[lk].push({ srn: str_(r.srn), qty: num_(r.qty), checked: num_(r.checked), pass: num_(r.pass), reject: num_(r.reject), cartons: num_(r.cartons), checker: str_(r.checker), by: str_(r.entered_by) });
  });
  var lineFloor = masterMap_('LINE_FLOOR');

  var out = depts.map(function(d) {
    var types = d.cat === 'STITCH' ? ['STITCH', 'ENDLINE'] : ['PACKING'];
    var o = { dept: d.dept, cat: d.cat, srns: {}, rows: {}, lastSrn: {}, locked: {}, attSrn: attSrn[d.dept] || '',
              mp: mpAtSlot_(attRows, events, d.dept, slot), mpBase: attRows.filter(function(r) { return str_(r.dept) === d.dept && str_(r.shift) === 'Final'; }).reduce(function(t, r) { return t + num_(r.count); }, 0),
              checker: lastChecker[d.dept] ? lastChecker[d.dept].v : '',
              floor: lastFloor[d.dept] ? lastFloor[d.dept].v : (lineFloor[d.dept] ? lineFloor[d.dept].value : '') };
    types.forEach(function(t) {
      o.srns[t] = srnOptions_(L, d.dept, t);
      o.rows[t] = rowsBy[d.dept + '|' + t] || [];
      // default SRN: what attendance said the line is running today, else the last one used
      o.lastSrn[t] = attSrn[d.dept] || (lastSrn[d.dept + '|' + t] ? lastSrn[d.dept + '|' + t].srn : '');
      var s = st[d.dept + '|' + t]; if (isLocked_(s)) o.locked[t] = s;
    });
    return o;
  });
  return { ok: true, slot: slot, shift: slotDef_(slot).shift, depts: out };
}

// Core upsert used by hourly.slot and the batch. ctx = { L, rows } shared across a batch so cumulative checks stay right.
function slotUpsert_(p, user, ctx) {
  var date = str_(p.date), factory = str_(p.factory), type = str_(p.type), dept = str_(p.dept), srn = str_(p.srn), slot = str_(p.slot);
  if (!typeDef_(type)) return fail_('TYPE', 'Type galat');
  var sd = slotDef_(slot); if (!sd) return fail_('SLOT', 'Slot galat');
  if (!dept || !srn) return fail_('KEY', 'SRN chuno');
  if (!canWrite_(user, factory, dept)) return fail_('PERM', 'Permission nahi');
  var status = ctx.status[dept + '|' + type] || '';
  if (isLocked_(status)) return fail_('LOCKED', status + ' hai — edit band');

  var row = { qty: 0, checked: 0, pass: 0, reject: 0, cartons: 0, pcs_per_ctn: 0 };
  if (type === 'ENDLINE') {
    row.checked = num_(p.checked); row.pass = num_(p.pass); row.reject = num_(p.reject);
    if (row.checked < 0 || row.pass < 0 || row.reject < 0) return fail_('VAL', 'Negative nahi chalega');
    if (row.pass + row.reject > row.checked) return fail_('VAL', 'Pass + reject checked se zyada');
    if (row.checked && !str_(p.checker)) return fail_('VAL', 'Checker ka naam likho');
  } else {
    row.qty = num_(p.qty);
    if (row.qty < 0) return fail_('VAL', 'Negative nahi chalega');
    if (type === 'PACKING') { row.cartons = num_(p.cartons); row.pcs_per_ctn = row.cartons ? Math.round(row.qty / row.cartons) : 0; }
  }
  var newAmt = type === 'ENDLINE' ? row.checked : row.qty;
  var key = [date, factory, type, dept, srn].join('|');
  var existing = ctx.rows.filter(function(r) { return hourlyKey_(r) === key && str_(r.slot) === slot; });
  var oldAmt = 0; existing.forEach(function(r) { oldAmt += type === 'ENDLINE' ? num_(r.checked) : num_(r.qty); });
  if (newAmt === oldAmt && !existing.length) return { ok: true, skipped: true };

  var chk = chainCheck_(ctx.L, type, dept, srn, newAmt - oldAmt);
  if (!chk.ok) return { ok: false, error: 'CHAIN', message: chk.msg, limit: chk.limit, used: chk.used };

  var stamp = nowStr_();
  var floor = str_(p.floor) || (existing.length ? str_(existing[0].floor) : '');
  deleteRows_(CFG.TABS.HOURLY_LOG, existing.map(function(r) { return r._row; }));
  ctx.rows = ctx.rows.filter(function(r) { return existing.indexOf(r) < 0; });
  // sheet rows above the deleted ones keep their numbers; rows below shift up
  var delRows = existing.map(function(r) { return r._row; }).sort(function(a, b) { return a - b; });
  ctx.rows.forEach(function(r) { var shift = 0; delRows.forEach(function(d) { if (r._row > d) shift++; }); r._row -= shift; });
  if (newAmt > 0) {
    var nr = { id: uuid_(), date: date, factory: factory, line: lineOf_(dept), dept: dept, srn: srn, floor: floor, type: type,
      shift: sd.shift, slot: slot, qty: row.qty, checked: row.checked, pass: row.pass, reject: row.reject, cartons: row.cartons,
      pcs_per_ctn: row.pcs_per_ctn, checker: str_(p.checker), entered_by: userName_(user), entered_at: stamp };
    appendRows_(CFG.TABS.HOURLY_LOG, [nr]);
    nr._row = tab_(CFG.TABS.HOURLY_LOG, true).getLastRow();
    ctx.rows.push(nr);
  }
  // keep the in-memory ledger in step for the next item of the batch
  var delta = newAmt - oldAmt;
  if (type === 'STITCH') addTo_(ctx.L.stitched, k2_(dept, srn), delta);
  else if (type === 'ENDLINE') { addTo_(ctx.L.endChecked, k2_(dept, srn), delta); var pd = row.pass - existing.reduce(function(t, r) { return t + num_(r.pass); }, 0); addTo_(ctx.L.endPass, k2_(dept, srn), pd); addTo_(ctx.L.endPassSrn, srn, pd); }
  else addTo_(ctx.L.packed, srn, delta);
  if (status === 'Rejected') { setDayStatus_(date, factory, dept, type, 'Draft', user, 'Re-entered after reject'); ctx.status[dept + '|' + type] = 'Draft'; }
  return { ok: true, amount: newAmt, balance: chk.balance, limit: chk.limit, at: stamp };
}

function batchCtx_(date, factory) {
  return { L: ledger_(), rows: readDaily_(CFG.TABS.HOURLY_LOG), status: statusMap_(date, factory) };
}

// { date, factory, slot, items: [{type, dept, srn, qty|checked,pass,reject,checker|qty,cartons, floor}] }
function hourSave_(req, user) {
  var date = str_(req.date), factory = str_(req.factory), slot = str_(req.slot);
  if (!isDateStr_(date)) return fail_('DATE', 'Date galat');
  if (CFG.FACTORIES.indexOf(factory) < 0) return fail_('FACTORY', 'Factory galat');
  if (!slotDef_(slot)) return fail_('SLOT', 'Slot galat');
  var items = Array.isArray(req.items) ? req.items : [];
  if (!items.length) return fail_('EMPTY', 'Kuch bhara nahi');
  var results = [], saved = 0, failed = 0;
  withLock_(function() {
    var ctx = batchCtx_(date, factory);
    items.forEach(function(it) {
      var p = Object.assign({}, it, { date: date, factory: factory, slot: slot });
      var r;
      try { r = slotUpsert_(p, user, ctx); } catch (e) { r = fail_('ERR', String(e && e.message || e)); }
      if (r.ok && !r.skipped) saved++; else if (!r.ok) failed++;
      results.push({ type: str_(it.type), dept: str_(it.dept), srn: str_(it.srn), ok: r.ok, skipped: !!r.skipped, message: r.message || '', balance: r.balance });
    });
  });
  invalidateAppAgg_();
  audit_(user, 'hour.save', date + '|' + factory + '|' + slot, { saved: saved, failed: failed });
  return { ok: true, saved: saved, failed: failed, results: results };
}

// { date, factory } -> factory-wide picture for the Home timeline
function factoryToday_(req, user) {
  var date = str_(req.date), factory = str_(req.factory);
  if (!isDateStr_(date)) return fail_('DATE', 'Date galat');
  var depts = writableDepts_(user, factory);
  var att = {}, attSrn = {}, attRoles = {};
  readDaily_(CFG.TABS.ATT_DAILY).forEach(function(r) {
    if (str_(r.date) !== date || str_(r.factory) !== factory) return;
    var k = str_(r.dept) + '|' + str_(r.shift);
    att[k] = (att[k] || 0) + num_(r.count);
    if (!attRoles[k]) attRoles[k] = {}; attRoles[k][str_(r.role)] = (attRoles[k][str_(r.role)] || 0) + num_(r.count);
    if (str_(r.srn) && (str_(r.shift) === 'Final' || !attSrn[str_(r.dept)])) attSrn[str_(r.dept)] = str_(r.srn);
  });
  var slots = {};
  readDaily_(CFG.TABS.HOURLY_LOG).forEach(function(r) {
    if (str_(r.date) !== date || str_(r.factory) !== factory) return;
    var sk = str_(r.slot), t = str_(r.type), dept = str_(r.dept);
    if (!slots[sk]) slots[sk] = { STITCH: {}, ENDLINE: {}, PACKING: {} };
    var amt = t === 'ENDLINE' ? num_(r.pass) : num_(r.qty);
    slots[sk][t][dept] = (slots[sk][t][dept] || 0) + amt;
  });
  var evRows = readDaily_(CFG.TABS.MANPOWER_EVENTS).filter(function(r) { return str_(r.date) === date && str_(r.factory) === factory; });
  var events = evRows.length;
  var eventList = evRows.map(function(r) { return { dept: str_(r.dept), role: str_(r.role), event: str_(r.event), count: num_(r.count), time: str_(r.time), eff_hours: num_(r.eff_hours), note: str_(r.note), by: str_(r.entered_by) }; });
  // manpower right now per dept (attendance + events up to the current hour)
  var attRowsAll = readDaily_(CFG.TABS.ATT_DAILY).filter(function(r) { return str_(r.date) === date && str_(r.factory) === factory; });
  var nowH = new Date(Utilities.formatDate(new Date(), tz_(), "yyyy/MM/dd HH:mm:ss")).getHours();
  var nowKey = ('0' + nowH).slice(-2) + '-' + ('0' + ((nowH + 1) % 24)).slice(-2), mpNow = {};
  depts.forEach(function(d) { mpNow[d.dept] = mpAtSlot_(attRowsAll, evRows, d.dept, nowKey); });
  var pending = 0;
  if (user.role === 'Admin') readDaily_(CFG.TABS.DAY_SUMMARY).forEach(function(r) { if (str_(r.status) === 'Submitted' && str_(r.factory) === factory) pending++; });
  var mine = {}; depts.forEach(function(d) { mine[d.dept] = true; });
  var transfers = { incoming: [], outgoing: [] };
  readDaily_(CFG.TABS.TRANSFERS).forEach(function(r) {
    if (str_(r.date) !== date || str_(r.factory) !== factory || str_(r.status) !== 'Pending') return;
    var t = { id: str_(r.id), from_dept: str_(r.from_dept), to_dept: str_(r.to_dept), role: str_(r.role), count: num_(r.count), time: str_(r.time), note: str_(r.note), by: str_(r.by) };
    if (mine[t.to_dept]) transfers.incoming.push(t);
    if (mine[t.from_dept]) transfers.outgoing.push(t);
  });
  // earlier days (last 4) that have attendance for my lines but were never closed -> the recorder can still update them
  var openDays = [], mineMap = {}; depts.forEach(function(d) { mineMap[d.dept] = true; });
  var stAll = {}; readDaily_(CFG.TABS.DAY_SUMMARY).forEach(function(r) { if (str_(r.factory) !== factory || !mineMap[str_(r.dept)]) return; if (isLocked_(str_(r.status))) stAll[str_(r.date) + '|' + str_(r.dept)] = true; });
  var attByDay = {}; readDaily_(CFG.TABS.ATT_DAILY).forEach(function(r) { if (str_(r.factory) !== factory || !mineMap[str_(r.dept)] || str_(r.date) >= todayStr_()) return; (attByDay[str_(r.date)] = attByDay[str_(r.date)] || {})[str_(r.dept)] = true; });
  var cutoffD = fmtDate_(new Date(new Date().getTime() - 4 * 86400000));
  Object.keys(attByDay).sort().forEach(function(dd) {
    if (dd < cutoffD) return;
    var open = Object.keys(attByDay[dd]).filter(function(dept) { return !stAll[dd + '|' + dept]; });
    if (open.length) openDays.push({ date: dd, lines: open.length });
  });
  return { ok: true, depts: depts, att: att, attSrn: attSrn, attRoles: attRoles, slots: slots, statuses: statusMap_(date, factory), events: events, eventList: eventList, mpNow: mpNow, pending: pending, transfers: transfers, openDays: openDays, serverTime: nowStr_() };
}

// ---------- manpower transfer between lines / floors ----------

// { date, factory, from_dept, to_dept, role, count, time, note }
function transferCreate_(req, user) {
  var date = str_(req.date), factory = str_(req.factory), from = str_(req.from_dept), to = str_(req.to_dept);
  var role = str_(req.role), count = num_(req.count), time = str_(req.time), note = str_(req.note);
  if (!isDateStr_(date)) return fail_('DATE', 'Date galat');
  if (!from || !to || from === to) return fail_('VAL', 'Kahan se, kahan — dono chuno');
  if (!role || count < 1) return fail_('VAL', 'Role aur count chahiye');
  if (!/^\d{1,2}:\d{2}$/.test(time)) return fail_('VAL', 'Time HH:MM');
  if (!canWrite_(user, factory, from)) return fail_('PERM', 'Is line ki permission nahi');
  if (isLocked_(dayStatus_(date, factory, from, 'ATT'))) return fail_('LOCKED', 'Attendance submit ho chuki');
  var id = uuid_(), stamp = nowStr_();
  withLock_(function() {
    appendRows_(CFG.TABS.TRANSFERS, [{ id: id, date: date, factory: factory, from_dept: from, to_dept: to, role: role, count: count, time: time, srn: '',
      status: 'Pending', note: note, by: userName_(user), at: stamp, decided_by: '', decided_at: '' }]);
    // the people have left the sending line right away
    appendRows_(CFG.TABS.MANPOWER_EVENTS, [{ id: uuid_(), date: date, factory: factory, dept: from, role: role, event: 'TRANSFER_OUT', count: count, time: time,
      eff_hours: effHours_('TRANSFER_OUT', time), note: 'transfer:' + id + ' → ' + to, entered_by: userName_(user), entered_at: stamp }]);
  });
  audit_(user, 'transfer.create', id, { from: from, to: to, role: role, count: count });
  return { ok: true, id: id };
}

// { id, action: 'accept'|'reject', srn }
function transferDecide_(req, user) {
  var id = str_(req.id), action = str_(req.action), srn = str_(req.srn);
  var t = readDaily_(CFG.TABS.TRANSFERS).filter(function(r) { return str_(r.id) === id; })[0];
  if (!t) return fail_('NF', 'Transfer nahi mila');
  if (str_(t.status) !== 'Pending') return fail_('VAL', 'Ye transfer pehle se ' + str_(t.status));
  var factory = str_(t.factory), to = str_(t.to_dept), from = str_(t.from_dept), date = str_(t.date);
  if (!canWrite_(user, factory, to)) return fail_('PERM', 'Ye transfer aapki line ka nahi');
  var sh = tab_(CFG.TABS.TRANSFERS, true), head = CFG.HEADERS.TRANSFERS, stamp = nowStr_();
  withLock_(function() {
    if (action === 'accept') {
      appendRows_(CFG.TABS.MANPOWER_EVENTS, [{ id: uuid_(), date: date, factory: factory, dept: to, role: str_(t.role), event: 'TRANSFER_IN', count: num_(t.count), time: str_(t.time),
        eff_hours: effHours_('TRANSFER_IN', str_(t.time)), note: 'transfer:' + id + ' ← ' + from + (srn ? ' · ' + srn : ''), entered_by: userName_(user), entered_at: stamp }]);
    } else {
      // rejected: undo the sending line's TRANSFER_OUT
      var ev = readDaily_(CFG.TABS.MANPOWER_EVENTS).filter(function(r) { return str_(r.event) === 'TRANSFER_OUT' && str_(r.note).indexOf('transfer:' + id) === 0; });
      deleteRows_(CFG.TABS.MANPOWER_EVENTS, ev.map(function(r) { return r._row; }));
    }
    sh.getRange(t._row, head.indexOf('status') + 1).setValue(action === 'accept' ? 'Accepted' : 'Rejected');
    sh.getRange(t._row, head.indexOf('srn') + 1).setValue(srn);
    sh.getRange(t._row, head.indexOf('decided_by') + 1).setValue(userName_(user));
    sh.getRange(t._row, head.indexOf('decided_at') + 1).setValue(stamp);
  });
  invalidateDaily_(CFG.TABS.TRANSFERS);
  audit_(user, 'transfer.' + action, id, { srn: srn });
  return { ok: true };
}

// Manual "refresh everything" (after editing sheets by hand)
function cacheClear_(req, user) { clearAllCaches_(); return { ok: true }; }
