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
  var rows = readDaily_(CFG.TABS.DAY_SUMMARY).filter(function(r) {
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
               cartons: c.cartons, pcs_per_ctn: c.pcs_per_ctn, checker: checker, entered_by: userName_(user), entered_at: stamp };
    }));
    return { replaced: existing.length, saved: clean.length };
  });
  invalidateAppAgg_();
  // a Rejected day being re-entered goes back to Draft so it can be resubmitted
  if (status === 'Rejected') setDayStatus_(date, factory, dept, type, 'Draft', user, 'Re-entered after reject');
  audit_(user, 'hourly.save', key, { total: total, slots: clean.length });
  return { ok: true, saved: result.saved, total: total, balance: chk.balance, limit: chk.limit, at: stamp };
}

// "Line 3" from "Surendra-Line 3-SL006" / "FAC666-Line 2-SL031"; falls back to the LINE master
function lineOf_(dept) {
  var m = str_(dept).match(/Line\s*\d+/i);
  if (m) return m[0].replace(/\s+/, ' ');
  var hit = mastersRows_().filter(function(r) { return str_(r.type) === 'LINE' && str_(r.value) === dept; })[0];
  return hit ? str_(hit.key) : '';
}

// { date, factory } -> per dept/type totals + day statuses, for the home screen
function hourlyDay_(req, user) {
  var date = str_(req.date), factory = str_(req.factory);
  if (!isDateStr_(date)) return fail_('DATE', 'Date galat');
  var agg = {};
  readDaily_(CFG.TABS.HOURLY_LOG).forEach(function(r) {
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
  var date = str_(req.date), factory = str_(req.factory), ev = str_(req.event);
  if (!isDateStr_(date)) return fail_('DATE', 'Date galat');
  var isClose = ev === 'LINE_CLOSED';
  var depts = Array.isArray(req.depts) && req.depts.length ? req.depts.map(str_).filter(String) : [str_(req.dept)];
  var role = isClose ? 'ALL' : str_(req.role), count = isClose ? 0 : num_(req.count);
  if (!depts[0] || !role) return fail_('KEY', 'Dept aur role chahiye');
  if (!isClose && count <= 0) return fail_('COUNT', 'Count 1 ya zyada');
  for (var i = 0; i < depts.length; i++) {
    if (!canWrite_(user, factory, depts[i])) return fail_('PERM', depts[i] + ': permission nahi');
    if (isLocked_(dayStatus_(date, factory, depts[i], 'ATT'))) return fail_('LOCKED', depts[i] + ': attendance submit ho chuki — manager se reject karwao');
  }
  var eff = effHours_(ev, str_(req.time)), stamp = nowStr_(), ids = [];
  withLock_(function() {
    if (isClose) {   // one close per line per day: replace an earlier one
      var old = readDaily_(CFG.TABS.MANPOWER_EVENTS).filter(function(r) { return str_(r.date) === date && str_(r.factory) === factory && str_(r.event) === 'LINE_CLOSED' && depts.indexOf(str_(r.dept)) >= 0; });
      deleteRows_(CFG.TABS.MANPOWER_EVENTS, old.map(function(r) { return r._row; }));
    }
    appendRows_(CFG.TABS.MANPOWER_EVENTS, depts.map(function(d) {
      var id = uuid_(); ids.push(id);
      return { id: id, date: date, factory: factory, dept: d, role: role, event: ev, count: count,
               time: str_(req.time), eff_hours: eff, note: str_(req.note), entered_by: userName_(user), entered_at: stamp };
    }));
  });
  audit_(user, 'manpower.save', ids.join(','), { event: ev, depts: depts, role: role, count: count, time: str_(req.time) });
  return { ok: true, id: ids[0], ids: ids, eff_hours: eff };
}

// LINE_CLOSED event for a dept that day -> { time, hour, eff } or null
function lineClose_(events, dept) {
  var hit = null;
  events.forEach(function(e) { if (str_(e.event) === 'LINE_CLOSED' && str_(e.dept) === dept) hit = e; });
  return hit ? { time: str_(hit.time), hour: eventHour_(hit), eff: num_(hit.eff_hours) } : null;
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
      if (def.close) return;   // handled below
      if (def.add) { var ka = role + '|' + eff; out[ka] = out[ka] || { role: role, hours: eff, count: 0 }; out[ka].count += n; return; }
      // take n people out of the fullest bucket for that role and re-add them at eff hours
      var keys = Object.keys(out).filter(function(k) { return out[k].role === role && out[k].count > 0; })
        .sort(function(a, b) { return out[b].hours - out[a].hours; });
      var left = n;
      keys.forEach(function(k) { if (left <= 0) return; var take = Math.min(left, out[k].count); out[k].count -= take; left -= take; });
      if (eff > 0) { var ke = role + '|' + eff; out[ke] = out[ke] || { role: role, hours: eff, count: 0 }; out[ke].count += n - left; }
    });
  // line closed early: nobody works past that time
  var close = lineClose_(events.filter(function(e) { return str_(e.date) === date && str_(e.factory) === factory; }), dept);
  if (close) {
    var capped = {};
    Object.keys(out).forEach(function(k) {
      var r = out[k], h = Math.min(r.hours, close.eff), kk = r.role + '|' + h;
      capped[kk] = capped[kk] || { role: r.role, hours: h, count: 0 }; capped[kk].count += r.count;
    });
    out = capped;
  }
  return Object.keys(out).map(function(k) { return out[k]; }).filter(function(r) { return r.count > 0; });
}

