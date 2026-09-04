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

  var today = all.filter(function(r) { return str_(r.date) === date; });
  if (today.length) return { ok: true, rows: today.map(attRowOut_), srn: str_(today[0].srn), prefill: false, prefillDate: '' };

  var earlier = all.filter(function(r) { return str_(r.date) < date; });
  if (!earlier.length) return { ok: true, rows: [], srn: '', prefill: false, prefillDate: '' };
  var latest = earlier.reduce(function(a, r) { return str_(r.date) > a ? str_(r.date) : a; }, '');
  var rows = earlier.filter(function(r) { return str_(r.date) === latest; });
  return { ok: true, rows: rows.map(attRowOut_), srn: str_(rows[0].srn), prefill: true, prefillDate: latest };
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

  var srn = str_(req.srn), stamp = nowStr_();
  var result = withLock_(function() {
    var existing = readDaily_(CFG.TABS.ATT_DAILY).filter(function(r) {
      return str_(r.date) === date && str_(r.factory) === factory && str_(r.dept) === dept && str_(r.shift) === shift;
    });
    deleteRows_(CFG.TABS.ATT_DAILY, existing.map(function(r) { return r._row; }));
    appendRows_(CFG.TABS.ATT_DAILY, clean.map(function(c) {
      return { id: uuid_(), date: date, factory: factory, dept: dept, shift: shift, role: c.role,
               hours: c.hours, count: c.count, entered_by: userName_(user), entered_at: stamp, srn: srn };
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
