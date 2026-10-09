// Mobile.js — the phone app's two screens, one light call each (no factory.today / hour.get / per-line calls).
//   m.att  -> Attendance tab: every line/floor with today's + last day's attendance, SRNs loaded on the line,
//             manpower now, today's changes, review status, and what the WhatsApp message needs.
//   m.out  -> Output tab: every stitching line with today's attendance, its SRNs (loading balance),
//             the day's output per SRN, manpower/hours, changes and review status.

function mNowSlot_() {
  var h = new Date(Utilities.formatDate(new Date(), tz_(), 'yyyy/MM/dd HH:mm:ss')).getHours();
  return ('0' + h).slice(-2) + '-' + ('0' + ((h + 1) % 24)).slice(-2);
}
function mEvents_(events, dept) {
  return events.filter(function(e) { return str_(e.dept) === dept; })
    .map(function(e) { return { id: str_(e.id), role: str_(e.role), event: str_(e.event), count: num_(e.count), time: str_(e.time), hours: num_(e.eff_hours) }; });
}
function mSrns_(L, dept) {
  return srnOptions_(L, dept, 'STITCH').map(function(o) { return { srn: o.srn, balance: o.balance, limit: o.limit, used: o.used }; });
}

// Attendance typed straight into the main attendance sheets (MASTER DATA cols A/B/C), recent days only. Cached 30 min.
//   A FAC666 Final [date, location, dept, designation, hours, count] · C FAC117 Final [date, location, dept, designation, hours, count, …]
//   B OT (both) [date, location, line, 'OT', designation, OT hours, count, …]
var PHONE_FROM = '2026-09-29';   // the phone app's output list starts here (user, 30 Sep 2026)
function sheetAttAgg_() {
  return {};   // 2026-10-01: attendance sheets are no longer read — only attendance entered in the app is used (user)
  var hit = cacheGetBig_('sheet_att2');
  if (hit) return hit;
  var out = {}, md = getSS_().getSheetByName(MASTER_SHEET_NAME);
  var from = fmtDate_(new Date(new Date().getTime() - 21 * 86400000));
  if (from > PHONE_FROM) from = PHONE_FROM;
  if (md && md.getLastRow() >= 3) {
    md.getRange(3, 1, md.getLastRow() - 2, 3).getValues().forEach(function(row) {
      [[row[0], 'Final', 2, 3, 4, 5], [row[1], 'OT', 2, 4, 5, 6], [row[2], 'Final', 2, 3, 4, 5]].forEach(function(c) {
        var a = parseJson_(c[0]); if (!a) return;
        var d = dateKey_(a[0]); if (d === '9999-12-31' || d < from) return;
        var dept = str_(a[c[2]]), role = str_(a[c[3]]), hours = num_(a[c[4]]), n = num_(a[c[5]]);
        if (!dept || n <= 0) return;
        var k = d + '|' + dept + '|' + c[1], o = out[k] = out[k] || { factory: str_(a[1]).replace(/\D/g, ''), count: 0, roles: {}, hours: 0, rows: {} };
        o.count += n; o.roles[role] = (o.roles[role] || 0) + n; if (hours > o.hours) o.hours = hours;
        o.rows[role + '|' + hours] = (o.rows[role + '|' + hours] || 0) + n;
      });
    });
  }
  cachePutBig_('sheet_att2', out, 1800);
  return out;
}

// { date, factory } -> the phone Attendance tab: only lines with attendance on that date (app, or typed in the sheet),
// the user's lines for the "line code" picker, manpower now, changes, status, SAM map, WhatsApp data.
function mAtt_(req, user) {
  var date = str_(req.date), factory = str_(req.factory);
  if (!isDateStr_(date)) return fail_('DATE', 'Date galat');
  var depts = writableDepts_(user, factory), st = statusMap_(date, factory), slot = date === todayStr_() ? mNowSlot_() : '17-18';
  var attDay = readDaily_(CFG.TABS.ATT_DAILY).filter(function(r) { return str_(r.date) === date && str_(r.factory) === factory; });
  var events = readDaily_(CFG.TABS.MANPOWER_EVENTS).filter(function(r) { return str_(r.date) === date && str_(r.factory) === factory; });
  var sheet = sheetAttAgg_();
  var wa = { depts: [], att: {}, attRoles: {}, attSrn: {}, eventList: [], mpNow: {} };
  var items = [], pick = [];
  depts.forEach(function(d) {
    var fin = attDay.filter(function(r) { return str_(r.dept) === d.dept && str_(r.shift) === 'Final'; });
    var ot = attDay.filter(function(r) { return str_(r.dept) === d.dept && str_(r.shift) === 'OT'; });
    var night = attDay.filter(function(r) { return str_(r.dept) === d.dept && str_(r.shift) === 'Night'; }).reduce(function(t, r) { return t + num_(r.count); }, 0);
    var shF = sheet[date + '|' + d.dept + '|Final'], shO = sheet[date + '|' + d.dept + '|OT'];
    var roles = {}, count = 0, fromSheet = false, srn = '', sup = '', inc = '', by = '';
    if (fin.length) {
      fin.forEach(function(r) { roles[str_(r.role)] = (roles[str_(r.role)] || 0) + num_(r.count); count += num_(r.count); });
      srn = str_(fin[0].srn); sup = str_(fin[0].supervisor); inc = str_(fin[0].incharge); by = str_(fin[0].entered_by);
    } else if (shF) { roles = shF.roles; count = shF.count; fromSheet = true; }
    var otCount = ot.length ? ot.reduce(function(t, r) { return t + num_(r.count); }, 0) : (shO ? shO.count : 0);
    pick.push({ dept: d.dept, cat: d.cat, filled: count > 0 });
    if (!count) return;
    var ev = mEvents_(events, d.dept), mpNow = fromSheet ? count : mpAtSlot_(attDay, events, d.dept, slot);
    items.push({ dept: d.dept, cat: d.cat, count: count, srn: srn, supervisor: sup, incharge: inc, by: by, fromSheet: fromSheet, inSheet: !!shF, roles: roles,
                 ot: otCount, night: night, status: st[d.dept + '|ATT'] || '', events: ev, mpNow: mpNow });
    wa.depts.push({ dept: d.dept, cat: d.cat });
    wa.att[d.dept + '|Final'] = count; wa.attRoles[d.dept + '|Final'] = roles; if (srn) wa.attSrn[d.dept] = srn;
    ev.forEach(function(e) { wa.eventList.push({ dept: d.dept, role: e.role, event: e.event, count: e.count, time: e.time }); });
    wa.mpNow[d.dept] = mpNow;
  });
  var sam = samMap_();
  // transfers: requests waiting for my lines, each line's transfers of the date, every line of the factory to transfer to
  var tr = mTransfers_(date, factory, user, depts);
  items.forEach(function(x) { x.transfers = tr.byLine[x.dept] || []; });
  var allLines = mastersRows_().filter(function(r) { return str_(r.type) === 'DEPT' && str_(r.factory) === factory && isTrue_(r.active) && CFG.ACTIVE_CATS.indexOf(str_(r.extra)) >= 0; })
    .map(function(r) { return { dept: str_(r.key), cat: str_(r.extra) }; });
  var plan = {}; try { plan = planOfDay_(date, depts.map(function(d) { return d.dept; })); } catch (e) {}   // production plan of the date (learning curve)
  return { ok: true, date: date, items: items, lines: pick, wa: wa, sam: sam, plan: plan, incoming: tr.incoming, allLines: allLines };
}

