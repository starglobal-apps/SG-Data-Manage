// Migrate.js — one-time move (1 Oct 2026) of the app's tables into fewer sheets (see CFG.STORE):
//   MASTERS -> renamed SETTINGS · ATT_DAILY, MANPOWER_EVENTS, TRANSFERS -> ATTENDANCE · HOURLY_LOG, DAY_SUMMARY, AUDIT_LOG -> OUTPUT
//   ACTIVE_ORDERS (empty, unused) removed.
// Every row is copied; an old tab is removed only when the new sheet has exactly as many rows of that table.
// Rows already in the new sheet (same id; log rows: same time + action + ref) are not copied twice, so it is safe to run
// again and nothing written meanwhile is lost. (Google Sheets version history keeps the old state.)
function migrateSheets(only) {
  var ss = getSS_(), log = [];
  withLock_(function() {
    var m = ss.getSheetByName('MASTERS');
    if (m && !ss.getSheetByName('SETTINGS')) { m.setName('SETTINGS'); log.push('MASTERS renamed to SETTINGS (' + Math.max(0, m.getLastRow() - 1) + ' rows)'); }
    // (MASTERS is in the list too: if a SETTINGS sheet appeared before the rename, the MASTERS rows are merged into it)
    ['MASTERS', 'ATT_DAILY', 'MANPOWER_EVENTS', 'TRANSFERS', 'HOURLY_LOG', 'DAY_SUMMARY', 'AUDIT_LOG'].forEach(function(name) {
      if (only && only !== name) return;   // one table per run keeps each run short
      var old = ss.getSheetByName(name);
      if (old && old.getName() === sheetOf_(name)) return;
      var tgt = ss.getSheetByName(sheetOf_(name));
      if (tgt && !tgt.getLastColumn()) ss.deleteSheet(tgt);   // created without its header (an earlier run stopped): make it again
      if (!old) { log.push(name + ': no old tab'); return; }
      var key = function(r) { return str_(r.id) || (name === 'MASTERS' ? [str_(r.type), str_(r.key), str_(r.factory), str_(r.value)].join('|') : [str_(r.at), str_(r.action), str_(r.ref)].join('|')); };
      var have = {}, already = readTab_(name); already.forEach(function(r) { have[key(r)] = 1; });
      var lr = old.getLastRow(), lc = old.getLastColumn(), rows = [];
      if (lr >= 2) {
        var head = old.getRange(1, 1, 1, lc).getValues()[0].map(str_);
        old.getRange(2, 1, lr - 1, lc).getValues().forEach(function(r) {
          var o = {}, empty = true;
          head.forEach(function(h, i) { if (!h) return; o[h] = r[i]; if (r[i] !== '' && r[i] !== null) empty = false; });
          if (!empty && !have[key(o)]) rows.push(o);
        });
      }
      for (var i = 0; i < rows.length; i += 500) appendRows_(name, rows.slice(i, i + 500));
      SpreadsheetApp.flush();
      var moved = readTab_(name).length;
      if (moved !== rows.length + already.length) { log.push(name + ': COUNT MISMATCH copied ' + rows.length + ' + already ' + already.length + ' but new sheet has ' + moved + ' — old tab kept'); return; }
      ss.deleteSheet(old);
      log.push(name + ': ' + rows.length + ' rows -> ' + sheetOf_(name) + (already.length ? ' (+' + already.length + ' already there)' : '') + ' (old tab removed)');
    });
    var ao = ss.getSheetByName('ACTIVE_ORDERS');
    if ((!only || only === 'ACTIVE_ORDERS') && ao && ao.getLastRow() <= 1) { ss.deleteSheet(ao); log.push('ACTIVE_ORDERS (empty) removed'); }
    clearAllCaches_();
  });
  Logger.log(log.join('\n'));
  return log;
}
