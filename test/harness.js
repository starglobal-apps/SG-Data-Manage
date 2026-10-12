// Run from the repo root: node test/harness.js   (expects '0 FAIL')
// End-to-end harness: the real gas/*.js server code on fake Google services + in-memory spreadsheets.
var fs = require('fs'), vm = require('vm'), crypto = require('crypto');
var RESULTS = []; function check(name, ok, info) { RESULTS.push((ok ? 'PASS ' : 'FAIL ') + name + (info !== undefined && !ok ? ' -> ' + JSON.stringify(info) : '')); }
// ---------- fake sheets ----------
function colNum(l) { var n = 0; for (var i = 0; i < l.length; i++) n = n * 26 + (l.charCodeAt(i) - 64); return n; }
function Sheet(ss, name) { this.ss = ss; this.name = name; this.data = []; this.maxCols = 30; this.maxRows = 2000; this.id = Math.floor(Math.random() * 1e6); }
Sheet.prototype = {
  getName() { return this.name; }, setName(n) { this.name = n; }, getSheetId() { return this.id; },
  getLastRow() { var last = 0; this.data.forEach((r, i) => { if (r && r.some(c => c !== '' && c !== null && c !== undefined)) last = i + 1; }); return last; },
  getLastColumn() { var m = 0; this.data.forEach(r => { if (!r) return; for (var j = r.length - 1; j >= 0; j--) if (r[j] !== '' && r[j] !== undefined && r[j] !== null) { m = Math.max(m, j + 1); break; } }); return m; },
  getMaxColumns() { return this.maxCols; }, getMaxRows() { return this.maxRows; },
  insertColumnsAfter(a, n) { this.maxCols += n; }, insertRowsAfter(a, n) { this.maxRows += n; }, setFrozenRows() {}, clear() { this.data = []; },
  deleteRow(r) { this.data.splice(r - 1, 1); },
  insertColumnBefore(c) { this.data.forEach(r => { if (r) r.splice(c - 1, 0, ''); }); this.maxCols++; },
  getRange(a, b, c, d) {
    var sh = this, r, col, nr, nc;
    if (typeof a === 'string') { var m = a.match(/^([A-Z]+)(\d+)(?::([A-Z]+)(\d+)?)?$/); r = +m[2]; col = colNum(m[1]); nc = m[3] ? colNum(m[3]) - col + 1 : 1; nr = m[4] ? +m[4] - r + 1 : (m[3] ? Math.max(1, sh.getLastRow() - r + 1) : 1); }
    else { r = a; col = b; nr = c || 1; nc = d || 1; }
    if (col + nc - 1 > sh.maxCols) throw new Error('Range out of bounds (cols ' + (col + nc - 1) + ' > ' + sh.maxCols + ') on ' + sh.name);
    var R = {
      setValues(v) { v.forEach((row, i) => { var rr = sh.data[r - 1 + i] = sh.data[r - 1 + i] || []; row.forEach((x, j) => rr[col - 1 + j] = x); }); return R; },
      setValue(x) { var rr = sh.data[r - 1] = sh.data[r - 1] || []; rr[col - 1] = x; return R; }, setFormula(f) { return R.setValue(f); },
      getValue() { return R.getValues()[0][0]; },
      getValues() { var out = []; for (var i = 0; i < nr; i++) { var row = sh.data[r - 1 + i] || [], o = []; for (var j = 0; j < nc; j++) { var v = row[col - 1 + j]; o.push(v === undefined || v === null ? '' : v); } out.push(o); } return out; },
      getDisplayValues() { return R.getValues().map(row => row.map(v => v instanceof Date ? fmt(v, 'dd-MMM-yyyy') : String(v))); },
      getFormulas() { return R.getValues().map(row => row.map(v => typeof v === 'string' && v[0] === '=' ? v : '')); },
      setFontWeight() { return R; }, setNumberFormat() { return R; }
    };
    return R;
  }
};
function Spreadsheet(id, name) { this.id = id; this.name = name; this.sheets = []; }
Spreadsheet.prototype = { getId() { return this.id; }, getName() { return this.name; }, getSheets() { return this.sheets.slice(); },
  getSheetByName(n) { return this.sheets.find(s => s.name === n) || null; }, insertSheet(n) { var s = new Sheet(this, n); this.sheets.push(s); return s; },
  deleteSheet(s) { this.sheets = this.sheets.filter(x => x !== s); }, setActiveSheet() {}, moveActiveSheet() {} };
