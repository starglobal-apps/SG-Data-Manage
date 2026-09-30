// DayClose.js — evening roll-up of hourly rows into final-shaped day rows, manager review, and Send to Final.
//
// DAY_SUMMARY.status: Draft -> Submitted -> Approved -> Sent   (or Rejected -> back to Draft on re-entry)

function masterMap_(type) {
  var m = {};
  mastersRows_().forEach(function(r) { if (str_(r.type) === type && isTrue_(r.active)) m[str_(r.key)] = { value: str_(r.value), extra: str_(r.extra) }; });
  return m;
}

function shiftHours_(shift) {
  for (var i = 0; i < CFG.SHIFTS.length; i++) if (CFG.SHIFTS[i].key === shift) return CFG.SHIFTS[i].hours;
  return 8;
}

function sum_(rows, f) { var t = 0; rows.forEach(function(r) { t += num_(r[f]); }); return t; }

// Working hours of a shift as entered in attendance (the largest hours bucket); falls back to the shift default
function attHours_(rows, shift) {
  var h = 0; rows.forEach(function(r) { if (num_(r.count) > 0 && num_(r.hours) > h) h = num_(r.hours); });
  return h || shiftHours_(shift);
}

// Builds Draft rows for (date, factory[, dept]). Existing Draft/Rejected rows for the same keys are replaced;
// Submitted/Approved/Sent rows are left alone and reported back.
function dayBuild_(req, user) {
  var date = str_(req.date), factory = str_(req.factory), onlyDept = str_(req.dept), onlyType = str_(req.onlyType);
  if (!isDateStr_(date)) return fail_('DATE', 'Date galat');
  if (CFG.FACTORIES.indexOf(factory) < 0) return fail_('FACTORY', 'Factory galat');

  var att = readTab_(CFG.TABS.ATT_DAILY).filter(function(r) { return str_(r.date) === date && str_(r.factory) === factory; });
  var events = readTab_(CFG.TABS.MANPOWER_EVENTS).filter(function(r) { return str_(r.date) === date && str_(r.factory) === factory; });
  var hourly = readTab_(CFG.TABS.HOURLY_LOG).filter(function(r) { return str_(r.date) === date && str_(r.factory) === factory; });
  var lineFloor = masterMap_('LINE_FLOOR'), lineStaff = masterMap_('LINE_STAFF');
  var L = ledger_(), stitchedSrnDB = {};
  Object.keys(L.stitched).forEach(function(k) { addTo_(stitchedSrnDB, k.split('|')[1], L.stitched[k]); });
  var pmsBlocks = function(dept, srn, cat, type) { return pmsAlerts_(L, stitchedSrnDB, dept, srn, cat).filter(function(a) { return a.type === type; }).map(function(a) { return { level: 'block', msg: a.msg }; }); };
  var rows = [];

  // ---- ATT: one summary per dept+shift
  var attKeys = {};
  att.forEach(function(r) { attKeys[str_(r.dept) + '|' + str_(r.shift)] = true; });
  Object.keys(attKeys).forEach(function(k) {
    var p = k.split('|'), dept = p[0], shift = p[1];
    if (onlyDept && dept !== onlyDept) return;
    if (onlyType && onlyType !== 'ATT') return;
    var eff = effectiveAttendanceDetail_(date, factory, dept, shift, att, events);
    var flags = [];
    if (!eff.length) flags.push({ level: 'warn', msg: 'Attendance khali' });
    var nm = attNames_(att, dept, shift);
    var attSrnRow = att.filter(function(r) { return str_(r.dept) === dept && str_(r.shift) === shift && str_(r.srn); })[0];
    rows.push({ date: date, factory: factory, line: lineOf_(dept), dept: dept, type: 'ATT', srn: '', shift: shift,
                payload: { rows: eff, manpower: sum_(eff, 'count'), manhours: eff.reduce(function(t, r) { return t + r.count * r.hours; }, 0), supervisor: nm.supervisor, incharge: nm.incharge, srn: attSrnRow ? str_(attSrnRow.srn) : '',
                           replaceSheet: !!sheetAttAgg_()[date + '|' + dept + '|' + shift] }, flags: flags });
    if (sheetAttAgg_()[date + '|' + dept + '|' + shift]) flags.push({ level: 'info', msg: 'Sheet me pehle se bhari attendance — approve hone par wo rows is se badal jayengi' });
  });

  // ---- STITCH: per dept + srn + shift
  var groups = {};
  hourly.filter(function(r) { return str_(r.type) === 'STITCH' && (!onlyType || onlyType === 'STITCH'); }).forEach(function(r) {
    var k = [str_(r.dept), str_(r.srn), str_(r.shift)].join('|');
    (groups[k] = groups[k] || []).push(r);
  });
  Object.keys(groups).forEach(function(k) {
    var p = k.split('|'), dept = p[0], srn = p[1], shift = p[2], g = groups[k];
    if (onlyDept && dept !== onlyDept) return;
    var effAtt = effectiveAttendanceDetail_(date, factory, dept, shift, att, events);
    if (!effAtt.length) {   // attendance only in the main sheet (typed there): take manpower from it
      var sa = sheetAttAgg_()[date + '|' + dept + '|' + shift];
      if (sa) effAtt = Object.keys(sa.roles).map(function(role) { return { role: role, hours: sa.hours, count: sa.roles[role], remark: '' }; });
    }
    var byRole = {}; effAtt.forEach(function(r) { byRole[r.role] = (byRole[r.role] || 0) + r.count; });
    // one final row per working-hours group: the longest-hours group carries the output, the others output 0
    var byH = {};
    effAtt.forEach(function(r) { var g = byH[r.hours] = byH[r.hours] || { hours: r.hours, manpower: 0, roles: {}, remark: [] }; g.manpower += r.count; g.roles[r.role] = (g.roles[r.role] || 0) + r.count; if (r.remark) g.remark.push(r.role + ': ' + r.remark); });
    var splits = Object.keys(byH).map(function(h) { return byH[h]; }).sort(function(a, b) { return b.hours - a.hours || b.manpower - a.manpower; })
      .map(function(g) { var o = { hours: g.hours, manpower: g.manpower, remark: g.remark.join('; ') }; CFG.STITCH_ROLE_COLS.forEach(function(role, i) { o['r' + (i + 1)] = g.roles[role] || 0; }); return o; });
    var names = attNames_(att, dept, shift === 'Final' ? 'Final' : '');
    var closeS = shift === 'Final' ? lineClose_(events, dept) : null;
    var attHrs = attHours_(effAtt, shift);
    var payload = {
      date: date, line: lineOf_(dept), dept: dept, srn: srn,
      floor: str_(g[0].floor) || (lineFloor[dept] ? lineFloor[dept].value : ''),
      shift: shift, manpower: sum_(effAtt, 'count'), hours: closeS ? Math.min(attHrs, closeS.eff) : attHrs, output: sum_(g, 'qty'),
      supervisor: names.supervisor, incharge: names.incharge, slots: g.length, splits: splits
    };
    // plan output = hourly target (manpower × 60 ÷ SAM of the SRN) × working hours — i.e. worked man-minutes ÷ SAM
    // (half-day people count only for the hours they worked). Blank when the SRN has no SAM yet.
    var samP = samOf_(srn), manHrs = effAtt.reduce(function(t, r) { return t + num_(r.count) * Math.min(num_(r.hours), payload.hours || num_(r.hours)); }, 0);
    payload.sam = samP ? samP.sam : 0;
    payload.plan = samP && samP.sam > 0 && manHrs > 0 ? Math.round(manHrs * 60 / samP.sam) : '';
    CFG.STITCH_ROLE_COLS.forEach(function(role, i) { payload['r' + (i + 1)] = byRole[role] || 0; });
    var flags = [];
    if (!payload.manpower) flags.push({ level: 'warn', msg: 'Is dept ki ' + shift + ' attendance nahi hai' });
    if (closeS) flags.push({ level: 'info', msg: 'Line band ' + closeS.time + ' → ' + payload.hours + ' hrs' });
    if (!payload.floor) flags.push({ level: 'warn', msg: 'Floor nahi mila (MASTERS LINE_FLOOR)' });
    flags = flags.concat(pmsBlocks(dept, srn, 'STITCH', 'STITCH'));
    rows.push({ date: date, factory: factory, line: payload.line, dept: dept, type: 'STITCH', srn: srn, shift: shift, payload: payload, flags: flags });
  });

  // ---- ENDLINE: per dept + srn + checker (+ shift)
  groups = {};
  hourly.filter(function(r) { return str_(r.type) === 'ENDLINE' && (!onlyType || onlyType === 'ENDLINE'); }).forEach(function(r) {
    var k = [str_(r.dept), str_(r.srn), str_(r.checker), str_(r.shift)].join('|');
    (groups[k] = groups[k] || []).push(r);
  });
  Object.keys(groups).forEach(function(k) {
    var p = k.split('|'), dept = p[0], srn = p[1], checker = p[2], shift = p[3], g = groups[k];
    if (onlyDept && dept !== onlyDept) return;
    var info = L.srnInfo[srn] || {};
    var floorName = str_(g[0].floor) || (lineFloor[dept] ? lineFloor[dept].value : '');
    var slotMap = {}, slotSet = {}, defects = {};
    g.forEach(function(r) {
      var sk = str_(r.slot); slotSet[sk] = true;
      if (!slotMap[sk]) slotMap[sk] = { pass: 0, reject: 0 };
      slotMap[sk].pass += num_(r.pass); slotMap[sk].reject += num_(r.reject);
      parseJsonArr_(r.defects).forEach(function(x) { if (x && x.d) defects[x.d] = (defects[x.d] || 0) + num_(x.n); });
    });
    var payload = {
      entryDate: date, factoryName: 'FAC' + factory, date: date, srn: srn, item: info.item || '', dept: dept,
      qfloor: floorName.replace(/Stitching/i, 'Quality'), checker: checker, hours: Object.keys(slotSet).length,
      checked: sum_(g, 'checked'), pass: sum_(g, 'pass'), reject: sum_(g, 'reject'), shift: shift, slots: slotMap, defects: defects
    };
    var flags = [];
    if (!checker) flags.push({ level: 'warn', msg: 'Checker ka naam nahi' });
    flags = flags.concat(pmsBlocks(dept, srn, 'STITCH', 'ENDLINE'));
    rows.push({ date: date, factory: factory, line: lineOf_(dept), dept: dept, type: 'ENDLINE', srn: srn, shift: shift, payload: payload, flags: flags });
  });

  // ---- PACKING: per packing dept + srn (+ shift)
  groups = {};
  hourly.filter(function(r) { return str_(r.type) === 'PACKING' && (!onlyType || onlyType === 'PACKING'); }).forEach(function(r) {
    var k = [str_(r.dept), str_(r.srn), str_(r.shift)].join('|');
    (groups[k] = groups[k] || []).push(r);
  });
  Object.keys(groups).forEach(function(k) {
    var p = k.split('|'), dept = p[0], srn = p[1], shift = p[2], g = groups[k];
    if (onlyDept && dept !== onlyDept) return;
    var staff = attNames_(att, dept, shift === 'Final' ? 'Final' : '');
    var cartons = sum_(g, 'cartons'), qty = sum_(g, 'qty');
    var effP = effectiveAttendance_(date, factory, dept, shift, att, events), byRoleP = {};
    effP.forEach(function(r) { byRoleP[r.role] = (byRoleP[r.role] || 0) + r.count; });
    var info = L.srnInfo[srn] || {};
    var closeP = shift === 'Final' ? lineClose_(events, dept) : null;
    var attHrsP = attHours_(effP, shift);
    var payload = { srn: srn, date: date, qty: qty, cartons: cartons, pcs_per_ctn: cartons ? Math.round(qty / cartons) : num_(g[0].pcs_per_ctn),
                    factory: shift === 'Final' ? factory : 'OT-' + factory, supervisor: staff.supervisor || '', hours: closeP ? Math.min(attHrsP, closeP.eff) : attHrsP, floor: dept, shift: shift,
                    item: info.item || '', manpower: sum_(effP, 'count') };
    Object.keys(CFG.PACK_ROLE_COLS).forEach(function(f) { payload[f] = byRoleP[CFG.PACK_ROLE_COLS[f]] || 0; });
    var flags = [];
    if (!payload.manpower) flags.push({ level: 'warn', msg: 'Is packing dept ki ' + shift + ' attendance nahi hai' });
    flags = flags.concat(pmsBlocks(dept, srn, 'PACKING', 'PACKING'));
    rows.push({ date: date, factory: factory, line: '', dept: dept, type: 'PACKING', srn: srn, shift: shift, payload: payload, flags: flags });
  });

  // ---- persist: replace Draft/Rejected rows for these keys
  var stamp = nowStr_();
  var kept = [], written = 0;
  withLock_(function() {
    var existing = readTab_(CFG.TABS.DAY_SUMMARY).filter(function(r) {
      return str_(r.date) === date && str_(r.factory) === factory && (!onlyDept || str_(r.dept) === onlyDept) && (!onlyType || str_(r.type) === onlyType);
    });
    var del = [];
    existing.forEach(function(r) {
      if (isLocked_(str_(r.status))) kept.push(str_(r.dept) + '|' + str_(r.type) + '|' + str_(r.srn) + '|' + str_(r.shift) + ' = ' + str_(r.status));
      else del.push(r._row);
    });
    var lockedKeys = {};
    existing.forEach(function(r) { if (isLocked_(str_(r.status))) lockedKeys[str_(r.dept) + '|' + str_(r.type) + '|' + str_(r.srn) + '|' + str_(r.shift)] = true; });
    deleteRows_(CFG.TABS.DAY_SUMMARY, del);
    var toWrite = rows.filter(function(r) { return !lockedKeys[r.dept + '|' + r.type + '|' + r.srn + '|' + r.shift]; });
    appendRows_(CFG.TABS.DAY_SUMMARY, toWrite.map(function(r) {
      return { id: uuid_(), date: r.date, factory: r.factory, line: r.line, dept: r.dept, type: r.type, srn: r.srn, shift: r.shift,
               payload: JSON.stringify(r.payload), status: 'Draft', flags: JSON.stringify(r.flags), submitted_by: '', submitted_at: '',
               reviewed_by: '', reviewed_at: '', remark: '', cleaned_at: '' };
    }));
    written = toWrite.length;
  });
  audit_(user, 'day.build', date + '|' + factory + '|' + onlyDept, { written: written, kept: kept.length });
  return { ok: true, rows: rows, written: written, locked: kept };
}

