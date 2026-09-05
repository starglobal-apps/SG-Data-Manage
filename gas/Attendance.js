// Attendance.js — morning attendance entry (per Dept × Role headcount, same shape as the Final Attendance sheets)

// Request: { date, factory, dept, shift }
// Reply:   { rows: [{role, hours, count}], prefill: bool, prefillDate }
//          If nothing is saved for that date, returns the most recent earlier day's rows as a prefill.
function attGet_(req, user) {
  var date = str_(req.date), factory = str_(req.factory), dept = str_(req.dept), shift = str_(req.shift) || 'Final';
  if (!isDateStr_(date)) return fail_('DATE', 'Date yyyy-mm-dd me bhejo');
  if (!dept) return fail_('DEPT', 'Dept chuno');

  var all = readDaily_(CFG.TABS.ATT_DAILY).filter(function(r) {
    return str_(r.factory) === factory && str_(r.dept) === dept && str_(r.shift) === shift;
  });

  var staff = lineStaffOf_(dept);
  var today = all.filter(function(r) { return str_(r.date) === date; });
  if (today.length) return { ok: true, rows: today.map(attRowOut_), srn: str_(today[0].srn), supervisor: str_(today[0].supervisor) || staff.supervisor, incharge: str_(today[0].incharge) || staff.incharge, qc_names: csv_(today[0].qc_names), prefill: false, prefillDate: '' };

  var earlier = all.filter(function(r) { return str_(r.date) < date; });
  if (!earlier.length) return { ok: true, rows: [], srn: '', supervisor: staff.supervisor, incharge: staff.incharge, prefill: false, prefillDate: '' };
  var latest = earlier.reduce(function(a, r) { return str_(r.date) > a ? str_(r.date) : a; }, '');
  var rows = earlier.filter(function(r) { return str_(r.date) === latest; });
  return { ok: true, rows: rows.map(attRowOut_), srn: str_(rows[0].srn), supervisor: str_(rows[0].supervisor) || staff.supervisor, incharge: str_(rows[0].incharge) || staff.incharge, qc_names: csv_(rows[0].qc_names), prefill: true, prefillDate: latest };
}

function attRowOut_(r) {
  return { role: str_(r.role), hours: num_(r.hours), count: num_(r.count), by: str_(r.entered_by), at: str_(r.entered_at) };
}

// Request: { date, factory, dept, shift, rows: [{role, hours, count}] }
// Replaces everything saved for that date+factory+dept+shift.
function attSave_(req, user) {
  var date = str_(req.date), factory = str_(req.factory), dept = str_(req.dept), shift = str_(req.shift) || 'Final';
  if (!isDateStr_(date)) return fail_('DATE', 'Date yyyy-mm-dd me bhejo');
  if (CFG.FACTORIES.indexOf(factory) < 0) return fail_('FACTORY', 'Factory galat: ' + factory);
  if (!dept) return fail_('DEPT', 'Dept chuno');
  if (!CFG.SHIFTS.some(function(s) { return s.key === shift; })) return fail_('SHIFT', 'Shift galat: ' + shift);
  if (!canWrite_(user, factory, dept)) return fail_('PERM', 'Is dept me entry ki permission nahi hai');

  var rows = Array.isArray(req.rows) ? req.rows : [];
  var clean = [], seen = {};
  for (var i = 0; i < rows.length; i++) {
    var role = str_(rows[i].role), hours = num_(rows[i].hours), count = num_(rows[i].count);
    if (!role) continue;
    if (seen[role]) return fail_('DUP', 'Role do baar aaya: ' + role);
    seen[role] = true;
    if (count < 0 || hours < 0 || hours > 12) return fail_('VAL', 'Galat hours/count: ' + role);
    if (count === 0) continue;
    clean.push({ role: role, hours: hours, count: count });
  }

  var srn = str_(req.srn), supervisor = str_(req.supervisor), incharge = str_(req.incharge), stamp = nowStr_();
  var qcNames = (Array.isArray(req.qc_names) ? req.qc_names.map(str_) : csv_(req.qc_names)).filter(String).join(',');
  var cat = deptCategory_(dept);
  if (clean.length && shift === 'Final') {
    if (!supervisor) return fail_('VAL', 'Supervisor ka naam zaroori hai');
    if (cat === 'STITCH' && !incharge) return fail_('VAL', 'Incharge ka naam zaroori hai');
  }
  var result = withLock_(function() {
    var existing = readDaily_(CFG.TABS.ATT_DAILY).filter(function(r) {
      return str_(r.date) === date && str_(r.factory) === factory && str_(r.dept) === dept && str_(r.shift) === shift;
    });
    deleteRows_(CFG.TABS.ATT_DAILY, existing.map(function(r) { return r._row; }));
    appendRows_(CFG.TABS.ATT_DAILY, clean.map(function(c) {
      return { id: uuid_(), date: date, factory: factory, dept: dept, shift: shift, role: c.role,
               hours: c.hours, count: c.count, entered_by: userName_(user), entered_at: stamp, srn: srn, supervisor: supervisor, incharge: incharge, qc_names: qcNames };
    }));
    return { replaced: existing.length, saved: clean.length };
  });

  audit_(user, 'att.save', date + '|' + factory + '|' + dept + '|' + shift, result);
  return { ok: true, saved: result.saved, replaced: result.replaced, at: stamp };
}

