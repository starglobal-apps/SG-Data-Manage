// Report.js — data for the printed-style day reports (Making Output Report / Packing Output Report).
// One line × one SRN: every row from history (MASTER DATA) plus the app era (HOURLY_LOG + ATT_DAILY), in date order.

var OP_ORDER_ = { Final: 0, OT: 1, Night: 2 };
function opOf_(shift) { shift = str_(shift); return shift === 'OT' ? 'OT' : shift === 'Night' ? 'Night' : 'Final'; }

// All loading rows (compact), cached 15 min — used to list challans for a line/SRN
function loadingRows_() {
  var hit = cacheGetBig_('loading_rows');
  if (hit) return hit;
  var res = Sheets.Spreadsheets.Values.get(srcId_(LOADING_JOB.srcKey),
    a1_(LOADING_JOB.srcSheet, LOADING_JOB.srcRow, LOADING_JOB.srcCol, LOADING_JOB.cols),
    { valueRenderOption: 'UNFORMATTED_VALUE', dateTimeRenderOption: 'FORMATTED_STRING' });
  var rows = (res.values || []).map(function(r) { return [str_(r[10]), str_(r[5]), dateKey_(r[1]), str_(r[2]), num_(r[7])]; })
    .filter(function(r) { return r[0] && r[1] && r[4]; });
  cachePutBig_('loading_rows', rows, 900);
  return rows;
}

// role counts for a dept+date+shift from attendance (app era)
function attRoleCounts_(attRows, dept, date, shift) {
  var m = {}, sup = '', inc = '';
  attRows.forEach(function(r) {
    if (str_(r.dept) !== dept || str_(r.date) !== date || str_(r.shift) !== shift) return;
    m[str_(r.role)] = (m[str_(r.role)] || 0) + num_(r.count);
    if (str_(r.supervisor)) sup = str_(r.supervisor);
    if (str_(r.incharge)) inc = str_(r.incharge);
  });
  return { roles: m, supervisor: sup, incharge: inc };
}
function sumRoles_(m, names) { var t = 0; names.forEach(function(n) { t += num_(m[n]); }); return t; }