// Draft -> Submitted for (date, factory[, dept]). Blocks if any row has a 'block' flag.
function daySubmit_(req, user) {
  var date = str_(req.date), factory = str_(req.factory), onlyDept = str_(req.dept);
  var built = dayBuild_(req, user);
  if (!built.ok) return built;
  var blocks = [];
  built.rows.forEach(function(r) { r.flags.forEach(function(f) { if (f.level === 'block') blocks.push(r.dept + ' ' + r.srn + ': ' + f.msg); }); });
  // mismatches do not stop the recorder any more: the rows carry the flags and the admin decides in Review
  var n = 0, stamp = nowStr_();
  withLock_(function() {
    var sh = tab_(CFG.TABS.DAY_SUMMARY, true), head = CFG.HEADERS.DAY_SUMMARY;
    var ci = { status: head.indexOf('status') + 1, by: head.indexOf('submitted_by') + 1, at: head.indexOf('submitted_at') + 1 };
    readTab_(CFG.TABS.DAY_SUMMARY).forEach(function(r) {
      if (str_(r.date) !== date || str_(r.factory) !== factory || (onlyDept && str_(r.dept) !== onlyDept)) return;
      if (str_(r.status) !== 'Draft') return;
      sh.getRange(r._row, ci.status).setValue('Submitted');
      sh.getRange(r._row, ci.by).setValue(userName_(user));
      sh.getRange(r._row, ci.at).setValue(stamp);
      n++;
    });
  });
  invalidateDaily_(CFG.TABS.DAY_SUMMARY);
  audit_(user, 'day.submit', date + '|' + factory + '|' + onlyDept, { rows: n, blocks: blocks.length });
  return { ok: true, submitted: n, rows: built.rows, blocks: blocks };
}

