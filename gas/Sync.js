// Sync.js — what happens AFTER "Send to Final":
//   1. the rows are in the source sheets (reviewSend_)            2. runAllImport() pulls them into MASTER DATA
//   3. cleanupSent_() deletes the app copies (HOURLY_LOG / ATT_DAILY / MANPOWER_EVENTS) so nothing is counted twice
//   4. caches cleared -> the app continues from MASTER DATA.
// Steps 2-4 run in a one-off trigger a few seconds after the send (afterSendJob), or by hand: admin.importNow.

var AFTER_SEND_FN = 'afterSendJob';

// No triggers (the web app's account has no trigger permission): the import + cleanup is marked as due and runs in the
// next quiet background call from a phone (m.warm, at most every 3 min while anyone has the app open) — or at once
// when the admin taps "Import data".
function scheduleAfterSend_() {
  try { PropertiesService.getScriptProperties().setProperty('IMPORT_DUE', String(Date.now())); return true; } catch (e) { return false; }
}
function runDueImport_() {
  var props = PropertiesService.getScriptProperties();
  if (!props.getProperty('IMPORT_DUE')) return '';
  props.deleteProperty('IMPORT_DUE');
  return afterSendJob();
}

// Trigger entry point (also run once by hand from the editor to grant the trigger permission)
function afterSendJob() {
  // guard with a property (not the script lock: cleanupSent_ / import take the lock themselves)
  var props = PropertiesService.getScriptProperties(), running = Number(props.getProperty('SYNC_RUNNING') || 0);
  if (running && Date.now() - running < 10 * 60000) return 'busy';
  props.setProperty('SYNC_RUNNING', String(Date.now()));
  var log = [];
  try {
    var t0 = new Date().getTime();
    var imp = runAllImport();
    log.push('import ' + Math.round((new Date().getTime() - t0) / 1000) + 's' + (/FAIL/.test(String(imp)) ? ' (with FAIL lines)' : ''));
    if (/READ FAIL|SHEET WRITE FAIL/.test(String(imp))) { log.push('cleanup skipped — import had failures'); }
    else { var c = cleanupSent_(); log.push('cleanup: ' + JSON.stringify(c)); }
    clearAllCaches_();
  } catch (e) { log.push('ERROR ' + (e && e.message || e)); }
  finally { props.deleteProperty('SYNC_RUNNING'); }
  try { appendRows_(CFG.TABS.AUDIT_LOG, [{ at: nowStr_(), user: 'trigger', action: 'sync.afterSend', ref: '', detail: log.join(' | ') }]); } catch (e3) {}
  return log.join('\n');
}

// Admin button: import + cleanup in the background (one-off trigger, ~20 s later)
function adminImportNow_(req, user) {
  if (!isAdmin_(user)) return fail_('PERM', 'Sirf admin');
  var running = Number(PropertiesService.getScriptProperties().getProperty('SYNC_RUNNING') || 0);
  if (running && Date.now() - running < 10 * 60000) return { ok: true, scheduled: false, running: true };
  // runs now (about 10 s): main sheets -> MASTER DATA, then the app copies of sent data are cleaned
  var log = afterSendJob();
  if (log === 'busy') return { ok: true, running: true };
  return { ok: true, done: true, log: log };
}

// Delete the app copies of every DAY_SUMMARY row that is Sent and not yet cleaned.
//   STITCH / ENDLINE / PACKING -> HOURLY_LOG rows (date, factory, dept, type, srn, shift)
//   ATT (only for days before today, the app still needs today's attendance) -> ATT_DAILY rows (date, factory, dept, shift)
//        + MANPOWER_EVENTS of that dept/date when the Final shift goes
function cleanupSent_() {
  var today = todayStr_(), head = physHeadOf_(CFG.TABS.DAY_SUMMARY), sh = tab_(CFG.TABS.DAY_SUMMARY, true);
  if (head.indexOf('cleaned_at') < 0) return { error: 'cleaned_at column missing in CFG' };
  if (sh.getLastColumn() < head.length) ensureHeaders_(CFG.TABS.DAY_SUMMARY);
  var ds = readTab_(CFG.TABS.DAY_SUMMARY).filter(function(r) { return (str_(r.status) === 'Sent' || str_(r.status) === 'Synced') && !str_(r.cleaned_at); });
  if (!ds.length) return { rows: 0 };
  var hourly = readTab_(CFG.TABS.HOURLY_LOG), att = readTab_(CFG.TABS.ATT_DAILY), ev = readTab_(CFG.TABS.MANPOWER_EVENTS);
  var delH = {}, delA = {}, delE = {}, done = [], stamp = nowStr_();
  ds.forEach(function(r) {
    var date = str_(r.date), factory = str_(r.factory), dept = str_(r.dept), type = str_(r.type), srn = str_(r.srn), shift = str_(r.shift);
    if (type === 'ATT') {
      if (date >= today) return;   // today's attendance stays until tomorrow
      att.forEach(function(a) { if (str_(a.date) === date && str_(a.factory) === factory && str_(a.dept) === dept && str_(a.shift) === shift) delA[a._row] = 1; });
      if (shift === 'Final') ev.forEach(function(e) { if (str_(e.date) === date && str_(e.factory) === factory && str_(e.dept) === dept) delE[e._row] = 1; });
    } else {
      hourly.forEach(function(h) { if (str_(h.date) === date && str_(h.factory) === factory && str_(h.dept) === dept && str_(h.type) === type && str_(h.srn) === srn && str_(h.shift) === shift) delH[h._row] = 1; });
    }
    done.push(r);
  });
  var toNums = function(m) { return Object.keys(m).map(Number); };
  withLock_(function() {
    deleteRows_(CFG.TABS.HOURLY_LOG, toNums(delH));
    deleteRows_(CFG.TABS.ATT_DAILY, toNums(delA));
    deleteRows_(CFG.TABS.MANPOWER_EVENTS, toNums(delE));
    var cc = head.indexOf('cleaned_at') + 1;
    done.forEach(function(r) { sh.getRange(r._row, cc).setValue(stamp); });
  });
  invalidateDaily_(CFG.TABS.DAY_SUMMARY); invalidateAppAgg_();
  // the log (OUTPUT sheet, table 'Log') keeps the last 30 days only
  try { var old = fmtDate_(new Date(new Date().getTime() - 30 * 86400000)), lg = readTab_(CFG.TABS.AUDIT_LOG).filter(function(r) { var a = str_(r.at).slice(0, 10); return a && a < old; });
        if (lg.length) withLock_(function() { deleteRows_(CFG.TABS.AUDIT_LOG, lg.map(function(r) { return r._row; })); }); } catch (e) {}
  return { rows: done.length, hourly: toNums(delH).length, att: toNums(delA).length, events: toNums(delE).length };
}