// { factory, dept, srn } -> Making Output Report data
function reportLine_(req, user) {
  var factory = str_(req.factory), dept = str_(req.dept), srn = str_(req.srn);
  if (!dept || !srn) return fail_('VAL', 'Line aur SRN chahiye');
  var rows = [], start = CFG.APP_START_DATE;

  // history from MASTER DATA (cols 4 = FAC666 stitching, 5 = FAC117 stitching)
  var md = getSS_().getSheetByName(MASTER_SHEET_NAME);
  if (md && md.getLastRow() >= 3) {
    md.getRange(3, 4, md.getLastRow() - 2, 2).getValues().forEach(function(row) {
      var s = parseJson_(row[0]), s7 = parseJson_(row[1]);
      var a = s && str_(s[2]) === dept && str_(s[3]) === srn ? { date: dateKey_(s[0]), shift: s[5], mp: s[6], hrs: s[7], out: s[8], inc: s[9], sup: s[10], helper: s[11], paster: s[12], tc: s[13], eqc: s[14], hn: s[15] }
            : s7 && str_(s7[3]) === dept && str_(s7[4]) === srn ? { date: dateKey_(s7[0]), shift: s7[5], mp: s7[6], hrs: s7[7], out: s7[8], inc: s7[9], sup: s7[10], helper: s7[11], paster: s7[12], tc: s7[13], eqc: s7[14], hn: s7[15] } : null;
      if (!a || a.date >= start || a.date === '9999-12-31') return;
      var others = num_(a.helper) + num_(a.paster) + num_(a.tc) + num_(a.eqc) + num_(a.hn);
      rows.push({ date: a.date, op: opOf_(a.shift), output: num_(a.out), operator: Math.max(0, num_(a.mp) - others), helper: num_(a.helper), paster: num_(a.paster),
                  eqc: num_(a.eqc), tc: num_(a.tc), other: num_(a.hn), hours: num_(a.hrs), supervisor: str_(a.sup), incharge: str_(a.inc), recorder: '' });
    });
  }
  // app era
  var att = readTab_(CFG.TABS.ATT_DAILY).filter(function(r) { return str_(r.dept) === dept && str_(r.date) >= start; });
  var grp = {};
  readTab_(CFG.TABS.HOURLY_LOG).forEach(function(r) {
    if (str_(r.type) !== 'STITCH' || str_(r.dept) !== dept || str_(r.srn) !== srn || str_(r.date) < start) return;
    var k = str_(r.date) + '|' + opOf_(r.shift);
    if (!grp[k]) grp[k] = { date: str_(r.date), op: opOf_(r.shift), output: 0, recorder: str_(r.entered_by), slots: 0 };
    grp[k].output += num_(r.qty); grp[k].slots++;
  });
  Object.keys(grp).forEach(function(k) {
    var g = grp[k], shift = g.op === 'Final' ? 'Final' : g.op;
    var ac = attRoleCounts_(att, dept, g.date, shift), m = ac.roles;
    var named = ['Operator', 'Helper', 'Paster', 'End Line Checker', 'Thread cutter'];
    var total = 0; Object.keys(m).forEach(function(r) { total += m[r]; });
    rows.push({ date: g.date, op: g.op, output: g.output, operator: num_(m['Operator']), helper: num_(m['Helper']), paster: num_(m['Paster']),
                eqc: num_(m['End Line Checker']), tc: num_(m['Thread cutter']), other: Math.max(0, total - sumRoles_(m, named)),
                hours: g.op === 'Final' ? shiftHours_('Final') : g.slots, supervisor: ac.supervisor, incharge: ac.incharge, recorder: g.recorder });
  });
  rows.sort(function(a, b) { return a.date.localeCompare(b.date) || OP_ORDER_[a.op] - OP_ORDER_[b.op]; });

  var loading = loadingRows_().filter(function(r) { return r[0] === dept && r[1] === srn; })
    .map(function(r) { return { date: r[2], challan: r[3], qty: r[4] }; }).sort(function(a, b) { return a.date.localeCompare(b.date); });

  var staff = lineStaffOf_(dept), lf = masterMap_('LINE_FLOOR')[dept], floor = lf ? lf.value.replace(/^.*Stitching\s*/i, '') : '';
  var last = rows.filter(function(r) { return r.supervisor || r.incharge; }).slice(-1)[0] || {};
  var info = (loadingAgg_().srnInfo || {})[srn] || {};
  return { ok: true, header: { factory: 'FAC' + factory, srn: srn, item: info.item || '', line: dept, floor: floor, supervisor: last.supervisor || staff.supervisor, incharge: last.incharge || staff.incharge },
           rows: rows, loading: loading };
}