function setDayStatus_(date, factory, dept, type, status, user, remark) {
  var sh = tab_(CFG.TABS.DAY_SUMMARY, true), head = CFG.HEADERS.DAY_SUMMARY;
  var cs = head.indexOf('status') + 1, cr = head.indexOf('remark') + 1;
  readTab_(CFG.TABS.DAY_SUMMARY).forEach(function(r) {
    if (str_(r.date) === date && str_(r.factory) === factory && str_(r.dept) === dept && str_(r.type) === type) {
      sh.getRange(r._row, cs).setValue(status);
      if (remark !== undefined) sh.getRange(r._row, cr).setValue(remark);
    }
  });
  invalidateDaily_(CFG.TABS.DAY_SUMMARY);
}

// ---------- manager review ----------

function isAdmin_(user) { return user.role === 'Admin'; }

function reviewList_(req, user) {
  if (!isAdmin_(user)) return fail_('PERM', 'Sirf admin');
  var L = ledger_(), stitchedSrn = {};
  Object.keys(L.stitched).forEach(function(k) { addTo_(stitchedSrn, k.split('|')[1], L.stitched[k]); });
  var date = str_(req.date), factory = str_(req.factory), status = str_(req.status);
  var since = str_(req.since) || fmtDate_(new Date(new Date().getTime() - 14 * 86400000));
  var out = readTab_(CFG.TABS.DAY_SUMMARY).filter(function(r) {
    if (date && str_(r.date) !== date) return false;
    if (!date && str_(r.date) < since) return false;
    if (factory && str_(r.factory) !== factory) return false;
    if (status && str_(r.status) !== status) return false;
    return str_(r.status) !== 'Draft';
  }).map(function(r) {
    var payload = parseJsonObj_(r.payload), flags = parseJsonArr_(r.flags);
    var fin = finalRow_(r, payload);
    var pms = str_(r.srn) ? pmsRow_(L, stitchedSrn, str_(r.dept), str_(r.srn)) : null;
    return { id: str_(r.id), date: str_(r.date), factory: str_(r.factory), line: str_(r.line), dept: str_(r.dept), type: str_(r.type), pms: pms,
             srn: str_(r.srn), shift: str_(r.shift), status: str_(r.status), payload: payload, flags: flags,
             submitted_by: str_(r.submitted_by), submitted_at: str_(r.submitted_at), reviewed_by: str_(r.reviewed_by), remark: str_(r.remark),
             target: fin ? fin.target : '', finalRows: fin ? fin.rows : [] };
  });
  out.sort(function(a, b) { return (b.date + b.dept).localeCompare(a.date + a.dept); });
  return { ok: true, items: out };
}