// ---------- checklist support ----------

// Upserts ONE slot for (date, factory, type, dept, srn, slot). qty/checked 0 deletes it.
function hourlySlot_(req, user) {
  var date = str_(req.date), factory = str_(req.factory);
  if (!isDateStr_(date)) return fail_('DATE', 'Date galat');
  if (CFG.FACTORIES.indexOf(factory) < 0) return fail_('FACTORY', 'Factory galat');
  var r = withLock_(function() { return slotUpsert_(req, user, batchCtx_(date, factory)); });
  invalidateAppAgg_();
  if (!r.ok) return r;
  var key = [date, factory, str_(req.type), str_(req.dept), str_(req.srn)].join('|'), total = 0;
  readTab_(CFG.TABS.HOURLY_LOG).forEach(function(x) { if (hourlyKey_(x) === key) total += str_(req.type) === 'ENDLINE' ? num_(x.checked) : num_(x.qty); });
  audit_(user, 'hourly.slot', key + '|' + str_(req.slot), { amt: r.amount });
  return { ok: true, total: total, balance: r.balance, limit: r.limit, at: r.at };
}

// Everything the checklist needs for one line in one call.
// { date, factory, dept } -> { att: {shift: {manpower, by}}, slots: {type: {slot: [rows]}}, totals, events, statuses }
function lineToday_(req, user) {
  var date = str_(req.date), factory = str_(req.factory), dept = str_(req.dept);
  if (!isDateStr_(date)) return fail_('DATE', 'Date galat');
  if (!dept) return fail_('DEPT', 'Line chuno');

  var att = {};
  readDaily_(CFG.TABS.ATT_DAILY).forEach(function(r) {
    if (str_(r.date) !== date || str_(r.factory) !== factory || str_(r.dept) !== dept) return;
    var s = str_(r.shift);
    if (!att[s]) att[s] = { manpower: 0, manhours: 0, by: str_(r.entered_by), at: str_(r.entered_at), rows: [], srn: str_(r.srn) };
    att[s].manpower += num_(r.count); att[s].manhours += num_(r.count) * num_(r.hours);
    att[s].rows.push({ role: str_(r.role), hours: num_(r.hours), count: num_(r.count) });
  });
  // Final shift: man-hours after manpower events (someone left / came late / line closed)
  var evAll = readDaily_(CFG.TABS.MANPOWER_EVENTS).filter(function(r) { return str_(r.date) === date && str_(r.factory) === factory; });
  var attAll = readDaily_(CFG.TABS.ATT_DAILY).filter(function(r) { return str_(r.date) === date && str_(r.factory) === factory; });
  if (att.Final) {
    var eff = effectiveAttendance_(date, factory, dept, 'Final', attAll, evAll);
    att.Final.rawManhours = att.Final.manhours;
    att.Final.manhours = eff.reduce(function(t, r) { return t + r.count * r.hours; }, 0);
    var cl = lineClose_(evAll, dept); if (cl) att.Final.closedAt = cl.time;
  }

  var slots = {}, totals = {};
  readDaily_(CFG.TABS.HOURLY_LOG).forEach(function(r) {
    if (str_(r.date) !== date || str_(r.factory) !== factory || str_(r.dept) !== dept) return;
    var t = str_(r.type), sk = str_(r.slot);
    if (!slots[t]) { slots[t] = {}; totals[t] = { qty: 0, checked: 0, pass: 0, reject: 0, cartons: 0, slots: 0 }; }
    if (!slots[t][sk]) { slots[t][sk] = []; totals[t].slots++; }
    slots[t][sk].push({ srn: str_(r.srn), qty: num_(r.qty), checked: num_(r.checked), pass: num_(r.pass), reject: num_(r.reject),
                        cartons: num_(r.cartons), checker: str_(r.checker), floor: str_(r.floor), by: str_(r.entered_by) });
    totals[t].qty += num_(r.qty); totals[t].checked += num_(r.checked); totals[t].pass += num_(r.pass); totals[t].reject += num_(r.reject); totals[t].cartons += num_(r.cartons);
  });

  var events = readDaily_(CFG.TABS.MANPOWER_EVENTS).filter(function(r) { return str_(r.date) === date && str_(r.factory) === factory && str_(r.dept) === dept; })
    .map(function(r) { return { id: str_(r.id), role: str_(r.role), event: str_(r.event), count: num_(r.count), time: str_(r.time), eff_hours: num_(r.eff_hours), note: str_(r.note) }; });

  var statuses = {}, order = ['Sent', 'Approved', 'Submitted', 'Rejected', 'Draft'];
  readDaily_(CFG.TABS.DAY_SUMMARY).forEach(function(r) {
    if (str_(r.date) !== date || str_(r.factory) !== factory || str_(r.dept) !== dept) return;
    var t = str_(r.type), s = str_(r.status);
    if (!statuses[t] || order.indexOf(s) < order.indexOf(statuses[t].status)) statuses[t] = { status: s, remark: str_(r.remark) };
  });

  return { ok: true, att: att, slots: slots, totals: totals, events: events, statuses: statuses, serverTime: nowStr_() };
}