// { factory, dept (packing floor), srn } -> Packing Output Report data
function reportPacking_(req, user) {
  var factory = str_(req.factory), dept = str_(req.dept), srn = str_(req.srn);
  if (!dept || !srn) return fail_('VAL', 'Floor aur SRN chahiye');
  var rows = [], start = CFG.APP_START_DATE, pcsPerBox = 0;
  var md = getSS_().getSheetByName(MASTER_SHEET_NAME);
  if (md && md.getLastRow() >= 3) {
    md.getRange(3, 6, md.getLastRow() - 2, 1).getValues().forEach(function(row) {
      var p = parseJson_(row[0]); if (!p || str_(p[0]) !== srn) return;
      var d = dateKey_(p[1]); if (d >= start || d === '9999-12-31') return;
      if (str_(p[21]) && str_(p[21]) !== dept) return;                 // another floor
      var op = /^OT/i.test(str_(p[7])) ? 'OT' : 'Final';
      rows.push({ date: d, op: op, pcs: num_(p[3]), box: num_(p[4]), checker: num_(p[14]), tc: num_(p[15]), helper: num_(p[16]), pressman: num_(p[12]), hours: num_(p[17]), supervisor: str_(p[13]), recorder: '', floorKnown: !!str_(p[21]) });
      if (num_(p[5])) pcsPerBox = num_(p[5]);
    });
  }
  var att = readTab_(CFG.TABS.ATT_DAILY).filter(function(r) { return str_(r.dept) === dept && str_(r.date) >= start; });
  var grp = {};
  readTab_(CFG.TABS.HOURLY_LOG).forEach(function(r) {
    if (str_(r.type) !== 'PACKING' || str_(r.dept) !== dept || str_(r.srn) !== srn || str_(r.date) < start) return;
    var k = str_(r.date) + '|' + opOf_(r.shift);
    if (!grp[k]) grp[k] = { date: str_(r.date), op: opOf_(r.shift), pcs: 0, box: 0, recorder: str_(r.entered_by), slots: 0 };
    grp[k].pcs += num_(r.qty); grp[k].box += num_(r.cartons); grp[k].slots++;
    if (num_(r.pcs_per_ctn)) pcsPerBox = num_(r.pcs_per_ctn);
  });
  Object.keys(grp).forEach(function(k) {
    var g = grp[k], ac = attRoleCounts_(att, dept, g.date, g.op === 'Final' ? 'Final' : g.op), m = ac.roles;
    rows.push({ date: g.date, op: g.op, pcs: g.pcs, box: g.box, checker: num_(m['Checker']), tc: num_(m['Thread cutter']), helper: num_(m['Helper']), pressman: num_(m['Press Man']),
                hours: g.op === 'Final' ? shiftHours_('Final') : g.slots, supervisor: ac.supervisor, recorder: g.recorder, floorKnown: true });
  });
  rows.sort(function(a, b) { return a.date.localeCompare(b.date) || OP_ORDER_[a.op] - OP_ORDER_[b.op]; });
  var staff = lineStaffOf_(dept), last = rows.filter(function(r) { return r.supervisor; }).slice(-1)[0] || {};
  var info = (loadingAgg_().srnInfo || {})[srn] || {};
  return { ok: true, header: { factory: 'FAC' + factory, srn: srn, item: info.item || '', floor: dept, pcsPerBox: pcsPerBox, supervisor: last.supervisor || staff.supervisor || staff.incharge }, rows: rows };
}

// { factory, srn } -> every line / floor that has data for this SRN (for the print-all PDF)
function reportSrn_(req, user) {
  var factory = str_(req.factory), srn = str_(req.srn);
  if (!srn) return fail_('VAL', 'SRN chahiye');
  var L = ledger_(), lines = {}, floors = {};
  Object.keys(L.loaded).forEach(function(k) { var p = k.split('|'); if (p[1] === srn) lines[p[0]] = 1; });
  Object.keys(L.stitched).forEach(function(k) { var p = k.split('|'); if (p[1] === srn) lines[p[0]] = 1; });
  readTab_(CFG.TABS.HOURLY_LOG).forEach(function(r) { if (str_(r.srn) !== srn) return; if (str_(r.type) === 'PACKING') floors[str_(r.dept)] = 1; else lines[str_(r.dept)] = 1; });
  var md = getSS_().getSheetByName(MASTER_SHEET_NAME);
  if (md && md.getLastRow() >= 3) md.getRange(3, 6, md.getLastRow() - 2, 1).getValues().forEach(function(row) { var p = parseJson_(row[0]); if (p && str_(p[0]) === srn && str_(p[21])) floors[str_(p[21])] = 1; });
  var deptFac = {}; mastersRows_().forEach(function(r) { if (str_(r.type) === 'DEPT') deptFac[str_(r.key)] = str_(r.factory); });
  var out = [];
  Object.keys(lines).sort().forEach(function(d) { if (!factory || !deptFac[d] || deptFac[d] === factory) { out.push({ dept: d, type: 'STITCH' }); out.push({ dept: d, type: 'ENDLINE' }); } });
  Object.keys(floors).sort().forEach(function(d) { if (!factory || !deptFac[d] || deptFac[d] === factory) out.push({ dept: d, type: 'PACKING' }); });
  var info = (L.srnInfo || {})[srn] || {};
  return { ok: true, srn: srn, item: info.item || '', targets: out };
}