function parseJsonObj_(v) { try { var o = JSON.parse(v); return o && typeof o === 'object' ? o : {}; } catch (e) { return {}; } }
function parseJsonArr_(v) { try { var a = JSON.parse(v); return Array.isArray(a) ? a : []; } catch (e) { return []; } }

// { ids: [], action: 'approve'|'reject', remark, override }
function reviewDecide_(req, user) {
  if (!isAdmin_(user)) return fail_('PERM', 'Sirf admin');
  var ids = Array.isArray(req.ids) ? req.ids.map(str_) : [], action = str_(req.action), remark = str_(req.remark), override = !!req.override;
  if (!ids.length) return fail_('IDS', 'Kuch select karo');
  if (action === 'reject' && !remark) return fail_('REMARK', 'Reject ka reason likho');
  var sh = tab_(CFG.TABS.DAY_SUMMARY, true), head = CFG.HEADERS.DAY_SUMMARY;
  var ci = { status: head.indexOf('status') + 1, by: head.indexOf('reviewed_by') + 1, at: head.indexOf('reviewed_at') + 1, remark: head.indexOf('remark') + 1 };
  var stamp = nowStr_(), done = 0, skipped = [];
  withLock_(function() {
    readTab_(CFG.TABS.DAY_SUMMARY).forEach(function(r) {
      if (ids.indexOf(str_(r.id)) < 0) return;
      var st = str_(r.status);
      if (st === 'Sent') { skipped.push(str_(r.dept) + ' ' + str_(r.srn) + ': already Sent'); return; }
      if (action === 'approve') {
        var blocks = parseJsonArr_(r.flags).filter(function(f) { return f.level === 'block'; });
        if (blocks.length && !override) { skipped.push(str_(r.dept) + ' ' + str_(r.srn) + ': ' + blocks[0].msg); return; }
        if (blocks.length && !remark) { skipped.push(str_(r.dept) + ' ' + str_(r.srn) + ': override ka reason likho'); return; }
        sh.getRange(r._row, ci.status).setValue('Approved');
      } else {
        sh.getRange(r._row, ci.status).setValue('Rejected');
      }
      sh.getRange(r._row, ci.by).setValue(userName_(user));
      sh.getRange(r._row, ci.at).setValue(stamp);
      sh.getRange(r._row, ci.remark).setValue(remark);
      done++;
    });
  });
  invalidateDaily_(CFG.TABS.DAY_SUMMARY);
  audit_(user, 'review.' + action, ids.join(','), { done: done, skipped: skipped, override: override, remark: remark });
  return { ok: true, done: done, skipped: skipped };
}