// Request: { date, factory }
// Reply:   { depts: [{dept, shift, manpower, manhours, by, at}] } — what has already been entered that day
function attStatus_(req, user) {
  var date = str_(req.date), factory = str_(req.factory);
  if (!isDateStr_(date)) return fail_('DATE', 'Date yyyy-mm-dd me bhejo');
  var agg = {};
  readDaily_(CFG.TABS.ATT_DAILY).forEach(function(r) {
    if (str_(r.date) !== date || str_(r.factory) !== factory) return;
    var k = str_(r.dept) + '|' + str_(r.shift);
    if (!agg[k]) agg[k] = { dept: str_(r.dept), shift: str_(r.shift), manpower: 0, manhours: 0, by: str_(r.entered_by), at: str_(r.entered_at), srn: str_(r.srn) };
    agg[k].manpower += num_(r.count);
    agg[k].manhours += num_(r.count) * num_(r.hours);
    if (str_(r.entered_at) > agg[k].at) { agg[k].at = str_(r.entered_at); agg[k].by = str_(r.entered_by); }
  });
  return { ok: true, depts: Object.keys(agg).map(function(k) { return agg[k]; }) };
}

// LINE_STAFF rows come from the stitching sheet: value = "MASTER NAME" (= Incharge), extra = "SUPERVISOR NAME".
function lineStaffOf_(dept) {
  var hit = mastersRows_().filter(function(r) { return str_(r.type) === 'LINE_STAFF' && str_(r.key) === dept; })[0];
  return { incharge: hit ? str_(hit.value) : '', supervisor: hit ? str_(hit.extra) : '' };
}
// Names entered with the day's attendance for a dept (+shift), falling back to LINE_STAFF
function attNames_(attRows, dept, shift) {
  var sup = '', inc = '';
  attRows.forEach(function(r) { if (str_(r.dept) !== dept || (shift && str_(r.shift) !== shift)) return; if (str_(r.supervisor)) sup = str_(r.supervisor); if (str_(r.incharge)) inc = str_(r.incharge); });
  var staff = lineStaffOf_(dept);
  return { supervisor: sup || staff.supervisor, incharge: inc || staff.incharge };
}