// { factory, dept, srn } -> Quality Department - Endline FTR data (per date: line output, checked / pass / fail, checkers)
function reportEndline_(req, user) {
  var factory = str_(req.factory), dept = str_(req.dept), srn = str_(req.srn);
  if (!dept || !srn) return fail_('VAL', 'Line aur SRN chahiye');
  var start = CFG.APP_START_DATE, byDate = {}, outByDate = {};
  var get = function(d) { return byDate[d] = byDate[d] || { date: d, checked: 0, pass: 0, fail: 0, hours: 0, checkers: {}, mp: 0 }; };
  var md = getSS_().getSheetByName(MASTER_SHEET_NAME);
  if (md && md.getLastRow() >= 3) {
    md.getRange(3, 4, md.getLastRow() - 2, 4).getValues().forEach(function(row) {
      var s = parseJson_(row[0]); if (s && str_(s[2]) === dept && str_(s[3]) === srn) { var d1 = dateKey_(s[0]); if (d1 < start) addTo_(outByDate, d1, s[8]); }
      var e = parseJson_(row[3]); if (!e || str_(e[5]) !== dept || str_(e[3]) !== srn) return;
      var d = dateKey_(e[2] || e[0]); if (d >= start || d === '9999-12-31') return;
      var g = get(d); g.checked += num_(e[9]); g.pass += num_(e[10]); g.fail += num_(e[11]); g.hours = Math.max(g.hours, num_(e[8])); if (str_(e[7])) g.checkers[str_(e[7])] = 1;
    });
  }
  var att = readTab_(CFG.TABS.ATT_DAILY).filter(function(r) { return str_(r.dept) === dept && str_(r.date) >= start; });
  var slotsByDate = {};
  readTab_(CFG.TABS.HOURLY_LOG).forEach(function(r) {
    if (str_(r.dept) !== dept || str_(r.srn) !== srn || str_(r.date) < start) return;
    var d = str_(r.date);
    if (str_(r.type) === 'STITCH') addTo_(outByDate, d, r.qty);
    if (str_(r.type) !== 'ENDLINE') return;
    var g = get(d); g.checked += num_(r.checked); g.pass += num_(r.pass); g.fail += num_(r.reject); if (str_(r.checker)) g.checkers[str_(r.checker)] = 1;
    (slotsByDate[d] = slotsByDate[d] || {})[str_(r.slot)] = 1;
  });
  Object.keys(slotsByDate).forEach(function(d) { get(d).hours = Object.keys(slotsByDate[d]).length; });
  var ipqc = {}, incharge = '';
  var rows = Object.keys(byDate).sort().map(function(d) {
    var g = byDate[d], ac = attRoleCounts_(att, dept, d, 'Final');
    var qmp = num_(ac.roles['End Line Checker']) + num_(ac.roles['Line Qc.']) + num_(ac.roles['Final Checker']) || Object.keys(g.checkers).length;
    if (ac.incharge) incharge = ac.incharge;
    Object.keys(g.checkers).forEach(function(c) { ipqc[c] = (ipqc[c] || 0) + 1; });
    return { date: d, output: num_(outByDate[d]), mp: qmp, hours: g.hours, checked: g.checked, pass: g.pass, fail: g.fail, qc: Object.keys(g.checkers).join(', ') };
  });
  var staff = lineStaffOf_(dept), lf = masterMap_('LINE_FLOOR')[dept], floor = lf ? lf.value.replace(/^.*Stitching\s*/i, '') : '';
  var top = Object.keys(ipqc).sort(function(a, b) { return ipqc[b] - ipqc[a]; })[0] || '';
  var info = (loadingAgg_().srnInfo || {})[srn] || {};
  return { ok: true, header: { factory: 'FAC' + factory, srn: srn, item: info.item || '', line: dept, floor: floor ? floor + ' Floor' : '', incharge: incharge || staff.incharge, ipqc: top }, rows: rows };
}
