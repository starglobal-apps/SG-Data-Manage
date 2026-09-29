// Target.js — hourly target for a line from today's attendance and the SRN's SAM (standard allowed minutes per piece).
//   target / hour @100% = productive manpower × 60 / SAM ;  @eff = × eff% ;  day = hourly × working hours
// SAM is stored once per SRN in MASTERS (type SAM, key = SRN, value = minutes) and reused by everyone.

var TARGET_NON_PRODUCTIVE = ['Supervisor', 'Incharge', 'Data Collector'];

function samOf_(srn) {
  var hit = mastersRows_().filter(function(r) { return str_(r.type) === 'SAM' && str_(r.key).toUpperCase() === str_(srn).toUpperCase() && isTrue_(r.active); })[0];
  return hit ? { sam: num_(hit.value), by: str_(hit.extra) } : null;
}

// { date, factory, dept, srn } -> attendance, manpower now, SAM, hourly actuals for the line
function targetGet_(req, user) {
  var date = str_(req.date), factory = str_(req.factory), dept = str_(req.dept), srn = str_(req.srn).toUpperCase();
  if (!isDateStr_(date)) return fail_('DATE', 'Date galat');
  if (!dept) return fail_('DEPT', 'Line chuno');
  var att = readDaily_(CFG.TABS.ATT_DAILY).filter(function(r) { return str_(r.date) === date && str_(r.factory) === factory && str_(r.dept) === dept; });
  var fin = att.filter(function(r) { return str_(r.shift) === 'Final'; });
  var events = readDaily_(CFG.TABS.MANPOWER_EVENTS).filter(function(r) { return str_(r.date) === date && str_(r.factory) === factory; });
  var roles = {}, total = 0, productive = 0, operators = 0;
  fin.forEach(function(r) {
    var role = str_(r.role), n = num_(r.count);
    roles[role] = (roles[role] || 0) + n; total += n;
    if (TARGET_NON_PRODUCTIVE.indexOf(role) < 0) productive += n;
    if (role === 'Operator') operators += n;
  });
  var hours = attHours_(fin.map(function(r) { return { role: str_(r.role), hours: num_(r.hours), count: num_(r.count) }; }), 'Final');
  var close = lineClose_(events, dept);
  if (close) hours = Math.min(hours, close.eff);
  var attSrn = fin.length ? str_(fin[0].srn) : '';
  if (!srn) srn = attSrn || (hourlySrnMap_(date, factory)[dept] || '');
  // manpower per slot (events applied) and actual stitching output per slot for this SRN
  var bySlot = CFG.SLOTS.filter(function(s) { return s.shift === 'Final'; }).map(function(s) {
    return { slot: s.key, label: s.label, mp: mpAtSlot_(att, events, dept, s.key), actual: 0 };
  });
  var idx = {}; bySlot.forEach(function(x, i) { idx[x.slot] = i; });
  readDaily_(CFG.TABS.HOURLY_LOG).forEach(function(r) {
    if (str_(r.date) !== date || str_(r.factory) !== factory || str_(r.dept) !== dept || str_(r.type) !== 'STITCH') return;
    if (srn && str_(r.srn).toUpperCase() !== srn) return;
    var i = idx[str_(r.slot)]; if (i !== undefined) bySlot[i].actual += num_(r.qty);
  });
  // non-productive heads are removed from the per-slot manpower too
  var nonProd = total - productive;
  bySlot.forEach(function(x) { x.mpProd = Math.max(0, x.mp - nonProd); if (close && close.hour <= Number(x.slot.split('-')[0]) + 0.01) x.closed = true; });
  var s = srn ? samOf_(srn) : null, info = srn ? ((loadingAgg_().srnInfo || {})[srn] || {}) : {};
  return { ok: true, date: date, dept: dept, srn: srn, attSrn: attSrn, item: info.item || '', hasAtt: fin.length > 0,
           roles: roles, total: total, productive: productive, operators: operators, hours: hours, closedAt: close ? close.time : '',
           sam: s ? s.sam : 0, samBy: s ? s.by : '', slots: bySlot, nonProductiveRoles: TARGET_NON_PRODUCTIVE };
}

// { srn, sam } -> save / replace the SAM for an SRN
function targetSamSave_(req, user) {
  var srn = str_(req.srn).toUpperCase(), sam = num_(req.sam);
  if (!srn) return fail_('VAL', 'SRN chahiye');
  if (!(sam > 0) || sam > 600) return fail_('VAL', 'SAM minutes me daalo (jaise 12.5)');
  var sh = tab_(CFG.TABS.MASTERS, true), head = CFG.HEADERS.MASTERS;
  var hit = readTab_(CFG.TABS.MASTERS).filter(function(r) { return str_(r.type) === 'SAM' && str_(r.key).toUpperCase() === srn; })[0];
  if (hit) {
    sh.getRange(hit._row, head.indexOf('value') + 1).setValue(sam);
    sh.getRange(hit._row, head.indexOf('extra') + 1).setValue(userName_(user));
    sh.getRange(hit._row, head.indexOf('active') + 1).setValue('TRUE');
  } else appendRows_(CFG.TABS.MASTERS, [{ type: 'SAM', key: srn, value: sam, factory: '', extra: userName_(user), active: 'TRUE' }]);
  invalidateMasters_();
  audit_(user, 'target.sam', srn, { sam: sam });
  return { ok: true, srn: srn, sam: sam };
}