// ---------- Send to Final ----------

function fmtSheetDate_(iso, style) {
  var d = parseDate_(iso); if (!d) return iso;
  if (style === 'us') return Utilities.formatDate(d, tz_(), 'M/d/yyyy');
  if (style === 'dd') return Utilities.formatDate(d, tz_(), 'dd-MMM-yyyy');
  return Utilities.formatDate(d, tz_(), 'd-MMM-yyyy');
}

// Maps one DAY_SUMMARY row to { target, rows: [ {field: value} ] } (ATT produces one row per role)
function finalRow_(r, p) {
  var type = str_(r.type), factory = str_(r.factory), shift = str_(r.shift);
  if (type === 'STITCH') {
    var t = factory === '117' ? 'STITCH_117' : 'STITCH_666';
    var base = { date: fmtSheetDate_(p.date, factory === '117' ? 'us' : ''), line: p.line, dept: p.dept, srn: p.srn, floor: p.floor,
                 shift: shift === 'Final' ? 'Final' : 'OT', master: p.incharge, supervisor: p.supervisor };
    var sp = p.splits || [];
    if (sp.length > 1) {
      return { target: t, rows: sp.map(function(g, i) {
        return Object.assign({}, base, { manpower: g.manpower, hours: i === 0 ? p.hours : g.hours, output: i === 0 ? p.output : 0, plan: i === 0 ? (p.plan === undefined ? '' : p.plan) : '', r1: g.r1, r2: g.r2, r3: g.r3, r4: g.r4, r5: g.r5, remark: g.remark || '' });
      }) };
    }
    return { target: t, rows: [Object.assign({}, base, { manpower: p.manpower, hours: p.hours, output: p.output, plan: p.plan === undefined ? '' : p.plan, r1: p.r1, r2: p.r2, r3: p.r3, r4: p.r4, r5: p.r5 })] };
  }
  if (type === 'ENDLINE') {
    var row2 = { entryDate: fmtSheetDate_(todayStr_()), factoryName: p.factoryName, date: fmtSheetDate_(p.date),
             srn: p.srn, item: p.item, dept: p.dept, qfloor: p.qfloor, checker: p.checker, hours: p.hours, checked: p.checked, pass: p.pass, reject: p.reject };
    Object.keys(CFG.ENDLINE_SLOT_COLS).forEach(function(sk) {
      var sv = (p.slots || {})[sk], tag = sk.replace('-', '');
      row2['p' + tag] = sv ? sv.pass : ''; row2['f' + tag] = sv ? sv.reject : '';
    });
    return { target: 'ENDLINE', rows: [row2] };
  }
  if (type === 'PACKING') {
    return { target: 'PACKING', rows: [{ entryTs: nowStr_(), srn: p.srn, date: p.date, qty: p.qty, cartons: p.cartons, pcs_per_ctn: p.pcs_per_ctn,
             factory: p.factory, pressman: p.pressman, supervisor: p.supervisor, checker: p.checker, threadcutter: p.threadcutter, helper: p.helper,
             hours: p.hours, floor: p.floor, item: p.item }] };
  }
  if (type === 'ATT') {
    var t2 = shift !== 'Final' ? 'ATT_OT' : (factory === '117' ? 'ATT_117' : 'ATT_666');
    var staffA = lineStaffOf_(r.dept);
    var rows = (p.rows || []).map(function(x) {
      return { date: fmtSheetDate_(r.date, 'dd'), factory: Number(factory), dept: r.dept, role: x.role, hours: x.hours, count: x.count,
               manhours: x.hours * x.count, incharge: p.incharge || staffA.incharge || '', supervisor: p.supervisor || staffA.supervisor || '',
               srn: p.srn || '', remark: x.remark || '' };
    });
    return { target: t2, rows: rows };
  }
  return null;
}