var SSS = {}; function ssById(id) { if (!SSS[id]) SSS[id] = new Spreadsheet(id, id); return SSS[id]; }
var APP = ssById('APP');
// A1 range on a spreadsheet: "'Sheet'!A10:L" | "A1:B2"
function parseRange(ss, a1) {
  var sheetName = null, cells = a1, m = a1.match(/^'((?:[^']|'')*)'!(.*)$/); if (m) { sheetName = m[1].replace(/''/g, "'"); cells = m[2]; } else if ((m = a1.match(/^([^!]+)!(.*)$/))) { sheetName = m[1]; cells = m[2]; }
  var sh = sheetName ? ss.getSheetByName(sheetName) : ss.sheets[0]; if (!sh) throw new Error('Unable to parse range: ' + a1);
  var c = cells.match(/^([A-Z]+)(\d*)(?::([A-Z]+)(\d*))?$/); if (!c) throw new Error('bad range ' + a1);
  var c1 = colNum(c[1]), r1 = c[2] ? +c[2] : 1, c2 = c[3] ? colNum(c[3]) : c1, r2 = c[4] ? +c[4] : null;
  return { sh: sh, c1: c1, r1: r1, c2: c2, r2: r2 };
}
function trimRows(rows) { rows = rows.map(r => { var i = r.length; while (i > 0 && (r[i - 1] === '' || r[i - 1] === null || r[i - 1] === undefined)) i--; return r.slice(0, i); }); while (rows.length && !rows[rows.length - 1].length) rows.pop(); return rows; }
var Sheets = { Spreadsheets: {
  get(id, opts) { var ss = ssById(id); return { sheets: ss.sheets.map(s => ({ properties: { title: s.name, sheetId: s.id }, data: [] })) }; },
  batchUpdate(body, id) { var ss = ssById(id); (body.requests || []).forEach(q => { if (q.deleteDimension) { var g = q.deleteDimension.range, sh = ss.sheets.find(s => s.id === g.sheetId); for (var i = g.endIndex - 1; i >= g.startIndex; i--) sh.data.splice(i, 1); } }); return {}; },
  Values: {
    get(id, range, opts) { var p = parseRange(ssById(id), range), r2 = p.r2 || p.sh.getLastRow(), out = []; for (var r = p.r1; r <= r2; r++) { var row = p.sh.data[r - 1] || [], o = []; for (var c = p.c1; c <= p.c2; c++) { var v = row[c - 1]; if (v instanceof Date) v = (opts && opts.valueRenderOption === 'UNFORMATTED_VALUE') ? fmt(v, 'yyyy-MM-dd') : fmt(v, 'dd-MMM-yyyy'); o.push(v === undefined || v === null ? '' : v); } out.push(o); } return { values: trimRows(out) }; },
    batchGet(id, opts) { return { valueRanges: opts.ranges.map(r => Sheets.Spreadsheets.Values.get(id, r, opts)) }; },
    update(body, id, range, opts) { var p = parseRange(ssById(id), range); body.values.forEach((row, i) => { var rr = p.sh.data[p.r1 - 1 + i] = p.sh.data[p.r1 - 1 + i] || []; row.forEach((v, j) => { if (v !== null) rr[p.c1 - 1 + j] = v; }); }); return {}; },
    batchUpdate(body, id) { (body.data || []).forEach(d => Sheets.Spreadsheets.Values.update({ values: d.values }, id, d.range, {})); return {}; },
    batchClear(body, id) { (body.ranges || []).forEach(r => { var p = parseRange(ssById(id), r), r2 = p.r2 || p.sh.getLastRow(); for (var x = p.r1; x <= r2; x++) { var row = p.sh.data[x - 1]; if (row) for (var c = p.c1; c <= p.c2; c++) row[c - 1] = ''; } }); return {}; },
    append(body, id, range, opts) { var p = parseRange(ssById(id), range); var r = p.sh.getLastRow() + 1; body.values.forEach((row, i) => { var rr = p.sh.data[r - 1 + i] = []; row.forEach((v, j) => rr[p.c1 - 1 + j] = v); }); return {}; }
  } } };
