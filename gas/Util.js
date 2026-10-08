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

// ---------- storage: the app's tables live in a few sheets ----------
// CFG.STORE puts each table in a sheet: SETTINGS (= MASTERS), ATTENDANCE (attendance · changes · transfers),
// OUTPUT (output · review · log); USERS stays its own sheet. A sheet holding several tables has a first column
// 'table' that says which table each row belongs to, and the union of their columns (unused ones stay blank).
function store_(name) { return (CFG.STORE && CFG.STORE[name]) || { sheet: name }; }
function sheetOf_(name) { return store_(name).sheet; }
var PHYS_HEAD_ = {};
// the column headers of the sheet that holds table `name`
function physHeadOf_(name) {
  var sheet = sheetOf_(name);
  if (PHYS_HEAD_[sheet]) return PHYS_HEAD_[sheet];
  var members = Object.keys(CFG.HEADERS).filter(function(t) { return sheetOf_(t) === sheet; });
  var multi = members.some(function(t) { return store_(t).label; });
  var head = multi ? ['table'] : [];
  members.forEach(function(t) { CFG.HEADERS[t].forEach(function(h) { if (head.indexOf(h) < 0) head.push(h); }); });
  return (PHYS_HEAD_[sheet] = head);
}
function siblings_(name) { var sheet = sheetOf_(name); return Object.keys(CFG.HEADERS).filter(function(t) { return sheetOf_(t) === sheet; }); }

function tab_(name, create) {
  var ss = getSS_(), sheet = sheetOf_(name);
  var sh = ss.getSheetByName(sheet);
  if (!sh && create) {
    sh = ss.insertSheet(sheet);
    var head = physHeadOf_(name);
    if (sh.getMaxColumns() < head.length) sh.insertColumnsAfter(sh.getMaxColumns(), head.length - sh.getMaxColumns());
    sh.getRange(1, 1, 1, head.length).setValues([head]).setFontWeight('bold');
    sh.setFrozenRows(1);
    var text = {}; siblings_(name).forEach(function(t) { (CFG.TEXT_COLS[t] || []).forEach(function(c) { text[c] = 1; }); });
    Object.keys(text).forEach(function(col) { var idx = head.indexOf(col); if (idx >= 0) sh.getRange(2, idx + 1, sh.getMaxRows() - 1, 1).setNumberFormat('@'); });
  }
  return sh;
}

// Adds any header columns the sheet does not have yet (at their place in the CFG order).
function ensureHeaders_(name) {
  var sh = tab_(name, true), head = physHeadOf_(name);
  var cur = sh.getLastColumn() ? sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0].map(str_) : [];
  var added = [];
  head.forEach(function(h, i) {
    if (cur.indexOf(h) >= 0) return;
    sh.insertColumnBefore(i + 1);
    sh.getRange(1, i + 1).setValue(h).setFontWeight('bold');
    cur.splice(i, 0, h);
    added.push(h);
  });
  return added;
}

// rows (array of arrays from the sheet, starting at sheet row `first`) -> objects of table `name`, with _row
function rowsToObjs_(name, vals, first) {
  var head = physHeadOf_(name), label = store_(name).label, out = [];
  for (var i = 0; i < vals.length; i++) {
    var row = vals[i];
    if (label && str_(row[0]) !== label) continue;
    var o = { _row: first + i }, empty = true;
    for (var j = label ? 1 : 0; j < head.length; j++) {
      var v = row[j];
      if (v !== '' && v !== null && v !== undefined) empty = false;
      o[head[j]] = (v instanceof Date) ? fmtDate_(v) : (v === undefined ? '' : v);
    }
    if (!empty) out.push(o);
  }
  return out;
}

// Read a table as an array of objects keyed by its headers. Adds _row (sheet row number).
function readTab_(name) {
  var sh = tab_(name, false);
  if (!sh) return [];
  var last = sh.getLastRow();
  if (last < 2) return [];
  return rowsToObjs_(name, sh.getRange(2, 1, last - 1, physHeadOf_(name).length).getValues(), 2);
}

function appendRows_(name, objs) {
  if (!objs || !objs.length) return;
  var sh = tab_(name, true), head = physHeadOf_(name), label = store_(name).label;
  if (sh.getLastColumn() < head.length) ensureHeaders_(name); // a column was added to CFG after the sheet was created
  var rows = objs.map(function(o) {
    return head.map(function(h) { if (h === 'table' && label) return label; var v = o[h]; return (v === undefined || v === null) ? '' : v; });
  });
  sh.getRange(sh.getLastRow() + 1, 1, rows.length, head.length).setValues(rows);
  invalidateDaily_(name);
}

// Delete the given sheet row numbers (bottom-up so indices stay valid). The other tables of the same sheet move
// up too, so their cached copies go as well.
function deleteRows_(name, rowNums) {
  if (!rowNums.length) return;
  var sh = tab_(name, false);
  rowNums.sort(function(a, b) { return b - a; }).forEach(function(r) { sh.deleteRow(r); });
  siblings_(name).forEach(invalidateDaily_);
}