// Phone Output tab: every line / shift (from PHONE_FROM up to today) that has attendance — in the app or typed in the
// sheet — but no stitching output yet (not in the app, not in the main sheet, not already with the admin; a line the
// admin sent back is listed again). Plus today's lines already filled, for the WhatsApp message.
var M_SLOT = { Final: '17-18', OT: '21-22', Night: '05-06' };
function mOut_(req, user) {
  var factory = str_(req.factory), today = todayStr_();
  var from = fmtDate_(new Date(new Date().getTime() - 14 * 86400000)); if (from < PHONE_FROM) from = PHONE_FROM;
  var depts = writableDepts_(user, factory).filter(function(d) { return d.cat === 'STITCH'; }), mine = {};
  depts.forEach(function(d) { mine[d.dept] = 1; });
  var inRange = function(r) { var d = str_(r.date); return str_(r.factory) === factory && d >= from && d <= today && mine[str_(r.dept)]; };
  var att = readDaily_(CFG.TABS.ATT_DAILY).filter(inRange);
  var events = readDaily_(CFG.TABS.MANPOWER_EVENTS).filter(inRange);
  var hourly = readDaily_(CFG.TABS.HOURLY_LOG).filter(function(r) { return inRange(r) && str_(r.type) === 'STITCH'; });
  var sheet = sheetAttAgg_(), L = ledgerLite_(), sheetDays = {};
  (L.recent || []).forEach(function(x) { sheetDays[x[1] + '|' + x[0] + '|' + x[2]] = 1; });   // output typed in the sheet
  var lineFloor = masterMap_('LINE_FLOOR'), stBy = {}, srnsBy = {};
  var statusOf = function(d, dept) { var m = stBy[d] = stBy[d] || statusMap_(d, factory); return m[dept + '|STITCH'] || ''; };
  var srnsOf = function(dept) { return srnsBy[dept] = srnsBy[dept] || mSrns_(L, dept); };
  // every (date, dept, shift) with attendance
  var keys = {};
  att.forEach(function(r) { if (M_SLOT[str_(r.shift)]) keys[str_(r.date) + '|' + str_(r.dept) + '|' + str_(r.shift)] = 'app'; });
  Object.keys(sheet).forEach(function(k) { var p = k.split('|'); if (p[0] >= from && p[0] <= today && mine[p[1]] && !keys[k] && sheet[k].factory === factory) keys[k] = 'sheet'; });
  var groups = {}, done = [], waiting = [], rejRemark = {}, reasonOf = {};
  readDaily_(CFG.TABS.DAY_SUMMARY).forEach(function(r) {
    if (str_(r.type) !== 'STITCH') return;
    if (str_(r.status) === 'Rejected') rejRemark[str_(r.date) + '|' + str_(r.dept)] = str_(r.remark);
    var rs = str_(parseJsonObj_(r.payload).reason); if (rs) reasonOf[str_(r.date) + '|' + str_(r.dept) + '|' + (str_(r.shift) || 'Final')] = rs;
  });
  Object.keys(keys).sort().forEach(function(k) {
    var p = k.split('|'), d = p[0], dept = p[1], sh = p[2], src = keys[k];
    var outRows = hourly.filter(function(r) { return str_(r.date) === d && str_(r.dept) === dept && (str_(r.shift) || 'Final') === sh; });
    var status = statusOf(d, dept);
    var by = {}; outRows.forEach(function(r) { var e = by[str_(r.srn)] = by[str_(r.srn)] || { srn: str_(r.srn), total: 0, other: 0 }; e.total += num_(r.qty); if (str_(r.slot) !== M_SLOT[sh]) e.other += num_(r.qty); });
    var entries = Object.keys(by).map(function(x) { return by[x]; });
    var rows = att.filter(function(r) { return str_(r.date) === d && str_(r.dept) === dept && str_(r.shift) === sh; });
    var dayEv = events.filter(function(e) { return str_(e.date) === d; });
    var base, mp, hours, attSrn = '';
    if (src === 'app') {
      base = rows.reduce(function(t, r) { return t + num_(r.count); }, 0);
      hours = attHours_(rows.map(function(r) { return { role: str_(r.role), hours: num_(r.hours), count: num_(r.count) }; }), sh);
      if (sh === 'Final') { var close = lineClose_(dayEv, dept); if (close) hours = Math.min(hours, close.eff); }
      mp = sh === 'Final' ? mpAtSlot_(rows, dayEv, dept, M_SLOT.Final) : base;
      attSrn = str_(rows[0].srn);
    } else { base = sheet[k].count; mp = base; hours = sheet[k].hours || (sh === 'OT' ? 2 : 8); }
    var line = { reason: reasonOf[d + '|' + dept + '|' + sh] || '', date: d, dept: dept, shift: sh, slot: M_SLOT[sh], fromSheet: src === 'sheet', mp: mp, mpBase: base, hours: hours, attSrn: attSrn,
                 floor: (src === 'app' && attFloor_(rows, dept)) || (lineFloor[dept] ? lineFloor[dept].value : ''), events: sh === 'Final' ? mEvents_(dayEv, dept) : [], entries: entries, status: status };
    var hasOut = outRows.length > 0 || sheetDays[dept + '|' + d + '|' + sh];
    if (d === today && outRows.length) done.push(line);
    // saved in the app and with the admin: listed as waiting until approved / rejected (a rejected one is pending again)
    if (outRows.length && (status === 'Submitted' || status === 'Approved')) { if (status === 'Submitted') line.srns = srnsOf(dept); waiting.push(line); return; }
    if (status === 'Rejected') line.remark = rejRemark[d + '|' + dept] || '';
    if (hasOut && status !== 'Rejected') return;
    if (isLocked_(status)) return;
    line.srns = srnsOf(dept);
    (groups[d] = groups[d] || []).push(line);
  });
  waiting.sort(function(a, b) { return (b.date + a.dept).localeCompare(a.date + b.dept); });
  return { ok: true, today: today, groups: Object.keys(groups).sort().reverse().map(function(d) { return { date: d, lines: groups[d] }; }), done: done, waiting: waiting };
}

// ---------- phone: everything the three screens need in ONE call (Attendance of the date · Output · PMS) ----------
// The phone keeps the reply, switches tabs without loading, and calls this again every 5 min / after a save.
function mAll_(req, user) {
  var factory = str_(req.factory), date = str_(req.date) || todayStr_();
  // same user + factory + date and nothing changed since (data version): the reply made last time, at once
  var rk = 'mall:' + [str_(user.user_id), factory, date, dataVer_()].join('|');
  var hit = cacheGetBig_(rk); if (hit) { hit.cached = true; return hit; }
  var res = mAllBuild_(factory, date, user);
  if (res.att && res.att.ok !== false && res.out && res.out.ok !== false && res.pms && res.pms.ok !== false) cachePutBig_(rk, res, 300);
  return res;
}
function mAllBuild_(factory, date, user) {
  var safe = function(fn) { try { return fn(); } catch (e) { return { ok: false, message: String(e && e.message || e) }; } };
  LEDGER_MEMO_ON_ = true;
  try {
    return { ok: true, date: date, factory: factory, at: nowStr_(),
             att: safe(function() { return mAtt_({ date: date, factory: factory }, user); }),
             out: safe(function() { return mOut_({ factory: factory }, user); }),
             pms: safe(function() { return mPms_({ factory: factory }, user); }),
             rev: isAdmin_(user) ? safe(function() { return mReview_({ factory: factory }, user); }) : null };
  } finally { LEDGER_MEMO_ON_ = false; LEDGER_MEMO_ = null; LITE_MEMO_ = null; }
}

// ---------- phone: quiet background refresh of the sheet data (called after a screen is shown) ----------
// { all } -> all: rebuild everything now ("Fresh data" button); otherwise only what is past its refresh time.
function mWarm_(req, user) {
  var c = CacheService.getScriptCache();
  if (!req.all && c.get('warm_running')) return { ok: true, busy: true };
  c.put('warm_running', '1', 90);
  var t = Date.now();
  try {
    // all: everything counts as old (others keep getting the old copy until the new one is built) + the small caches go
    if (req.all) { Object.keys(SWR_KEYS_).forEach(function(k) { c.put(k + '#t', '0', 21600); }); ['app_agg', 'hist_agg', 'hist_qc', 'defects_master', 'users_rows'].forEach(cacheDelBig_); Object.keys(CFG.TABS).forEach(function(k) { invalidateDaily_(CFG.TABS[k]); }); }
    SWR_REFRESH_ = true;
    [mastersRows_, loadingAgg_, summaryAgg_, bulletinSam_, planAgg_].forEach(function(fn) { fn(); });
    try { syncLines_(); } catch (e) {}   // new line codes from loading / plan -> SETTINGS   // the phone reads only these (loading: new challans show within minutes)
  } finally { SWR_REFRESH_ = false; c.remove('warm_running'); }
  // data sent to the main sheets: bring it into MASTER DATA and clean the app copies (was a trigger)
  var imp = ''; try { imp = runDueImport_(); } catch (e) { imp = 'import error ' + e; }
  return { ok: true, ms: Date.now() - t, imported: !!imp };
}

