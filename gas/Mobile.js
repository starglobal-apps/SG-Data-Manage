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

// The data recorder(s) a line's attendance of a date belongs to: names on its rows of that shift (entered_by), leaving out
// admins / managers (they fill or fix for others). Phone (user, 2026-10-12): any recorder may fill any line, and a filled
// line is shown only to the recorder named on its attendance; a line filled only by an admin / manager is shown to the
// users who have it in their lines (blank lines = all); admins / managers see every line.
var BOSS_NAMES_ = null;
function attOwners_(attRows, date, dept, shift) {
  if (!BOSS_NAMES_) { BOSS_NAMES_ = {}; usersRows_().forEach(function(u) { if (str_(u.role) === 'Admin' || str_(u.role) === 'Manager') { BOSS_NAMES_[str_(u.name).toLowerCase()] = 1; BOSS_NAMES_[str_(u.user_id).toLowerCase()] = 1; } }); }
  var names = {};
  attRows.forEach(function(r) {
    if (str_(r.date) !== date || str_(r.dept) !== dept || (str_(r.shift) || 'Final') !== (shift || 'Final')) return;
    var n = str_(r.entered_by); if (n && !BOSS_NAMES_[n.toLowerCase()]) names[n] = 1;
  });
  return Object.keys(names);
}
function attIsMine_(user, owners) {
  if (isManager_(user) || !owners.length) return true;
  var me = userName_(user).toLowerCase(), id = str_(user.user_id).toLowerCase();
  return owners.some(function(n) { n = n.toLowerCase(); return n === me || n === id; });
}
function lineVisible_(user, owners, dept) {
  if (isManager_(user)) return true;
  if (owners.length) return attIsMine_(user, owners);
  var mineLines = Array.isArray(user.depts) ? user.depts : csv_(user.depts);
  return !mineLines.length || mineLines.indexOf(dept) >= 0;
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
    var owners = count ? attOwners_(fin, date, d.dept, 'Final') : [], mineLine = lineVisible_(user, owners, d.dept);
    pick.push({ dept: d.dept, cat: d.cat, filled: count > 0, by: count && !mineLine ? owners.join(', ') : '' });
    if (!count || !mineLine) return;   // filled by another recorder: not on this recorder's list
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
  // per shift: a submitted shift output must not hide the OT output of the same line (and the other way round)
  var statusOf = function(d, dept, sh) { var m = stBy[d] = stBy[d] || statusMapShift_(d, factory); return m[dept + '|STITCH|' + (sh || 'Final')] || ''; };
  var srnsOf = function(dept) { return srnsBy[dept] = srnsBy[dept] || mSrns_(L, dept); };
  // every (date, dept, shift) with attendance
  var keys = {};
  att.forEach(function(r) { if (M_SLOT[str_(r.shift)]) keys[str_(r.date) + '|' + str_(r.dept) + '|' + str_(r.shift)] = 'app'; });
  Object.keys(sheet).forEach(function(k) { var p = k.split('|'); if (p[0] >= from && p[0] <= today && mine[p[1]] && !keys[k] && sheet[k].factory === factory) keys[k] = 'sheet'; });
  var groups = {}, done = [], waiting = [], rejRemark = {}, reasonOf = {};
  readDaily_(CFG.TABS.DAY_SUMMARY).forEach(function(r) {
    if (str_(r.type) !== 'STITCH') return;
    if (str_(r.status) === 'Rejected') rejRemark[str_(r.date) + '|' + str_(r.dept) + '|' + (str_(r.shift) || 'Final')] = str_(r.remark);
    var rs = str_(parseJsonObj_(r.payload).reason); if (rs) reasonOf[str_(r.date) + '|' + str_(r.dept) + '|' + (str_(r.shift) || 'Final')] = rs;
  });
  Object.keys(keys).sort().forEach(function(k) {
    var p = k.split('|'), d = p[0], dept = p[1], sh = p[2], src = keys[k];
    if (!lineVisible_(user, attOwners_(att, d, dept, sh), dept)) return;   // another recorder's line
    var outRows = hourly.filter(function(r) { return str_(r.date) === d && str_(r.dept) === dept && (str_(r.shift) || 'Final') === sh; });
    var status = statusOf(d, dept, sh);
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
    if (status === 'Rejected') line.remark = rejRemark[d + '|' + dept + '|' + sh] || '';
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
  var rk = 'mall:' + [str_(user.user_id), factory, date, dataVer_(), str_(req.b)].join('|');
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
  var resent = 0; try { resent = resendApproved_(); } catch (e) {}   // approved output that did not reach the main sheet yet
  return { ok: true, ms: Date.now() - t, imported: !!imp || resent > 0, resent: resent };
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
  // one copy for everybody (same list on every phone), rebuilt when data changes
  var fac = str_(req.factory).replace(/^FAC/i, ''), key = 'mpms2:' + fac + ':' + dataVer_();
  var hit = cacheGetBig_(key); if (hit) return hit;
  var all = pmsRows_(fac);
  var res = { ok: true, rows: all.filter(function(r) { return !r.isShipped; }), names: all.map(function(r) { return r.srn; }), unloadError: '' };
  cachePutBig_(key, res, 300);
  return res;
}
// SRN-wise PMS numbers of the factory (SRN0500 onwards), shipped ones included (isShipped). Newest SRN first.
function pmsRows_(fac) {
  var L = ledgerLite_(), catOf = {}, contr = {}, contrBy = {};
  mastersRows_().forEach(function(r) { if (str_(r.type) === 'DEPT' && str_(r.extra)) catOf[str_(r.key).toUpperCase()] = str_(r.extra); });
  Object.keys(L.loaded).forEach(function(k) {
    var i = k.lastIndexOf('|'), party = k.slice(0, i), srn = k.slice(i + 1).toUpperCase();
    if ((catOf[party.toUpperCase()] || deptCategory_(party)) !== 'CONTRACTOR') return;
    addTo_(contr, srn, L.loaded[k]); (contrBy[srn] = contrBy[srn] || {})[party] = 1;
  });
  var rows = [];
  Object.keys(L.pms).forEach(function(srn) {
    var m = srn.match(/^SRN0*(\d+)/); if (!m || +m[1] < 500) return;    // only SRN0500 onwards
    var p = L.pms[srn], info = L.srnInfo[srn] || {};
    if (fac && info.factory && String(info.factory).replace(/\D/g, '') !== fac) return;   // only this factory's SRNs
    rows.push({ srn: srn, style: info.item || '', buyer: info.buyer || '', order: p.order, status: p.status, isShipped: /^shipped$/i.test(str_(p.status)),
                loading: num_(L.loadedSrn[srn]), contractor: num_(contr[srn]), contractors: Object.keys(contrBy[srn] || {}).join(', '),
                stitched: num_(p.stitched), endPass: num_(L.endPassSrn[srn]), packed: num_(L.packed[srn]), unloaded: num_(p.unloaded), shipped: num_(p.shipped) });
  });
  rows.sort(function(a, b) { return b.srn.localeCompare(a.srn); });
  return rows;
}
// PMS search: { factory, q } -> SRNs whose name contains q, shipped ones too (up to 40)
function mPmsFind_(req, user) {
  var fac = str_(req.factory).replace(/^FAC/i, ''), q = str_(req.q).toUpperCase().replace(/\s+/g, '');
  if (q.length < 2) return { ok: true, rows: [] };
  return { ok: true, rows: pmsRows_(fac).filter(function(r) { return r.srn.indexOf(q) >= 0 || (r.style + ' ' + r.buyer).toUpperCase().indexOf(q) >= 0; }).slice(0, 40) };
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
    var evAll = readDaily_(CFG.TABS.MANPOWER_EVENTS).concat(base.evs), withEvents = {};
    evAll.forEach(function(e) {
      if (str_(e.event) === 'TRANSFER_OUT') { var m = /^transfer:([^ ]+)/.exec(str_(e.note)); if (m) withEvents[m[1]] = 1; }
      if (str_(e.date) !== date || str_(e.factory) !== factory || str_(e.dept) !== from) return;
      if (['ABSENT', 'LEFT_AT', 'TRANSFER_OUT'].indexOf(str_(e.event)) >= 0 && left[str_(e.role)] !== undefined) left[str_(e.role)] -= num_(e.count);
    });
    // people already asked for in a request still waiting are not available again
    readDaily_(CFG.TABS.TRANSFERS).forEach(function(t) {
      if (str_(t.status) !== 'Pending' || str_(t.date) !== date || str_(t.factory) !== factory || str_(t.from_dept) !== from || withEvents[str_(t.id)]) return;
      parseJsonArr_(t.items).forEach(function(i) { if (left[str_(i.role)] !== undefined) left[str_(i.role)] -= num_(i.count); });
    });
    for (var i = 0; i < items.length; i++) {
      var have = Math.max(0, left[items[i].role] || 0);
      if (items[i].count > have) return fail_('VAL', 'Only ' + have + ' ' + items[i].role + ' available on this line' + (have < (base.roles[items[i].role] || 0) ? ' (others are absent, gone or in a transfer)' : ''));
    }
    if (base.add.length) appendRows_(CFG.TABS.ATT_DAILY, base.add);
    var total = items.reduce(function(t, x) { return t + x.count; }, 0);
    appendRows_(CFG.TABS.TRANSFERS, [{ id: id, date: date, factory: factory, from_dept: from, to_dept: to, role: items.length === 1 ? items[0].role : '', count: total, time: time, srn: '',
      status: 'Pending', note: 'phone', by: by, at: stamp, decided_by: '', decided_at: '', to_user: '', items: JSON.stringify(items), allocations: '' }]);
    // nothing changes on the line or the main sheet until the request is accepted (user, 2026-10-13)
    if (base.evs.length) appendRows_(CFG.TABS.MANPOWER_EVENTS, base.evs);
    return { ok: true, total: total };
  });
  if (!res.ok) return res;
  audit_(user, 'transfer.create', id, { from: from, to: to, hour: hour, items: items });
  return { ok: true, id: id, total: res.total, sheetError: '' };
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
  var toOwners = attOwners_(readDaily_(CFG.TABS.ATT_DAILY), date, to, 'Final');
  if (!lineVisible_(user, toOwners, to)) return fail_('PERM', 'Only ' + toOwners.join(', ') + ' (recorder of ' + to.replace(/^FAC\d+-/, '') + ') can accept this transfer');
  var items = parseJsonArr_(t.items), stamp = nowStr_(), by = userName_(user), hour = trHourOf_(t.time);
  var after = shiftHours_('Final') - trHoursBefore_(hour);
  // accept: the people may be split over this line and other lines (allocations [{ dept, role, count }]); none = all to this line
  var allocs = items.map(function(x) { return { dept: to, role: str_(x.role), count: num_(x.count) }; });
  var before = trHoursBefore_(hour);
  if (action === 'accept' && Array.isArray(req.allocations)) {
    allocs = req.allocations.map(function(a) { return { dept: str_(a.dept), role: str_(a.role), count: num_(a.count) }; }).filter(function(a) { return a.count > 0; });
    var need = {}, got = {};
    items.forEach(function(x) { need[str_(x.role)] = (need[str_(x.role)] || 0) + num_(x.count); });
    for (var i = 0; i < allocs.length; i++) {
      var a = allocs[i];
      if (!a.dept || !a.role || Math.floor(a.count) !== a.count) return fail_('VAL', 'Select the line and a whole number for every row');
      if (need[a.role] === undefined) return fail_('VAL', a.role + ' was not in this transfer');
      if (a.dept === from) return fail_('VAL', 'They come from ' + from.replace(/^FAC\d+-/, '') + ' — to keep them there, reject the transfer');
      var known = mastersRows_().some(function(r) { return str_(r.type) === 'DEPT' && str_(r.key) === a.dept && str_(r.factory) === factory && isTrue_(r.active); });
      if (!known) return fail_('VAL', 'Line not found: ' + a.dept);
      if (!canWrite_(user, factory, a.dept)) return fail_('PERM', 'No permission for ' + a.dept);
      got[a.role] = (got[a.role] || 0) + a.count;
    }
    // fewer may be accepted (e.g. 8 of 10: the sender typed too many); the rest is simply not transferred
    var over = Object.keys(got).filter(function(r) { return got[r] > need[r]; })[0];
    if (over) return fail_('VAL', over + ': ' + need[over] + ' came, ' + got[over] + ' placed — not more than came');
    if (!allocs.length) return fail_('VAL', 'Nobody accepted — to take nobody, reject the transfer');
  }
  var acc = {}; allocs.forEach(function(a) { acc[a.role] = (acc[a.role] || 0) + a.count; });   // accepted per type
  var allocDepts = []; allocs.forEach(function(a) { if (allocDepts.indexOf(a.dept) < 0) allocDepts.push(a.dept); });
  // a request made before 2026-10-13 already took the people off the sending line (TRANSFER_OUT rows): replaced below
  var oldOut = readDaily_(CFG.TABS.MANPOWER_EVENTS).filter(function(r) { return str_(r.event) === 'TRANSFER_OUT' && str_(r.note).indexOf('transfer:' + id) === 0; });
  withLock_(function() {
    if (action === 'accept') {
      var add = [], evs = [];
      [from].concat(allocDepts).forEach(function(d) {   // a line's attendance typed in the sheet comes into the app first
        var base = appAttOrCopy_(date, factory, d, by, stamp); add = add.concat(base.add); evs = evs.concat(base.evs);
      });
      if (add.length) appendRows_(CFG.TABS.ATT_DAILY, add);
      appendRows_(CFG.TABS.MANPOWER_EVENTS, evs.concat(Object.keys(acc).map(function(r) {   // out of the sending line: only those accepted
        return { id: uuid_(), date: date, factory: factory, dept: from, role: r, event: 'TRANSFER_OUT', count: acc[r], time: str_(t.time),
                 eff_hours: before, note: 'transfer:' + id + ' → ' + to, entered_by: by, entered_at: stamp };
      })).concat(allocs.map(function(a) {
        return { id: uuid_(), date: date, factory: factory, dept: a.dept, role: a.role, event: 'TRANSFER_IN', count: a.count, time: str_(t.time),
                 eff_hours: after, note: 'transfer:' + id + ' ← ' + from, entered_by: by, entered_at: stamp };
      })));
    }
    // the transfer row first; deleting event rows (same sheet) shifts rows, so that comes last
    var sh = tab_(CFG.TABS.TRANSFERS, true), head = physHeadOf_(CFG.TABS.TRANSFERS);
    sh.getRange(t._row, head.indexOf('status') + 1).setValue(action === 'accept' ? 'Accepted' : 'Rejected');
    if (action === 'accept') sh.getRange(t._row, head.indexOf('allocations') + 1).setValue(JSON.stringify(allocs));
    sh.getRange(t._row, head.indexOf('decided_by') + 1).setValue(by);
    sh.getRange(t._row, head.indexOf('decided_at') + 1).setValue(stamp);
    if (oldOut.length) deleteRows_(CFG.TABS.MANPOWER_EVENTS, oldOut.map(function(r) { return r._row; }));
  });
  invalidateDaily_(CFG.TABS.TRANSFERS); invalidateDaily_(CFG.TABS.MANPOWER_EVENTS);
  var cameN = items.reduce(function(a, x) { return a + num_(x.count); }, 0), accN = allocs.reduce(function(a, x) { return a + x.count; }, 0);
  audit_(user, 'transfer.' + action, id, { to: to, came: cameN, accepted: action === 'accept' ? accN : 0, allocations: action === 'accept' ? allocs : undefined });
  // main sheets: both sides on accept; on reject only an old-style request had changed the sending line
  var errs = [], sync = action === 'accept' ? [from].concat(allocDepts) : (oldOut.length ? [from] : []);
  sync.forEach(function(d) { var s = attSync_(date, factory, d, 'Final', user, true); if (!s.ok) errs.push(s.message); });
  return { ok: true, came: cameN, accepted: action === 'accept' ? accN : 0, allocations: action === 'accept' ? allocs : [], sheetError: errs.join(' · ') };
}

