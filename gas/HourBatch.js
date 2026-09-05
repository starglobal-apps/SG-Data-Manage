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

// SRN used in that day's hourly rows per dept (latest entry wins) — fallback when attendance has no SRN
function hourlySrnMap_(date, factory) {
  var m = {}, at = {};
  readDaily_(CFG.TABS.HOURLY_LOG).forEach(function(r) {
    if (str_(r.date) !== date || str_(r.factory) !== factory || !str_(r.srn)) return;
    var d = str_(r.dept), t = str_(r.entered_at);
    if (!at[d] || at[d] < t) { at[d] = t; m[d] = str_(r.srn); }
  });
  return m;
}
// { map: {dept: srn}, from: {dept: 'att' | 'hourly'} }
function daySrnMap_(date, factory) {
  var att = attSrnMap_(date, factory), hr = hourlySrnMap_(date, factory), map = {}, from = {};
  Object.keys(hr).forEach(function(d) { map[d] = hr[d]; from[d] = 'hourly'; });
  Object.keys(att).forEach(function(d) { map[d] = att[d]; from[d] = 'att'; });
  return { map: map, from: from };
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
  var hasAtt = {}, qcOf = {}; attRows.forEach(function(r) { hasAtt[str_(r.dept)] = true; if (str_(r.qc_names)) qcOf[str_(r.dept)] = csv_(r.qc_names); });
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

  var slotStart = Number(slot.split('-')[0]);
  var rowWarn = function(t, dept, srn) {
    if (t === 'ENDLINE') { var over = num_(L.endChecked[k2_(dept, srn)]) - num_(L.stitched[k2_(dept, srn)]); return over > 0 ? 'Endline checked stitching se ' + over + ' zyada' : ''; }
    if (t === 'PACKING') { var lim = num_(L.endPassSrn[srn]), overP = num_(L.packed[srn]) - lim; return !lim ? srn + ' ka endline data nahi' : overP > 0 ? 'Packing endline pass se ' + overP + ' zyada (sab floors)' : ''; }
    return '';
  };
  var out = depts.map(function(d) {
    var types = d.cat === 'STITCH' ? ['STITCH', 'ENDLINE'] : ['PACKING'];
    var cl = lineClose_(events, d.dept);
    var o = { dept: d.dept, cat: d.cat, srns: {}, rows: {}, lastSrn: {}, locked: {}, attSrn: attSrn[d.dept] || '', qcNames: qcOf[d.dept] || [],
              closed: cl && cl.hour <= slotStart + 0.01 ? cl.time : '',
              mp: mpAtSlot_(attRows, events, d.dept, slot), mpBase: attRows.filter(function(r) { return str_(r.dept) === d.dept && str_(r.shift) === 'Final'; }).reduce(function(t, r) { return t + num_(r.count); }, 0),
              checker: lastChecker[d.dept] ? lastChecker[d.dept].v : '',
              floor: lastFloor[d.dept] ? lastFloor[d.dept].v : (lineFloor[d.dept] ? lineFloor[d.dept].value : '') };
    types.forEach(function(t) {
      o.srns[t] = srnOptions_(L, d.dept, t);
      o.rows[t] = (rowsBy[d.dept + '|' + t] || []).map(function(r) { r.warn = rowWarn(t, d.dept, r.srn); return r; });
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
  // endline rows are per checker: two QCs on one line keep separate rows for the same slot
  var existing = ctx.rows.filter(function(r) { return hourlyKey_(r) === key && str_(r.slot) === slot && (type !== 'ENDLINE' || str_(r.checker) === str_(p.checker)); });
  var oldAmt = 0; existing.forEach(function(r) { oldAmt += type === 'ENDLINE' ? num_(r.checked) : num_(r.qty); });
  if (newAmt === oldAmt && !existing.length) return { ok: true, skipped: true };
  // unchanged (same numbers as the one saved row) -> nothing to write
  if (existing.length === 1 && newAmt > 0) {
    var ex = existing[0], same = ['qty', 'checked', 'pass', 'reject', 'cartons'].every(function(f) { return num_(ex[f]) === row[f]; }) && (!str_(p.floor) || str_(ex.floor) === str_(p.floor));
    if (same) return { ok: true, skipped: true, unchanged: true };
  }

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
  return { ok: true, amount: newAmt, balance: chk.balance, limit: chk.limit, at: stamp, warn: chk.level === 'warn' ? chk.msg : '' };
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
      results.push({ type: str_(it.type), dept: str_(it.dept), srn: str_(it.srn), ok: r.ok, skipped: !!r.skipped, unchanged: !!r.unchanged, message: r.message || '', warn: r.warn || '', balance: r.balance });
    });
  });
  invalidateAppAgg_();
  audit_(user, 'hour.save', date + '|' + factory + '|' + slot, { saved: saved, failed: failed });
  return { ok: true, saved: saved, failed: failed, results: results };
}

