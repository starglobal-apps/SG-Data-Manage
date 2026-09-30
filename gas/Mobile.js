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
    .map(function(e) { return { role: str_(e.role), event: str_(e.event), count: num_(e.count), time: str_(e.time) }; });
}
function mSrns_(L, dept) {
  return srnOptions_(L, dept, 'STITCH').map(function(o) { return { srn: o.srn, balance: o.balance, limit: o.limit, used: o.used }; });
}

// { date, factory }
function mAtt_(req, user) {
  var date = str_(req.date), factory = str_(req.factory);
  if (!isDateStr_(date)) return fail_('DATE', 'Date galat');
  var base = attPrev_(req, user); if (!base.ok) return base;
  var L = ledger_(), st = statusMap_(date, factory), slot = mNowSlot_();
  var attToday = readDaily_(CFG.TABS.ATT_DAILY).filter(function(r) { return str_(r.date) === date && str_(r.factory) === factory; });
  var events = readDaily_(CFG.TABS.MANPOWER_EVENTS).filter(function(r) { return str_(r.date) === date && str_(r.factory) === factory; });
  var wa = { depts: [], att: {}, attRoles: {}, attSrn: {}, eventList: [], mpNow: {} };
  var items = base.items.map(function(x) {
    x.srns = x.cat === 'STITCH' ? mSrns_(L, x.dept) : [];
    x.status = st[x.dept + '|ATT'] || '';
    x.events = mEvents_(events, x.dept);
    x.mpNow = x.today ? mpAtSlot_(attToday, events, x.dept, slot) : 0;
    x.ot = attToday.filter(function(r) { return str_(r.dept) === x.dept && str_(r.shift) === 'OT'; }).reduce(function(t, r) { return t + num_(r.count); }, 0);
    wa.depts.push({ dept: x.dept, cat: x.cat });
    attToday.forEach(function(r) {
      if (str_(r.dept) !== x.dept) return;
      var k = x.dept + '|' + str_(r.shift);
      wa.att[k] = (wa.att[k] || 0) + num_(r.count);
      (wa.attRoles[k] = wa.attRoles[k] || {})[str_(r.role)] = (wa.attRoles[k][str_(r.role)] || 0) + num_(r.count);
      if (str_(r.srn) && (str_(r.shift) === 'Final' || !wa.attSrn[x.dept])) wa.attSrn[x.dept] = str_(r.srn);
    });
    x.events.forEach(function(e) { wa.eventList.push({ dept: x.dept, role: e.role, event: e.event, count: e.count, time: e.time }); });
    wa.mpNow[x.dept] = x.mpNow;
    return x;
  });
  // SAM (minutes / piece) per SRN, saved once from the Target tab -> hourly target shown on the phone (display only)
  var sam = {};
  mastersRows_().forEach(function(r) { if (str_(r.type) === 'SAM' && isTrue_(r.active) && num_(r.value) > 0) sam[str_(r.key).toUpperCase()] = num_(r.value); });
  return { ok: true, date: date, items: items, wa: wa, sam: sam };
}

