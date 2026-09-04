// Hourly.js — hour-slot output entry (stitching / endline / packing) and manpower change events

function slotDef_(key) {
  for (var i = 0; i < CFG.SLOTS.length; i++) if (CFG.SLOTS[i].key === key) return CFG.SLOTS[i];
  return null;
}

function typeDef_(key) {
  for (var i = 0; i < CFG.HOURLY_TYPES.length; i++) if (CFG.HOURLY_TYPES[i].key === key) return CFG.HOURLY_TYPES[i];
  return null;
}

// Day summary status for (date, factory, dept, type). Submitted/Approved/Sent lock further hourly edits.
function dayStatus_(date, factory, dept, type) {
  var rows = readTab_(CFG.TABS.DAY_SUMMARY).filter(function(r) {
    return str_(r.date) === date && str_(r.factory) === factory && str_(r.dept) === dept && str_(r.type) === type;
  });
  var order = ['Sent', 'Approved', 'Submitted', 'Rejected', 'Draft'];
  var best = '';
  rows.forEach(function(r) { var s = str_(r.status); if (order.indexOf(s) >= 0 && (best === '' || order.indexOf(s) < order.indexOf(best))) best = s; });
  return best;
}

function isLocked_(status) { return status === 'Submitted' || status === 'Approved' || status === 'Sent'; }

// { date, factory, type, dept, srn } -> saved slots + current balance for that SRN
function hourlyGet_(req, user) {
  var date = str_(req.date), factory = str_(req.factory), type = str_(req.type), dept = str_(req.dept), srn = str_(req.srn);
  if (!isDateStr_(date)) return fail_('DATE', 'Date galat');
  if (!typeDef_(type)) return fail_('TYPE', 'Type galat');
  var key = [date, factory, type, dept, srn].join('|');
  var rows = readTab_(CFG.TABS.HOURLY_LOG).filter(function(r) { return hourlyKey_(r) === key; });
  var out = rows.map(function(r) {
    return { slot: str_(r.slot), qty: num_(r.qty), checked: num_(r.checked), pass: num_(r.pass), reject: num_(r.reject),
             cartons: num_(r.cartons), pcs_per_ctn: num_(r.pcs_per_ctn), checker: str_(r.checker), floor: str_(r.floor), by: str_(r.entered_by), at: str_(r.entered_at) };
  });
  var chk = srn ? chainCheck_(ledger_(key), type, dept, srn, 0) : null;
  return { ok: true, rows: out, status: dayStatus_(date, factory, dept, type),
           limit: chk ? chk.limit : 0, used: chk ? chk.used : 0, floor: rows.length ? str_(rows[0].floor) : '' };
}