// ---------- phone PMS tab: every unshipped order with the numbers the recorder needs to fill data right ----------
// Orders  = MASTER DATA col I ('All Orders' A..AA): [2] SRN · [3] Buyer · [6] Shipping Qty · [12] Style · [19] Shipped Status · [23] Shipped Qty
// Unload  = loading spreadsheet 'Unloading_chalaan': E SRN · K qty in challan · P status (reject) · R qty approved
function ordersAgg_() {
  var hit = cacheGetBig_('orders_agg');
  if (hit) return hit;
  var out = {}, md = getSS_().getSheetByName(MASTER_SHEET_NAME);
  if (md && md.getLastRow() >= 3) {
    md.getRange(3, 9, md.getLastRow() - 2, 1).getValues().forEach(function(row) {
      var a = parseJson_(row[0]); if (!a) return;
      var srn = str_(a[2]).toUpperCase(); if (!/^SRN/.test(srn)) return;
      var o = out[srn] = out[srn] || { buyer: '', style: '', shipping: 0, shipped: 0, status: '' };
      o.style = str_(a[12]) || o.style;
      o.shipping += num_(a[6]); o.shipped += num_(a[23]);
      if (str_(a[19])) o.status = str_(a[19]);
    });
  }
  cachePutBig_('orders_agg', out, 1800);
  return out;
}
function unloadingAgg_() {
  var hit = cacheGetBig_('unload_agg');
  if (hit) return hit;
  var out = {};
  try {
    var res = Sheets.Spreadsheets.Values.get(srcId_('LOADING'), "'Unloading_chalaan'!E2:R", { valueRenderOption: 'UNFORMATTED_VALUE' });
    (res.values || []).forEach(function(r) {
      var srn = str_(r[0]).toUpperCase(); if (!/^SRN/.test(srn)) return;
      if (/reject|cancel/i.test(str_(r[11]))) return;                    // P: Status(if Reject)
      var q = num_(r[13]) || num_(r[6]);                                   // R: approved qty, else K: qty in challan
      if (q) out[srn] = (out[srn] || 0) + q;
    });
  } catch (e) { out.__error = String(e && e.message || e); }
  cachePutBig_('unload_agg', out, 1800);
  return out;
}

// { factory } -> unshipped SRNs (SRN0500 onwards) with loading, stitching, endline pass, packed, unloading, shipped — all from
// APP SUMMARY (+ the app's output not in the sheet yet); contractor loading shown apart (they report no stitching / endline)
function mPms_(req, user) {
  var L = ledgerLite_(), catOf = {}, contr = {}, contrBy = {};
  mastersRows_().forEach(function(r) { if (str_(r.type) === 'DEPT' && str_(r.extra)) catOf[str_(r.key).toUpperCase()] = str_(r.extra); });
  Object.keys(L.loaded).forEach(function(k) {
    var i = k.lastIndexOf('|'), party = k.slice(0, i), srn = k.slice(i + 1).toUpperCase();
    if ((catOf[party.toUpperCase()] || deptCategory_(party)) !== 'CONTRACTOR') return;
    addTo_(contr, srn, L.loaded[k]); (contrBy[srn] = contrBy[srn] || {})[party] = 1;
  });
  var fac = str_(req.factory).replace(/^FAC/i, ''), rows = [];
  Object.keys(L.pms).forEach(function(srn) {
    var m = srn.match(/^SRN0*(\d+)/); if (!m || +m[1] < 500) return;    // only SRN0500 onwards
    var p = L.pms[srn], info = L.srnInfo[srn] || {};
    if (/^shipped$/i.test(str_(p.status))) return;                       // shipped orders are not shown
    if (fac && info.factory && info.factory !== fac) return;               // only this factory's SRNs
    var r = { srn: srn, style: info.item || '', buyer: info.buyer || '', order: p.order, status: p.status,
              loading: num_(L.loadedSrn[srn]), contractor: num_(contr[srn]), contractors: Object.keys(contrBy[srn] || {}).join(', '),
              stitched: num_(p.stitched), endPass: num_(L.endPassSrn[srn]), packed: num_(L.packed[srn]), unloaded: num_(p.unloaded), shipped: num_(p.shipped) };
    if (r.loading || r.stitched || r.endPass || r.packed) rows.push(r);
  });
  rows.sort(function(a, b) { return b.srn.localeCompare(a.srn); });
  return { ok: true, rows: rows, unloadError: '' };
}

// A line's Final attendance of a date as the app has it: { roles: {role: count}, add: [ATT_DAILY rows], evs: [events], none }.
// When only the main sheet has it, the rows to copy into the app are returned in add / evs (same people and hours;
// shorter-hours sheet rows as half day, 0-hour rows as absent) — the caller appends them inside its lock.
function appAttOrCopy_(date, factory, dept, by, stamp) {
  var app = readDaily_(CFG.TABS.ATT_DAILY).filter(function(r) { return str_(r.date) === date && str_(r.factory) === factory && str_(r.dept) === dept && str_(r.shift) === 'Final'; });
  var roles = {}, add = [], evs = [];
  if (app.length) { app.forEach(function(r) { roles[str_(r.role)] = (roles[str_(r.role)] || 0) + num_(r.count); }); return { roles: roles, add: add, evs: evs }; }
  var sa = sheetAttAgg_()[date + '|' + dept + '|Final'];
  if (!sa || !sa.rows) return { roles: roles, add: add, evs: evs, none: true };
  var byRole = {};
  Object.keys(sa.rows).forEach(function(k) { var p = k.split('|'), o = byRole[p[0]] = byRole[p[0]] || { count: 0, hours: 0, parts: [] }; o.count += sa.rows[k]; o.hours = Math.max(o.hours, num_(p[1])); o.parts.push({ h: num_(p[1]), n: sa.rows[k] }); });
  var prev = readDaily_(CFG.TABS.ATT_DAILY).filter(function(r) { return str_(r.factory) === factory && str_(r.dept) === dept && str_(r.shift) === 'Final' && str_(r.date) < date; })
    .sort(function(a, b) { return str_(b.date).localeCompare(str_(a.date)); })[0];
  var staff = lineStaffOf_(dept);
  Object.keys(byRole).forEach(function(r) {
    var o = byRole[r]; roles[r] = o.count;
    add.push({ id: uuid_(), date: date, factory: factory, dept: dept, shift: 'Final', role: r, hours: o.hours || shiftHours_('Final'), count: o.count,
               entered_by: by, entered_at: stamp, srn: prev ? str_(prev.srn) : '', supervisor: (prev && str_(prev.supervisor)) || staff.supervisor,
               incharge: (prev && str_(prev.incharge)) || staff.incharge, qc_names: '', keep_status: '1' });
    o.parts.forEach(function(p) {
      if (p.h < o.hours) evs.push({ id: uuid_(), date: date, factory: factory, dept: dept, role: r, event: p.h > 0 ? 'HALF_DAY' : 'ABSENT', count: p.n, time: '',
                                    eff_hours: p.h, note: 'sheet', entered_by: by, entered_at: stamp });
    });
  });
  return { roles: roles, add: add, evs: evs };
}

