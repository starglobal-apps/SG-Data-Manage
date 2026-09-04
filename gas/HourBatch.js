// HourBatch.js — one hour, whole factory: read every line's rows for a slot and save them all in one call.
// Also the factory-level "today" view that feeds the Home timeline.

// SRN options for a dept/type with limits and balances (shared with orders.active)
function srnOptions_(L, dept, type) {
  var list = [];
  if (type === 'PACKING') {
    Object.keys(L.endPassSrn).forEach(function(srn) {
      var pass = num_(L.endPassSrn[srn]), packed = num_(L.packed[srn]);
      if (pass - packed <= 0) return;
      var info = L.srnInfo[srn] || {};
      list.push({ srn: srn, item: info.item || '', limit: pass, used: packed, balance: pass - packed });
    });
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
  return readTab_(CFG.TABS.MASTERS).filter(function(r) {
    return str_(r.type) === 'DEPT' && isTrue_(r.active) && str_(r.factory) === factory && canWrite_(user, factory, str_(r.key));
  }).map(function(r) { return { dept: str_(r.key), cat: str_(r.extra) }; });
}

function statusMap_(date, factory) {
  var m = {}, order = ['Sent', 'Approved', 'Submitted', 'Rejected', 'Draft'];
  readTab_(CFG.TABS.DAY_SUMMARY).forEach(function(r) {
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
  var depts = writableDepts_(user, factory).filter(function(d) { return d.cat === 'STITCH' || d.cat === 'PACKING'; });
  var st = statusMap_(date, factory);

  var rowsBy = {}, lastSrn = {}, lastChecker = {}, lastFloor = {};
  readTab_(CFG.TABS.HOURLY_LOG).forEach(function(r) {
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
    var o = { dept: d.dept, cat: d.cat, srns: {}, rows: {}, lastSrn: {}, locked: {}, checker: lastChecker[d.dept] ? lastChecker[d.dept].v : '',
              floor: lastFloor[d.dept] ? lastFloor[d.dept].v : (lineFloor[d.dept] ? lineFloor[d.dept].value : '') };
    types.forEach(function(t) {
      o.srns[t] = srnOptions_(L, d.dept, t);
      o.rows[t] = rowsBy[d.dept + '|' + t] || [];
      o.lastSrn[t] = lastSrn[d.dept + '|' + t] ? lastSrn[d.dept + '|' + t].srn : '';
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
      pcs_per_ctn: row.pcs_per_ctn, checker: str_(p.checker), entered_by: user.user_id, entered_at: stamp };
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
  return { L: ledger_(), rows: readTab_(CFG.TABS.HOURLY_LOG), status: statusMap_(date, factory) };
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
  audit_(user, 'hour.save', date + '|' + factory + '|' + slot, { saved: saved, failed: failed });
  return { ok: true, saved: saved, failed: failed, results: results };
}

// { date, factory } -> factory-wide picture for the Home timeline
function factoryToday_(req, user) {
  var date = str_(req.date), factory = str_(req.factory);
  if (!isDateStr_(date)) return fail_('DATE', 'Date galat');
  var depts = writableDepts_(user, factory);
  var att = {};
  readTab_(CFG.TABS.ATT_DAILY).forEach(function(r) {
    if (str_(r.date) !== date || str_(r.factory) !== factory) return;
    var k = str_(r.dept) + '|' + str_(r.shift);
    att[k] = (att[k] || 0) + num_(r.count);
  });
  var slots = {};
  readTab_(CFG.TABS.HOURLY_LOG).forEach(function(r) {
    if (str_(r.date) !== date || str_(r.factory) !== factory) return;
    var sk = str_(r.slot), t = str_(r.type), dept = str_(r.dept);
    if (!slots[sk]) slots[sk] = { STITCH: {}, ENDLINE: {}, PACKING: {} };
    var amt = t === 'ENDLINE' ? num_(r.pass) : num_(r.qty);
    slots[sk][t][dept] = (slots[sk][t][dept] || 0) + amt;
  });
  var events = readTab_(CFG.TABS.MANPOWER_EVENTS).filter(function(r) { return str_(r.date) === date && str_(r.factory) === factory; }).length;
  return { ok: true, depts: depts, att: att, slots: slots, statuses: statusMap_(date, factory), events: events, serverTime: nowStr_() };
}
