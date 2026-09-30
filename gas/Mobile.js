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
  var sam = {};
  mastersRows_().forEach(function(r) { if (str_(r.type) === 'SAM' && isTrue_(r.active) && num_(r.value) > 0) sam[str_(r.key).toUpperCase()] = num_(r.value); });
  return { ok: true, date: date, items: items, lines: pick, wa: wa, sam: sam };
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
  if (isLocked_(dayStatus_(date, factory, dept, 'ATT'))) return fail_('LOCKED', 'Ye attendance admin ke paas hai — approve / reject hone ke baad update karo');
  if (hd < 0 || ab < 0 || Math.floor(hd) !== hd || Math.floor(ab) !== ab || !(hd + ab)) return fail_('VAL', 'Half day / absent me kitne log — poora number');
  if (hd && !(hrs > 0 && hrs < 12)) return fail_('VAL', 'Half day ke working hour chuno');
  var sa = sheetAttAgg_()[date + '|' + dept + '|Final'], stamp = nowStr_(), by = userName_(user);
  var ev = function(r, event, count, hours, note) {
    return { id: uuid_(), date: date, factory: factory, dept: dept, role: r, event: event, count: count, time: '',
             eff_hours: hours, note: note, entered_by: by, entered_at: stamp };
  };
  var res = withLock_(function() {
    var app = readDaily_(CFG.TABS.ATT_DAILY).filter(function(r) { return str_(r.date) === date && str_(r.factory) === factory && str_(r.dept) === dept && str_(r.shift) === 'Final'; });
    var roles = {}, add = [], evs = [];
    if (app.length) app.forEach(function(r) { roles[str_(r.role)] = (roles[str_(r.role)] || 0) + num_(r.count); });
    else {
      if (!sa || !sa.rows) return fail_('NF', 'Is din is line ki attendance nahi mili');
      var byRole = {};
      Object.keys(sa.rows).forEach(function(k) { var p = k.split('|'), o = byRole[p[0]] = byRole[p[0]] || { count: 0, hours: 0, parts: [] }; o.count += sa.rows[k]; o.hours = Math.max(o.hours, num_(p[1])); o.parts.push({ h: num_(p[1]), n: sa.rows[k] }); });
      var prev = readDaily_(CFG.TABS.ATT_DAILY).filter(function(r) { return str_(r.factory) === factory && str_(r.dept) === dept && str_(r.shift) === 'Final' && str_(r.date) < date; })
        .sort(function(a, b) { return str_(b.date).localeCompare(str_(a.date)); })[0];
      var staff = lineStaffOf_(dept);
      Object.keys(byRole).forEach(function(r) {
        var o = byRole[r]; roles[r] = o.count;
        add.push({ id: uuid_(), date: date, factory: factory, dept: dept, shift: 'Final', role: r, hours: o.hours || shiftHours_('Final'), count: o.count,
                   entered_by: by, entered_at: stamp, srn: prev ? str_(prev.srn) : '', supervisor: (prev && str_(prev.supervisor)) || staff.supervisor,
                   incharge: (prev && str_(prev.incharge)) || staff.incharge, qc_names: '' });
        o.parts.forEach(function(p) { if (p.h < o.hours) evs.push(ev(r, p.h > 0 ? 'HALF_DAY' : 'ABSENT', p.n, p.h, 'sheet')); });
      });
    }
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
  var toAdmin = false;
  if (sa) { var s = daySubmit_({ date: date, factory: factory, dept: dept, onlyType: 'ATT' }, user); toAdmin = !!(s.ok && s.submitted); }
  return { ok: true, copied: res.copied, toAdmin: toAdmin };
}