// ---------- phone "Update attendance": half day / absent for one manpower type of a line ----------
// { date, factory, dept, role, halfDay, hours, absent }
// Attendance typed in the main sheet is first copied into the app (same people and hours; shorter-hours sheet rows kept as
// half day, 0-hour rows as absent), then the change is added. A line whose attendance is in the main sheet then goes to
// the admin (ATT Submitted): approve + Send replaces that line/date's rows in the main sheet (replaceSheet).
function mAttUpd_(req, user) {
  var date = str_(req.date), factory = str_(req.factory), dept = str_(req.dept), role = str_(req.role);
  var hd = num_(req.halfDay), ab = num_(req.absent), hrs = num_(req.hours);
  if (!isDateStr_(date)) return fail_('DATE', 'Date galat');
  if (!dept || !role) return fail_('KEY', 'Line aur manpower type chahiye');
  if (!canWrite_(user, factory, dept)) return fail_('PERM', 'Is line ki permission nahi');
  if (hd < 0 || ab < 0 || Math.floor(hd) !== hd || Math.floor(ab) !== ab || !(hd + ab)) return fail_('VAL', 'Half day / absent me kitne log — poora number');
  if (hd && !(hrs > 0 && hrs < 12)) return fail_('VAL', 'Half day ke working hour chuno');
  var sa = sheetAttAgg_()[date + '|' + dept + '|Final'], stamp = nowStr_(), by = userName_(user);
  var ev = function(r, event, count, hours, note) {
    return { id: uuid_(), date: date, factory: factory, dept: dept, role: r, event: event, count: count, time: '',
             eff_hours: hours, note: note, entered_by: by, entered_at: stamp };
  };
  var res = withLock_(function() {
    var base = appAttOrCopy_(date, factory, dept, by, stamp);
    if (base.none) return fail_('NF', 'Is din is line ki attendance nahi mili');
    var roles = base.roles, add = base.add, evs = base.evs;
    if (!roles[role]) return fail_('VAL', role + ' is line me nahi hai');
    if (hd + ab > roles[role]) return fail_('VAL', role + ' sirf ' + roles[role] + ' hain (half day + absent ' + (hd + ab) + ')');
    if (hd) evs.push(ev(role, 'HALF_DAY', hd, hrs, 'phone'));
    if (ab) evs.push(ev(role, 'ABSENT', ab, effHours_('ABSENT', ''), 'phone'));
    if (add.length) appendRows_(CFG.TABS.ATT_DAILY, add);
    appendRows_(CFG.TABS.MANPOWER_EVENTS, evs);
    return { ok: true, copied: add.length, events: evs.length };
  });
  if (!res.ok) return res;
  audit_(user, 'm.attUpd', date + '|' + factory + '|' + dept, { role: role, halfDay: hd, hours: hrs, absent: ab, copied: res.copied });
  // straight into the main attendance sheet, HR status kept
  var s = attSync_(date, factory, dept, 'Final', user, true);
  return { ok: true, copied: res.copied, inSheet: !!s.ok, sheetError: s.ok ? '' : s.message };
}

// { date, factory, dept, shift } -> write that line's attendance to the main sheet again (Resend after the sheet failed)
function mAttSync_(req, user) {
  var date = str_(req.date), factory = str_(req.factory), dept = str_(req.dept), shift = str_(req.shift) || 'Final';
  if (!isDateStr_(date) || !dept) return fail_('VAL', 'Wrong date / line');
  if (!canWrite_(user, factory, dept)) return fail_('PERM', 'No permission for this line');
  var s = attSync_(date, factory, dept, shift, user, true);
  return s.ok ? { ok: true, rows: s.rows } : fail_('SHEET', s.message);
}

// ---------- phone "Transfer manpower": people of one line go to another line from a whole hour ----------
// The day shift is 9 AM–6 PM with lunch 1–2 PM (8 working hours). Hours are whole hours only (9, 10, 11 …):
// transfer at 11  ->  2 hours on the old line, 6 hours on the new line (shown as separate rows like a half day).
var TR_LUNCH = 13;
function trHoursBefore_(hour) { var h = hour - 9 - (hour > TR_LUNCH ? 1 : 0); return Math.max(0, Math.min(shiftHours_('Final'), h)); }
function trTime_(hour) { return ('0' + hour).slice(-2) + ':00'; }
function trHourOf_(time) { var m = str_(time).match(/^(\d{1,2})/); return m ? +m[1] : 9; }

// { date, factory, from_dept, to_dept, hour, items: [{role, count}] } -> request for the recorder of to_dept (Pending)
function mTrCreate_(req, user) {
  var date = str_(req.date), factory = str_(req.factory), from = str_(req.from_dept), to = str_(req.to_dept), hour = num_(req.hour);
  var items = (Array.isArray(req.items) ? req.items : []).map(function(x) { return { role: str_(x.role), count: num_(x.count) }; }).filter(function(x) { return x.role && x.count > 0; });
  if (!isDateStr_(date)) return fail_('DATE', 'Wrong date');
  if (!from || !to) return fail_('VAL', 'Select the line to transfer to');
  if (from === to) return fail_('VAL', 'Select a different line');
  if (!(hour >= 9 && hour <= 17) || Math.floor(hour) !== hour) return fail_('VAL', 'Select the transfer time (hour)');
  if (!items.length) return fail_('VAL', 'Enter how many people of at least one manpower type');
  if (items.some(function(x) { return Math.floor(x.count) !== x.count; })) return fail_('VAL', 'How many — enter a whole number');
  if (!canWrite_(user, factory, from)) return fail_('PERM', 'No permission for this line');
  var known = mastersRows_().some(function(r) { return str_(r.type) === 'DEPT' && str_(r.key) === to && str_(r.factory) === factory && isTrue_(r.active); });
  if (!known) return fail_('VAL', 'Line not found: ' + to);
  var stamp = nowStr_(), by = userName_(user), id = uuid_(), time = trTime_(hour), before = trHoursBefore_(hour);
  var res = withLock_(function() {
    var base = appAttOrCopy_(date, factory, from, by, stamp);
    if (base.none) return fail_('NF', 'No attendance on this line for this date');
    // people of each type still on the line (absent / left / already transferred out are not available)
    var left = {}; Object.keys(base.roles).forEach(function(r) { left[r] = base.roles[r]; });
    readDaily_(CFG.TABS.MANPOWER_EVENTS).concat(base.evs).forEach(function(e) {
      if (str_(e.date) !== date || str_(e.factory) !== factory || str_(e.dept) !== from) return;
      if (['ABSENT', 'LEFT_AT', 'TRANSFER_OUT'].indexOf(str_(e.event)) >= 0 && left[str_(e.role)] !== undefined) left[str_(e.role)] -= num_(e.count);
    });
    for (var i = 0; i < items.length; i++) {
      var have = Math.max(0, left[items[i].role] || 0);
      if (items[i].count > have) return fail_('VAL', 'Only ' + have + ' ' + items[i].role + ' available on this line');
    }
    if (base.add.length) appendRows_(CFG.TABS.ATT_DAILY, base.add);
    var total = items.reduce(function(t, x) { return t + x.count; }, 0);
    appendRows_(CFG.TABS.TRANSFERS, [{ id: id, date: date, factory: factory, from_dept: from, to_dept: to, role: items.length === 1 ? items[0].role : '', count: total, time: time, srn: '',
      status: 'Pending', note: 'phone', by: by, at: stamp, decided_by: '', decided_at: '', to_user: '', items: JSON.stringify(items), allocations: '' }]);
    appendRows_(CFG.TABS.MANPOWER_EVENTS, base.evs.concat(items.map(function(x) {
      return { id: uuid_(), date: date, factory: factory, dept: from, role: x.role, event: 'TRANSFER_OUT', count: x.count, time: time,
               eff_hours: before, note: 'transfer:' + id + ' → ' + to, entered_by: by, entered_at: stamp };
    })));
    return { ok: true, total: total };
  });
  if (!res.ok) return res;
  audit_(user, 'transfer.create', id, { from: from, to: to, hour: hour, items: items });
  var s = attSync_(date, factory, from, 'Final', user, true);
  return { ok: true, id: id, total: res.total, sheetError: s.ok ? '' : s.message };
}