// { date, factory, type, dept, srn, floor, checker, rows: [{slot, qty|checked,pass,reject|qty,cartons,pcs_per_ctn}] }
// Replaces all slots for (date, factory, type, dept, srn). Hard-blocks if the chain limit would be exceeded.
function hourlySave_(req, user) {
  var date = str_(req.date), factory = str_(req.factory), type = str_(req.type), dept = str_(req.dept), srn = str_(req.srn);
  if (!isDateStr_(date)) return fail_('DATE', 'Date galat');
  if (CFG.FACTORIES.indexOf(factory) < 0) return fail_('FACTORY', 'Factory galat');
  var td = typeDef_(type); if (!td) return fail_('TYPE', 'Type galat');
  if (!dept || !srn) return fail_('KEY', 'Dept aur SRN dono chahiye');
  if (!canWrite_(user, factory, dept)) return fail_('PERM', 'Is dept me entry ki permission nahi hai');

  var status = dayStatus_(date, factory, dept, type);
  if (isLocked_(status)) return fail_('LOCKED', 'Ye din ' + status + ' hai — manager se reject karwao tab edit hoga');

  var floor = str_(req.floor), checker = str_(req.checker);
  var clean = [], seen = {}, total = 0;
  (Array.isArray(req.rows) ? req.rows : []).forEach(function(x) {
    var slot = str_(x.slot), sd = slotDef_(slot);
    if (!sd) throw new Error('Slot galat: ' + slot);
    if (seen[slot]) throw new Error('Slot do baar: ' + slot);
    seen[slot] = true;
    var row = { slot: slot, shift: sd.shift, qty: 0, checked: 0, pass: 0, reject: 0, cartons: 0, pcs_per_ctn: 0 };
    if (type === 'ENDLINE') {
      row.checked = num_(x.checked); row.pass = num_(x.pass); row.reject = num_(x.reject);
      if (row.checked < 0 || row.pass < 0 || row.reject < 0) throw new Error('Negative nahi chalega: ' + slot);
      if (row.pass + row.reject > row.checked) throw new Error(slot + ': pass + reject checked se zyada');
      if (!row.checked) return;
      total += row.checked;
    } else {
      row.qty = num_(x.qty);
      if (row.qty < 0) throw new Error('Negative nahi chalega: ' + slot);
      if (type === 'PACKING') { row.cartons = num_(x.cartons); row.pcs_per_ctn = num_(x.pcs_per_ctn); }
      if (!row.qty) return;
      total += row.qty;
    }
    clean.push(row);
  });

  var key = [date, factory, type, dept, srn].join('|');
  var chk = chainCheck_(ledger_(key), type, dept, srn, total);
  if (!chk.ok) return { ok: false, error: 'CHAIN', message: chk.msg, limit: chk.limit, used: chk.used };

  var stamp = nowStr_();
  var result = withLock_(function() {
    var existing = readTab_(CFG.TABS.HOURLY_LOG).filter(function(r) { return hourlyKey_(r) === key; });
    deleteRows_(CFG.TABS.HOURLY_LOG, existing.map(function(r) { return r._row; }));
    appendRows_(CFG.TABS.HOURLY_LOG, clean.map(function(c) {
      return { id: uuid_(), date: date, factory: factory, line: lineOf_(dept), dept: dept, srn: srn, floor: floor, type: type,
               shift: c.shift, slot: c.slot, qty: c.qty, checked: c.checked, pass: c.pass, reject: c.reject,
               cartons: c.cartons, pcs_per_ctn: c.pcs_per_ctn, checker: checker, entered_by: user.user_id, entered_at: stamp };
    }));
    return { replaced: existing.length, saved: clean.length };
  });
  // a Rejected day being re-entered goes back to Draft so it can be resubmitted
  if (status === 'Rejected') setDayStatus_(date, factory, dept, type, 'Draft', user, 'Re-entered after reject');
  audit_(user, 'hourly.save', key, { total: total, slots: clean.length });
  return { ok: true, saved: result.saved, total: total, balance: chk.balance, limit: chk.limit, at: stamp };
}

// "Line 3" from "Surendra-Line 3-SL006" / "FAC666-Line 2-SL031"; falls back to the LINE master
function lineOf_(dept) {
  var m = str_(dept).match(/Line\s*\d+/i);
  if (m) return m[0].replace(/\s+/, ' ');
  var hit = readTab_(CFG.TABS.MASTERS).filter(function(r) { return str_(r.type) === 'LINE' && str_(r.value) === dept; })[0];
  return hit ? str_(hit.key) : '';
}

// { date, factory } -> per dept/type totals + day statuses, for the home screen
function hourlyDay_(req, user) {
  var date = str_(req.date), factory = str_(req.factory);
  if (!isDateStr_(date)) return fail_('DATE', 'Date galat');
  var agg = {};
  readTab_(CFG.TABS.HOURLY_LOG).forEach(function(r) {
    if (str_(r.date) !== date || str_(r.factory) !== factory) return;
    var k = str_(r.dept) + '|' + str_(r.type);
    if (!agg[k]) agg[k] = { dept: str_(r.dept), type: str_(r.type), qty: 0, slots: 0, srns: {} };
    agg[k].qty += str_(r.type) === 'ENDLINE' ? num_(r.pass) : num_(r.qty);
    agg[k].slots += 1;
    agg[k].srns[str_(r.srn)] = true;
  });
  var statuses = {};
  readTab_(CFG.TABS.DAY_SUMMARY).forEach(function(r) {
    if (str_(r.date) !== date || str_(r.factory) !== factory) return;
    var k = str_(r.dept) + '|' + str_(r.type);
    var order = ['Sent', 'Approved', 'Submitted', 'Rejected', 'Draft'], s = str_(r.status);
    if (!statuses[k] || order.indexOf(s) < order.indexOf(statuses[k].status)) statuses[k] = { status: s, remark: str_(r.remark) };
  });
  var events = readTab_(CFG.TABS.MANPOWER_EVENTS).filter(function(r) { return str_(r.date) === date && str_(r.factory) === factory; }).length;
  return { ok: true,
    hourly: Object.keys(agg).map(function(k) { var a = agg[k]; a.srns = Object.keys(a.srns); return a; }),
    statuses: statuses, events: events };
}

