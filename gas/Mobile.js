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
  return { ok: true, date: date, items: items, lines: pick, wa: wa, sam: sam, incoming: tr.incoming, allLines: allLines };
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
  var sheet = sheetAttAgg_(), sheetDays = historyAgg_().sheetDays || {};
  var L = ledger_(), lineFloor = masterMap_('LINE_FLOOR'), stBy = {}, srnsBy = {};
  var statusOf = function(d, dept) { var m = stBy[d] = stBy[d] || statusMap_(d, factory); return m[dept + '|STITCH'] || ''; };
  var srnsOf = function(dept) { return srnsBy[dept] = srnsBy[dept] || mSrns_(L, dept); };
  // every (date, dept, shift) with attendance
  var keys = {};
  att.forEach(function(r) { if (M_SLOT[str_(r.shift)]) keys[str_(r.date) + '|' + str_(r.dept) + '|' + str_(r.shift)] = 'app'; });
  Object.keys(sheet).forEach(function(k) { var p = k.split('|'); if (p[0] >= from && p[0] <= today && mine[p[1]] && !keys[k] && sheet[k].factory === factory) keys[k] = 'sheet'; });
  var groups = {}, done = [];
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
    var line = { date: d, dept: dept, shift: sh, slot: M_SLOT[sh], fromSheet: src === 'sheet', mp: mp, mpBase: base, hours: hours, attSrn: attSrn,
                 floor: lineFloor[dept] ? lineFloor[dept].value : '', events: sh === 'Final' ? mEvents_(dayEv, dept) : [], entries: entries, status: status };
    var hasOut = outRows.length > 0 || sheetDays[dept + '|' + d + '|' + sh];
    if (d === today && outRows.length) done.push(line);
    if (hasOut && status !== 'Rejected') return;
    if (isLocked_(status)) return;
    line.srns = srnsOf(dept);
    (groups[d] = groups[d] || []).push(line);
  });
  return { ok: true, today: today, groups: Object.keys(groups).sort().reverse().map(function(d) { return { date: d, lines: groups[d] }; }), done: done };
}

// ---------- phone: everything the three screens need in ONE call (Attendance of the date · Output · PMS) ----------
// The phone keeps the reply, switches tabs without loading, and calls this again every 5 min / after a save.
function mAll_(req, user) {
  var factory = str_(req.factory), date = str_(req.date) || todayStr_(), t = Date.now();
  var safe = function(fn) { try { return fn(); } catch (e) { return { ok: false, message: String(e && e.message || e) }; } };
  LEDGER_MEMO_ON_ = true;
  try {
    return { ok: true, date: date, factory: factory, at: nowStr_(),
             att: safe(function() { return mAtt_({ date: date, factory: factory }, user); }),
             out: safe(function() { return mOut_({ factory: factory }, user); }),
             pms: safe(function() { return mPms_({ factory: factory }, user); }), ms: 0 };
  } finally { LEDGER_MEMO_ON_ = false; LEDGER_MEMO_ = null; }
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
    [mastersRows_, sheetAttAgg_, loadingAgg_, historyAgg_, ordersAgg_, unloadingAgg_, bulletinSam_].forEach(function(fn) { fn(); });
  } finally { SWR_REFRESH_ = false; c.remove('warm_running'); }
  return { ok: true, ms: Date.now() - t };
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

// { factory } -> unshipped SRNs that have production data: loading, stitching, endline pass, packed, unloading, shipped
function mPms_(req, user) {
  var L = ledger_(), orders = ordersAgg_(), unl = unloadingAgg_();
  var stitchedSrn = {};
  Object.keys(L.stitched).forEach(function(k) { addTo_(stitchedSrn, k.split('|')[1], L.stitched[k]); });
  // loading given to a contractor (party is not a line / packing / … of ours): they send no stitching / endline figures
  var contr = {}, contrBy = {}, catOf = {};
  mastersRows_().forEach(function(r) { if (str_(r.type) === 'DEPT' && str_(r.extra)) catOf[str_(r.key).toUpperCase()] = str_(r.extra); });
  Object.keys(L.loaded || {}).forEach(function(k) {
    var i = k.lastIndexOf('|'), party = k.slice(0, i), srn = k.slice(i + 1).toUpperCase();
    if ((catOf[party.toUpperCase()] || deptCategory_(party)) !== 'CONTRACTOR') return;
    addTo_(contr, srn, L.loaded[k]); (contrBy[srn] = contrBy[srn] || {})[party] = 1;
  });
  var seen = {};
  [L.loadedSrn, stitchedSrn, L.endPassSrn, L.packed].forEach(function(m) { Object.keys(m || {}).forEach(function(k) { seen[str_(k).toUpperCase()] = 1; }); });
  var fac = str_(req.factory).replace(/^FAC/i, ''), rows = [], hasOrders = Object.keys(orders).length > 0;
  Object.keys(seen).forEach(function(srn) {
    var m = srn.match(/^SRN0*(\d+)/); if (!m || +m[1] < 500) return;    // only SRN0500 onwards
    var o = orders[srn];
    if (hasOrders && !o) return;                                         // not in 'All Orders' (old, already closed)
    o = o || {};
    if (/^shipped$/i.test(str_(o.status))) return;                       // shipped orders are not shown
    var info = (L.srnInfo || {})[srn] || {};
    if (fac && info.factory && info.factory !== fac) return;               // only this factory's SRNs
    rows.push({ srn: srn, style: o.style || info.item || '', buyer: info.buyer || '', order: num_(o.shipping) || num_(info.orderQty), status: o.status || '',
                loading: num_(L.loadedSrn[srn]), contractor: num_(contr[srn]), contractors: Object.keys(contrBy[srn] || {}).join(', '), stitched: num_(stitchedSrn[srn]), endPass: num_(L.endPassSrn[srn]), packed: num_(L.packed[srn]),
                unloaded: num_(unl[srn]), shipped: num_(o.shipped) });
  });
  rows = rows.filter(function(r) { return r.loading || r.stitched || r.endPass || r.packed; });
  rows.sort(function(a, b) { return b.srn.localeCompare(a.srn); });
  return { ok: true, rows: rows, unloadError: unl.__error || '' };
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
    var sh = tab_(CFG.TABS.TRANSFERS, true), head = CFG.HEADERS.TRANSFERS;
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