// { id, decision: 'accept' | 'reject' } by the recorder of the receiving line. Accept: the people join that line from the
// transfer hour (the rest of the shift). Reject: they stay on the old line all day.
function mTrDecide_(req, user) {
  var id = str_(req.id), action = str_(req.decision);
  if (action !== 'accept' && action !== 'reject') return fail_('VAL', 'Accept or reject');
  var t = readDaily_(CFG.TABS.TRANSFERS).filter(function(r) { return str_(r.id) === id; })[0];
  if (!t || !str_(t.to_dept)) return fail_('NF', 'Transfer not found');
  if (str_(t.status) !== 'Pending') return fail_('VAL', 'This transfer is already ' + str_(t.status));
  var date = str_(t.date), factory = str_(t.factory), from = str_(t.from_dept), to = str_(t.to_dept);
  if (!canWrite_(user, factory, to) && !isManager_(user)) return fail_('PERM', 'This transfer is not for your line');
  var items = parseJsonArr_(t.items), stamp = nowStr_(), by = userName_(user), hour = trHourOf_(t.time);
  var after = shiftHours_('Final') - trHoursBefore_(hour);
  withLock_(function() {
    if (action === 'accept') {
      var base = appAttOrCopy_(date, factory, to, by, stamp);   // receiving line's attendance typed in the sheet comes into the app first
      if (base.add.length) appendRows_(CFG.TABS.ATT_DAILY, base.add);
      appendRows_(CFG.TABS.MANPOWER_EVENTS, base.evs.concat(items.map(function(x) {
        return { id: uuid_(), date: date, factory: factory, dept: to, role: str_(x.role), event: 'TRANSFER_IN', count: num_(x.count), time: str_(t.time),
                 eff_hours: after, note: 'transfer:' + id + ' ← ' + from, entered_by: by, entered_at: stamp };
      })));
    } else {
      var ev = readDaily_(CFG.TABS.MANPOWER_EVENTS).filter(function(r) { return str_(r.event) === 'TRANSFER_OUT' && str_(r.note).indexOf('transfer:' + id) === 0; });
      deleteRows_(CFG.TABS.MANPOWER_EVENTS, ev.map(function(r) { return r._row; }));
    }
    var sh = tab_(CFG.TABS.TRANSFERS, true), head = physHeadOf_(CFG.TABS.TRANSFERS);
    sh.getRange(t._row, head.indexOf('status') + 1).setValue(action === 'accept' ? 'Accepted' : 'Rejected');
    sh.getRange(t._row, head.indexOf('decided_by') + 1).setValue(by);
    sh.getRange(t._row, head.indexOf('decided_at') + 1).setValue(stamp);
  });
  invalidateDaily_(CFG.TABS.TRANSFERS);
  audit_(user, 'transfer.' + action, id, { to: to });
  var s = attSync_(date, factory, action === 'accept' ? to : from, 'Final', user, true);
  return { ok: true, sheetError: s.ok ? '' : s.message };
}

// transfers for the phone Attendance tab: requests waiting for my lines (any recent day) and my lines' transfers of the date
function mTransfers_(date, factory, user, depts) {
  var mine = {}; depts.forEach(function(d) { mine[d.dept] = 1; });
  var since = fmtDate_(new Date(new Date().getTime() - 7 * 86400000)), incoming = [], out = {};
  readDaily_(CFG.TABS.TRANSFERS).forEach(function(r) {
    if (str_(r.factory) !== factory || !str_(r.to_dept)) return;
    var x = { id: str_(r.id), date: str_(r.date), from: str_(r.from_dept), to: str_(r.to_dept), time: str_(r.time), hour: trHourOf_(r.time),
              items: parseJsonArr_(r.items), total: num_(r.count), status: str_(r.status), by: str_(r.by) };
    if (x.status === 'Pending' && mine[x.to] && x.date >= since) incoming.push(x);
    if (x.date === date && mine[x.from]) (out[x.from] = out[x.from] || []).push(x);
    if (x.date === date && mine[x.to] && x.status === 'Accepted') (out[x.to] = out[x.to] || []).push(x);
  });
  return { incoming: incoming, byLine: out };
}

// ---------- phone: output approval (admin) and output of a date ----------
function mOutQty_(type, p) { return type === 'ENDLINE' ? num_(p.pass) : num_(p.output !== undefined ? p.output : p.qty); }

// Output waiting for the admin: Submitted rows (not attendance) of the factory, last 30 days
function mReview_(req, user) {
  if (!isAdmin_(user)) return { ok: true, items: [] };
  var factory = str_(req.factory), since = fmtDate_(new Date(new Date().getTime() - 30 * 86400000));
  var L = null, srnsBy = {};
  var items = readDaily_(CFG.TABS.DAY_SUMMARY).filter(function(r) {
    return str_(r.status) === 'Submitted' && str_(r.type) !== 'ATT' && (!factory || str_(r.factory) === factory) && str_(r.date) >= since;
  }).map(function(r) {
    var p = parseJsonObj_(r.payload), t = str_(r.type);
    return { id: str_(r.id), date: str_(r.date), dept: str_(r.dept), type: t, srn: str_(r.srn), shift: str_(r.shift), qty: mOutQty_(t, p),
             manpower: num_(p.manpower), hours: num_(p.hours), plan: p.plan === undefined ? '' : p.plan, reason: str_(p.reason), by: str_(r.submitted_by), at: str_(r.submitted_at),
             noFloor: !p.floor, floor: str_(p.floor).replace(/^.*Stitching\s+/, ''),
             edit: t === 'STITCH' ? { output: num_(p.output), hours: num_(p.hours), roles: { Operator: p.operators !== undefined ? num_(p.operators) : num_(p.manpower), Helper: num_(p.r1), Paster: num_(p.r2), 'Thread cutter': num_(p.r3), 'End Line Checker': num_(p.r4), 'Hand needle': num_(p.r5) },
                                     srns: (function() { try { if (!L) L = ledgerLite_(); return srnsBy[str_(r.dept)] = srnsBy[str_(r.dept)] || mSrns_(L, str_(r.dept)).map(function(s) { return s.srn; }); } catch (e) { return []; } })() } : null,
             flags: parseJsonArr_(r.flags).filter(function(f) { return f.level === 'block' || f.level === 'warn'; }).map(function(f) { return { level: f.level, msg: enMsg_(f.msg) }; }) };
  });
  items.sort(function(a, b) { return (b.date + a.dept).localeCompare(a.date + b.dept); });
  return { ok: true, items: items };
}

// { ids, decision: 'approve' | 'reject', remark } (admin). Approve = approved and written to the main sheet at once.
function mReviewDecide_(req, user) {
  if (!isAdmin_(user)) return fail_('PERM', 'Admin only');
  var ids = Array.isArray(req.ids) ? req.ids.map(str_).filter(String) : [], decision = str_(req.decision), remark = str_(req.remark);
  if (!ids.length) return fail_('IDS', 'Select something');
  if (decision === 'reject') { if (!remark) return fail_('REMARK', 'Enter the reject reason'); return reviewDecide_({ ids: ids, decision: 'reject', remark: remark }, user); }
  if (decision !== 'approve') return fail_('VAL', 'Approve or reject?');
  // optional reason (output below plan), per row: { id: reason } -> goes to the sheet's Reason column
  var reasons = req.reasons && typeof req.reasons === 'object' ? req.reasons : {};
  if (Object.keys(reasons).length) withLock_(function() {
    readTab_(CFG.TABS.DAY_SUMMARY).forEach(function(r) {
      var why = str_(reasons[str_(r.id)]); if (!why || ids.indexOf(str_(r.id)) < 0) return;
      var p = parseJsonObj_(r.payload); p.reason = why; setField_(CFG.TABS.DAY_SUMMARY, r._row, 'payload', JSON.stringify(p));
    });
    invalidateDaily_(CFG.TABS.DAY_SUMMARY);
  });
  var d = reviewDecide_({ ids: ids, decision: 'approve', remark: remark, override: !!remark }, user);
  if (!d.ok) return d;
  var ok = readTab_(CFG.TABS.DAY_SUMMARY).filter(function(r) { return ids.indexOf(str_(r.id)) >= 0 && str_(r.status) === 'Approved'; }).map(function(r) { return str_(r.id); });
  var s = ok.length ? reviewSend_({ ids: ok }, user) : { ok: true, sent: 0 };
  return { ok: true, approved: d.done, sent: s.sent || 0, skipped: (d.skipped || []).concat(s.skipped || []), sendError: s.ok ? '' : s.message };
}

