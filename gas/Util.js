// Util.js — shared helpers for the SG Data API

function getSS_() {
  if (CFG.SS_ID) return SpreadsheetApp.openById(CFG.SS_ID);
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  if (!ss) throw new Error('Spreadsheet not found. Set CFG.SS_ID in Config.js');
  return ss;
}

function tz_() { return Session.getScriptTimeZone() || 'Asia/Kolkata'; }
function fmtDate_(d) { return Utilities.formatDate(d, tz_(), 'yyyy-MM-dd'); }
function nowStr_() { return Utilities.formatDate(new Date(), tz_(), 'yyyy-MM-dd HH:mm:ss'); }
function todayStr_() { return fmtDate_(new Date()); }
function uuid_() { return Utilities.getUuid(); }

function isDateStr_(s) { return /^\d{4}-\d{2}-\d{2}$/.test(String(s || '')); }

function tab_(name, create) {
  var ss = getSS_();
  var sh = ss.getSheetByName(name);
  if (!sh && create) {
    sh = ss.insertSheet(name);
    var head = CFG.HEADERS[name];
    if (head) {
      sh.getRange(1, 1, 1, head.length).setValues([head]).setFontWeight('bold');
      sh.setFrozenRows(1);
      (CFG.TEXT_COLS[name] || []).forEach(function(col) {
        var idx = head.indexOf(col);
        if (idx >= 0) sh.getRange(2, idx + 1, sh.getMaxRows() - 1, 1).setNumberFormat('@');
      });
    }
  }
  return sh;
}

// Read a tab as an array of objects keyed by CFG.HEADERS. Adds _row (sheet row number).
function readTab_(name) {
  var sh = tab_(name, false);
  if (!sh) return [];
  var last = sh.getLastRow();
  if (last < 2) return [];
  var head = CFG.HEADERS[name];
  var vals = sh.getRange(2, 1, last - 1, head.length).getValues();
  var out = [];
  for (var i = 0; i < vals.length; i++) {
    var row = vals[i], o = { _row: i + 2 }, empty = true;
    for (var j = 0; j < head.length; j++) {
      var v = row[j];
      if (v !== '' && v !== null) empty = false;
      o[head[j]] = (v instanceof Date) ? fmtDate_(v) : v;
    }
    if (!empty) out.push(o);
  }
  return out;
}

function appendRows_(name, objs) {
  if (!objs || !objs.length) return;
  var sh = tab_(name, true);
  var head = CFG.HEADERS[name];
  var rows = objs.map(function(o) {
    return head.map(function(h) { var v = o[h]; return (v === undefined || v === null) ? '' : v; });
  });
  sh.getRange(sh.getLastRow() + 1, 1, rows.length, head.length).setValues(rows);
}

// Delete the given sheet row numbers (bottom-up so indices stay valid)
function deleteRows_(name, rowNums) {
  if (!rowNums.length) return;
  var sh = tab_(name, false);
  rowNums.sort(function(a, b) { return b - a; }).forEach(function(r) { sh.deleteRow(r); });
}

function audit_(user, action, ref, detail) {
  try {
    appendRows_(CFG.TABS.AUDIT_LOG, [{
      at: nowStr_(), user: user ? user.user_id : '', action: action, ref: ref || '',
      detail: typeof detail === 'string' ? detail : JSON.stringify(detail || '')
    }]);
  } catch (e) {}
}

function withLock_(fn) {
  var lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try { return fn(); } finally { lock.releaseLock(); }
}

function json_(o) {
  return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON);
}

function fail_(code, msg) { return { ok: false, error: code, message: msg || code }; }

function num_(v) { var n = Number(v); return isNaN(n) ? 0 : n; }
function str_(v) { return (v === undefined || v === null) ? '' : String(v).trim(); }
function csv_(v) { return str_(v).split(',').map(function(s) { return s.trim(); }).filter(String); }