// { ids: [] } -> appends Approved rows to their source sheets, marks them Sent
function reviewSend_(req, user) {
  if (!isAdmin_(user)) return fail_('PERM', 'Sirf admin');
  var ids = Array.isArray(req.ids) ? req.ids.map(str_) : [];
  if (!ids.length) return fail_('IDS', 'Kuch select karo');
  var items = readTab_(CFG.TABS.DAY_SUMMARY).filter(function(r) { return ids.indexOf(str_(r.id)) >= 0; });
  var ready = items.filter(function(r) { return str_(r.status) === 'Approved'; });
  var skipped = items.filter(function(r) { return str_(r.status) !== 'Approved'; }).map(function(r) { return str_(r.dept) + ' ' + str_(r.srn) + ': ' + str_(r.status); });
  if (!ready.length) return { ok: false, error: 'NONE', message: 'Koi Approved row nahi', skipped: skipped };

  var byTarget = {};
  ready.forEach(function(r) {
    var fin = finalRow_(r, parseJsonObj_(r.payload));
    if (!fin) return;
    (byTarget[fin.target] = byTarget[fin.target] || []).push({ r: r, rows: fin.rows });
  });

  var log = [], sentIds = [];
  withLock_(function() {
    // attendance edited in the app that was first typed into the sheet: remove those old rows, then append the new ones
    ready.forEach(function(r) {
      if (str_(r.type) !== 'ATT') return;
      var p = parseJsonObj_(r.payload); if (!p.replaceSheet) return;
      var fin = finalRow_(r, p); if (!fin) return;
      try { var n = deleteSheetAttRows_(CFG.FINAL_TARGETS[fin.target], str_(r.date), str_(r.dept)); log.push(fin.target + ': purani ' + n + ' rows hataayi (' + str_(r.dept) + ' ' + str_(r.date) + ')'); }
      catch (e) { log.push(fin.target + ': purani rows nahi hati — ' + (e && e.message || e)); }
    });
    Object.keys(byTarget).forEach(function(tk) {
      var T = CFG.FINAL_TARGETS[tk];
      var flat = [];
      byTarget[tk].forEach(function(x) { x.rows.forEach(function(row) { flat.push(row); }); });
      var res = appendFinal_(T, flat);
      log.push(tk + ': ' + flat.length + ' rows at row ' + res.startRow);
      byTarget[tk].forEach(function(x) { sentIds.push(str_(x.r.id)); });
    });
    var sh = tab_(CFG.TABS.DAY_SUMMARY, true), head = CFG.HEADERS.DAY_SUMMARY;
    var cs = head.indexOf('status') + 1, cb = head.indexOf('reviewed_by') + 1, ca = head.indexOf('reviewed_at') + 1, stamp = nowStr_();
    ready.forEach(function(r) {
      if (sentIds.indexOf(str_(r.id)) < 0) return;
      sh.getRange(r._row, cs).setValue('Sent'); sh.getRange(r._row, cb).setValue(userName_(user)); sh.getRange(r._row, ca).setValue(stamp);
    });
  });
  cacheDelBig_('hist_agg'); cacheDelBig_('hist_agg2'); cacheDelBig_('app_agg'); invalidateDaily_(CFG.TABS.DAY_SUMMARY);
  var scheduled = sentIds.length ? scheduleAfterSend_() : false;
  audit_(user, 'review.send', sentIds.join(','), log.concat(['import trigger: ' + scheduled]));
  return { ok: true, sent: sentIds.length, log: log, skipped: skipped, importScheduled: scheduled };
}