// { date, factory } -> who entered how much output that date (every line of the factory)
function mOutDay_(req, user) {
  var date = str_(req.date), factory = str_(req.factory);
  if (!isDateStr_(date)) return fail_('DATE', 'Wrong date');
  var rows = [], seen = {};
  readTab_(CFG.TABS.DAY_SUMMARY).forEach(function(r) {
    if (str_(r.date) !== date || str_(r.factory) !== factory || str_(r.type) === 'ATT' || str_(r.status) === 'Draft') return;
    var p = parseJsonObj_(r.payload), t = str_(r.type);
    seen[[str_(r.dept), t, str_(r.srn), str_(r.shift)].join('|')] = 1;
    rows.push({ dept: str_(r.dept), type: t, srn: str_(r.srn), shift: str_(r.shift), qty: mOutQty_(t, p), by: str_(r.submitted_by), status: str_(r.status), remark: str_(r.remark) });
  });
  var loose = {};   // entered in the app but not submitted yet
  readDaily_(CFG.TABS.HOURLY_LOG).forEach(function(r) {
    if (str_(r.date) !== date || str_(r.factory) !== factory) return;
    var t = str_(r.type), k = [str_(r.dept), t, str_(r.srn), str_(r.shift) || 'Final'].join('|');
    if (seen[k]) return;
    var o = loose[k] = loose[k] || { dept: str_(r.dept), type: t, srn: str_(r.srn), shift: str_(r.shift) || 'Final', qty: 0, by: str_(r.entered_by), status: 'Not submitted', remark: '' };
    o.qty += t === 'ENDLINE' ? num_(r.pass) : num_(r.qty);
  });
  Object.keys(loose).forEach(function(k) { rows.push(loose[k]); });
  // lines with attendance that date (app) but no output anywhere (app / main sheet): still pending
  var done = {}, sheetDays = {};
  rows.forEach(function(r) { done[r.dept + '|' + r.shift] = 1; });
  try { (ledgerLite_().recent || []).forEach(function(x) { if (x[0] === date) sheetDays[x[1] + '|' + x[2]] = 1; }); } catch (e) {}
  var attBy = {};
  readDaily_(CFG.TABS.ATT_DAILY).forEach(function(r) {
    if (str_(r.date) !== date || str_(r.factory) !== factory || !M_SLOT[str_(r.shift)]) return;
    var k = str_(r.dept) + '|' + str_(r.shift); if (!attBy[k]) attBy[k] = { dept: str_(r.dept), shift: str_(r.shift), srn: str_(r.srn), by: str_(r.entered_by) };
  });
  var cat = {}; mastersRows_().forEach(function(r) { if (str_(r.type) === 'DEPT') cat[str_(r.key)] = str_(r.extra); });
  Object.keys(attBy).forEach(function(k) {
    if (done[k] || sheetDays[k] || cat[attBy[k].dept] !== 'STITCH') return;
    var a = attBy[k]; rows.push({ dept: a.dept, type: 'STITCH', srn: a.srn, shift: a.shift, qty: null, by: a.by, status: 'Pending', remark: '' });
  });
  rows.sort(function(a, b) { return a.by.localeCompare(b.by) || a.dept.localeCompare(b.dept); });
  return { ok: true, date: date, rows: rows };
}

// { date, factory, dept, shift } -> the recorder edits output still waiting for approval: that shift's Submitted rows go
// back to Draft (the following hour.save + day.submit sends the new numbers). Approved / Sent rows cannot be edited.
function mOutReopen_(req, user) {
  var date = str_(req.date), factory = str_(req.factory), dept = str_(req.dept), shift = str_(req.shift) || 'Final';
  if (!isDateStr_(date) || !dept) return fail_('VAL', 'Wrong date / line');
  if (!canWrite_(user, factory, dept)) return fail_('PERM', 'No permission for this line');
  var n = 0, blocked = '';
  withLock_(function() {
    readTab_(CFG.TABS.DAY_SUMMARY).forEach(function(r) {
      if (str_(r.date) !== date || str_(r.factory) !== factory || str_(r.dept) !== dept || str_(r.type) !== 'STITCH' || (str_(r.shift) || 'Final') !== shift) return;
      var st = str_(r.status);
      if (st === 'Approved' || st === 'Sent') { blocked = st; return; }
      if (st === 'Submitted') { setField_(CFG.TABS.DAY_SUMMARY, r._row, 'status', 'Draft'); n++; }
    });
    invalidateDaily_(CFG.TABS.DAY_SUMMARY);
  });
  if (blocked) return fail_('LOCKED', 'Already approved — it cannot be edited now');
  audit_(user, 'm.outReopen', date + '|' + factory + '|' + dept + '|' + shift, { rows: n });
  return { ok: true, reopened: n };
}