// one field of one row (row from readTab_ / readDaily_)
function setField_(name, row, field, value) {
  var c = physHeadOf_(name).indexOf(field) + 1;
  if (c > 0) tab_(name, true).getRange(row, c).setValue(value);
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
// The heavy sheet aggregates are served stale-while-revalidate: past their ttl they are still returned at once (kept up
// to 6 h), and the phone's quiet m.warm call (SWR_REFRESH_ = true) rebuilds the ones that are past it. So nobody waits
// for a rebuild from the sheets (that took 7+ s); data is at most ~ttl old while the app is in use.
var SWR_KEYS_ = { plan_agg: 1, app_summary: 1, hist_agg2: 1, loading_agg: 1, sheet_att2: 1, orders_agg: 1, unload_agg: 1, bulletin_sam: 1, masters_rows: 1, loading_rows: 1 };
var SWR_REFRESH_ = false;
function cachePutBig_(key, obj, ttl) {
  try {
    var json = JSON.stringify(obj), size = 90000, parts = [];
    for (var i = 0; i < json.length; i += size) parts.push(json.slice(i, i + size));
    var c = CacheService.getScriptCache(), map = { };
    parts.forEach(function(pt, i) { map[key + '#' + i] = pt; });
    map[key + '#n'] = String(parts.length);
    map[key + '#t'] = String(Date.now() + (ttl || 600) * 1000);   // soft expiry
    c.putAll(map, SWR_KEYS_[key] ? 21600 : (ttl || 600));
    if (SWR_KEYS_[key]) bumpData_();   // sheet data rebuilt: phone replies are made again
  } catch (e) {}
}
function cacheGetBig_(key) {
  try {
    var c = CacheService.getScriptCache(), head = c.getAll([key + '#n', key + '#t']), n = Number(head[key + '#n'] || 0);
    if (!n) return null;
    if (SWR_KEYS_[key] && SWR_REFRESH_ && Date.now() > Number(head[key + '#t'] || 0)) return null;   // m.warm: rebuild the stale ones
    var keys = []; for (var i = 0; i < n; i++) keys.push(key + '#' + i);
    var got = c.getAll(keys), json = '';
    for (var j = 0; j < n; j++) { if (!got[key + '#' + j]) return null; json += got[key + '#' + j]; }
    return JSON.parse(json);
  } catch (e) { return null; }
}
function cacheDelBig_(key) {
  try {
    var c = CacheService.getScriptCache(), n = Number(c.get(key + '#n') || 0), keys = [key + '#n', key + '#t'];
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
  if (store_(name).label) n = n * 2;   // the sheet holds other tables too
  var start = Math.max(2, last - n + 1);
  return rowsToObjs_(name, sh.getRange(start, 1, last - start + 1, physHeadOf_(name).length).getValues(), start);
}
// Day views: last 3000 rows, memoised per execution and cached 10 min across executions; every app write invalidates
// (appendRows_ / deleteRows_ / status updates), and the phone's "Fresh data" clears them too.
var DAILY_MEM_ = {};
function readDaily_(name) {
  if (DAILY_MEM_[name]) return DAILY_MEM_[name];
  var hit = cacheGetBig_('daily:' + name);
  if (hit) { DAILY_MEM_[name] = hit; return hit; }
  var rows = readRecent_(name, 3000);
  cachePutBig_('daily:' + name, rows, 600);
  DAILY_MEM_[name] = rows;
  return rows;
}
function invalidateDaily_(name) { delete DAILY_MEM_[name]; cacheDelBig_('daily:' + name); bumpData_(); }
// version of the app's data: changes on every write / rebuild, so a ready-made phone reply (m.all) is never stale
function bumpData_() { try { CacheService.getScriptCache().put('data_ver', String(Date.now()) + Math.random(), 21600); } catch (e) {} }
function dataVer_() { try { return CacheService.getScriptCache().get('data_ver') || '0'; } catch (e) { return '0'; } }
function clearAllCaches_() {
  ['loading_agg', 'hist_agg', 'hist_agg2', 'app_agg', 'masters_rows', 'users_rows', 'hist_qc', 'defects_master', 'sheet_att', 'sheet_att2', 'orders_agg', 'unload_agg', 'bulletin_sam'].forEach(cacheDelBig_);
  Object.keys(CFG.TABS).forEach(function(k) { invalidateDaily_(CFG.TABS[k]); });
}

// MASTERS rows, cached 10 min (invalidated by setup/reseed)
var MASTERS_MEM_ = null;
function mastersRows_() {
  if (MASTERS_MEM_) return MASTERS_MEM_;
  var hit = cacheGetBig_('masters_rows');
  if (hit) return (MASTERS_MEM_ = hit);
  var rows = readTab_(CFG.TABS.MASTERS);
  cachePutBig_('masters_rows', rows, 600);
  return rows;
}
function invalidateMasters_() { MASTERS_MEM_ = null; cacheDelBig_('masters_rows'); bumpData_(); }

function userName_(u) { return u ? (str_(u.name) || str_(u.user_id)) : ''; }