// ---------- manpower events ----------

function effHours_(ev, time) {
  var def = null;
  for (var i = 0; i < CFG.MP_EVENTS.length; i++) if (CFG.MP_EVENTS[i].key === ev) def = CFG.MP_EVENTS[i];
  if (!def) throw new Error('Event galat: ' + ev);
  if (def.eff !== null && def.eff !== undefined) return def.eff;
  var m = str_(time).match(/^(\d{1,2}):(\d{2})$/);
  if (!m) throw new Error('Time HH:MM me daalo');
  var t = (+m[1]) + (+m[2]) / 60;
  var h = def.from !== undefined ? t - def.from : def.to - t;
  h = Math.round(Math.max(0, Math.min(8, h)) * 2) / 2;
  return h;
}

function manpowerGet_(req, user) {
  var date = str_(req.date), factory = str_(req.factory), dept = str_(req.dept);
  if (!isDateStr_(date)) return fail_('DATE', 'Date galat');
  var rows = readTab_(CFG.TABS.MANPOWER_EVENTS).filter(function(r) {
    return str_(r.date) === date && str_(r.factory) === factory && (!dept || str_(r.dept) === dept);
  }).map(function(r) {
    return { id: str_(r.id), dept: str_(r.dept), role: str_(r.role), event: str_(r.event), count: num_(r.count),
             time: str_(r.time), eff_hours: num_(r.eff_hours), note: str_(r.note), by: str_(r.entered_by), at: str_(r.entered_at) };
  });
  return { ok: true, events: rows };
}

// { date, factory, dept, role, event, count, time, note }
function manpowerSave_(req, user) {
  var date = str_(req.date), factory = str_(req.factory), dept = str_(req.dept), role = str_(req.role);
  if (!isDateStr_(date)) return fail_('DATE', 'Date galat');
  if (!dept || !role) return fail_('KEY', 'Dept aur role chahiye');
  if (!canWrite_(user, factory, dept)) return fail_('PERM', 'Permission nahi');
  var count = num_(req.count); if (count <= 0) return fail_('COUNT', 'Count 1 ya zyada');
  if (isLocked_(dayStatus_(date, factory, dept, 'ATT'))) return fail_('LOCKED', 'Attendance submit ho chuki — manager se reject karwao');
  var eff = effHours_(str_(req.event), str_(req.time));
  var row = { id: uuid_(), date: date, factory: factory, dept: dept, role: role, event: str_(req.event), count: count,
              time: str_(req.time), eff_hours: eff, note: str_(req.note), entered_by: user.user_id, entered_at: nowStr_() };
  appendRows_(CFG.TABS.MANPOWER_EVENTS, [row]);
  audit_(user, 'manpower.save', row.id, row);
  return { ok: true, id: row.id, eff_hours: eff };
}

function manpowerDelete_(req, user) {
  var id = str_(req.id);
  var hit = readTab_(CFG.TABS.MANPOWER_EVENTS).filter(function(r) { return str_(r.id) === id; })[0];
  if (!hit) return fail_('NF', 'Event nahi mila');
  if (!canWrite_(user, str_(hit.factory), str_(hit.dept))) return fail_('PERM', 'Permission nahi');
  if (isLocked_(dayStatus_(str_(hit.date), str_(hit.factory), str_(hit.dept), 'ATT'))) return fail_('LOCKED', 'Attendance submit ho chuki');
  deleteRows_(CFG.TABS.MANPOWER_EVENTS, [hit._row]);
  audit_(user, 'manpower.delete', id, '');
  return { ok: true };
}