// { date, factory, dept, items: [{slot, type, srn, qty|checked,pass,reject,checker|qty,cartons, floor}] }
// Data tab edit mode: any number of slots of ONE line/floor, saved together (chain checks share one ledger).
function lineSave_(req, user) {
  var date = str_(req.date), factory = str_(req.factory), dept = str_(req.dept);
  if (!isDateStr_(date)) return fail_('DATE', 'Date galat');
  if (CFG.FACTORIES.indexOf(factory) < 0) return fail_('FACTORY', 'Factory galat');
  if (!dept) return fail_('DEPT', 'Line chuno');
  if (!canWrite_(user, factory, dept)) return fail_('PERM', 'Is line ki permission nahi');
  var items = Array.isArray(req.items) ? req.items : [];
  if (!items.length) return fail_('EMPTY', 'Kuch badla nahi');
  for (var i = 0; i < items.length; i++) if (!slotDef_(str_(items[i].slot))) return fail_('SLOT', 'Slot galat: ' + str_(items[i].slot));
  var results = [], saved = 0, failed = 0;
  withLock_(function() {
    var ctx = batchCtx_(date, factory);
    items.forEach(function(it) {
      var p = Object.assign({}, it, { date: date, factory: factory, dept: dept, slot: str_(it.slot) });
      var r;
      try { r = slotUpsert_(p, user, ctx); } catch (e) { r = fail_('ERR', String(e && e.message || e)); }
      if (r.ok && !r.skipped) saved++; else if (!r.ok) failed++;
      results.push({ slot: p.slot, type: str_(it.type), srn: str_(it.srn), ok: r.ok, skipped: !!r.skipped, message: r.message || '', warn: r.warn || '' });
    });
  });
  invalidateAppAgg_();
  audit_(user, 'line.save', date + '|' + factory + '|' + dept, { saved: saved, failed: failed });
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
  var events = evRows.length, closed = {};
  evRows.forEach(function(r) { if (str_(r.event) === 'LINE_CLOSED') closed[str_(r.dept)] = { time: str_(r.time), hour: eventHour_(r) }; });
  var daySrn = daySrnMap_(date, factory);
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
    if (str_(r.factory) !== factory || str_(r.status) !== 'Pending') return;
    var its = parseJsonArr_(r.items); if (!its.length && str_(r.role)) its = [{ role: str_(r.role), count: num_(r.count) }];
    var t = { id: str_(r.id), date: str_(r.date), from_dept: str_(r.from_dept), to_user: str_(r.to_user), role: str_(r.role), count: num_(r.count), items: its, time: str_(r.time), note: str_(r.note), by: str_(r.by) };
    if (t.to_user === user.user_id) transfers.incoming.push(t);           // waiting for ME to place them (any day)
    else if (str_(r.date) === date && mine[t.from_dept]) transfers.outgoing.push(t);
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
  return { ok: true, depts: depts, att: att, attSrn: attSrn, daySrn: daySrn.map, srnFrom: daySrn.from, closed: closed, attRoles: attRoles, slots: slots, statuses: statusMap_(date, factory), events: events, eventList: eventList, mpNow: mpNow, pending: pending, transfers: transfers, openDays: openDays, serverTime: nowStr_() };
}

// ---------- manpower transfer: my line/floor -> another data recorder (who then places them on their lines) ----------

// { date, factory, from_dept, to_user, items: [{role, count}], time, note }
function transferCreate_(req, user) {
  var date = str_(req.date), factory = str_(req.factory), from = str_(req.from_dept), toUser = str_(req.to_user), time = str_(req.time), note = str_(req.note);
  var items = (Array.isArray(req.items) ? req.items : []).map(function(x) { return { role: str_(x.role), count: num_(x.count) }; }).filter(function(x) { return x.role && x.count > 0; });
  if (!isDateStr_(date)) return fail_('DATE', 'Date galat');
  if (!from || !toUser) return fail_('VAL', 'Line aur recorder dono chuno');
  if (!items.length) return fail_('VAL', 'Kam se kam ek role ki qty daalo');
  if (!/^\d{1,2}:\d{2}$/.test(time)) return fail_('VAL', 'Time HH:MM');
  if (!canWrite_(user, factory, from)) return fail_('PERM', 'Is line ki permission nahi');
  if (isLocked_(dayStatus_(date, factory, from, 'ATT'))) return fail_('LOCKED', 'Attendance submit ho chuki');
  var target = usersRows_().filter(function(u) { return str_(u.user_id) === toUser && isTrue_(u.active); })[0];
  if (!target) return fail_('VAL', 'Recorder nahi mila');
  if (toUser === user.user_id) return fail_('VAL', 'Apne aap ko transfer nahi');
  var total = items.reduce(function(t, x) { return t + x.count; }, 0);
  var id = uuid_(), stamp = nowStr_();
  withLock_(function() {
    appendRows_(CFG.TABS.TRANSFERS, [{ id: id, date: date, factory: factory, from_dept: from, to_dept: '', role: items.length === 1 ? items[0].role : '', count: total, time: time, srn: '',
      status: 'Pending', note: note, by: userName_(user), at: stamp, decided_by: '', decided_at: '', to_user: toUser, items: JSON.stringify(items), allocations: '' }]);
    appendRows_(CFG.TABS.MANPOWER_EVENTS, items.map(function(x) {
      return { id: uuid_(), date: date, factory: factory, dept: from, role: x.role, event: 'TRANSFER_OUT', count: x.count, time: time,
               eff_hours: effHours_('TRANSFER_OUT', time), note: 'transfer:' + id + ' → ' + str_(target.name), entered_by: userName_(user), entered_at: stamp };
    }));
  });
  audit_(user, 'transfer.create', id, { from: from, to_user: toUser, items: items });
  return { ok: true, id: id, to_name: str_(target.name), total: total };
}

