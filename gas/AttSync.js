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
    var events = shift === 'Final' ? readDaily_(CFG.TABS.MANPOWER_EVENTS).filter(function(r) { return str_(r.date) === date && str_(r.factory) === factory; }) : [];
    var hasEv = events.some(function(e) { return str_(e.dept) === dept; });
    if (!att.length && !hasEv && isUpdate) return { ok: true, skipped: true };   // nothing in the app: an update alone never empties the sheet
    var eff = att.length || hasEv ? effectiveAttendanceDetail_(date, factory, dept, shift, attAll, events) : [];
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

// Brings attendance back into the app (one-off, 9 Oct 2026: the cleanup had removed the previous days' app rows).
// Source = the app's own record of each line's day (the review row's payload: the effective rows the app had at the last
// save); SRN / supervisor / incharge come from the main attendance sheet. { from, to }: every date|line|shift in the range
// with a review row and no app rows any more. Per role: the longest-hours part is the attendance row, shorter parts
// become HALF_DAY changes, "Absent n" in the remark becomes an ABSENT change.
function attRestore_(from, to) {
  var have = {}, log = [];
  readTab_(CFG.TABS.ATT_DAILY).forEach(function(r) { have[[str_(r.date), str_(r.dept), str_(r.shift)].join('|')] = 1; });
  // names + SRN per date|dept|shift from the main sheets
  var names = {};
  ['ATT_666', 'ATT_117', 'ATT_OT'].forEach(function(tk) {
    var T = CFG.FINAL_TARGETS[tk], col = {}; Object.keys(T.cols).forEach(function(c) { col[T.cols[c]] = +c - 1; });
    var v = Sheets.Spreadsheets.Values.get(srcId_(T.srcKey), "'" + T.sheet + "'!A" + T.minRow + ':P', { valueRenderOption: 'UNFORMATTED_VALUE', dateTimeRenderOption: 'FORMATTED_STRING' }).values || [];
    v.forEach(function(r) {
      var g = function(f) { return col[f] === undefined ? '' : (r[col[f]] === undefined ? '' : r[col[f]]); };
      var d = dateKey_(g('date')); if (d < from || d > to || !str_(g('dept'))) return;
      var shift = tk === 'ATT_OT' ? (/night/i.test(str_(g('otType'))) ? 'Night' : 'OT') : 'Final', k = [d, str_(g('dept')), shift].join('|');
      var n = names[k] = names[k] || { srn: '', sup: '', inc: '' };
      n.srn = n.srn || str_(g('srn')); n.sup = n.sup || str_(g('supervisor')); n.inc = n.inc || str_(g('incharge'));
    });
  });
  var stamp = nowStr_(), rows = [], evs = [];
  readTab_(CFG.TABS.DAY_SUMMARY).forEach(function(r) {
    if (str_(r.type) !== 'ATT' || str_(r.date) < from || str_(r.date) > to) return;
    var date = str_(r.date), factory = str_(r.factory), dept = str_(r.dept), shift = str_(r.shift) || 'Final', k = [date, dept, shift].join('|');
    if (have[k]) return; have[k] = 1;
    var eff = parseJsonObj_(r.payload).rows || [], byRole = {};
    eff.forEach(function(x) { var o = byRole[str_(x.role)] = byRole[str_(x.role)] || { hours: 0, parts: [], absent: 0 }; o.hours = Math.max(o.hours, num_(x.hours)); o.parts.push({ h: num_(x.hours), n: num_(x.count) }); var ab = str_(x.remark).match(/Absent\s+(\d+)/i); if (ab) o.absent += num_(ab[1]); });
    var nm = names[k] || { srn: '', sup: '', inc: '' }, total = 0;
    Object.keys(byRole).forEach(function(role) {
      var o = byRole[role], count = o.parts.reduce(function(t, p) { return t + p.n; }, 0); if (!count) return; total += count;
      rows.push({ id: uuid_(), date: date, factory: factory, dept: dept, shift: shift, role: role, hours: o.hours, count: count,
                  entered_by: 'restored', entered_at: stamp, srn: nm.srn, supervisor: nm.sup, incharge: nm.inc, qc_names: '', keep_status: '1' });
      if (shift === 'Final') {
        o.parts.forEach(function(p) { if (p.h < o.hours && p.n > 0) evs.push({ id: uuid_(), date: date, factory: factory, dept: dept, role: role, event: 'HALF_DAY', count: p.n, time: '', eff_hours: p.h, note: 'restored', entered_by: 'restored', entered_at: stamp }); });
        if (o.absent) evs.push({ id: uuid_(), date: date, factory: factory, dept: dept, role: role, event: 'ABSENT', count: o.absent, time: '', eff_hours: 0, note: 'restored', entered_by: 'restored', entered_at: stamp });
      }
    });
    if (total) log.push(k + ': ' + total + ' people');
  });
  withLock_(function() { if (rows.length) appendRows_(CFG.TABS.ATT_DAILY, rows); if (evs.length) appendRows_(CFG.TABS.MANPOWER_EVENTS, evs); });
  return { lines: log, rows: rows.length, events: evs.length };
}
// removes what attRestore_ added (so it can run again)
function attRestoreUndo_() {
  var a = readTab_(CFG.TABS.ATT_DAILY).filter(function(r) { return str_(r.entered_by) === 'restored'; }).map(function(r) { return r._row; });
  var e = readTab_(CFG.TABS.MANPOWER_EVENTS).filter(function(r) { return str_(r.note) === 'restored'; }).map(function(r) { return r._row; });
  withLock_(function() { deleteRowsMany_([{ table: CFG.TABS.ATT_DAILY, rows: a }, { table: CFG.TABS.MANPOWER_EVENTS, rows: e }]); });
  return { att: a.length, events: e.length };
}