// ---------- other services ----------
function pad(n, w) { return String(n).padStart(w || 2, '0'); }
function fmt(d, pat) { var MON = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']; return pat.replace(/yyyy|MMM|MM|dd|HH|mm|ss|M|d/g, t => ({ yyyy: d.getFullYear(), MMM: MON[d.getMonth()], MM: pad(d.getMonth() + 1), dd: pad(d.getDate()), HH: pad(d.getHours()), mm: pad(d.getMinutes()), ss: pad(d.getSeconds()), M: d.getMonth() + 1, d: d.getDate() })[t]); }
var CACHE = {}, PROPS = {};
global.SpreadsheetApp = { getActiveSpreadsheet: () => APP, openById: id => ssById(id), flush() {}, getUi() { return { createMenu() { return { addItem() { return this; }, addSeparator() { return this; }, addToUi() {} }; } }; } };
global.CacheService = { getScriptCache: () => ({ get: k => (k in CACHE ? CACHE[k] : null), put: (k, v) => { CACHE[k] = String(v); }, putAll: m => Object.assign(CACHE, m), getAll: ks => { var o = {}; ks.forEach(k => { if (k in CACHE) o[k] = CACHE[k]; }); return o; }, remove: k => { delete CACHE[k]; }, removeAll: ks => ks.forEach(k => delete CACHE[k]) }) };
global.LockService = { getScriptLock: () => ({ waitLock() {}, releaseLock() {} }) };
global.PropertiesService = { getScriptProperties: () => ({ getProperty: k => (k in PROPS ? PROPS[k] : null), setProperty: (k, v) => { PROPS[k] = String(v); }, deleteProperty: k => { delete PROPS[k]; } }) };
global.Session = { getScriptTimeZone: () => 'Asia/Kolkata' };
global.Utilities = { formatDate: (d, tz, p) => fmt(d, p), getUuid: () => crypto.randomUUID(), sleep() {},
  newBlob: x => ({ getBytes: () => Buffer.from(typeof x === 'string' ? x : Buffer.from(x)), getDataAsString: () => Buffer.from(x).toString('utf8') }),
  computeHmacSha256Signature: (s, k) => Array.from(crypto.createHmac('sha256', k).update(typeof s === 'string' ? s : Buffer.from(s)).digest()),
  base64EncodeWebSafe: b => Buffer.from(typeof b === 'string' ? b : Buffer.from(b)).toString('base64url'), base64DecodeWebSafe: s => Array.from(Buffer.from(s, 'base64url')) };
global.ContentService = { createTextOutput: s => ({ _s: s, setMimeType() { return this; }, getContent() { return this._s; } }), MimeType: { JSON: 'json' } };
global.Logger = { log() {} }; global.ScriptApp = { getProjectTriggers() { throw new Error('no triggers'); } };
global.Sheets = Sheets;
// ---------- load the server ----------
fs.readdirSync('gas').filter(f => f.endsWith('.js') && f !== 'Sources.js').sort().forEach(f => vm.runInThisContext(fs.readFileSync('gas/' + f, 'utf8'), { filename: f }));
// fake source ids: the test never needs (or touches) the real spreadsheets
globalThis.SOURCE_IDS = {}; ['ATT', 'STITCH117', 'PACKING', 'ENDLINE', 'LOADING', 'ALLORDER', 'COST', 'PLAN'].forEach(k => { SOURCE_IDS[k] = 'fake_' + k; });
// ---------- seed data ----------
var TODAY = todayStr_();
function seed(ssId, name, rows, maxCols) { var sh = ssById(ssId).getSheetByName(name) || ssById(ssId).insertSheet(name); sh.maxCols = maxCols || 40; rows.forEach((r, i) => { sh.data[i] = r.slice(); }); return sh; }
seed('APP', 'USERS', [CFG.HEADERS.USERS, ['admin', 'Admin', '1111', 'Admin', '', '', 'TRUE', ''], ['rec1', 'Ravi', '2222', 'Data Collector', '666', 'FAC666-Line 1-SL001,FAC666-Line 2-SL002', 'TRUE', ''], ['rec2', 'Mohan', '3333', 'Data Collector', '666', 'FAC666-Line 3-SL003', 'TRUE', '']]);
var S = [CFG.HEADERS.MASTERS]; ['FAC666-Line 1-SL001', 'FAC666-Line 2-SL002', 'FAC666-Line 3-SL003'].forEach(d => S.push(['DEPT', d, d, '666', 'STITCH', 'TRUE'])); S.push(['DEPT', 'FAC666-Packing Ground', 'FAC666-Packing Ground', '666', 'PACKING', 'TRUE']);
CFG.DEPT_CATEGORIES.forEach(c => c.roles.forEach((r, i) => S.push(['CAT_ROLE', c.key, r, '', i + 1, 'TRUE']))); S.push(['LINE_STAFF', 'FAC666-Line 1-SL001', 'SG01-Inch', '', 'SG02-Sup', 'TRUE']); S.push(['SAM', 'SRN0621A', 20, '', 'admin', 'TRUE']);
seed('APP', 'SETTINGS', S);
var MD = [['FAC666-Final Attendance', '', '', 'Stitching Data', '', 'Packing Data', 'END LINE DATA', 'Loading Data', 'All order', 'Unloading Data', 'Making Plan'], []]; seed('APP', 'MASTER DATA', MD, 12);
seed('APP', 'APP SUMMARY', [[ 'x', '', 0, '', '', '', '', 0, '', '', '', '', '', '', '', '', '', '', '', '', '', 0 ]], 60);
var ATTID = SOURCE_IDS.ATT; seed(ATTID, ' karigar att_666', [['', '', 'Date', 'location', 'department', 'designation', 'working hour', 'manpower', 'Blank', 'Incharge', 'Supervisor', 'SRN', 'Remark', 'Status']]);
seed(ATTID, 'OT att', [['', '', 'Date', 'Location', 'Line', 'OT', 'Degination', 'OT hours', 'Manpower', 'total', 'Incharge', 'Supervisor', 'SRN', 'Remark', 'Status']]); seed(ATTID, '117', [['', '', 'Date']]);
var DH = ['Date', 'LINE NO', 'Code', 'SRN', 'FLOOR', 'OT', 'Actual Manpower', 'hours', 'OUTPUT', 'MASTER', 'SUPERVISOR', 'Remark', 'Plan', 'variance', 'Reason']; while (DH.length < 27) DH.push('r'); seed(ATTID, 'Data', [DH]);
var LD = []; for (var i = 0; i < 9; i++) LD.push(['h']); LD.push(['01/10/2026 10:00:00', '1-Oct-2026', '7001', 'FAC666', 'SRN0620A -5 Below - TOTE(73500pcs)', 'SRN0620A', 'Line 1', 936, '', 'Star-Line', 'FAC666-Line 1-SL001', 'SL001']); LD.push(['02/10/2026 10:00:00', '2-Oct-2026', '7002', 'FAC666', 'SRN0621A -Zudio - BAG(1000pcs)', 'SRN0621A', 'Line 3', 500, '', 'Star-Line', 'FAC666-Line 3-SL003', 'SL003']);
seed(SOURCE_IDS.LOADING, 'loading_chalaan', LD); seed(SOURCE_IDS.LOADING, 'Unloading_chalaan', [['h']]);
seed(SOURCE_IDS.COST, 'Making Bulletin Data', [['h'], ['9/1/2026', '2026-09-01', 'SRN0620A', 'TOTE', '', 'op1', 'Operator', '', 'Making Bulletin', 1, 600], ['9/1/2026', '2026-09-01', 'SRN0620A', 'TOTE', '', 'op2', 'Helper', '', 'Making Bulletin', 1, 600]]);   // SAM 20 min
seed(SOURCE_IDS.PLAN, 'Making Plan Response for Production', [['h']]);
// plan row in MASTER DATA col K: L1 / SRN0620A / today: 220 pcs, 20 op + {"Helper":5} = 25 people, 10 h -> rate 0.88
var md = APP.getSheetByName('MASTER DATA'); md.data[2] = []; md.data[2][10] = JSON.stringify(['ts', 'SRN0620A', 'TOTE', 'FAC666-Line 1-SL001', TODAY.split('-').reverse().join('/'), 'Thu', 220, 1000, '{}', 20, '{"Helper":5}', 25, 10, 220]);
// ---------- helpers ----------
function post(body) { var out = doPost({ postData: { contents: JSON.stringify(body) } }); return JSON.parse(out.getContent()); }
var TOK = {}; TOK.rec1 = post({ action: 'login', pin: '2222' }).token; TOK.rec2 = post({ action: 'login', pin: '3333' }).token; TOK.admin = post({ action: 'login', pin: '1111' }).token;
function call(who, action, p) { return post(Object.assign({}, p || {}, { action: action, token: TOK[who], lang: 'en' })); }
var L1 = 'FAC666-Line 1-SL001', L2 = 'FAC666-Line 2-SL002', L3 = 'FAC666-Line 3-SL003';
function attSheetRows(dept, date) { var sh = ssById(ATTID).getSheetByName(' karigar att_666'); return sh.data.filter(r => r && str_(r[4]) === dept && dateKey_(r[2]) === date).map(r => ({ role: r[5], hours: r[6], count: r[7], inc: r[9], sup: r[10], srn: r[11], remark: r[12] || '', status: r[13] || '' })); }
function attRows(dept, date, shift) { return readTab_(CFG.TABS.ATT_DAILY).filter(r => str_(r.dept) === dept && str_(r.date) === date && str_(r.shift) === (shift || 'Final')); }
function dsRows(dept, type) { return readTab_(CFG.TABS.DAY_SUMMARY).filter(r => str_(r.dept) === dept && (!type || str_(r.type) === type)); }
function sum(rows, f) { return rows.reduce((t, r) => t + num_(r[f]), 0); }
// ========== 1. login & empty state ==========
check('login recorder/admin', !!TOK.rec1 && !!TOK.admin);
var a0 = call('rec1', 'm.all', { factory: '666', date: TODAY });
check('m.all empty att/out, pms shows loaded SRN', a0.ok && a0.att.items.length === 0 && a0.out.groups.length === 0 && a0.pms.rows.some(r => r.srn === 'SRN0620A' && r.loading === 936), { pms: a0.pms });
// ========== 2. attendance save (phone) ==========
var ROWS = [{ role: 'Operator', hours: 8, count: 20 }, { role: 'Helper', hours: 8, count: 5 }, { role: 'Supervisor', hours: 8, count: 1 }];
var noFloor = call('rec1', 'att.save', { phone: true, rid: 'r0', date: TODAY, factory: '666', dept: L1, shift: 'Final', srn: 'SRN0620A', supervisor: 'SG02-Sup', incharge: 'SG01-Inch', rows: ROWS });
check('att.save without floor refused (phone)', !noFloor.ok && /floor/i.test(noFloor.message), noFloor);
var s1 = call('rec1', 'att.save', { phone: true, rid: 'r1', date: TODAY, factory: '666', dept: L1, shift: 'Final', srn: 'SRN0620A', floor: 'Ground', supervisor: 'SG02-Sup', incharge: 'SG01-Inch', rows: ROWS });
check('att.save ok + sheet 3 rows', s1.ok && s1.sheet === 3, s1);
var sr = attSheetRows(L1, TODAY);
check('sheet rows: dept/date/srn/status blank/names', sr.length === 3 && sr.every(r => r.srn === 'SRN0620A' && r.status === '' && r.inc === 'SG01-Inch' && r.sup === 'SG02-Sup') && sum(sr, 'count') === 26, sr);
check('LINE_FLOOR set from attendance', readTab_(CFG.TABS.MASTERS).some(r => r.type === 'LINE_FLOOR' && r.key === L1 && r.value === 'FAC666-Stitching Ground'));
check('ATT_DAILY floor stored', attRows(L1, TODAY).every(r => r.floor === 'FAC666-Stitching Ground'));
var s1b = call('rec1', 'att.save', { phone: true, rid: 'r1', date: TODAY, factory: '666', dept: L1, shift: 'Final', srn: 'SRN0620A', floor: 'Ground', supervisor: 'SG02-Sup', incharge: 'SG01-Inch', rows: ROWS });
check('same rid again: no double rows', s1b.ok && attSheetRows(L1, TODAY).length === 3 && attRows(L1, TODAY).length === 3, { sheet: attSheetRows(L1, TODAY).length, app: attRows(L1, TODAY).length });
// change attendance: operator 22
var ROWS2 = [{ role: 'Operator', hours: 8, count: 22 }, { role: 'Helper', hours: 8, count: 5 }, { role: 'Supervisor', hours: 8, count: 1 }];
var s2 = call('rec1', 'att.save', { phone: true, rid: 'r2', date: TODAY, factory: '666', dept: L1, shift: 'Final', srn: 'SRN0620A', floor: 'Ground', supervisor: 'SG02-Sup', incharge: 'SG01-Inch', rows: ROWS2 });
sr = attSheetRows(L1, TODAY);
check('change: sheet replaced, 3 rows, operator 22, status blank', s2.ok && sr.length === 3 && sr.find(r => r.role === 'Operator').count === 22 && sr.every(r => r.status === ''), sr);
// HR approves in the sheet, then recorder marks half day -> status must stay
ssById(ATTID).getSheetByName(' karigar att_666').data.forEach(r => { if (r && str_(r[4]) === L1) r[13] = 'Approved'; });
var u1 = call('rec1', 'm.attUpd', { rid: 'r3', date: TODAY, factory: '666', dept: L1, role: 'Operator', halfDay: 2, hours: 4, absent: 1 });
sr = attSheetRows(L1, TODAY);
var ops = sr.filter(r => r.role === 'Operator');
check('update: half day row 4h x2 + absent remark, status kept', u1.ok && ops.length === 2 && ops.some(r => r.hours === 4 && r.count === 2 && /Half day 2/.test(r.remark)) && ops.some(r => r.hours === 8 && r.count === 19 && /Absent 1/.test(r.remark)) && sr.every(r => r.status === 'Approved'), { ops: ops, all: sr });
var a1 = call('rec1', 'm.all', { factory: '666', date: TODAY });
var it = a1.att.items.find(x => x.dept === L1);
check('m.all att item count/events', it && it.count === 28 && it.events.length === 2 && it.srn === 'SRN0620A' && (it.mpNow === 25 || it.mpNow === 27), it);
var pend = a1.out.groups.flatMap(g => g.lines);
check('output pending: L1 with srn list + mp 25 + plan', pend.length === 1 && pend[0].dept === L1 && pend[0].mp === 25 && pend[0].srns.some(s => s.srn === 'SRN0620A' && s.balance === 936), pend);
check('plan for today given to phone', a1.att.plan && a1.att.plan[L1 + '|SRN0620A'] && Math.abs(a1.att.plan[L1 + '|SRN0620A'].rate - 0.88) < 0.001, a1.att.plan);
// ========== 3. output save ==========
var o1 = call('rec1', 'm.outSave', { rid: 'o1', date: TODAY, factory: '666', dept: L1, shift: 'Final', slot: '17-18', srn: 'SRN0620A', qty: 150, other: 0, floor: pend[0].floor, allowOver: false, reason: 'machine down' });
var ds = dsRows(L1, 'STITCH'), p = ds.length ? parseJsonObj_(ds[0].payload) : {};
check('m.outSave: one Submitted row, payload right', o1.ok && ds.length === 1 && ds[0].status === 'Submitted' && p.output === 150 && p.operators === 21 && p.manpower === 27 && p.hours === 8 && p.floor === 'FAC666-Stitching Ground' && p.reason === 'machine down' && p.splits.length === 2, { o1: o1, p: p });
// plan = rate 0.88 x production man-hours (operators 19x8 + 2x4 + helpers 5x8 = 200) = 176
check('plan output from production plan', p.plan === 176 && p.planFrom === 'plan', p.plan);
check('HOURLY_LOG one row qty 150', readTab_(CFG.TABS.HOURLY_LOG).filter(r => r.dept === L1).length === 1);
var o1b = call('rec1', 'm.outSave', { rid: 'o1', date: TODAY, factory: '666', dept: L1, shift: 'Final', slot: '17-18', srn: 'SRN0620A', qty: 150, other: 0, floor: '', allowOver: false, reason: 'machine down' });
check('same rid output: no duplicate', o1b.ok && dsRows(L1, 'STITCH').length === 1 && readTab_(CFG.TABS.HOURLY_LOG).filter(r => r.dept === L1).length === 1);
var a2 = call('rec1', 'm.all', { factory: '666', date: TODAY });
check('after save: not pending, in waiting', a2.out.groups.flatMap(g => g.lines).length === 0 && a2.out.waiting.length === 1 && a2.out.waiting[0].status === 'Submitted' && a2.out.waiting[0].reason === 'machine down', a2.out);
// edit while waiting
var o2 = call('rec1', 'm.outSave', { rid: 'o2', date: TODAY, factory: '666', dept: L1, shift: 'Final', slot: '17-18', srn: 'SRN0620A', qty: 160, other: 0, floor: '', allowOver: false, reason: '' });
ds = dsRows(L1, 'STITCH'); p = parseJsonObj_(ds[0].payload);
check('edit while waiting: still one row, qty 160', o2.ok && ds.length === 1 && ds[0].status === 'Submitted' && p.output === 160 && readTab_(CFG.TABS.HOURLY_LOG).filter(r => r.dept === L1).length === 1, { ds: ds.length, p: p.output });
// zero output on another line (rec2 / L3)
call('rec2', 'att.save', { phone: true, rid: 'r4', date: TODAY, factory: '666', dept: L3, shift: 'Final', srn: 'SRN0621A', floor: 'First', supervisor: 'S', incharge: 'I', rows: [{ role: 'Operator', hours: 8, count: 10 }] });
var oz = call('rec2', 'm.outSave', { rid: 'o3', date: TODAY, factory: '666', dept: L3, shift: 'Final', slot: '17-18', srn: 'SRN0621A', qty: 0, other: 0, floor: '', allowOver: false, reason: '' });
var dz = dsRows(L3, 'STITCH');
check('zero output recorded + submitted', oz.ok && dz.length === 1 && dz[0].status === 'Submitted' && parseJsonObj_(dz[0].payload).output === 0, { oz: oz, dz: dz.length });
// ========== 4. admin review ==========
var ad = call('admin', 'm.all', { factory: '666', date: TODAY });
check('admin review list has both', ad.rev && ad.rev.items.length === 2 && ad.rev.items.find(x => x.dept === L1).edit.roles.Operator === 21, ad.rev);
var id1 = ad.rev.items.find(x => x.dept === L1).id, id3 = ad.rev.items.find(x => x.dept === L3).id;
var e1 = call('admin', 'm.reviewEdit', { id: id1, srn: 'SRN0620A', floor: 'First', output: 155, hours: 8, roles: { Operator: 20, Helper: 5, Paster: 1, 'Thread cutter': 0, 'End Line Checker': 0, 'Hand needle': 0 }, reason: 'admin fixed', approve: false });
p = parseJsonObj_(dsRows(L1, 'STITCH')[0].payload);
var ar = attRows(L1, TODAY);
check('reviewEdit: payload + attendance rows updated', e1.ok && e1.attChanged > 0 && !e1.attError && p.output === 155 && p.operators === 19 && p.manpower === 26 && p.floor === 'FAC666-Stitching First' && p.reason === 'admin fixed' && p.splits.length === 2 && ar.find(r => r.role === 'Operator').count === 20 && ar.find(r => r.role === 'Paster').count === 1 && ar.every(r => r.floor === 'FAC666-Stitching First'), { e1: e1, p: p, ar: ar });
sr = attSheetRows(L1, TODAY);
check('reviewEdit: HR sheet re-synced, status kept, paster added', sr.find(r => r.role === 'Paster') && sr.every(r => r.status === 'Approved') && sum(sr.filter(r => r.role === 'Operator'), 'count') === 19 /* 20 - 1 absent */, sr);
var rj = call('admin', 'm.reviewDecide', { ids: [id3], decision: 'reject', remark: 'wrong qty' });
check('reject: status Rejected + remark', rj.ok && dsRows(L3, 'STITCH')[0].status === 'Rejected' && dsRows(L3, 'STITCH')[0].remark === 'wrong qty', rj);
var a3 = call('rec2', 'm.all', { factory: '666', date: TODAY });
check('rejected line pending again with reason', a3.out.groups.flatMap(g => g.lines).some(l => l.dept === L3 && l.remark === 'wrong qty'), a3.out);
var ap = call('admin', 'm.reviewDecide', { ids: [e1.id || id1], decision: 'approve', remark: '', reasons: {} });
check('approve -> sent', ap.ok && ap.sent === 1 && dsRows(L1, 'STITCH')[0].status === 'Sent', ap);
var dataRows = ssById(ATTID).getSheetByName('Data').data.slice(1).filter(r => r && str_(r[2]) === L1);
var m0 = dataRows[0] || [], m1 = dataRows[1] || [];
check('Data sheet: 2 rows (8h group + half-day group)', dataRows.length === 2, dataRows);
check('Data row1: date/dept/srn/floor/shift/G=operators/hours/output/master/sup/plan/reason/roles', m0[0] === fmt(new Date(), 'd-MMM-yyyy') && m0[3] === 'SRN0620A' && m0[4] === 'FAC666-Stitching First' && m0[5] === 'Final' && m0[6] === 17 && m0[7] === 8 && m0[8] === 155 && m0[9] === 'SG01-Inch' && m0[10] === 'SG02-Sup' && m0[14] === 'admin fixed' && m0[22] === 5 && m0[23] === 1, m0);
check('Data row2: half-day group 4h, 2 operators, output 0, remark', m1[6] === 2 && m1[7] === 4 && m1[8] === 0 && /Half day/.test(String(m1[11])), m1);
check('import marked due after send', !!PROPS.IMPORT_DUE);
// cleanup must keep today's attendance
var cl = cleanupSent_();
check('cleanup keeps attendance, removes sent output copies', cl.att === 0 && cl.hourly === 1 && attRows(L1, TODAY).length > 0, cl);
var sentRow = dsRows(L1, 'STITCH').find(r => r.status === 'Sent'); var wrongStamp = readTab_(CFG.TABS.DAY_SUMMARY).filter(r => r.cleaned_at && r.status !== 'Sent');
check('cleanup stamped the right row only', sentRow && sentRow.cleaned_at && wrongStamp.length === 0 && readTab_(CFG.TABS.HOURLY_LOG).filter(r => r.dept === L3).length === 1, { sent: sentRow && sentRow.cleaned_at, wrong: wrongStamp.length });
var a4 = call('rec1', 'm.all', { factory: '666', date: TODAY });
check('after cleanup: L1 not pending again, attendance still shown', !a4.out.groups.flatMap(g => g.lines).some(l => l.dept === L1) && a4.att.items.some(x => x.dept === L1), a4.out);
// ========== 5. transfer ==========
var t1 = call('rec1', 'm.trCreate', { date: TODAY, factory: '666', from_dept: L1, to_dept: L3, hour: 11, items: [{ role: 'Operator', count: 3 }] });
check('transfer create', t1.ok && t1.total === 3, t1);
var a5 = call('rec2', 'm.all', { factory: '666', date: TODAY });
check('receiver sees request', a5.att.incoming.length === 1 && a5.att.incoming[0].from === L1, a5.att.incoming);
var t2 = call('rec2', 'm.trDecide', { id: t1.id, decision: 'accept' });
var sr3 = attSheetRows(L3, TODAY);
check('accept: L3 sheet has 6h transferred-in row', t2.ok && sr3.some(r => r.role === 'Operator' && r.hours === 6 && r.count === 3 && /transferred in/.test(r.remark)), sr3);
sr = attSheetRows(L1, TODAY);
check('L1 sheet: 3 operators moved out (2h row)', sr.some(r => r.role === 'Operator' && r.hours === 2 && r.count === 3 && /transferred out/.test(r.remark)), sr);
var t3 = call('rec1', 'm.trCreate', { date: TODAY, factory: '666', from_dept: L1, to_dept: L3, hour: 14, items: [{ role: 'Helper', count: 2 }] });
var evBefore = readTab_(CFG.TABS.MANPOWER_EVENTS).length;
var t4 = call('rec2', 'm.trDecide', { id: t3.id, decision: 'reject' });
var trRows = readTab_(CFG.TABS.TRANSFERS);
check('transfer reject: right transfer row marked, only its event removed', t4.ok && trRows.find(x => x.id === t3.id).status === 'Rejected' && trRows.find(x => x.id === t1.id).status === 'Accepted' && readTab_(CFG.TABS.MANPOWER_EVENTS).length === evBefore - 1, { tr: trRows.map(x => x.id.slice(0, 4) + ':' + x.status), ev: readTab_(CFG.TABS.MANPOWER_EVENTS).length });
// ========== 6. cancel attendance ==========
var cx = call('rec2', 'att.save', { phone: true, rid: 'r9', date: TODAY, factory: '666', dept: L3, shift: 'Final', rows: [] });
check('cancel: sheet rows removed', cx.ok && attSheetRows(L3, TODAY).length === 0 && attRows(L3, TODAY).length === 0, attSheetRows(L3, TODAY));
// ========== 7. users ==========
var us = call('admin', 'users.save', { user_id: '', name: 'New Rec', pin: '4444', role: 'Data Collector', factory: '666', depts: [L2], active: true });
check('users.save + login', us.ok && post({ action: 'login', pin: '4444' }).ok, us);
// ========== 8. staff names (Supervisor / Incharge list for the phone dropdowns) ==========
var stA = call('admin', 'staff.save', { name: 'Test Sup One', kind: 'Supervisor' });
var stL = call('rec1', 'staff.list', {});
check('staff.save: name in the supervisor list', stA.ok && stL.supervisors.indexOf('Test Sup One') >= 0, stL.supervisors);
var stR = call('admin', 'staff.remove', { name: 'Test Sup One', kind: 'Supervisor' });
var stL2 = call('rec1', 'staff.list', {});
var stRow = readTab_(CFG.TABS.MASTERS).filter(r => r.type === 'STAFF' && r.key === 'Test Sup One');
check('staff.remove: hidden, active=FALSE in the right column', stR.ok && stL2.supervisors.indexOf('Test Sup One') < 0 && stRow.length === 1 && String(stRow[0].active).toUpperCase() === 'FALSE' && stRow[0].value === 'Supervisor' && /admin|Admin/.test(String(stRow[0].extra)), stRow);
var stA2 = call('admin', 'staff.save', { name: 'test sup one', kind: 'Supervisor' });
var stRow2 = readTab_(CFG.TABS.MASTERS).filter(r => r.type === 'STAFF' && r.key.toLowerCase() === 'test sup one');
check('staff.save again: same row re-activated (no duplicate)', stA2.ok && stRow2.length === 1 && String(stRow2[0].active).toUpperCase() === 'TRUE' && call('rec1', 'staff.list', {}).supervisors.indexOf('Test Sup One') >= 0, stRow2);
var hidden = call('admin', 'staff.remove', { name: 'Name From History', kind: 'Incharge' });
check('staff.remove of a name not in SETTINGS: hidden by a new row', hidden.ok && readTab_(CFG.TABS.MASTERS).some(r => r.type === 'STAFF' && r.key === 'Name From History' && String(r.active).toUpperCase() === 'FALSE'));
check('staff.remove: bad kind rejected', call('admin', 'staff.remove', { name: 'X', kind: 'Boss' }).ok === false);
// ========== 9. notifications (reply.notify, sent by the Worker) ==========
var nTo = (r, id) => (r.notify || []).some(n => n.to.indexOf(id) >= 0);
check('notify: attendance save -> admin, not the saver', nTo(s1, 'admin') && !nTo(s1, 'rec1') && /Attendance · Line 1-SL001/.test(s1.notify[0].title) && /by Ravi/.test(s1.notify[0].body), s1.notify);
check('notify: same rid resent -> no second notification', !s1b.notify, s1b.notify);
check('notify: output saved -> admin, opens Approve', nTo(o1, 'admin') && o1.notify[0].url === '#mrev' && /Output for approval/.test(o1.notify[0].title) && /150 pcs/.test(o1.notify[0].body), o1.notify);
check('notify: transfer request -> recorder of the receiving line only', nTo(t1, 'rec2') && !nTo(t1, 'rec1') && !nTo(t1, 'admin') && /Transfer request · Line 1-SL001 → /.test(t1.notify[0].title), t1.notify);
check('notify: transfer accepted -> who asked', nTo(t2, 'rec1') && !nTo(t2, 'rec2') && /Transfer accepted/.test(t2.notify[0].title), t2.notify);
check('notify: transfer rejected -> who asked', nTo(t4, 'rec1') && /Transfer rejected/.test(t4.notify[0].title), t4.notify);
check('notify: output sent back -> recorder of that line (L3: rec2) with the reason', nTo(rj, 'rec2') && !nTo(rj, 'rec1') && !nTo(rj, 'admin') && /Output sent back/.test(rj.notify[0].title) && /wrong qty/.test(rj.notify[0].body), rj.notify);
check('notify: output approved -> line recorder', nTo(ap, 'rec1') && /Output approved/.test(ap.notify[0].title), ap.notify);
var nr = call('rec1', 'm.out', {});
check('notify: reads carry no notify', !nr.notify);
var ps = call('rec1', 'push.sub', { sub: { endpoint: 'https://push.example/abc', keys: { p256dh: 'x', auth: 'y' } } });
check('push.sub: confirms the user', ps.ok && ps.user_id === 'rec1' && call('rec1', 'push.sub', { sub: {} }).ok === false, ps);
console.log(RESULTS.join('\n')); console.log('\n' + RESULTS.filter(r => r.startsWith('FAIL')).length + ' FAIL / ' + RESULTS.length);