// { id, action: 'accept' | 'reject', allocations: [{dept, role, count}] }  — accept places every person on one of my lines/floors
function transferDecide_(req, user) {
  var id = str_(req.id), action = str_(req.action);
  var t = readDaily_(CFG.TABS.TRANSFERS).filter(function(r) { return str_(r.id) === id; })[0];
  if (!t) return fail_('NF', 'Transfer nahi mila');
  if (str_(t.status) !== 'Pending') return fail_('VAL', 'Ye transfer pehle se ' + str_(t.status));
  if (str_(t.to_user) !== user.user_id && !isManager_(user)) return fail_('PERM', 'Ye transfer aapke liye nahi hai');
  var factory = str_(t.factory), from = str_(t.from_dept), date = str_(t.date);
  var items = parseJsonArr_(t.items); if (!items.length && str_(t.role)) items = [{ role: str_(t.role), count: num_(t.count) }];
  var sh = tab_(CFG.TABS.TRANSFERS, true), head = CFG.HEADERS.TRANSFERS, stamp = nowStr_();
  var allocs = [];
  if (action === 'accept') {
    allocs = (Array.isArray(req.allocations) ? req.allocations : []).map(function(a) { return { dept: str_(a.dept), role: str_(a.role), count: num_(a.count) }; }).filter(function(a) { return a.dept && a.role && a.count > 0; });
    var need = {}; items.forEach(function(x) { need[x.role] = (need[x.role] || 0) + x.count; });
    var got = {}; allocs.forEach(function(a) { got[a.role] = (got[a.role] || 0) + a.count; });
    var bad = Object.keys(need).filter(function(r) { return (got[r] || 0) !== need[r]; });
    if (bad.length) return fail_('VAL', bad[0] + ': ' + need[bad[0]] + ' aaye, ' + (got[bad[0]] || 0) + ' adjust kiye — sab adjust karo');
    for (var i = 0; i < allocs.length; i++) if (!canWrite_(user, factory, allocs[i].dept)) return fail_('PERM', allocs[i].dept + ' aapki line nahi hai');
  }
  withLock_(function() {
    if (action === 'accept') {
      appendRows_(CFG.TABS.MANPOWER_EVENTS, allocs.map(function(a) {
        return { id: uuid_(), date: date, factory: factory, dept: a.dept, role: a.role, event: 'TRANSFER_IN', count: a.count, time: str_(t.time),
                 eff_hours: effHours_('TRANSFER_IN', str_(t.time)), note: 'transfer:' + id + ' ← ' + from, entered_by: userName_(user), entered_at: stamp };
      }));
    } else {
      var ev = readDaily_(CFG.TABS.MANPOWER_EVENTS).filter(function(r) { return str_(r.event) === 'TRANSFER_OUT' && str_(r.note).indexOf('transfer:' + id) === 0; });
      deleteRows_(CFG.TABS.MANPOWER_EVENTS, ev.map(function(r) { return r._row; }));
    }
    sh.getRange(t._row, head.indexOf('status') + 1).setValue(action === 'accept' ? 'Accepted' : 'Rejected');
    sh.getRange(t._row, head.indexOf('allocations') + 1).setValue(JSON.stringify(allocs));
    sh.getRange(t._row, head.indexOf('decided_by') + 1).setValue(userName_(user));
    sh.getRange(t._row, head.indexOf('decided_at') + 1).setValue(stamp);
  });
  invalidateDaily_(CFG.TABS.TRANSFERS);
  audit_(user, 'transfer.' + action, id, { allocations: allocs });
  return { ok: true };
}

// Active recorders (for the transfer target list) — no PINs
function usersRecorders_(req, user) {
  var factory = str_(req.factory);
  var list = usersRows_().filter(function(u) {
    return isTrue_(u.active) && str_(u.user_id) !== user.user_id && ['Data Collector', 'Supervisor', 'Manager'].indexOf(str_(u.role)) >= 0 && (!str_(u.factory) || !factory || str_(u.factory) === factory);
  }).map(function(u) { return { user_id: str_(u.user_id), name: str_(u.name), role: str_(u.role), depts: csv_(u.depts) }; });
  list.sort(function(a, b) { return a.name.localeCompare(b.name); });
  return { ok: true, users: list };
}

// Manual "refresh everything" (after editing sheets by hand)
function cacheClear_(req, user) { clearAllCaches_(); return { ok: true }; }