// transfers for the phone Attendance tab: requests waiting for my lines (any recent day) and my lines' transfers of the date
function mTransfers_(date, factory, user, depts) {
  var mine = {}; depts.forEach(function(d) { mine[d.dept] = 1; });
  var since = fmtDate_(new Date(new Date().getTime() - 7 * 86400000)), incoming = [], out = {};
  var att = readDaily_(CFG.TABS.ATT_DAILY).filter(function(r) { return str_(r.factory) === factory && str_(r.date) >= since; });
  readDaily_(CFG.TABS.TRANSFERS).forEach(function(r) {
    if (str_(r.factory) !== factory || !str_(r.to_dept)) return;
    var x = { id: str_(r.id), date: str_(r.date), from: str_(r.from_dept), to: str_(r.to_dept), time: str_(r.time), hour: trHourOf_(r.time),
              items: parseJsonArr_(r.items), total: num_(r.count), status: str_(r.status), by: str_(r.by) };
    if (x.status === 'Pending' && mine[x.to] && x.date >= since && lineVisible_(user, attOwners_(att, x.date, x.to, 'Final'), x.to)) incoming.push(x);   // the receiving line's recorder decides
    if (x.date === date && mine[x.from]) {
      var acc0 = x.status === 'Accepted' ? parseJsonArr_(r.allocations) : [];
      if (acc0.length) {   // accepted (maybe fewer than asked): the sending line shows those that went
        var per = {}; acc0.forEach(function(a) { per[str_(a.role)] = (per[str_(a.role)] || 0) + num_(a.count); });
        var its = Object.keys(per).map(function(k) { return { role: k, count: per[k] }; });
        (out[x.from] = out[x.from] || []).push(Object.assign({}, x, { items: its, total: its.reduce(function(a, i) { return a + i.count; }, 0), asked: x.total }));
      } else (out[x.from] = out[x.from] || []).push(x);
    }
    if (x.date === date && x.status === 'Accepted') {
      var al = parseJsonArr_(r.allocations), byDept = {};
      if (!al.length) al = x.items.map(function(i) { return { dept: x.to, role: i.role, count: i.count }; });
      al.forEach(function(a) { var d = str_(a.dept); (byDept[d] = byDept[d] || []).push({ role: str_(a.role), count: num_(a.count) }); });
      Object.keys(byDept).forEach(function(d) {
        if (!mine[d]) return;
        (out[d] = out[d] || []).push(Object.assign({}, x, { to: d, items: byDept[d], total: byDept[d].reduce(function(t2, i) { return t2 + i.count; }, 0) }));
      });
    }
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
  var rep = outputReport_(str_(it.factory), str_(it.srn), str_(it.dept), id);
  var one = rep.byLine[str_(it.dept)] || { head: rep.headOf(str_(it.dept)), carry: null, rows: [] };
  return { ok: true, head: one.head, carry: one.carry, rows: one.rows, id: id };
}

// Phone Report tab: { factory, srn, dept? } -> the SRN's lines (output, loading) and the day-wise Making Output Report of
// one line (the asked one, else the only / busiest one). Read-only, every user.
function mSrnReport_(req, user) {
  var factory = str_(req.factory), srn = str_(req.srn).toUpperCase(), dept = str_(req.dept);
  if (!/^SRN/i.test(srn)) return fail_('VAL', 'Select an SRN');
  var rep = outputReport_(factory, srn, '', '');
  var lines = Object.keys(rep.byLine).map(function(d) {
    var r = rep.byLine[d], last = r.rows.length ? r.rows[r.rows.length - 1] : {};
    return { dept: d, output: num_(last.total), load: num_(last.loadTotal), days: r.rows.filter(function(x) { return x.src !== 'loading'; }).length + (r.carry ? r.carry.days : 0), last: str_(last.date) };
  }).sort(function(a, b) { return b.output - a.output || b.load - a.load; });
  var pick = dept && rep.byLine[dept] ? dept : (lines[0] ? lines[0].dept : '');
  var one = pick ? rep.byLine[pick] : null;
  var info = null; try { info = (ledgerLite_().srnInfo || {})[srn] || null; } catch (e) {}
  return { ok: true, srn: srn, factory: factory, lines: lines, dept: pick, head: one ? one.head : null, carry: one ? one.carry : null, rows: one ? one.rows : [], info: info };
}

// The day-wise Making Output Report of an SRN, per line: the main stitching sheet + output in the app not in the sheet yet
// (waiting / approved; curId = the review row being looked at) + loading challans. One row per date + shift, cumulative
// totals, 15 rows a page (older days fold into a carry-forward row). onlyDept = '' -> every line of the SRN.
function outputReport_(factory, srn, onlyDept, curId) {
  srn = str_(srn).toUpperCase();
  var T = CFG.FINAL_TARGETS[factory === '117' ? 'STITCH_117' : 'STITCH_666'], col = {};
  Object.keys(T.cols).forEach(function(c) { col[T.cols[c]] = +c - 1; });
  var heads = {}, rowsBy = {};
  var headOf = function(d) { return heads[d] = heads[d] || { factory: 'FAC' + factory, srn: srn, line: d, incharge: '', supervisor: '', junior: '' }; };
  var push = function(d, x) { (rowsBy[d] = rowsBy[d] || []).push(x); };
  var want = function(d) { return d && (!onlyDept || d === onlyDept); };
  // 1) the main stitching sheet
  var v = Sheets.Spreadsheets.Values.get(srcId_(T.srcKey), "'" + T.sheet + "'!A" + T.minRow + ':AB', { valueRenderOption: 'UNFORMATTED_VALUE', dateTimeRenderOption: 'FORMATTED_STRING' }).values || [];
  v.forEach(function(r) {
    var d = str_(r[col.dept]);
    if (!want(d) || str_(r[col.srn]).toUpperCase() !== srn) return;
    var g = function(f) { return col[f] === undefined ? '' : r[col[f]]; }, h = headOf(d);
    push(d, { date: dateKey_(g('date')), shift: /OT/i.test(str_(g('shift'))) ? 'OT' : 'Final', plan: g('plan') === '' ? '' : num_(g('plan')), actual: num_(g('output')),
              remark: [str_(g('remark')), str_(g('reason'))].filter(String).join(' · '), op: num_(g('manpower')),
              r1: num_(g('r1')), r2: num_(g('r2')), r3: num_(g('r3')), r4: num_(g('r4')), r5: num_(g('r5')), hours: num_(g('hours')), src: 'sheet' });
    h.incharge = str_(g('master')) || h.incharge; h.supervisor = str_(g('supervisor')) || h.supervisor;
    if (factory !== '117' && str_(r[27])) h.junior = str_(r[27]);
  });
  // 2) output in the app not in the sheet yet (waiting / approved)
  readTab_(CFG.TABS.DAY_SUMMARY).forEach(function(r) {
    var d = str_(r.dept);
    if (!want(d) || str_(r.srn).toUpperCase() !== srn || str_(r.type) !== 'STITCH' || (factory && str_(r.factory) !== factory)) return;
    var st = str_(r.status); if (st !== 'Submitted' && st !== 'Approved' && str_(r.id) !== curId) return;
    var p = parseJsonObj_(r.payload), h = headOf(d);
    push(d, { id: str_(r.id), date: str_(r.date), shift: str_(r.shift) || 'Final', plan: p.plan === undefined ? '' : p.plan, actual: num_(p.output), remark: str_(p.reason),
              op: p.operators !== undefined ? num_(p.operators) : num_(p.manpower), r1: num_(p.r1), r2: num_(p.r2), r3: num_(p.r3), r4: num_(p.r4), r5: num_(p.r5),
              hours: num_(p.hours), src: 'app', status: st, by: str_(r.submitted_by) });
    h.incharge = h.incharge || str_(p.incharge); h.supervisor = h.supervisor || str_(p.supervisor);
  });
  // 3) loading challans of this SRN
  var ld = {};
  try {
    (Sheets.Spreadsheets.Values.get(srcId_(LOADING_JOB.srcKey), a1_(LOADING_JOB.srcSheet, LOADING_JOB.srcRow, LOADING_JOB.srcCol, LOADING_JOB.cols),
      { valueRenderOption: 'UNFORMATTED_VALUE', dateTimeRenderOption: 'FORMATTED_STRING' }).values || []).forEach(function(r) {
      var d = str_(r[10]);
      if (str_(r[5]).toUpperCase() !== srn || !want(d) || !num_(r[7])) return;
      headOf(d); (ld[d] = ld[d] || []).push({ date: dateKey_(r[1]), challan: str_(r[2]), qty: num_(r[7]) });
    });
  } catch (e) {}
  var byLine = {};
  Object.keys(heads).forEach(function(d) {
    // one row per date + shift; a loading day without output gets its own row
    var byKey = {};
    (rowsBy[d] || []).forEach(function(x) {
      var k = x.date + '|' + (x.shift === 'OT' ? 2 : 1), y = byKey[k];
      if (!y) { byKey[k] = x; return; }
      if (x.src === 'app' || y.src === 'app') { if (x.src === 'app' && y.src !== 'app') byKey[k] = x; return; }   // waiting output replaces nothing already in the sheet
      // several sheet rows of one day (half day / absent split rows): add them up, longest hours
      ['plan', 'actual', 'op', 'r1', 'r2', 'r3', 'r4', 'r5'].forEach(function(f) { if (x[f] !== '' && x[f] !== undefined) y[f] = (y[f] === '' ? 0 : num_(y[f])) + num_(x[f]); });
      y.hours = Math.max(num_(y.hours), num_(x.hours)); if (x.remark) y.remark = [y.remark, x.remark].filter(String).join(' · ');
    });
    (ld[d] || []).forEach(function(l) {
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
    byLine[d] = { head: heads[d], carry: carry, rows: list };
  });
  return { byLine: byLine, headOf: headOf };
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
// The pieces / SRN / floor go into the app's output row and the manpower / SRN / floor / hours into that day's attendance
// (app + HR sheet, status kept); then the day is rebuilt and submitted again exactly like a recorder's save, so the sheet
// row keeps its half-day / absent splits, remarks, role columns and plan. The review row gets a new id (returned).
function mReviewEdit_(req, user) {
  if (!isAdmin_(user)) return fail_('PERM', 'Admin only');
  var id = str_(req.id), r = readTab_(CFG.TABS.DAY_SUMMARY).filter(function(x) { return str_(x.id) === id; })[0];
  if (!r) return fail_('NF', 'Not found');
  if (str_(r.type) !== 'STITCH') return fail_('VAL', 'Only stitching output can be edited here');
  if (['Submitted', 'Draft', 'Rejected'].indexOf(str_(r.status)) < 0) return fail_('LOCKED', 'Already ' + str_(r.status));
  var p = parseJsonObj_(r.payload), date = str_(r.date), factory = str_(r.factory), dept = str_(r.dept), shift = str_(r.shift) || 'Final';
  var srn = str_(req.srn).toUpperCase() || str_(p.srn).toUpperCase(), output = num_(req.output), hours = num_(req.hours) || num_(p.hours), floorName = str_(req.floor);
  if (!/^SRN/.test(srn)) return fail_('VAL', 'Select the SRN');
  if (output < 0 || Math.floor(output) !== output) return fail_('VAL', 'Pieces — whole number');
  if (!(hours > 0 && hours <= 14)) return fail_('VAL', 'Working hours 1–14');
  var roles = req.roles && typeof req.roles === 'object' ? req.roles : {}, counts = {}, total = 0;
  Object.keys(roles).forEach(function(k) { var n = num_(roles[k]); if (n < 0 || Math.floor(n) !== n) return; counts[str_(k)] = n; total += n; });
  if (!total) return fail_('VAL', 'Enter the manpower');
  var floor = floorName ? (/^FAC/i.test(floorName) ? floorName : 'FAC' + factory + '-Stitching ' + floorName) : str_(p.floor);
  var reason = str_(req.reason).slice(0, 300), attShift = shift, attChanged = 0, attErr = '';
  withLock_(function() {
    // 0. the review row goes back to Draft FIRST (output rows below live on the same sheet: deleting them shifts row numbers)
    setField_(CFG.TABS.DAY_SUMMARY, r._row, 'status', 'Draft');
    // 1. the app's output rows of that line / shift -> one row with the new pieces / SRN / floor
    var old = readTab_(CFG.TABS.HOURLY_LOG).filter(function(h) { return str_(h.date) === date && str_(h.factory) === factory && str_(h.dept) === dept && str_(h.type) === 'STITCH' && (str_(h.shift) || 'Final') === shift; });
    deleteRows_(CFG.TABS.HOURLY_LOG, old.map(function(h) { return h._row; }));
    appendRows_(CFG.TABS.HOURLY_LOG, [{ id: uuid_(), date: date, factory: factory, line: lineOf_(dept), dept: dept, srn: srn, floor: floor, type: 'STITCH', shift: shift, slot: M_SLOT[shift] || '17-18',
      qty: output, checked: 0, pass: 0, reject: 0, cartons: 0, pcs_per_ctn: 0, checker: '', entered_by: (old[0] && str_(old[0].entered_by)) || userName_(user), entered_at: nowStr_(), defects: '' }]);
    // 2. that day's attendance: role counts, SRN, floor, working hours (the output row and the attendance never disagree)
    var rows = readTab_(CFG.TABS.ATT_DAILY).filter(function(a) { return str_(a.date) === date && str_(a.factory) === factory && str_(a.dept) === dept && str_(a.shift) === attShift; });
    var byRole = {}; rows.forEach(function(a) { byRole[str_(a.role)] = a; });
    var maxH = rows.length ? Math.max.apply(null, rows.map(function(a) { return num_(a.hours); })) : hours, ref = rows[0] || {}, add = [], del = [];
    Object.keys(counts).forEach(function(role) {
      var a = byRole[role], n = counts[role];
      if (a) { if (num_(a.count) !== n) { if (n > 0) setField_(CFG.TABS.ATT_DAILY, a._row, 'count', n); else del.push(a._row); attChanged++; } }
      else if (n > 0) { add.push({ id: uuid_(), date: date, factory: factory, dept: dept, shift: attShift, role: role, hours: hours, count: n, entered_by: userName_(user), entered_at: nowStr_(),
                                   srn: srn, supervisor: str_(ref.supervisor), incharge: str_(ref.incharge), qc_names: '', keep_status: '1', floor: floor }); attChanged++; }
    });
    rows.forEach(function(a) {
      if (str_(a.srn) !== srn) { setField_(CFG.TABS.ATT_DAILY, a._row, 'srn', srn); attChanged++; }
      if (floor && str_(a.floor) !== floor) { setField_(CFG.TABS.ATT_DAILY, a._row, 'floor', floor); attChanged++; }
      if (hours !== maxH && num_(a.hours) === maxH) { setField_(CFG.TABS.ATT_DAILY, a._row, 'hours', hours); attChanged++; }   // full-day rows follow the new working hours
    });
    if (del.length) deleteRows_(CFG.TABS.ATT_DAILY, del);
    if (add.length) appendRows_(CFG.TABS.ATT_DAILY, add);
    invalidateDaily_(CFG.TABS.DAY_SUMMARY); invalidateDaily_(CFG.TABS.HOURLY_LOG); invalidateDaily_(CFG.TABS.ATT_DAILY);
  });
  invalidateAppAgg_();
  if (floor) try { lineFloorSet_(dept, factory, floor); } catch (e) {}
  if (attChanged) try { var sy = attSync_(date, factory, dept, attShift, user, true); if (!sy.ok) attErr = sy.message; } catch (e) { attErr = String(e && e.message || e); }
  var s = daySubmit_({ lite: true, date: date, factory: factory, dept: dept, onlyType: 'STITCH' }, user);
  if (!s.ok) return s;
  var nr = readTab_(CFG.TABS.DAY_SUMMARY).filter(function(x) { return str_(x.date) === date && str_(x.factory) === factory && str_(x.dept) === dept && str_(x.type) === 'STITCH' && str_(x.srn).toUpperCase() === srn && (str_(x.shift) || 'Final') === shift && str_(x.status) === 'Submitted'; })[0];
  if (!nr) return fail_('ERR', 'Rebuilt row not found');
  var np = parseJsonObj_(nr.payload); np.reason = reason; np.editedBy = userName_(user);
  withLock_(function() { setField_(CFG.TABS.DAY_SUMMARY, nr._row, 'payload', JSON.stringify(np)); invalidateDaily_(CFG.TABS.DAY_SUMMARY); });
  audit_(user, 'm.reviewEdit', id, { newId: str_(nr.id), srn: srn, output: output, hours: hours, manpower: total, floor: floor, attChanged: attChanged, attErr: attErr });
  if (!req.approve) return { ok: true, edited: true, id: str_(nr.id), attChanged: attChanged, attError: attErr };
  var hasBlock = parseJsonArr_(nr.flags).some(function(f) { return f.level === 'block'; });
  var dec = mReviewDecide_({ ids: [str_(nr.id)], decision: 'approve', remark: hasBlock ? ('Approved after edit by ' + userName_(user)) : '' }, user);
  if (dec && dec.ok) { dec.attChanged = attChanged; dec.attError = attErr; dec.id = str_(nr.id); }
  return dec;
}

// ---------- PDR: previous day report, master-wise (phone Report tab) ----------
// { factory, date } -> every stitching line / SRN of that date grouped by master (incharge): plan manpower + plan output
// (production plan of the day), actual manpower (operators + the other production roles, shift) + actual output (shift +
// OT), working hours "shift + OT", variance and achievement %. Data: the main stitching sheet, plus output still waiting
// in the app (pending). Read-only.
function mPdr_(req, user) {
  var factory = str_(req.factory).replace(/^FAC/i, '') || '666', date = str_(req.date);
  if (!isDateStr_(date)) return fail_('DATE', 'Select a date');
  var T = CFG.FINAL_TARGETS[factory === '117' ? 'STITCH_117' : 'STITCH_666'], col = {};
  Object.keys(T.cols).forEach(function(c) { col[T.cols[c]] = +c - 1; });
  var nm = function(v) { return str_(v).replace(/^[A-Z]{1,4}\d{3,}\s*-\s*/i, '').trim(); };
  var by = {};
  var add = function(dept, srn, x) {
    var k = dept + '|' + srn, o = by[k] = by[k] || { dept: dept, srn: srn, master: '', supervisor: '', mp: 0, mpOt: 0, hours: 0, hoursOt: 0, manhours: 0, out: 0, sheetPlan: 0, pending: false };
    if (!o.master && x.master) o.master = nm(x.master);
    if (!o.supervisor && x.sup) o.supervisor = nm(x.sup);
    if (x.ot) { o.mpOt += x.mp; o.hoursOt = Math.max(o.hoursOt, x.hours); } else { o.mp += x.mp; o.hours = Math.max(o.hours, x.hours); }
    o.out += x.out; o.sheetPlan += x.plan; o.manhours += x.mp * x.hours; if (x.pending) o.pending = true;
  };
  // 1) the main stitching sheet
  var v = Sheets.Spreadsheets.Values.get(srcId_(T.srcKey), "'" + T.sheet + "'!A" + T.minRow + ':AB', { valueRenderOption: 'UNFORMATTED_VALUE', dateTimeRenderOption: 'FORMATTED_STRING' }).values || [];
  v.forEach(function(r) {
    var g = function(f) { return col[f] === undefined ? '' : r[col[f]]; };
    if (dateKey_(g('date')) !== date || !str_(g('dept'))) return;
    var mp = num_(g('manpower')) + num_(g('r1')) + num_(g('r2')) + num_(g('r3')) + num_(g('r4')) + num_(g('r5'));
    add(str_(g('dept')), str_(g('srn')).toUpperCase(), { ot: /OT|night/i.test(str_(g('shift'))), mp: mp, hours: num_(g('hours')), out: num_(g('output')), plan: num_(g('plan')), master: g('master'), sup: g('supervisor') });
  });
  // 2) output of that date still in the app (waiting / approved, not in the sheet yet)
  readTab_(CFG.TABS.DAY_SUMMARY).forEach(function(r) {
    if (str_(r.date) !== date || str_(r.type) !== 'STITCH' || (str_(r.factory) && str_(r.factory) !== factory)) return;
    var st = str_(r.status); if (st !== 'Submitted' && st !== 'Approved') return;
    var p = parseJsonObj_(r.payload);
    var mp = (p.operators !== undefined ? num_(p.operators) : num_(p.manpower)) + num_(p.r1) + num_(p.r2) + num_(p.r3) + num_(p.r4) + num_(p.r5);
    add(str_(r.dept), str_(r.srn).toUpperCase(), { ot: (str_(r.shift) || 'Final') !== 'Final', mp: mp, hours: num_(p.hours), out: num_(p.output), plan: num_(p.plan), master: p.incharge, sup: p.supervisor, pending: true });
  });
  // 3) plan of the day (production plan: day plan qty + planned manpower); else the plan written on the sheet rows
  var masters = {};
  Object.keys(by).forEach(function(k) {
    // plan output for the people who actually worked: rate of that day (learning curve; 100% after the plan ended) × man-hours
    // no plan for the line: the Making Bulletin (SAM, all manpower types) like the hourly target — man-hours × 60 ÷ SAM,
    // with the SRN's learning curve of that day when another line's plan has it (else 100%)
    var o = by[k], pl = planOf_(date, o.dept, o.srn), sm = null, smLc = '';
    if (!(pl && pl.rate)) { try { sm = samOf_(o.srn); } catch (e) {} if (sm && sm.sam > 0) smLc = planLcOfSrn_(date, o.srn) || 100; }
    var planOut = pl && pl.rate ? Math.round(pl.rate * o.manhours) : sm && sm.sam > 0 && o.manhours ? Math.round(o.manhours * 60 / sm.sam * smLc / 100) : Math.round(o.sheetPlan);
    var line = { dept: o.dept, srn: o.srn, supervisor: o.supervisor, planMp: pl && pl.mp ? Math.round(pl.mp) : '', planOut: planOut || '', mp: o.mp, mpOt: o.mpOt, hours: o.hours, hoursOt: o.hoursOt,
                 out: o.out, variance: planOut ? o.out - planOut : '', ach: planOut ? Math.round(o.out * 1000 / planOut) / 10 : '', pending: o.pending,
                 planFrom: pl && pl.rate ? (pl.after ? 'after' : 'plan') : sm && sm.sam > 0 && o.manhours ? 'sam' : (planOut ? 'sheet' : ''), lc: pl && pl.rate ? pl.lc : smLc, sam: sm && sm.sam > 0 ? sm.sam : '', manhours: Math.round(o.manhours * 10) / 10 };
    var mk = o.master || '—', m = masters[mk.toLowerCase()] = masters[mk.toLowerCase()] || { master: mk, lines: [] };
    m.lines.push(line);
  });
  var tot = { planOut: 0, out: 0, planMp: 0, mp: 0 };
  var list = Object.keys(masters).map(function(k) {
    var m = masters[k];
    m.lines.sort(function(a, b) { return a.dept.localeCompare(b.dept) || a.srn.localeCompare(b.srn); });
    m.planOut = m.lines.reduce(function(a, l) { return a + num_(l.planOut); }, 0); m.out = m.lines.reduce(function(a, l) { return a + l.out; }, 0);
    m.planMp = m.lines.reduce(function(a, l) { return a + num_(l.planMp); }, 0); m.mp = m.lines.reduce(function(a, l) { return a + l.mp; }, 0);
    var planned = m.lines.filter(function(l) { return l.planOut; }), pOut = planned.reduce(function(a, l) { return a + num_(l.planOut); }, 0), aOut = planned.reduce(function(a, l) { return a + l.out; }, 0);
    m.ach = pOut ? Math.round(aOut * 1000 / pOut) / 10 : '';
    tot.planOut += m.planOut; tot.out += m.out; tot.planMp += m.planMp; tot.mp += m.mp; tot.pOut = (tot.pOut || 0) + pOut; tot.aOut = (tot.aOut || 0) + aOut;
    return m;
  }).sort(function(a, b) { return a.master === '—' ? 1 : b.master === '—' ? -1 : a.master.localeCompare(b.master); });
  tot.ach = tot.pOut ? Math.round(tot.aOut * 1000 / tot.pOut) / 10 : '';
  return { ok: true, date: date, factory: factory, masters: list, total: tot };
}