// Attendance rows for (date, factory, dept, shift) after applying manpower events -> [{role, hours, count}]
function effectiveAttendance_(date, factory, dept, shift, attRows, events) {
  var rows = attRows.filter(function(r) {
    return str_(r.date) === date && str_(r.factory) === factory && str_(r.dept) === dept && str_(r.shift) === shift;
  });
  var out = {};
  rows.forEach(function(r) { var k = str_(r.role) + '|' + num_(r.hours); out[k] = { role: str_(r.role), hours: num_(r.hours), count: (out[k] ? out[k].count : 0) + num_(r.count) }; });
  if (shift !== 'Final') return Object.keys(out).map(function(k) { return out[k]; });

  events.filter(function(e) { return str_(e.date) === date && str_(e.factory) === factory && str_(e.dept) === dept; })
    .forEach(function(e) {
      var role = str_(e.role), n = num_(e.count), eff = num_(e.eff_hours);
      var def = CFG.MP_EVENTS.filter(function(d) { return d.key === str_(e.event); })[0] || {};
      if (def.add) { var ka = role + '|' + eff; out[ka] = out[ka] || { role: role, hours: eff, count: 0 }; out[ka].count += n; return; }
      // take n people out of the fullest bucket for that role and re-add them at eff hours
      var keys = Object.keys(out).filter(function(k) { return out[k].role === role && out[k].count > 0; })
        .sort(function(a, b) { return out[b].hours - out[a].hours; });
      var left = n;
      keys.forEach(function(k) { if (left <= 0) return; var take = Math.min(left, out[k].count); out[k].count -= take; left -= take; });
      if (eff > 0) { var ke = role + '|' + eff; out[ke] = out[ke] || { role: role, hours: eff, count: 0 }; out[ke].count += n - left; }
    });
  return Object.keys(out).map(function(k) { return out[k]; }).filter(function(r) { return r.count > 0; });
}

// ---------- checklist support ----------

// Upserts ONE slot for (date, factory, type, dept, srn, slot). qty/checked 0 deletes it.
// { date, factory, type, dept, srn, slot, floor, checker, qty | checked, pass, reject | qty, cartons }
function hourlySlot_(req, user) {
  var date = str_(req.date), factory = str_(req.factory), type = str_(req.type), dept = str_(req.dept), srn = str_(req.srn), slot = str_(req.slot);
  if (!isDateStr_(date)) return fail_('DATE', 'Date galat');
  if (CFG.FACTORIES.indexOf(factory) < 0) return fail_('FACTORY', 'Factory galat');
  if (!typeDef_(type)) return fail_('TYPE', 'Type galat');
  var sd = slotDef_(slot); if (!sd) return fail_('SLOT', 'Slot galat');
  if (!dept || !srn) return fail_('KEY', 'SRN chuno');
  if (!canWrite_(user, factory, dept)) return fail_('PERM', 'Is line me entry ki permission nahi hai');
  var status = dayStatus_(date, factory, dept, type);
  if (isLocked_(status)) return fail_('LOCKED', 'Ye din ' + status + ' hai — manager se reject karwao tab edit hoga');

  var row = { qty: 0, checked: 0, pass: 0, reject: 0, cartons: 0, pcs_per_ctn: 0 };
  if (type === 'ENDLINE') {
    row.checked = num_(req.checked); row.pass = num_(req.pass); row.reject = num_(req.reject);
    if (row.checked < 0 || row.pass < 0 || row.reject < 0) return fail_('VAL', 'Negative nahi chalega');
    if (row.pass + row.reject > row.checked) return fail_('VAL', 'Pass + reject checked se zyada hai');
    if (!str_(req.checker)) return fail_('VAL', 'Checker ka naam likho');
  } else {
    row.qty = num_(req.qty);
    if (row.qty < 0) return fail_('VAL', 'Negative nahi chalega');
    if (type === 'PACKING') { row.cartons = num_(req.cartons); row.pcs_per_ctn = row.cartons ? Math.round(row.qty / row.cartons) : 0; }
  }
  var newAmt = type === 'ENDLINE' ? row.checked : row.qty;

  var key = [date, factory, type, dept, srn].join('|');
  var all = readTab_(CFG.TABS.HOURLY_LOG).filter(function(r) { return hourlyKey_(r) === key; });
  var existing = all.filter(function(r) { return str_(r.slot) === slot; });
  var oldAmt = 0; existing.forEach(function(r) { oldAmt += type === 'ENDLINE' ? num_(r.checked) : num_(r.qty); });

  var chk = chainCheck_(ledger_(), type, dept, srn, newAmt - oldAmt);
  if (!chk.ok) return { ok: false, error: 'CHAIN', message: chk.msg, limit: chk.limit, used: chk.used };

  var stamp = nowStr_();
  withLock_(function() {
    deleteRows_(CFG.TABS.HOURLY_LOG, existing.map(function(r) { return r._row; }));
    if (newAmt > 0) {
      var floor = str_(req.floor) || (existing.length ? str_(existing[0].floor) : (all.length ? str_(all[0].floor) : ''));
      appendRows_(CFG.TABS.HOURLY_LOG, [{ id: uuid_(), date: date, factory: factory, line: lineOf_(dept), dept: dept, srn: srn, floor: floor, type: type,
        shift: sd.shift, slot: slot, qty: row.qty, checked: row.checked, pass: row.pass, reject: row.reject, cartons: row.cartons,
        pcs_per_ctn: row.pcs_per_ctn, checker: str_(req.checker), entered_by: user.user_id, entered_at: stamp }]);
    }
  });
  if (status === 'Rejected') setDayStatus_(date, factory, dept, type, 'Draft', user, 'Re-entered after reject');
  audit_(user, 'hourly.slot', key + '|' + slot, { amt: newAmt });
  var todayTotal = 0; all.forEach(function(r) { if (str_(r.slot) !== slot) todayTotal += type === 'ENDLINE' ? num_(r.checked) : num_(r.qty); });
  todayTotal += newAmt;
  return { ok: true, total: todayTotal, balance: chk.balance, limit: chk.limit, at: stamp };
}