// Deletes the rows of one line/date from an attendance target sheet (matched on its date and dept columns).
function deleteSheetAttRows_(T, dateIso, dept) {
  var dateCol = 0, deptCol = 0;
  Object.keys(T.cols).forEach(function(c) { if (T.cols[c] === 'date') dateCol = +c; if (T.cols[c] === 'dept') deptCol = +c; });
  if (!dateCol || !deptCol) return 0;
  var id = srcId_(T.srcKey);
  var meta = Sheets.Spreadsheets.get(id, { fields: 'sheets.properties' });
  var sh = (meta.sheets || []).filter(function(s) { return s.properties.title === T.sheet; })[0];
  if (!sh) return 0;
  var c1 = Math.min(dateCol, deptCol), c2 = Math.max(dateCol, deptCol);
  var got = Sheets.Spreadsheets.Values.get(id, a1_(T.sheet, 1, c1, c2 - c1 + 1), { valueRenderOption: 'FORMATTED_VALUE' });
  var rows = [];
  (got.values || []).forEach(function(v, i) {
    if (dateKey_(v[dateCol - c1]) === dateIso && str_(v[deptCol - c1]) === dept) rows.push(i);   // 0-based sheet row index
  });
  if (!rows.length) return 0;
  var reqs = rows.sort(function(a, b) { return b - a; }).map(function(i) {
    return { deleteDimension: { range: { sheetId: sh.properties.sheetId, dimension: 'ROWS', startIndex: i, endIndex: i + 1 } } };
  });
  Sheets.Spreadsheets.batchUpdate({ requests: reqs }, id);
  return rows.length;
}