// Pending review count for the manager badge
function reviewCount_(req, user) {
  if (user.role !== 'Admin') return { ok: true, count: 0 };
  var n = 0;
  readTab_(CFG.TABS.DAY_SUMMARY).forEach(function(r) { if (str_(r.status) === 'Submitted' && (!req.factory || str_(r.factory) === str_(req.factory))) n++; });
  return { ok: true, count: n };
}

// Event time as a decimal hour (HALF_DAY = 13:00, ABSENT/EXTRA = 9:00)
function eventHour_(e) {
  var m = str_(e.time).match(/^(\d{1,2}):(\d{2})$/);
  if (m) return (+m[1]) + (+m[2]) / 60;
  var k = str_(e.event);
  return k === 'HALF_DAY' ? 13 : 9;
}
function eventAdds_(e) { var d = CFG.MP_EVENTS.filter(function(x) { return x.key === str_(e.event); })[0]; return !!(d && d.add); }

// Manpower actually on a dept during a slot = Final attendance + people who joined before the slot ends − people who left before it starts
function mpAtSlot_(attRows, events, dept, slotKey) {
  var base = 0;
  attRows.forEach(function(r) { if (str_(r.dept) === dept && str_(r.shift) === 'Final') base += num_(r.count); });
  var st = Number(slotKey.split('-')[0]), closed = false;
  events.forEach(function(e) {
    if (str_(e.dept) !== dept) return;
    var t = eventHour_(e), n = num_(e.count);
    if (str_(e.event) === 'LINE_CLOSED') { if (t <= st + 0.01) closed = true; return; }
    if (eventAdds_(e)) { if (t < st + 1) base += n; }
    else if (t <= st + 0.01) base -= n;
  });
  return closed ? 0 : Math.max(0, base);
}