// Staff names: STAFF master (managed in the app) + LINE_STAFF from the stitching sheet + names typed earlier
function staffList_(req, user) {
  var sup = {}, inc = {}, qc = {};
  mastersRows_().forEach(function(r) {
    var t = str_(r.type);
    if (t === 'LINE_STAFF') { if (str_(r.value)) inc[str_(r.value)] = 1; if (str_(r.extra)) sup[str_(r.extra)] = 1; }
    if (t === 'STAFF' && isTrue_(r.active)) { var k = str_(r.value), n = str_(r.key); if (k === 'Supervisor') sup[n] = 1; else if (k === 'Incharge') inc[n] = 1; else if (k === 'Endline QC') qc[n] = 1; }
  });
  readDaily_(CFG.TABS.ATT_DAILY).forEach(function(r) { if (str_(r.supervisor)) sup[str_(r.supervisor)] = 1; if (str_(r.incharge)) inc[str_(r.incharge)] = 1; csv_(r.qc_names).forEach(function(n) { qc[n] = 1; }); });
  readDaily_(CFG.TABS.HOURLY_LOG).forEach(function(r) { if (str_(r.type) === 'ENDLINE' && str_(r.checker)) qc[str_(r.checker)] = 1; });
  historyCheckers_().forEach(function(n) { qc[n] = 1; });
  // a name hidden in the app (STAFF row active=FALSE) stays hidden even if history has it
  mastersRows_().forEach(function(r) { if (str_(r.type) === 'STAFF' && !isTrue_(r.active)) { var k = str_(r.value), n = str_(r.key); if (k === 'Endline QC') delete qc[n]; else if (k === 'Supervisor') delete sup[n]; else if (k === 'Incharge') delete inc[n]; } });
  return { ok: true, supervisors: Object.keys(sup).sort(), incharges: Object.keys(inc).sort(), qcs: Object.keys(qc).sort(), kinds: CFG.STAFF_KINDS };
}

// Endline checker names from MASTER DATA history (last ~120 days). Cached 6 h.
function historyCheckers_() {
  var hit = cacheGetBig_('hist_qc');
  if (hit) return hit;
  var names = {}, md = getSS_().getSheetByName(MASTER_SHEET_NAME);
  if (md && md.getLastRow() >= 3) {
    var cutoff = fmtDate_(new Date(new Date().getTime() - 120 * 86400000));
    md.getRange(3, 7, md.getLastRow() - 2, 1).getValues().forEach(function(row) {
      var e = parseJson_(row[0]);   // [entry, factory, prodDate, srn, item, dept, qfloor, checker, ...]
      if (!e || !str_(e[7])) return;
      if (dateKey_(e[2] || e[0]) < cutoff) return;
      names[str_(e[7]).trim()] = 1;
    });
  }
  var out = Object.keys(names);
  cachePutBig_('hist_qc', out, 21600);
  return out;
}

// { name, kind }  kind = Supervisor | Incharge | Endline QC   (any logged-in user can add; a removed name is set inactive)
function staffSave_(req, user) {
  var name = str_(req.name), kind = str_(req.kind);
  if (!name) return fail_('VAL', 'Naam likho');
  if (CFG.STAFF_KINDS.indexOf(kind) < 0) return fail_('VAL', 'Kind galat');
  var sh = tab_(CFG.TABS.MASTERS, true), head = CFG.HEADERS.MASTERS;
  var hit = readTab_(CFG.TABS.MASTERS).filter(function(r) { return str_(r.type) === 'STAFF' && str_(r.value) === kind && str_(r.key).toLowerCase() === name.toLowerCase(); })[0];
  if (hit) sh.getRange(hit._row, head.indexOf('active') + 1).setValue('TRUE');
  else appendRows_(CFG.TABS.MASTERS, [{ type: 'STAFF', key: name, value: kind, factory: str_(req.factory), extra: userName_(user), active: 'TRUE' }]);
  invalidateMasters_();
  audit_(user, 'staff.save', name, { kind: kind });
  return { ok: true };
}
function staffRemove_(req, user) {
  var name = str_(req.name), kind = str_(req.kind);
  var sh = tab_(CFG.TABS.MASTERS, true), head = CFG.HEADERS.MASTERS, n = 0;
  readTab_(CFG.TABS.MASTERS).forEach(function(r) { if (str_(r.type) === 'STAFF' && str_(r.value) === kind && str_(r.key) === name) { sh.getRange(r._row, head.indexOf('active') + 1).setValue('FALSE'); n++; } });
  if (!n) appendRows_(CFG.TABS.MASTERS, [{ type: 'STAFF', key: name, value: kind, factory: '', extra: 'hidden by ' + userName_(user), active: 'FALSE' }]); // hide a sheet-derived name too
  invalidateMasters_();
  return { ok: true };
}
