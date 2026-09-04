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

// Adds any header columns that CFG.HEADERS has but the sheet does not (appended at the end, in order).
// Column order in CFG.HEADERS must match the sheet for existing columns; new ones are appended.
function ensureHeaders_(name) {
  var sh = tab_(name, true), head = CFG.HEADERS[name];
  var cur = sh.getLastColumn() ? sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0].map(str_) : [];
  var added = [];
  head.forEach(function(h, i) {
    if (cur.indexOf(h) >= 0) return;
    // insert at position i so CFG order and sheet order stay aligned
    sh.insertColumnBefore(i + 1);
    sh.getRange(1, i + 1).setValue(h).setFontWeight('bold');
    cur.splice(i, 0, h);
    added.push(h);
  });
  return added;
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
      at: nowStr_(), user: user ? userName_(user) : '', action: action, ref: ref || '',
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

// ---------- chunked CacheService (values > 100 KB) ----------
function cachePutBig_(key, obj, ttl) {
  try {
    var json = JSON.stringify(obj), size = 90000, parts = [];
    for (var i = 0; i < json.length; i += size) parts.push(json.slice(i, i + size));
    var c = CacheService.getScriptCache(), map = { };
    parts.forEach(function(pt, i) { map[key + '#' + i] = pt; });
    map[key + '#n'] = String(parts.length);
    c.putAll(map, ttl || 600);
  } catch (e) {}
}
function cacheGetBig_(key) {
  try {
    var c = CacheService.getScriptCache(), n = Number(c.get(key + '#n') || 0);
    if (!n) return null;
    var keys = []; for (var i = 0; i < n; i++) keys.push(key + '#' + i);
    var got = c.getAll(keys), json = '';
    for (var j = 0; j < n; j++) { if (!got[key + '#' + j]) return null; json += got[key + '#' + j]; }
    return JSON.parse(json);
  } catch (e) { return null; }
}
function cacheDelBig_(key) {
  try {
    var c = CacheService.getScriptCache(), n = Number(c.get(key + '#n') || 0), keys = [key + '#n'];
    for (var i = 0; i < n; i++) keys.push(key + '#' + i);
    c.removeAll(keys);
  } catch (e) {}
}

// Last `n` rows of a tab (daily tabs grow chronologically, so recent rows are all a day view needs)
function readRecent_(name, n) {
  var sh = tab_(name, false);
  if (!sh) return [];
  var last = sh.getLastRow();
  if (last < 2) return [];
  var head = CFG.HEADERS[name], start = Math.max(2, last - n + 1);
  var vals = sh.getRange(start, 1, last - start + 1, head.length).getValues();
  var out = [];
  for (var i = 0; i < vals.length; i++) {
    var row = vals[i], o = { _row: start + i }, empty = true;
    for (var j = 0; j < head.length; j++) {
      var v = row[j];
      if (v !== '' && v !== null) empty = false;
      o[head[j]] = (v instanceof Date) ? fmtDate_(v) : v;
    }
    if (!empty) out.push(o);
  }
  return out;
}
function readDaily_(name) { return readRecent_(name, 3000); }

// MASTERS rows, cached 10 min (invalidated by setup/reseed)
function mastersRows_() {
  var hit = cacheGetBig_('masters_rows');
  if (hit) return hit;
  var rows = readTab_(CFG.TABS.MASTERS);
  cachePutBig_('masters_rows', rows, 600);
  return rows;
}
function invalidateMasters_() { cacheDelBig_('masters_rows'); }

function userName_(u) { return u ? (str_(u.name) || str_(u.user_id)) : ''; }