// { id } (admin) -> "Making Output Report" of that line + SRN: every day's output from the main stitching sheet, the
// output waiting in the app, manpower per role, plan / variance / reason, and the loading challans. Read on demand only.
function mReviewReport_(req, user) {
  if (!isAdmin_(user)) return fail_('PERM', 'Admin only');
  var id = str_(req.id), it = readTab_(CFG.TABS.DAY_SUMMARY).filter(function(r) { return str_(r.id) === id; })[0];
  if (!it) return fail_('NF', 'Not found');
  var factory = str_(it.factory), dept = str_(it.dept), srn = str_(it.srn).toUpperCase();
  var T = CFG.FINAL_TARGETS[factory === '117' ? 'STITCH_117' : 'STITCH_666'], col = {};
  Object.keys(T.cols).forEach(function(c) { col[T.cols[c]] = +c - 1; });
  var rows = [], head = { factory: 'FAC' + factory, srn: srn, line: dept, incharge: '', supervisor: '', junior: '' };
  // 1) the main stitching sheet (only this line + SRN)
  var v = Sheets.Spreadsheets.Values.get(srcId_(T.srcKey), "'" + T.sheet + "'!A" + T.minRow + ':AB', { valueRenderOption: 'UNFORMATTED_VALUE', dateTimeRenderOption: 'FORMATTED_STRING' }).values || [];
  v.forEach(function(r) {
    if (str_(r[col.dept]) !== dept || str_(r[col.srn]).toUpperCase() !== srn) return;
    var g = function(f) { return col[f] === undefined ? '' : r[col[f]]; };
    rows.push({ date: dateKey_(g('date')), shift: /OT/i.test(str_(g('shift'))) ? 'OT' : 'Final', plan: g('plan') === '' ? '' : num_(g('plan')), actual: num_(g('output')),
                remark: [str_(g('remark')), str_(g('reason'))].filter(String).join(' · '), op: num_(g('manpower')),
                r1: num_(g('r1')), r2: num_(g('r2')), r3: num_(g('r3')), r4: num_(g('r4')), r5: num_(g('r5')), hours: num_(g('hours')), src: 'sheet' });
    head.incharge = str_(g('master')) || head.incharge; head.supervisor = str_(g('supervisor')) || head.supervisor;
    if (factory !== '117' && str_(r[27])) head.junior = str_(r[27]);
  });
  // 2) output in the app not in the sheet yet (waiting / approved)
  readTab_(CFG.TABS.DAY_SUMMARY).forEach(function(r) {
    if (str_(r.dept) !== dept || str_(r.srn).toUpperCase() !== srn || str_(r.type) !== 'STITCH') return;
    var st = str_(r.status); if (st !== 'Submitted' && st !== 'Approved' && str_(r.id) !== id) return;
    var p = parseJsonObj_(r.payload);
    rows.push({ id: str_(r.id), date: str_(r.date), shift: str_(r.shift) || 'Final', plan: p.plan === undefined ? '' : p.plan, actual: num_(p.output), remark: str_(p.reason),
                op: p.operators !== undefined ? num_(p.operators) : num_(p.manpower), r1: num_(p.r1), r2: num_(p.r2), r3: num_(p.r3), r4: num_(p.r4), r5: num_(p.r5),
                hours: num_(p.hours), src: 'app', status: st, by: str_(r.submitted_by) });
    head.incharge = head.incharge || str_(p.incharge); head.supervisor = head.supervisor || str_(p.supervisor);
  });
  // 3) loading challans of this SRN on this line
  var ld = [];
  try {
    (Sheets.Spreadsheets.Values.get(srcId_(LOADING_JOB.srcKey), a1_(LOADING_JOB.srcSheet, LOADING_JOB.srcRow, LOADING_JOB.srcCol, LOADING_JOB.cols),
      { valueRenderOption: 'UNFORMATTED_VALUE', dateTimeRenderOption: 'FORMATTED_STRING' }).values || []).forEach(function(r) {
      if (str_(r[5]).toUpperCase() !== srn || str_(r[10]) !== dept || !num_(r[7])) return;
      ld.push({ date: dateKey_(r[1]), challan: str_(r[2]), qty: num_(r[7]) });
    });
  } catch (e) {}
  // one row per date + shift; a loading day without output gets its own row
  var byKey = {};
  rows.forEach(function(x) {
    var k = x.date + '|' + (x.shift === 'OT' ? 2 : 1), y = byKey[k];
    if (!y) { byKey[k] = x; return; }
    if (x.src === 'app' || y.src === 'app') { if (x.src === 'app' && y.src !== 'app') byKey[k] = x; return; }   // waiting output replaces nothing already in the sheet
    // several sheet rows of one day (half day / absent split rows): add them up, longest hours
    ['plan', 'actual', 'op', 'r1', 'r2', 'r3', 'r4', 'r5'].forEach(function(f) { if (x[f] !== '' && x[f] !== undefined) y[f] = (y[f] === '' ? 0 : num_(y[f])) + num_(x[f]); });
    y.hours = Math.max(num_(y.hours), num_(x.hours)); if (x.remark) y.remark = [y.remark, x.remark].filter(String).join(' · ');
  });
  ld.forEach(function(l) {
    var k = l.date + '|1', x = byKey[k] || byKey[l.date + '|2'];
    if (!x) x = byKey[k] = { date: l.date, shift: '', plan: '', actual: 0, remark: '', op: '', r1: '', r2: '', r3: '', r4: '', r5: '', hours: '', src: 'loading' };
    x.challan = (x.challan ? x.challan + ', ' : '') + l.challan; x.load = num_(x.load) + l.qty;
  });
  var list = Object.keys(byKey).sort().map(function(k) { return byKey[k]; }), cum = 0, loadCum = 0;
  list.forEach(function(x) {
    cum += num_(x.actual); x.total = cum; loadCum += num_(x.load); x.loadTotal = loadCum;
    x.variance = x.plan === '' || x.plan === null ? '' : num_(x.plan) - num_(x.actual);
  });
  // one page = 15 rows: older rows fold into a "carry forward" first row
  var PAGE = 15, carry = null;
  if (list.length > PAGE) {
    var old = list.slice(0, list.length - (PAGE - 1)), last = old[old.length - 1];
    carry = { plan: old.reduce(function(t, x) { return t + num_(x.plan); }, 0), actual: old.reduce(function(t, x) { return t + num_(x.actual); }, 0), total: last.total,
              load: old.reduce(function(t, x) { return t + num_(x.load); }, 0), loadTotal: last.loadTotal, days: old.length };
    carry.variance = carry.plan - carry.actual;
    list = list.slice(list.length - (PAGE - 1));
  }
  return { ok: true, head: head, carry: carry, rows: list, id: id };
}

// { date, factory, dept, shift, slot, srn, qty (the shift's total), other (already in other slots), floor, allowOver }
// Phone output save in ONE call (sent from the phone's background outbox with a rid): output still waiting for
// approval is reopened, the pieces are saved, and the line's day goes to the admin (Submitted).
function mOutSave_(req, user) {
  var date = str_(req.date), factory = str_(req.factory), dept = str_(req.dept), shift = str_(req.shift) || 'Final';
  var re = mOutReopen_({ date: date, factory: factory, dept: dept, shift: shift }, user);
  if (!re.ok) return re;
  var h = hourSave_({ lite: true, date: date, factory: factory, slot: str_(req.slot),
                      items: [{ type: 'STITCH', dept: dept, srn: str_(req.srn), qty: num_(req.qty) - num_(req.other), floor: str_(req.floor), allowOver: !!req.allowOver, keepZero: true }] }, user);
  if (!h.ok) return h;
  var f = (h.results || []).filter(function(r) { return !r.ok; })[0];
  if (f) return fail_(f.error || 'VAL', f.message);
  var s = daySubmit_({ lite: true, date: date, factory: factory, dept: dept }, user);
  if (!s.ok) return s;
  // optional reason (why output is below plan) -> the review row -> the main sheet's Reason column (O) on approval
  var why = str_(req.reason).slice(0, 300);
  withLock_(function() {
    readTab_(CFG.TABS.DAY_SUMMARY).forEach(function(r) {
      if (str_(r.date) !== date || str_(r.factory) !== factory || str_(r.dept) !== dept || str_(r.type) !== 'STITCH' || (str_(r.shift) || 'Final') !== shift) return;
      if (str_(r.status) !== 'Submitted') return;
      var p = parseJsonObj_(r.payload); if (str_(p.reason) === why) return;
      p.reason = why; setField_(CFG.TABS.DAY_SUMMARY, r._row, 'payload', JSON.stringify(p));
    });
    invalidateDaily_(CFG.TABS.DAY_SUMMARY);
  });
  return { ok: true, submitted: s.submitted, alerts: (s.blocks || []).length };
}

// { dept, floor: 'Ground' | 'First' | 'Second' } (admin) -> the line's floor (SETTINGS LINE_FLOOR, value "FAC666-Stitching Ground"),
// also put on that line's output rows still waiting (Draft / Submitted) so the sheet row gets it on approval
function mSetFloor_(req, user) {
  if (!isAdmin_(user)) return fail_('PERM', 'Admin only');
  var dept = str_(req.dept), floor = str_(req.floor);
  if (!dept || CFG.FLOORS.indexOf(floor) < 0) return fail_('VAL', 'Select the floor');
  var fac = ''; mastersRows_().forEach(function(r) { if (str_(r.type) === 'DEPT' && str_(r.key) === dept) fac = str_(r.factory); });
  var value = 'FAC' + (fac || '666') + '-Stitching ' + floor, n = 0;
  withLock_(function() {
    var hit = readTab_(CFG.TABS.MASTERS).filter(function(r) { return str_(r.type) === 'LINE_FLOOR' && str_(r.key) === dept; })[0];
    if (hit) { setField_(CFG.TABS.MASTERS, hit._row, 'value', value); setField_(CFG.TABS.MASTERS, hit._row, 'active', 'TRUE'); }
    else appendRows_(CFG.TABS.MASTERS, [{ type: 'LINE_FLOOR', key: dept, value: value, factory: fac, extra: '', active: 'TRUE' }]);
    readTab_(CFG.TABS.DAY_SUMMARY).forEach(function(r) {
      if (str_(r.dept) !== dept || str_(r.type) !== 'STITCH' || ['Draft', 'Submitted', 'Rejected'].indexOf(str_(r.status)) < 0) return;
      var p = parseJsonObj_(r.payload); if (p.floor) return;
      p.floor = value; setField_(CFG.TABS.DAY_SUMMARY, r._row, 'payload', JSON.stringify(p));
      setField_(CFG.TABS.DAY_SUMMARY, r._row, 'flags', JSON.stringify(parseJsonArr_(r.flags).filter(function(f) { return !/Floor nahi mila/.test(str_(f.msg)); }))); n++;
    });
    invalidateDaily_(CFG.TABS.DAY_SUMMARY);
  });
  invalidateMasters_();
  audit_(user, 'm.setFloor', dept, { floor: value, rows: n });
  return { ok: true, floor: value, rows: n };
}