// { date, factory } -> stitching lines that worked that day (attendance filled), per shift (Day / OT),
// plus earlier days whose output is still missing (not in the app and not typed into the sheet either).
var M_SLOT = { Final: '17-18', OT: '21-22' };
function mOut_(req, user) {
  var date = str_(req.date), factory = str_(req.factory);
  if (!isDateStr_(date)) return fail_('DATE', 'Date galat');
  var depts = writableDepts_(user, factory).filter(function(d) { return d.cat === 'STITCH'; });
  var att = readDaily_(CFG.TABS.ATT_DAILY).filter(function(r) { return str_(r.date) === date && str_(r.factory) === factory; });
  var events = readDaily_(CFG.TABS.MANPOWER_EVENTS).filter(function(r) { return str_(r.date) === date && str_(r.factory) === factory; });
  var hourly = readDaily_(CFG.TABS.HOURLY_LOG).filter(function(r) { return str_(r.date) === date && str_(r.factory) === factory && str_(r.type) === 'STITCH'; });
  var st = statusMap_(date, factory), lineFloor = masterMap_('LINE_FLOOR'), L = ledger_();
  var lines = [];
  depts.forEach(function(d) {
    var shifts = [], floor = '';
    ['Final', 'OT'].forEach(function(sh) {
      var rows = att.filter(function(r) { return str_(r.dept) === d.dept && str_(r.shift) === sh; });
      if (!rows.length) return;
      var by = {};
      hourly.forEach(function(r) {
        if (str_(r.dept) !== d.dept || (str_(r.shift) || 'Final') !== sh) return;
        var e = by[str_(r.srn)] = by[str_(r.srn)] || { srn: str_(r.srn), total: 0, other: 0 };
        e.total += num_(r.qty); if (str_(r.slot) !== M_SLOT[sh]) e.other += num_(r.qty);
        if (str_(r.floor)) floor = str_(r.floor);
      });
      var hours = attHours_(rows.map(function(r) { return { role: str_(r.role), hours: num_(r.hours), count: num_(r.count) }; }), sh);
      if (sh === 'Final') { var close = lineClose_(events, d.dept); if (close) hours = Math.min(hours, close.eff); }
      var base = rows.reduce(function(t, r) { return t + num_(r.count); }, 0);
      shifts.push({ shift: sh, slot: M_SLOT[sh], mpBase: base, mp: sh === 'Final' ? mpAtSlot_(att, events, d.dept, M_SLOT.Final) : base,
                    hours: hours, attSrn: str_(rows[0].srn), entries: Object.keys(by).map(function(k) { return by[k]; }) });
    });
    if (!shifts.length) return;   // no attendance that day = the line did not work: not shown
    var status = st[d.dept + '|STITCH'] || '';
    lines.push({ dept: d.dept, floor: floor || (lineFloor[d.dept] ? lineFloor[d.dept].value : ''), events: mEvents_(events, d.dept),
                 srns: mSrns_(L, d.dept), shifts: shifts, status: status, locked: isLocked_(status) ? status : '' });
  });
  return { ok: true, date: date, lines: lines, pending: mPending_(user, factory, date, depts) };
}

// Last 7 days (not the day on screen, not today's future): lines with attendance but no stitching output in the app
// and none typed into the main sheet (MASTER DATA) for that line / date / shift, and not already with the admin.
function mPending_(user, factory, shownDate, depts) {
  var today = todayStr_(), from = fmtDate_(new Date(new Date().getTime() - 7 * 86400000));
  var mine = {}; depts.forEach(function(d) { mine[d.dept] = 1; });
  var sheetDays = (historyAgg_().sheetDays) || {};
  var attBy = {}, outBy = {};
  readDaily_(CFG.TABS.ATT_DAILY).forEach(function(r) {
    var d = str_(r.date); if (str_(r.factory) !== factory || !mine[str_(r.dept)] || d < from || d >= today || d === shownDate) return;
    attBy[d + '|' + str_(r.dept) + '|' + str_(r.shift)] = 1;
  });
  readDaily_(CFG.TABS.HOURLY_LOG).forEach(function(r) {
    if (str_(r.type) !== 'STITCH' || str_(r.factory) !== factory) return;
    outBy[str_(r.date) + '|' + str_(r.dept) + '|' + (str_(r.shift) || 'Final')] = 1;
  });
  var byDate = {}, stCache = {};
  Object.keys(attBy).forEach(function(k) {
    var p = k.split('|'), d = p[0], dept = p[1], sh = p[2];
    if (sh !== 'Final' && sh !== 'OT') return;
    if (outBy[k] || sheetDays[dept + '|' + d + '|' + sh]) return;
    var st = stCache[d] = stCache[d] || statusMap_(d, factory);
    if (isLocked_(st[dept + '|STITCH'] || '')) return;
    (byDate[d] = byDate[d] || []).push({ dept: dept, shift: sh });
  });
  return Object.keys(byDate).sort().reverse().map(function(d) { return { date: d, lines: byDate[d] }; });
}