// Writes rows into the target sheet, only the mapped columns, starting at the first empty row of keyCol.
function appendFinal_(T, rows) {
  var id = srcId_(T.srcKey);
  var keyLetter = colLetter_(T.keyCol);
  var got = Sheets.Spreadsheets.Values.get(id, "'" + String(T.sheet).replace(/'/g, "''") + "'!" + keyLetter + T.minRow + ':' + keyLetter);
  var used = (got.values || []).length;
  // trim trailing blanks
  var vals = got.values || [];
  while (used > 0 && (!vals[used - 1] || vals[used - 1][0] === '' || vals[used - 1][0] === null)) used--;
  var startRow = T.minRow + used;

  var colNums = Object.keys(T.cols).map(Number).sort(function(a, b) { return a - b; });
  var minC = colNums[0], maxC = colNums[colNums.length - 1];
  var data = rows.map(function(row) {
    var out = [];
    for (var c = minC; c <= maxC; c++) {
      var f = T.cols[c];
      out.push(f === undefined ? null : (row[f] === undefined || row[f] === null ? '' : row[f]));
    }
    return out;
  });
  // null cells are skipped by the API (existing formulas/values untouched)
  Sheets.Spreadsheets.Values.update(
    { values: data },
    id,
    a1_(T.sheet, startRow, minC, maxC - minC + 1, startRow + data.length - 1),
    { valueInputOption: 'USER_ENTERED' }
  );
  return { startRow: startRow, rows: data.length };
}

// Logs the header rows + last data row of every final target so the column mapping can be verified.
function diagFinalTargets(onlyKey) {
  var lines = [];
  Object.keys(CFG.FINAL_TARGETS).forEach(function(tk) {
    if (onlyKey && tk !== onlyKey) return;
    var T = CFG.FINAL_TARGETS[tk];
    Utilities.sleep(1500); // Sheets read quota is per minute
    try {
      var id = srcId_(T.srcKey);
      var colNums = Object.keys(T.cols).map(Number);
      var maxC = Math.max.apply(null, colNums.concat([27]));
      var head = Sheets.Spreadsheets.Values.get(id, a1_(T.sheet, 1, 1, maxC, Math.max(2, T.minRow - 1)), { valueRenderOption: 'FORMATTED_VALUE' });
      var keyLetter = colLetter_(T.keyCol);
      var col = Sheets.Spreadsheets.Values.get(id, "'" + String(T.sheet).replace(/'/g, "''") + "'!" + keyLetter + T.minRow + ':' + keyLetter);
      var n = (col.values || []).length, lastRow = T.minRow + n - 1;
      var last = n ? Sheets.Spreadsheets.Values.get(id, a1_(T.sheet, lastRow, 1, maxC, lastRow), { valueRenderOption: 'FORMATTED_VALUE' }) : { values: [] };
      var formulas = n ? Sheets.Spreadsheets.Values.get(id, a1_(T.sheet, lastRow, 1, maxC, lastRow), { valueRenderOption: 'FORMULA' }) : { values: [] };
      lines.push('=== ' + tk + '  (' + T.sheet + ')  lastRow=' + lastRow);
      (head.values || []).forEach(function(h, i) { lines.push('  header' + (i + 1) + ': ' + JSON.stringify(h)); });
      lines.push('  last   : ' + JSON.stringify((last.values || [[]])[0]));
      lines.push('  formula: ' + JSON.stringify((formulas.values || [[]])[0]));
      lines.push('  mapping: ' + JSON.stringify(T.cols));
    } catch (e) { lines.push('=== ' + tk + ' FAIL: ' + e); }
  });
  var out = lines.join('\n');
  Logger.log(out);
  return out;
}

function diagAttOT() { return diagFinalTargets('ATT_OT'); }