// Admin edits an output entry waiting for approval and (optionally) approves it in the same go.
// { id, srn, floor, output, hours, roles: {Operator, Helper, Paster, 'Thread cutter', 'End Line Checker', 'Hand needle'}, reason, approve }
// The review row's payload is rewritten (one manpower group), the app's output rows of that line / SRN / shift are set to
// the new pieces, the floor is kept as the line's floor, and the plan is recomputed for the new people and hours.
function mReviewEdit_(req, user) {
  if (!isAdmin_(user)) return fail_('PERM', 'Admin only');
  var id = str_(req.id), r = readTab_(CFG.TABS.DAY_SUMMARY).filter(function(x) { return str_(x.id) === id; })[0];
  if (!r) return fail_('NF', 'Not found');
  if (str_(r.type) !== 'STITCH') return fail_('VAL', 'Only stitching output can be edited here');
  if (['Submitted', 'Draft', 'Rejected'].indexOf(str_(r.status)) < 0) return fail_('LOCKED', 'Already ' + str_(r.status));
  var p = parseJsonObj_(r.payload), date = str_(r.date), factory = str_(r.factory), dept = str_(r.dept), shift = str_(r.shift) || 'Final';
  var srn = str_(req.srn).toUpperCase() || str_(p.srn), output = num_(req.output), hours = num_(req.hours) || num_(p.hours), floorName = str_(req.floor);
  if (!/^SRN/.test(srn)) return fail_('VAL', 'Select the SRN');
  if (output < 0 || Math.floor(output) !== output) return fail_('VAL', 'Pieces — whole number');
  if (!(hours > 0 && hours <= 14)) return fail_('VAL', 'Working hours 1–14');
  var roles = req.roles && typeof req.roles === 'object' ? req.roles : {}, counts = {}, total = 0;
  Object.keys(roles).forEach(function(k) { var n = num_(roles[k]); if (n < 0 || Math.floor(n) !== n) return; counts[str_(k)] = n; total += n; });
  if (!total) return fail_('VAL', 'Enter the manpower');
  var floor = floorName ? (/^FAC/i.test(floorName) ? floorName : 'FAC' + factory + '-Stitching ' + floorName) : str_(p.floor);
  // payload: one manpower group, role columns, plan for the new people / hours
  var prod = 0; Object.keys(counts).forEach(function(k) { if (CFG.TARGET_ROLES.indexOf(k) >= 0) prod += counts[k]; });
  var planP = null; try { planP = planOf_(date, dept, srn); } catch (e) {}
  var samP = samOf_(srn);
  var plan = planP ? Math.round(planP.rate * prod * hours) : (samP && samP.sam > 0 && prod > 0 ? Math.round(prod * hours * 60 / samP.sam) : (p.plan === undefined ? '' : p.plan));
  var g = { hours: hours, manpower: total, operators: counts.Operator || 0, remark: '' };
  CFG.STITCH_ROLE_COLS.forEach(function(role, i) { g['r' + (i + 1)] = counts[role] || 0; p['r' + (i + 1)] = counts[role] || 0; });
  Object.assign(p, { srn: srn, floor: floor, output: output, hours: hours, manpower: total, operators: counts.Operator || 0, plan: plan, splits: [g], reason: str_(req.reason).slice(0, 300), editedBy: userName_(user) });
  var flags = parseJsonArr_(r.flags).filter(function(f) { return !/Floor nahi mila|zyada|more than loading|loading nahi mili/i.test(str_(f.msg)); });
  withLock_(function() {
    setField_(CFG.TABS.DAY_SUMMARY, r._row, 'payload', JSON.stringify(p));
    setField_(CFG.TABS.DAY_SUMMARY, r._row, 'flags', JSON.stringify(flags));
    setField_(CFG.TABS.DAY_SUMMARY, r._row, 'srn', srn);
    // the app's own output rows of that line / shift: one row with the new pieces (so PMS and reports match until the import)
    var old = readTab_(CFG.TABS.HOURLY_LOG).filter(function(h) { return str_(h.date) === date && str_(h.factory) === factory && str_(h.dept) === dept && str_(h.type) === 'STITCH' && (str_(h.shift) || 'Final') === shift; });
    deleteRows_(CFG.TABS.HOURLY_LOG, old.map(function(h) { return h._row; }));
    appendRows_(CFG.TABS.HOURLY_LOG, [{ id: uuid_(), date: date, factory: factory, line: lineOf_(dept), dept: dept, srn: srn, floor: floor, type: 'STITCH', shift: shift, slot: M_SLOT[shift] || '17-18',
      qty: output, checked: 0, pass: 0, reject: 0, cartons: 0, pcs_per_ctn: 0, checker: '', entered_by: (old[0] && str_(old[0].entered_by)) || userName_(user), entered_at: nowStr_(), defects: '' }]);
    invalidateDaily_(CFG.TABS.DAY_SUMMARY); invalidateDaily_(CFG.TABS.HOURLY_LOG);
  });
  invalidateAppAgg_();
  if (floor) try { lineFloorSet_(dept, factory, floor); } catch (e) {}
  // the same manpower / SRN / floor go into that day's attendance (app + HR sheet, HR status kept): the output row and the
  // attendance must never disagree
  var attChanged = 0, attErr = '';
  try {
    var attShift = shift === 'Final' ? 'Final' : shift;
    withLock_(function() {
      var rows = readTab_(CFG.TABS.ATT_DAILY).filter(function(a) { return str_(a.date) === date && str_(a.factory) === factory && str_(a.dept) === dept && str_(a.shift) === attShift; });
      var byRole = {}; rows.forEach(function(a) { byRole[str_(a.role)] = a; });
      var baseHours = rows.length ? Math.max.apply(null, rows.map(function(a) { return num_(a.hours); })) : hours;
      var ref = rows[0] || {}, add = [], del = [];
      Object.keys(counts).forEach(function(role) {
        var a = byRole[role], n = counts[role];
        if (a) { if (num_(a.count) !== n) { if (n > 0) setField_(CFG.TABS.ATT_DAILY, a._row, 'count', n); else del.push(a._row); attChanged++; } }
        else if (n > 0) { add.push({ id: uuid_(), date: date, factory: factory, dept: dept, shift: attShift, role: role, hours: baseHours, count: n, entered_by: userName_(user), entered_at: nowStr_(),
                                     srn: srn, supervisor: str_(ref.supervisor), incharge: str_(ref.incharge), qc_names: '', keep_status: '1', floor: floor }); attChanged++; }
      });
      rows.forEach(function(a) { if (str_(a.srn) !== srn) { setField_(CFG.TABS.ATT_DAILY, a._row, 'srn', srn); attChanged++; } if (floor && str_(a.floor) !== floor) { setField_(CFG.TABS.ATT_DAILY, a._row, 'floor', floor); attChanged++; } });
      if (del.length) deleteRows_(CFG.TABS.ATT_DAILY, del);
      if (add.length) appendRows_(CFG.TABS.ATT_DAILY, add);
      invalidateDaily_(CFG.TABS.ATT_DAILY);
    });
    if (attChanged) { var sy = attSync_(date, factory, dept, attShift, user, true); if (!sy.ok) attErr = sy.message; }
  } catch (e) { attErr = String(e && e.message || e); }
  audit_(user, 'm.reviewEdit', id, { srn: srn, output: output, hours: hours, manpower: total, floor: floor, attChanged: attChanged, attErr: attErr });
  if (!req.approve) return { ok: true, edited: true, attChanged: attChanged, attError: attErr };
  var hasBlock = flags.some(function(f) { return f.level === 'block'; });
  var dec = mReviewDecide_({ ids: [id], decision: 'approve', remark: hasBlock ? ('Approved after edit by ' + userName_(user)) : '' }, user);
  if (dec && dec.ok) { dec.attChanged = attChanged; dec.attError = attErr; }
  return dec;
}