// Everything the checklist needs for one line in one call.
// { date, factory, dept } -> { att: {shift: {manpower, by}}, slots: {type: {slot: [rows]}}, totals, events, statuses }
function lineToday_(req, user) {
  var date = str_(req.date), factory = str_(req.factory), dept = str_(req.dept);
  if (!isDateStr_(date)) return fail_('DATE', 'Date galat');
  if (!dept) return fail_('DEPT', 'Line chuno');

  var att = {};
  readTab_(CFG.TABS.ATT_DAILY).forEach(function(r) {
    if (str_(r.date) !== date || str_(r.factory) !== factory || str_(r.dept) !== dept) return;
    var s = str_(r.shift);
    if (!att[s]) att[s] = { manpower: 0, manhours: 0, by: str_(r.entered_by), at: str_(r.entered_at) };
    att[s].manpower += num_(r.count); att[s].manhours += num_(r.count) * num_(r.hours);
  });

  var slots = {}, totals = {};
  readTab_(CFG.TABS.HOURLY_LOG).forEach(function(r) {
    if (str_(r.date) !== date || str_(r.factory) !== factory || str_(r.dept) !== dept) return;
    var t = str_(r.type), sk = str_(r.slot);
    if (!slots[t]) { slots[t] = {}; totals[t] = { qty: 0, checked: 0, pass: 0, reject: 0, cartons: 0, slots: 0 }; }
    if (!slots[t][sk]) { slots[t][sk] = []; totals[t].slots++; }
    slots[t][sk].push({ srn: str_(r.srn), qty: num_(r.qty), checked: num_(r.checked), pass: num_(r.pass), reject: num_(r.reject),
                        cartons: num_(r.cartons), checker: str_(r.checker), floor: str_(r.floor), by: str_(r.entered_by) });
    totals[t].qty += num_(r.qty); totals[t].checked += num_(r.checked); totals[t].pass += num_(r.pass); totals[t].reject += num_(r.reject); totals[t].cartons += num_(r.cartons);
  });

  var events = readTab_(CFG.TABS.MANPOWER_EVENTS).filter(function(r) { return str_(r.date) === date && str_(r.factory) === factory && str_(r.dept) === dept; }).length;

  var statuses = {}, order = ['Sent', 'Approved', 'Submitted', 'Rejected', 'Draft'];
  readTab_(CFG.TABS.DAY_SUMMARY).forEach(function(r) {
    if (str_(r.date) !== date || str_(r.factory) !== factory || str_(r.dept) !== dept) return;
    var t = str_(r.type), s = str_(r.status);
    if (!statuses[t] || order.indexOf(s) < order.indexOf(statuses[t].status)) statuses[t] = { status: s, remark: str_(r.remark) };
  });

  return { ok: true, att: att, slots: slots, totals: totals, events: events, statuses: statuses, serverTime: nowStr_() };
}

// Pending review count for the manager badge
function reviewCount_(req, user) {
  if (!isManager_(user)) return { ok: true, count: 0 };
  var n = 0;
  readTab_(CFG.TABS.DAY_SUMMARY).forEach(function(r) { if (str_(r.status) === 'Submitted' && (!req.factory || str_(r.factory) === str_(req.factory))) n++; });
  return { ok: true, count: n };
}