// Admin: today's attendance straight to review — builds the ATT day rows for the chosen depts, approves and sends them.
// { date, factory, depts: [] }
function attSend_(req, user) {
  if (!isAdmin_(user)) return fail_('PERM', 'Sirf admin');
  var date = str_(req.date), factory = str_(req.factory), depts = (Array.isArray(req.depts) ? req.depts : []).map(str_).filter(String);
  if (!isDateStr_(date)) return fail_('DATE', 'Date galat');
  if (!depts.length) return fail_('VAL', 'Line chuno');
  var ids = [];
  depts.forEach(function(d) {
    var b = dayBuild_({ date: date, factory: factory, dept: d, onlyType: 'ATT' }, user);
    if (!b.ok) return;
  });
  var sh = tab_(CFG.TABS.DAY_SUMMARY, true), head = physHeadOf_(CFG.TABS.DAY_SUMMARY), stamp = nowStr_();
  var ci = { status: head.indexOf('status') + 1, sby: head.indexOf('submitted_by') + 1, sat: head.indexOf('submitted_at') + 1, rby: head.indexOf('reviewed_by') + 1, rat: head.indexOf('reviewed_at') + 1 };
  withLock_(function() {
    readTab_(CFG.TABS.DAY_SUMMARY).forEach(function(r) {
      if (str_(r.date) !== date || str_(r.factory) !== factory || str_(r.type) !== 'ATT' || depts.indexOf(str_(r.dept)) < 0) return;
      if (isLocked_(str_(r.status)) && str_(r.status) !== 'Approved') return;
      sh.getRange(r._row, ci.status).setValue('Approved');
      sh.getRange(r._row, ci.sby).setValue(userName_(user)); sh.getRange(r._row, ci.sat).setValue(stamp);
      sh.getRange(r._row, ci.rby).setValue(userName_(user)); sh.getRange(r._row, ci.rat).setValue(stamp);
      ids.push(str_(r.id));
    });
  });
  invalidateDaily_(CFG.TABS.DAY_SUMMARY);
  if (!ids.length) return fail_('NONE', 'Is date ki attendance nahi mili (ya pehle se Sent hai)');
  audit_(user, 'att.send', date + '|' + factory, { depts: depts, ids: ids.length });
  return reviewSend_({ ids: ids }, user);
}

// Admin: the day's attendance per line/shift with its review status — for the Review tab
function attToday_(req, user) {
  if (!isAdmin_(user)) return fail_('PERM', 'Sirf admin');
  var date = str_(req.date) || todayStr_(), factory = str_(req.factory);
  var byKey = {};
  readDaily_(CFG.TABS.ATT_DAILY).forEach(function(r) {
    if (str_(r.date) !== date || (factory && str_(r.factory) !== factory)) return;
    var k = str_(r.dept) + '|' + str_(r.shift);
    if (!byKey[k]) byKey[k] = { dept: str_(r.dept), shift: str_(r.shift), manpower: 0, manhours: 0, srn: str_(r.srn), supervisor: str_(r.supervisor), incharge: str_(r.incharge), by: str_(r.entered_by), at: str_(r.entered_at), status: '' };
    byKey[k].manpower += num_(r.count); byKey[k].manhours += num_(r.count) * num_(r.hours);
  });
  readDaily_(CFG.TABS.DAY_SUMMARY).forEach(function(r) {
    if (str_(r.date) !== date || (factory && str_(r.factory) !== factory) || str_(r.type) !== 'ATT') return;
    var k = str_(r.dept) + '|' + str_(r.shift); if (byKey[k]) byKey[k].status = str_(r.status);
  });
  var list = Object.keys(byKey).map(function(k) { return byKey[k]; });
  list.sort(function(a, b) { return a.dept.localeCompare(b.dept) || a.shift.localeCompare(b.shift); });
  return { ok: true, date: date, items: list };
}
