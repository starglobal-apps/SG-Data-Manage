// AttSync.js — attendance goes straight into the main attendance sheets (karigar att_666 / 117 / OT att) every time it is
// saved, changed or updated: no admin review. HR approves it there in the Status column.
//   entered / changed (att.save)         -> the line's rows of that date (+shift) are rewritten, Status blank
//   updated (absent / half day / events) -> rows rewritten, HR Status kept (same role, else the line's status)
//   OT / Night edited when already in the sheet -> Status kept
//   cancelled / line moved (att.save with no rows) -> the line's rows of that date (+shift) are removed
// A DAY_SUMMARY row (type ATT, status 'Synced') remembers it so the old app rows are cleaned up the next days.

// isUpdate: absent / half day / other manpower changes (keeps HR status). Returns { ok, rows, removed } or { ok:false, message }.
function attSync_(date, factory, dept, shift, user, isUpdate) {
  shift = shift || 'Final';
  try {
    var attAll = readDaily_(CFG.TABS.ATT_DAILY).filter(function(r) { return str_(r.date) === date && str_(r.factory) === factory; });
    var att = attAll.filter(function(r) { return str_(r.dept) === dept && str_(r.shift) === shift; });
    if (!att.length && isUpdate) return { ok: true, skipped: true };   // no app attendance: an update alone never empties the sheet
    var events = shift === 'Final' ? readDaily_(CFG.TABS.MANPOWER_EVENTS).filter(function(r) { return str_(r.date) === date && str_(r.factory) === factory; }) : [];
    var eff = att.length ? effectiveAttendanceDetail_(date, factory, dept, shift, attAll, events) : [];
    var nm = attNames_(attAll, dept, shift), srnRow = att.filter(function(r) { return str_(r.srn); })[0];
    var fin = finalRow_({ date: date, factory: factory, dept: dept, type: 'ATT', shift: shift },
                        { rows: eff, supervisor: nm.supervisor, incharge: nm.incharge, srn: srnRow ? str_(srnRow.srn) : '' });
    var T = CFG.FINAL_TARGETS[fin.target], res = {};
    withLock_(function() {
      var old = {}, n = deleteSheetAttRows_(T, date, dept, old, shift);
      var keep = isUpdate || (shift !== 'Final' && n > 0);
      fin.rows.forEach(function(row) { row.status = keep ? (old.byRole[str_(row.role)] || old.any || '') : ''; });
      if (fin.rows.length) appendFinal_(T, fin.rows);
      attSyncMark_(date, factory, dept, shift, eff, user);
      res = { ok: true, rows: fin.rows.length, removed: n, target: fin.target };
    });
    audit_(user, 'att.sync', date + '|' + factory + '|' + dept + '|' + shift, res);
    return res;
  } catch (e) {
    audit_(user, 'att.sync.fail', date + '|' + factory + '|' + dept + '|' + shift, String(e && e.message || e));
    return { ok: false, message: 'Main sheet me nahi gaya: ' + (e && e.message || e) };
  }
}

// one DAY_SUMMARY row per date/factory/dept/shift with status 'Synced' (replaces any older ATT row of that key)
function attSyncMark_(date, factory, dept, shift, eff, user) {
  var old = readTab_(CFG.TABS.DAY_SUMMARY).filter(function(r) {
    return str_(r.date) === date && str_(r.factory) === factory && str_(r.dept) === dept && str_(r.type) === 'ATT' && str_(r.shift) === shift;
  });
  deleteRows_(CFG.TABS.DAY_SUMMARY, old.map(function(r) { return r._row; }));
  var stamp = nowStr_(), mp = 0, mh = 0;
  eff.forEach(function(r) { mp += num_(r.count); mh += num_(r.count) * num_(r.hours); });
  appendRows_(CFG.TABS.DAY_SUMMARY, [{ id: uuid_(), date: date, factory: factory, line: lineOf_(dept), dept: dept, type: 'ATT', srn: '', shift: shift,
    payload: JSON.stringify({ rows: eff, manpower: mp, manhours: mh }), status: 'Synced', flags: '[]', submitted_by: userName_(user), submitted_at: stamp,
    reviewed_by: '', reviewed_at: '', remark: '', cleaned_at: '' }]);
}

// Every line's attendance of a date sent to the main sheet (used once for the day the flow changed; also runnable from
// the editor: attSyncDay('2026-10-01')). Lines already in the sheet keep their HR status.
function attSyncDay_(date, user) {
  var keys = {};
  readDaily_(CFG.TABS.ATT_DAILY).forEach(function(r) { if (str_(r.date) === date) keys[str_(r.factory) + '|' + str_(r.dept) + '|' + str_(r.shift)] = 1; });
  var out = [];
  Object.keys(keys).sort().forEach(function(k) {
    var p = k.split('|'), r = attSync_(date, p[0], p[1], p[2] || 'Final', user, true);
    if (r.skipped) r = attSync_(date, p[0], p[1], p[2] || 'Final', user, false);
    out.push(k + ' -> ' + (r.ok ? r.rows + ' rows (old ' + r.removed + ')' : r.message));
  });
  return out;
}
function attSyncDay(date) { var out = attSyncDay_(date || todayStr_(), { name: 'editor', user_id: 'editor', role: 'Admin' }); Logger.log(out.join('\n')); return out; }
