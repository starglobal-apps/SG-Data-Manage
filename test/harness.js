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
      clearContent() { for (var i = 0; i < nr; i++) { var rr = sh.data[r - 1 + i]; if (rr) for (var j = 0; j < nc; j++) rr[col - 1 + j] = ''; } return R; },
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
  get(id, opts) { var ss = ssById(id); return { sheets: ss.sheets.map(s => ({ properties: { title: s.name, sheetId: s.id, gridProperties: { rowCount: s.maxRows } }, data: [] })) }; },
  batchUpdate(body, id) { var ss = ssById(id); (body.requests || []).forEach(q => { if (q.appendDimension) { ss.sheets.find(s => s.id === q.appendDimension.sheetId).maxRows += q.appendDimension.length; return; } if (q.deleteDimension) { var g = q.deleteDimension.range, sh = ss.sheets.find(s => s.id === g.sheetId); for (var i = g.endIndex - 1; i >= g.startIndex; i--) sh.data.splice(i, 1); } }); return {}; },
  Values: {
    get(id, range, opts) { var p = parseRange(ssById(id), range), r2 = p.r2 || p.sh.getLastRow(), out = []; for (var r = p.r1; r <= r2; r++) { var row = p.sh.data[r - 1] || [], o = []; for (var c = p.c1; c <= p.c2; c++) { var v = row[c - 1]; if (v instanceof Date) v = (opts && opts.valueRenderOption === 'UNFORMATTED_VALUE') ? fmt(v, 'yyyy-MM-dd') : fmt(v, 'dd-MMM-yyyy'); o.push(v === undefined || v === null ? '' : v); } out.push(o); } return { values: trimRows(out) }; },
    batchGet(id, opts) { return { valueRanges: opts.ranges.map(r => Sheets.Spreadsheets.Values.get(id, r, opts)) }; },
    update(body, id, range, opts) { var p = parseRange(ssById(id), range); if (p.r1 - 1 + body.values.length > p.sh.maxRows) throw new Error('Range (' + range + ') exceeds grid limits. Max rows: ' + p.sh.maxRows); body.values.forEach((row, i) => { var rr = p.sh.data[p.r1 - 1 + i] = p.sh.data[p.r1 - 1 + i] || []; row.forEach((v, j) => { if (v !== null) rr[p.c1 - 1 + j] = v; }); }); return {}; },
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
globalThis.SOURCE_IDS = {}; ['ATT', 'STITCH117', 'PACKING', 'ENDLINE', 'LOADING', 'ALLORDER', 'COST', 'PLAN', 'CUTTING'].forEach(k => { SOURCE_IDS[k] = 'fake_' + k; });
// ---------- seed data ----------
var TODAY = todayStr_();
function seed(ssId, name, rows, maxCols) { var sh = ssById(ssId).getSheetByName(name) || ssById(ssId).insertSheet(name); sh.maxCols = maxCols || 40; rows.forEach((r, i) => { sh.data[i] = r.slice(); }); return sh; }
seed('APP', 'USERS', [CFG.HEADERS.USERS, ['admin', 'Admin', '1111', 'Admin', '', '', 'TRUE', ''], ['rec1', 'Ravi', '2222', 'Data Collector', '666', 'FAC666-Line 1-SL001,FAC666-Line 2-SL002', 'TRUE', ''], ['rec2', 'Mohan', '3333', 'Data Collector', '666', 'FAC666-Line 3-SL003', 'TRUE', '']]);
var S = [CFG.HEADERS.MASTERS]; ['FAC666-Line 1-SL001', 'FAC666-Line 2-SL002', 'FAC666-Line 3-SL003'].forEach(d => S.push(['DEPT', d, d, '666', 'STITCH', 'TRUE'])); S.push(['DEPT', 'FAC666-Packing Ground', 'FAC666-Packing Ground', '666', 'PACKING', 'TRUE']);
CFG.DEPT_CATEGORIES.forEach(c => c.roles.forEach((r, i) => S.push(['CAT_ROLE', c.key, r, '', i + 1, 'TRUE']))); S.push(['LINE_STAFF', 'FAC666-Line 1-SL001', 'SG01-Inch', '', 'SG02-Sup', 'TRUE']); S.push(['SAM', 'SRN0621A', 20, '', 'admin', 'TRUE']);
seed('APP', 'SETTINGS', S);
var MD = [['FAC666-Final Attendance', '', '', 'Stitching Data', '', 'Packing Data', 'END LINE DATA', 'Loading Data', 'All order', 'Unloading Data', 'Making Plan', 'Cutting Data'], []]; seed('APP', 'MASTER DATA', MD, 12);
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
check('transfer waiting: nothing changes on L1 or its main sheet yet', !attSheetRows(L1, TODAY).some(r => /transferred out/.test(r.remark)) && !readTab_(CFG.TABS.MANPOWER_EVENTS).some(e => String(e.note).indexOf('transfer:' + t1.id) === 0), attSheetRows(L1, TODAY));
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
check('transfer reject: right transfer row marked, nothing else changes', t4.ok && trRows.find(x => x.id === t3.id).status === 'Rejected' && trRows.find(x => x.id === t1.id).status === 'Accepted' && readTab_(CFG.TABS.MANPOWER_EVENTS).length === evBefore, { tr: trRows.map(x => x.id.slice(0, 4) + ':' + x.status), ev: readTab_(CFG.TABS.MANPOWER_EVENTS).length });
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
check('notify: transfer accepted -> who asked + admin, not the one who accepted', nTo(t2, 'rec1') && nTo(t2, 'admin') && !nTo(t2, 'rec2') && /Transfer accepted/.test(t2.notify[0].title), t2.notify);
check('notify: transfer rejected -> who asked + admin', nTo(t4, 'rec1') && nTo(t4, 'admin') && /Transfer rejected/.test(t4.notify[0].title), t4.notify);
check('notify: output sent back -> recorder of that line (L3: rec2) with the reason', nTo(rj, 'rec2') && !nTo(rj, 'rec1') && !nTo(rj, 'admin') && /Output sent back/.test(rj.notify[0].title) && /wrong qty/.test(rj.notify[0].body), rj.notify);
check('notify: output approved -> line recorder', nTo(ap, 'rec1') && /Output approved/.test(ap.notify[0].title), ap.notify);
var nr = call('rec1', 'm.out', {});
check('notify: reads carry no notify', !nr.notify);
var ps = call('rec1', 'push.sub', { sub: { endpoint: 'https://push.example/abc', keys: { p256dh: 'x', auth: 'y' } } });
check('push.sub: confirms the user', ps.ok && ps.user_id === 'rec1' && call('rec1', 'push.sub', { sub: {} }).ok === false, ps);
// ========== 10. transfers: once-only by rid; notification to the recorder named on the receiving line's attendance ==========
var aL2 = call('admin', 'att.save', { phone: true, rid: 'aL2', date: TODAY, factory: '666', dept: L2, shift: 'Final', srn: 'SRN0620A', floor: 'First', supervisor: 'S', incharge: 'I', rows: [{ role: 'Operator', hours: 8, count: 10 }, { role: 'Helper', hours: 8, count: 2 }] });
var trBefore = readTab_(CFG.TABS.TRANSFERS).length;
var tx1 = call('rec1', 'm.trCreate', { rid: 'tx1', date: TODAY, factory: '666', from_dept: L1, to_dept: L2, hour: 15, items: [{ role: 'Helper', count: 1 }] });
var tx1b = call('rec1', 'm.trCreate', { rid: 'tx1', date: TODAY, factory: '666', from_dept: L1, to_dept: L2, hour: 15, items: [{ role: 'Helper', count: 1 }] });
check('m.trCreate with the same rid twice: one transfer, second reply has no notify', aL2.ok && tx1.ok && tx1b.ok && tx1b.id === tx1.id && readTab_(CFG.TABS.TRANSFERS).length === trBefore + 1 && !tx1b.notify, [aL2.message, tx1.message, readTab_(CFG.TABS.TRANSFERS).length - trBefore]);
var newRec = readTab_(CFG.TABS.USERS).filter(u => u.name === 'New Rec')[0];
check('transfer request -> the recorder named on L2 attendance (Admin), not the other L2 user', nTo(tx1, 'admin') && !nTo(tx1, newRec.user_id) && !nTo(tx1, 'rec1'), tx1.notify);
var td1 = call('admin', 'm.trDecide', { rid: 'td1', id: tx1.id, decision: 'reject' });
var td1b = call('admin', 'm.trDecide', { rid: 'td1', id: tx1.id, decision: 'reject' });
check('m.trDecide same rid twice: applied once, requester told once', td1.ok && td1b.ok && nTo(td1, 'rec1') && !td1b.notify, [td1, td1b]);
check('transfer to L1 (Admin also named there after the edit): Admin told, sender not', (function () { var r = call('rec1', 'm.trCreate', { rid: 'tx2', date: TODAY, factory: '666', from_dept: L2, to_dept: L1, hour: 16, items: [{ role: 'Operator', count: 1 }] }); return r.ok && nTo(r, 'admin') && !nTo(r, 'rec1'); })());
appendRows_(CFG.TABS.ATT_DAILY, [{ id: 'x1', date: TODAY, factory: '666', dept: 'FAC666-Line 9-SL009', shift: 'Final', role: 'Operator', hours: 8, count: 5, entered_by: 'Ravi', entered_at: '', srn: '', supervisor: '', incharge: '', qc_names: '', keep_status: '', floor: '' }]); invalidateDaily_(CFG.TABS.ATT_DAILY);
var rec1u = usersRows_().filter(u => u.user_id === 'rec1')[0];
var selfN = notifyFor_('m.trCreate', { date: TODAY, factory: '666', from_dept: L1, to_dept: 'FAC666-Line 9-SL009', hour: 12, items: [{ role: 'Operator', count: 1 }] }, rec1u, { ok: true, id: 'z' });
var otherN = notifyFor_('m.trCreate', { date: TODAY, factory: '666', from_dept: L1, to_dept: 'FAC666-Line 9-SL009', hour: 12, items: [{ role: 'Operator', count: 1 }] }, usersRows_().filter(u => u.user_id === 'rec2')[0], { ok: true, id: 'z2' });
check('transfer to a line whose only recorder is the sender: nobody told (not the admins either)', selfN === null, selfN);
check('same line, someone else sends: the recorder named there (Ravi) is told', otherN && otherN[0].to.join() === 'rec1', otherN);
// ========== 11. a recorder sees only the lines whose attendance they filled ==========
var nrTok = post({ action: 'login', pin: '4444' }); TOK.newrec = nrTok.token;
var attOf = (who) => call(who, 'm.att', { date: TODAY, factory: '666' });
var a1 = attOf('rec1'), a2 = attOf('newrec');
check('line filled only by the admin (L2): every user of the line sees it', a1.items.some(x => x.dept === L2) && a2.items.some(x => x.dept === L2), [a1.items.map(x => x.dept), a2.items.map(x => x.dept)]);
var nrSave = call('newrec', 'att.save', { phone: true, rid: 'nr1', date: TODAY, factory: '666', dept: L2, shift: 'Final', srn: 'SRN0620A', floor: 'First', supervisor: 'S', incharge: 'I', rows: [{ role: 'Operator', hours: 8, count: 9 }] });
a1 = attOf('rec1'); a2 = attOf('newrec');
var pickL2 = a1.lines.filter(l => l.dept === L2)[0];
check('L2 filled by New Rec: New Rec sees it, Ravi does not (picker says whose)', nrSave.ok && a2.items.some(x => x.dept === L2) && !a1.items.some(x => x.dept === L2) && pickL2 && pickL2.filled && pickL2.by === 'New Rec', [nrSave.message, a1.items.map(x => x.dept), pickL2]);
check('Ravi still sees his own line L1', a1.items.some(x => x.dept === L1));
check('admin sees every filled line', attOf('admin').items.some(x => x.dept === L2) && attOf('admin').items.some(x => x.dept === L1));
var tx3 = call('rec1', 'm.trCreate', { rid: 'tx3', date: TODAY, factory: '666', from_dept: L1, to_dept: L2, hour: 13, items: [{ role: 'Helper', count: 1 }] });
check('transfer to L2: request shows for New Rec (L2 recorder), not for Ravi, and goes to New Rec', tx3.ok && attOf('newrec').incoming.some(t => t.id === tx3.id) && !attOf('rec1').incoming.some(t => t.id === tx3.id) && nTo(tx3, nrTok.user.user_id), [tx3.message, tx3.notify]);
// ========== 12. phone: any recorder may fill any line; the line then belongs to the recorder named on it ==========
var r1L3 = call('rec1', 'att.save', { phone: true, rid: 'r1L3', date: TODAY, factory: '666', dept: L3, shift: 'Final', srn: 'SRN0620A', floor: 'Second', supervisor: 'S', incharge: 'I', rows: [{ role: 'Operator', hours: 8, count: 7 }] });
var A1 = attOf('rec1'), A2 = attOf('rec2');
check('Ravi (not assigned L3) can fill L3 on the phone', r1L3.ok, r1L3);
check('picker lists every line of the factory for every recorder', [L1, L2, L3].every(d => A2.lines.some(l => l.dept === d)) && [L1, L2, L3].every(d => A1.lines.some(l => l.dept === d)), A2.lines.map(l => l.dept));
check('L3 card: Ravi sees it, Mohan (assigned L3) does not; picker tells Mohan whose it is', A1.items.some(x => x.dept === L3) && !A2.items.some(x => x.dept === L3) && A2.lines.filter(l => l.dept === L3)[0].by === 'Ravi', [A2.items.map(x => x.dept), A2.lines]);
var O1 = call('rec1', 'm.out', { factory: '666' }), O2 = call('rec2', 'm.out', { factory: '666' });
var hasL3 = o => (o.groups || []).some(g => g.lines.some(l => l.dept === L3 && l.date === TODAY));
check('Output pending of L3 today: Ravi has it, Mohan does not', hasL3(O1) && !hasL3(O2), [hasL3(O1), hasL3(O2)]);
var txL3 = call('newrec', 'm.trCreate', { rid: 'txL3', date: TODAY, factory: '666', from_dept: L2, to_dept: L3, hour: 12, items: [{ role: 'Operator', count: 1 }] });
var badDecide = call('rec2', 'm.trDecide', { rid: 'bd1', id: txL3.id, decision: 'accept' });
var goodDecide = call('rec1', 'm.trDecide', { rid: 'gd1', id: txL3.id, decision: 'accept' });
check('transfer to L3: only its recorder (Ravi) can accept', txL3.ok && nTo(txL3, 'rec1') && !nTo(txL3, 'rec2') && badDecide.ok === false && badDecide.error === 'PERM' && goodDecide.ok, [txL3.message, badDecide, goodDecide.message]);
// ========== 13. notification status / test routes ==========
var pst = call('admin', 'push.status', {}), pstR = call('rec1', 'push.status', {}), ptt = call('rec1', 'push.test', {});
check('push.status: admin gets the active users, a recorder is refused', pst.ok && pst.users.some(u => u.id === 'rec1' && u.name === 'Ravi') && pstR.ok === false && pstR.error === 'PERM', [pstR]);
check('push.test: confirms who asked', ptt.ok && ptt.user_id === 'rec1');
// ========== 14. accept a transfer and split the people over several lines ==========
var sp = call('newrec', 'm.trCreate', { rid: 'sp1', date: TODAY, factory: '666', from_dept: L2, to_dept: L1, hour: 14, items: [{ role: 'Operator', count: 4 }] });
var spBad1 = call('rec1', 'm.trDecide', { rid: 'spb1', id: sp.id, decision: 'accept', allocations: [{ dept: L1, role: 'Operator', count: 2 }, { dept: L3, role: 'Operator', count: 3 }] });
var spBad2 = call('rec1', 'm.trDecide', { rid: 'spb2', id: sp.id, decision: 'accept', allocations: [{ dept: L1, role: 'Operator', count: 2 }, { dept: L2, role: 'Operator', count: 2 }] });
check('split: not more than came, and not back to the line they came from', sp.ok && spBad1.ok === false && /4 came, 5 placed/.test(spBad1.message) && spBad2.ok === false && /reject/.test(spBad2.message), [sp.message, spBad1.message, spBad2.message]);
var l3SheetBefore = attSheetRows(L3, TODAY).length;
var spOk = call('rec1', 'm.trDecide', { rid: 'spok', id: sp.id, decision: 'accept', allocations: [{ dept: L1, role: 'Operator', count: 2 }, { dept: L3, role: 'Operator', count: 2 }] });
var spEv = readTab_(CFG.TABS.MANPOWER_EVENTS).filter(e => e.event === 'TRANSFER_IN' && String(e.note).indexOf('transfer:' + sp.id) === 0);
var spRow = readTab_(CFG.TABS.TRANSFERS).filter(t => t.id === sp.id)[0];
check('split: 2 in on L1 and 2 in on L3, allocations kept, status Accepted', spOk.ok && spEv.length === 2 && spEv.some(e => e.dept === L1 && +e.count === 2) && spEv.some(e => e.dept === L3 && +e.count === 2) && spRow.status === 'Accepted' && JSON.parse(spRow.allocations).length === 2, [spOk.message, spEv.map(e => e.dept + ':' + e.count)]);
var l3Sheet = attSheetRows(L3, TODAY);
check('split: L3 main sheet has the 2 transferred-in operators', l3Sheet.some(r => r.role === 'Operator' && r.count === 2 && /transferred in/.test(r.remark)), l3Sheet);
var spView = call('rec1', 'm.att', { date: TODAY, factory: '666' });
var l3Item = spView.items.filter(x => x.dept === L3)[0], l1Item = spView.items.filter(x => x.dept === L1)[0];
check('split: each line card lists the transfer with its own people', l3Item && l3Item.transfers.some(t => t.id === sp.id && t.total === 2) && l1Item.transfers.some(t => t.id === sp.id && t.total === 2), [l3Item && l3Item.transfers]);
check('split: requester + admin told where they went', nTo(spOk, nrTok.user.user_id) && nTo(spOk, 'admin') && /Line 1-SL001 \(2 Operator\), Line 3-SL003 \(2 Operator\)/.test(spOk.notify[0].body), spOk.notify);
var plain = call('newrec', 'm.trCreate', { rid: 'sp2', date: TODAY, factory: '666', from_dept: L2, to_dept: L1, hour: 15, items: [{ role: 'Operator', count: 1 }] });
var plainOk = call('rec1', 'm.trDecide', { rid: 'sp2ok', id: plain.id, decision: 'accept' });
check('accept without a split: all to the receiving line (as before)', plainOk.ok && readTab_(CFG.TABS.MANPOWER_EVENTS).some(e => e.event === 'TRANSFER_IN' && String(e.note).indexOf('transfer:' + plain.id) === 0 && e.dept === L1 && +e.count === 1));
// ========== 15. accept fewer than asked (8 of 10): only those move, the rest is not transferred ==========
var pa = call('newrec', 'm.trCreate', { rid: 'pa1', date: TODAY, factory: '666', from_dept: L2, to_dept: L1, hour: 16, items: [{ role: 'Operator', count: 2 }] });
var paNone = call('rec1', 'm.trDecide', { rid: 'pa0', id: pa.id, decision: 'accept', allocations: [] });
var paOk = call('rec1', 'm.trDecide', { rid: 'pa2', id: pa.id, decision: 'accept', allocations: [{ dept: L1, role: 'Operator', count: 1 }] });
var paEv = readTab_(CFG.TABS.MANPOWER_EVENTS).filter(e => String(e.note).indexOf('transfer:' + pa.id) === 0);
check('accept fewer: nobody accepted is refused; 1 of 2 -> 1 out of L2, 1 into L1', pa.ok && paNone.ok === false && /reject/.test(paNone.message) && paOk.ok && paOk.accepted === 1 && paOk.came === 2 &&
  paEv.some(e => e.event === 'TRANSFER_OUT' && e.dept === L2 && +e.count === 1) && paEv.some(e => e.event === 'TRANSFER_IN' && e.dept === L1 && +e.count === 1) && paEv.length === 2, [pa.message, paNone.message, paOk.message, paEv.map(e => e.event + ':' + e.dept + ':' + e.count)]);
check('accept fewer: sender told 1 of 2, 1 not accepted', nTo(paOk, nrTok.user.user_id) && /partly accepted/.test(paOk.notify[0].title) && /1 of 2 people/.test(paOk.notify[0].body) && /1 not accepted/.test(paOk.notify[0].body), paOk.notify);
var paView = call('newrec', 'm.att', { date: TODAY, factory: '666' });
var paL2 = (paView.items.filter(x => x.dept === L2)[0] || {}).transfers || [];
check('accept fewer: the sending line shows 1 went (of 2 asked)', paL2.some(t => t.id === pa.id && t.total === 1 && t.asked === 2), paL2);
check('accept fewer: L2 main sheet shows the 1 operator moved out at 16:00', attSheetRows(L2, TODAY).some(r => r.role === 'Operator' && r.count === 1 && /transferred out 16:00/.test(r.remark)), attSheetRows(L2, TODAY));
// a waiting request keeps its people: they cannot be asked for twice
var l2Ops = attRows(L2, TODAY).filter(r => r.role === 'Operator').reduce((a, r) => a + +r.count, 0);
var outNow = readTab_(CFG.TABS.MANPOWER_EVENTS).filter(e => e.dept === L2 && e.event === 'TRANSFER_OUT').reduce((a, e) => a + +e.count, 0);
var waiting = readTab_(CFG.TABS.TRANSFERS).filter(t => t.status === 'Pending' && t.from_dept === L2 && t.date === TODAY).reduce((a, t) => a + JSON.parse(t.items).reduce((b, i) => b + +i.count, 0), 0);
var free = l2Ops - outNow - waiting;
var hold = call('newrec', 'm.trCreate', { rid: 'h1', date: TODAY, factory: '666', from_dept: L2, to_dept: L3, hour: 16, items: [{ role: 'Operator', count: free }] });
var hold2 = call('newrec', 'm.trCreate', { rid: 'h2', date: TODAY, factory: '666', from_dept: L2, to_dept: L1, hour: 16, items: [{ role: 'Operator', count: 1 }] });
check('people in a waiting request cannot be transferred again', free > 0 && hold.ok && hold2.ok === false && /Only 0 Operator available/.test(hold2.message), [free, hold.message, hold2.message]);
// ========== 16. Report tab: SRN day-wise report (and the admin Review report on the same builder) ==========
var rp = call('rec1', 'm.srnReport', { factory: '666', srn: 'srn0620a' });
var rpL1 = rp.lines && rp.lines.filter(l => l.dept === L1)[0];
check('srn report: lines of the SRN with output, L1 report day-wise with cumulative total', rp.ok && rp.srn === 'SRN0620A' && rpL1 && rpL1.output > 0 && rp.dept && rp.rows.length > 0 && rp.rows[rp.rows.length - 1].total >= rp.rows[0].total, [rp.message, rp.lines, rp.dept]);
var rp1 = call('rec2', 'm.srnReport', { factory: '666', srn: 'SRN0620A', dept: L1 });
check('srn report for a chosen line: that line, any user may read it', rp1.ok && rp1.dept === L1 && rp1.head.line === L1 && rp1.rows.some(x => x.actual > 0), [rp1.message, rp1.head]);
check('srn report: bad SRN refused', call('rec1', 'm.srnReport', { factory: '666', srn: 'x' }).ok === false);
var anyRev = readTab_(CFG.TABS.DAY_SUMMARY).filter(r => r.type === 'STITCH')[0];
var rv = call('admin', 'm.reviewReport', { id: anyRev.id });
check('admin review report still works on the shared builder', rv.ok && rv.head && rv.head.line === anyRev.dept && Array.isArray(rv.rows) && call('rec1', 'm.reviewReport', { id: anyRev.id }).ok === false, [rv.message]);
// ========== 17. the main sheet has no empty rows: rows are added; approved rows that did not reach it are sent again ==========
var dataSh = ssById(ATTID).getSheetByName('Data');
var pendRows = readTab_(CFG.TABS.DAY_SUMMARY).filter(r => r.type === 'STITCH' && (r.status === 'Submitted'));
if (!pendRows.length) { call('rec1', 'm.outSave', { rid: 'full1', date: TODAY, factory: '666', dept: L3, shift: 'Final', slot: '17-18', srn: 'SRN0620A', qty: 5, other: 0, floor: 'Second', allowOver: true, reason: '' }); pendRows = readTab_(CFG.TABS.DAY_SUMMARY).filter(r => r.type === 'STITCH' && r.status === 'Submitted'); }
var target = pendRows[0];
dataSh.maxRows = dataSh.getLastRow();   // sheet full: not one empty row
var before17 = dataSh.getLastRow();
var apFull = call('admin', 'm.reviewDecide', { ids: [target.id], decision: 'approve', remark: '', reasons: {} });
var st17 = readTab_(CFG.TABS.DAY_SUMMARY).filter(r => r.id === target.id)[0].status;
check('sheet without empty rows: rows added, output written, row Sent', apFull.ok && apFull.sent === 1 && st17 === 'Sent' && dataSh.getLastRow() > before17 && dataSh.maxRows > before17, [apFull, st17, before17, dataSh.getLastRow(), dataSh.maxRows]);
// an Approved row left behind (send failed earlier) goes in the background (m.warm), once
var left = readTab_(CFG.TABS.DAY_SUMMARY).filter(r => r.type === 'STITCH' && r.status === 'Sent')[0];
setField_(CFG.TABS.DAY_SUMMARY, left._row, 'status', 'Approved'); invalidateDaily_(CFG.TABS.DAY_SUMMARY);
var rowsBefore = dataSh.getLastRow();
var w1 = call('rec2', 'm.warm', {}), afterW1 = dataSh.getLastRow();
var w2 = call('rec2', 'm.warm', {}), afterW2 = dataSh.getLastRow();
check('approved row left behind: sent by m.warm, only once', w1.ok && w1.resent === 1 && afterW1 > rowsBefore && readTab_(CFG.TABS.DAY_SUMMARY).filter(r => r.id === left.id)[0].status === 'Sent' && (w2.resent || 0) === 0 && afterW2 === afterW1, [w1, w2, rowsBefore, afterW1, afterW2]);
// ========== 18. shift output done -> the OT output of the same line still pending and can be saved ==========
var otAtt = call('rec1', 'att.save', { phone: true, rid: 'ot18', date: TODAY, factory: '666', dept: L3, shift: 'OT', srn: 'SRN0620A', supervisor: 'S', incharge: 'I', rows: [{ role: 'Operator', hours: 2, count: 6 }] });
var finSt = readTab_(CFG.TABS.DAY_SUMMARY).filter(r => r.date === TODAY && r.dept === L3 && r.type === 'STITCH' && (r.shift || 'Final') === 'Final').map(r => r.status);
var mo18 = call('rec1', 'm.out', { factory: '666' });
var otPend = (mo18.groups || []).some(g => g.lines.some(l => l.dept === L3 && l.date === TODAY && l.shift === 'OT'));
check('shift output of L3 already ' + (finSt[0] || 'none') + ': L3 OT output is still pending', otAtt.ok && finSt.length && otPend, [otAtt.message, finSt, mo18.groups && mo18.groups.map(g => g.lines.map(l => l.dept.slice(-5) + ':' + l.shift))]);
var otSave = call('rec1', 'm.outSave', { rid: 'ots18', date: TODAY, factory: '666', dept: L3, shift: 'OT', slot: '21-22', srn: 'SRN0620A', qty: 30, other: 0, floor: '', allowOver: true, reason: '' });
var ds18 = readTab_(CFG.TABS.DAY_SUMMARY).filter(r => r.date === TODAY && r.dept === L3 && r.type === 'STITCH');
check('OT output saves and goes for approval; the shift row keeps its status', otSave.ok && ds18.some(r => r.shift === 'OT' && r.status === 'Submitted') && ds18.filter(r => (r.shift || 'Final') === 'Final').map(r => r.status).join() === finSt.join(), [otSave.message, ds18.map(r => (r.shift || 'Final') + ':' + r.status)]);
// ========== 19. PMS: one list for everybody, every unshipped SRN; search finds shipped ones ==========
var pm1 = call('rec1', 'm.pms', { factory: '666' }), pm2 = call('rec2', 'm.pms', { factory: '666' });
check('PMS: same list for every user, names include every SRN of the list', pm1.ok && JSON.stringify(pm1.rows.map(r => r.srn)) === JSON.stringify(pm2.rows.map(r => r.srn)) && pm1.rows.every(r => pm1.names.indexOf(r.srn) >= 0) && pm1.rows.every(r => !r.isShipped), [pm1.message, pm1.rows.length, pm1.names.length]);
var pf = call('rec1', 'm.pmsFind', { factory: '666', q: '620' });
check('PMS search by number: finds SRN0620A', pf.ok && pf.rows.some(r => r.srn === 'SRN0620A'), [pf.message, pf.rows.map(r => r.srn)]);
check('PMS search needs 2+ characters', call('rec1', 'm.pmsFind', { factory: '666', q: '6' }).rows.length === 0);
// ========== 20. PDR: master-wise report of a date ==========
var pdr = call('rec1', 'm.pdr', { factory: '666', date: TODAY });
var allLines = pdr.ok ? [].concat.apply([], pdr.masters.map(m => m.lines)) : [];
var l3ot = allLines.filter(l => l.dept === L3)[0];
check('PDR: masters with their lines, output from the main sheet + pending app output, shift + OT hours', pdr.ok && pdr.masters.length >= 1 && allLines.some(l => l.dept === L1 && l.out > 0) && l3ot && l3ot.hoursOt === 2 && l3ot.pending === true && pdr.masters.every(m => m.master && m.lines.length), [pdr.message, pdr.masters && pdr.masters.map(m => m.master + ':' + m.lines.map(l => l.dept.slice(-5) + '/' + l.out + '/' + l.hours + '+' + l.hoursOt).join(','))]);
check('PDR: achievement % = actual / plan output', allLines.every(l => l.planOut === '' || Math.abs(l.ach - Math.round(l.out * 1000 / l.planOut) / 10) < 0.01) && (pdr.total.out === allLines.reduce((a, l) => a + l.out, 0)), pdr.total);
check('PDR: each line carries its supervisor', allLines.every(l => typeof l.supervisor === 'string') && allLines.some(l => l.supervisor), allLines.map(l => l.supervisor));
check('PDR: bad date refused', call('rec1', 'm.pdr', { factory: '666', date: 'x' }).ok === false);
// ========== 21. plan: learning curve (col P) and 100% after the plan's last day; PDR plan = rate × actual man-hours ==========
check('learning curve values: "60%", 0.6, 60, blank', planLc_('60%') === 60 && planLc_(0.6) === 60 && planLc_(60) === 60 && planLc_('') === 100);
var D0 = (function () { var d = new Date(TODAY + 'T00:00:00'); d.setDate(d.getDate() - 2); return d.toISOString().slice(0, 10); })();
md.data[3] = []; md.data[3][10] = JSON.stringify(['ts', 'SRN0620A', 'TOTE', L3, D0.split('-').reverse().join('/'), 'Mon', 100, 0, '{}', 10, '{}', 10, 10, 100, '', '50%']);
cacheDelBig_('plan_agg'); try { CacheService.getScriptCache().remove('plan_agg#t'); } catch (e) {}
var pD0 = planOf_(D0, L3, 'SRN0620A'), pAfter = planOf_(TODAY, L3, 'SRN0620A'), pL1 = planOf_(TODAY, L1, 'SRN0620A');
check('plan day at 50%: rate of the day 1.0, full rate 2.0', pD0 && Math.abs(pD0.rate - 1) < 1e-9 && pD0.lc === 50 && Math.abs(pD0.rate100 - 2) < 1e-9, pD0);
check('after the last plan day: 100% of the rate (2.0)', pAfter && pAfter.after === true && pAfter.lc === 100 && Math.abs(pAfter.rate - 2) < 1e-9, pAfter);
check('no plan before the plan starts / other SRN', planOf_(D0, L1, 'SRN0620A') === null && planOf_(TODAY, L3, 'SRN9999X') === null);
var pdr2 = call('admin', 'm.pdr', { factory: '666', date: TODAY });
var lines2 = [].concat.apply([], pdr2.masters.map(m => m.lines));
var pl1 = lines2.filter(l => l.dept === L1 && l.srn === 'SRN0620A')[0], pl2 = lines2.filter(l => l.dept === L3 && l.srn === 'SRN0620A')[0];
check('PDR plan output = rate of the day × actual production man-hours (L1, plan day)', pl1 && pl1.planFrom === 'plan' && pl1.planOut === Math.round(pL1.rate * pl1.manhours), [pl1, pL1 && pL1.rate]);
check('PDR after the plan ended (L3): 100% rate × man-hours', pl2 && pl2.planFrom === 'after' && pl2.lc === 100 && pl2.planOut === Math.round(2 * pl2.manhours), pl2);
// no plan for the line: Making Bulletin SAM (20 min for SRN0620A) × the SRN's learning curve that day (L1 plan: 100%)
md.data[3][10] = JSON.stringify(['ts', 'SRN0999Z', 'X', L3, D0.split('-').reverse().join('/'), 'Mon', 100, 0, '{}', 10, '{}', 10, 10, 100, '', '50%']);
cacheDelBig_('plan_agg'); try { CacheService.getScriptCache().remove('plan_agg#t'); } catch (e) {}
var pdr3 = call('admin', 'm.pdr', { factory: '666', date: TODAY });
var pl3 = [].concat.apply([], pdr3.masters.map(m => m.lines)).filter(l => l.dept === L3 && l.srn === 'SRN0620A')[0];
check('PDR without a line plan: bulletin SAM × learning curve × man-hours (like the hourly target)', pl3 && pl3.planFrom === 'sam' && pl3.sam === 20 && pl3.lc === 100 && pl3.planOut === Math.round(pl3.manhours * 60 / 20), pl3);
// ========== 22. PDR: endline (checked / pass) after the actual output, and floor-wise packing ==========
seed(SOURCE_IDS.ENDLINE, 'Quality Endline data', [['h'], ['h'],
  ['13-Oct-2026', 'FAC666', TODAY, 'SRN0620A', 'TOTE', L1, 'Ground', 'Q1', 8, 100, 95, 5],
  ['13-Oct-2026', 'FAC666', TODAY, 'SRN0620A', 'TOTE', L2, 'Ground', 'Q2', 8, 50, 48, 2],
  ['13-Oct-2026', 'FAC117', TODAY, 'SRN0620A', 'TOTE', L1, 'Ground', 'Q3', 8, 999, 999, 0]]);
var PK = [['ts', 'srn', 'date', 'x', 'qty', 'ctn', 'pcs', 'x', 'factory', 'x', 'x', 'x', 'x', 'press', 'sup', 'chk', 'tc', 'help', 'hrs', 'x', 'x', 'x', 'floor', 'item']];
PK.push(['t', 'SRN0620A', TODAY, '', 300, 10, 30, '', '666', '', '', '', '', 2, 'SG00505-Pack Sup', 3, 1, 2, 8, '', '', '', 'FAC666-Packing Ground', 'TOTE']);
PK.push(['t', 'SRN0620A', TODAY, '', 200, 7, 30, '', '666', '', '', '', '', 2, 'SG00505-Pack Sup', 3, 1, 2, 4, '', '', '', 'FAC666-Packing Ground', 'TOTE']);
PK.push(['t', 'SRN0621A', TODAY, '', 120, 4, 30, '', '666', '', '', '', '', 1, '', 1, 0, 1, 8, '', '', '', 'FAC666-Packing First', 'BAG']);
seed(SOURCE_IDS.PACKING, 'Finishing_Res', PK);
var pdr4 = call('admin', 'm.pdr', { factory: '666', date: TODAY });
var l4 = [].concat.apply([], pdr4.masters.map(m => m.lines));
var e1 = l4.filter(l => l.dept === L1 && l.srn === 'SRN0620A')[0], e2 = l4.filter(l => l.dept === L2 && l.srn === 'SRN0620A')[0];
check('PDR endline: checked / pass on the line (other factory left out)', e1 && e1.endChecked === 100 && e1.endPass === 95, e1);
check('PDR endline of a line without stitching that day: listed too', e2 && e2.endOnly && e2.endPass === 48 && pdr4.total.endPass === 143, [e2, pdr4.total]);
var pk = pdr4.packing || [], gr = pk.filter(f => f.floor === 'FAC666-Packing Ground')[0];
check('PDR packing floor-wise: per floor and SRN, pcs + cartons added, manpower, hours, supervisor', pk.length === 2 && gr && gr.qty === 500 && gr.cartons === 17 && gr.rows[0].mp === 8 && gr.rows[0].hours === 8 && gr.rows[0].supervisor === 'Pack Sup', pk);
// ========== 23. cutting: import of 'cutting data_R' (date, SRN, intent, fabric, qty) and the report's cutting part ==========
var cj = IMPORT_JOBS.filter(j => j.tgt === 'Cutting Data')[0];
var cs = shapeJob_(cj, [['14-Oct-2026 09:55:47', '13-Oct-2026', 'SRN0620A', 'CA0001750', 'Poly | Quilted', 600, 81.5, 8], ['', '28/05/2026', 'SRN0610A', 'CA0001630', 'Jacquard', 250, 43, 8]]);
check('cutting import keeps date, SRN, intent, fabric, qty (col L)', MASTER_PUSH.some(m => m.col === 12 && m.sheet === 'Cutting Data' && m.width === 5) && cs.width === 5 && cs.values[0].join('|') === '13-Oct-2026|SRN0620A|CA0001750|Poly | Quilted|600', cs);
check('cutting dates: 06-Oct-2026 and 05/06/2026 (day first)', cutDate_('06-Oct-2026') === '2026-10-06' && cutDate_('05/06/2026') === '2026-06-05' && cutDate_('') === '', [cutDate_('06-Oct-2026'), cutDate_('05/06/2026')]);
var TD = TODAY.split('-'), MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][+TD[1] - 1];
md.data[2][11] = JSON.stringify([TD[2] + '-' + MON + '-' + TD[0], 'SRN0620A', 'CA1', 'Poly Quilted', 600, ]);
md.data[3][11] = JSON.stringify([TD[2] + '/' + TD[1] + '/' + TD[0], 'SRN0620A', 'CA2', 'Lining', 250]);
md.data[4] = md.data[4] || []; md.data[4][11] = JSON.stringify([TD[2] + '-' + MON + '-' + TD[0], 'SRN0620A', 'CA1', 'Poly Quilted', 100]);
md.data[5] = md.data[5] || []; md.data[5][11] = JSON.stringify(['01-Jan-2020', 'SRN0620A', 'CA9', 'Old', 999]);
var pdr5 = call('admin', 'm.pdr', { factory: '666', date: TODAY }), cut = pdr5.cutting || [];
check('report cutting of the date: SRN-wise, fabric rows added up (other dates left out)', cut.length === 1 && cut[0].srn === 'SRN0620A' && cut[0].qty === 950 && cut[0].rows.length === 2 && cut[0].rows[0].fabric === 'Poly Quilted' && cut[0].rows[0].qty === 700 && cut[0].rows[0].intent === 'CA1', cut);
seed(SOURCE_IDS.CUTTING, 'cutting data_R', [['Timestamps', 'Date', 'SRN', 'Intent', 'Fabric', 'Qty'], ['t', '13-Oct-2026', 'SRN0620A', 'CA1', 'Poly', 600], ['', '28/05/2026', 'SRN0610A', 'CA2', 'Foam', 250]]);
var keepK = md.data[2][10], ci = importCutting_();
check('cutting-only import: header + rows in col L, other columns untouched', /2 rows/.test(ci) && md.data[0][11] === 'Cutting Data' && JSON.parse(md.data[2][11])[3] === 'Poly' && JSON.parse(md.data[3][11])[1] === 'SRN0610A' && !md.data[4][11] && md.data[2][10] === keepK, [ci, md.data[0][11], md.data[2][11]]);
console.log(RESULTS.join('\n')); console.log('\n' + RESULTS.filter(r => r.startsWith('FAIL')).length + ' FAIL / ' + RESULTS.length);
