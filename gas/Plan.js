// Plan.js — the production plan (Production Management System > 'Making Plan Response for Production', imported into
// MASTER DATA col K). Its Day Plan Qty already follows the learning curve (0, 80, 160, 320 … then full), with the
// manpower it was planned for. The day's target is that plan scaled to the people actually working:
//   rate (pcs per person-hour) = day plan qty ÷ (planned people × planned hours)   planned people = operators + other manpower
//   hourly target = rate × production people today        plan output (sheet col M) = rate × their working hours
// A line / SRN / date without a plan row falls back to the SAM method.
// MASTER DATA col K row: [ts, SRN, style, line, plan date dd/mm/yyyy, day, day plan qty, balance, efficiency,
//                         operators, other manpower {"Helper":7,…}, total manpower, working hours, daily target]

function planDate_(v) {
  var s = str_(v), m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (m) return m[3] + '-' + ('0' + m[2]).slice(-2) + '-' + ('0' + m[1]).slice(-2);   // the plan sheet writes dd/mm/yyyy
  var k = dateKey_(v); return k === '9999-12-31' ? '' : k;
}

// { 'line|SRN|yyyy-mm-dd': { qty, mp, hours, rate } } for the last 45 days and the next 15. Cached (refreshed by m.warm).
function planAgg_() {
  var hit = cacheGetBig_('plan_agg');
  if (hit) return hit;
  var out = {}, md = getSS_().getSheetByName(MASTER_SHEET_NAME);
  var from = fmtDate_(new Date(new Date().getTime() - 45 * 86400000)), to = fmtDate_(new Date(new Date().getTime() + 15 * 86400000));
  if (md && md.getLastRow() >= 3 && md.getLastColumn() >= 11) {
    md.getRange(3, 11, md.getLastRow() - 2, 1).getValues().forEach(function(row) {
      var a = parseJson_(row[0]); if (!a) return;
      var d = planDate_(a[4]); if (!d || d < from || d > to) return;
      var srn = str_(a[1]).toUpperCase(), line = str_(a[3]); if (!/^SRN/.test(srn) || !line) return;
      var other = 0; try { var o = typeof a[10] === 'object' ? a[10] : JSON.parse(str_(a[10]) || '{}'); Object.keys(o || {}).forEach(function(k) { other += num_(o[k]); }); } catch (e) {}
      var mp = num_(a[9]) + other || num_(a[11]), hours = num_(a[12]) || shiftHours_('Final'), qty = num_(a[6]);
      out[line + '|' + srn + '|' + d] = { qty: qty, mp: mp, hours: hours, rate: mp > 0 && hours > 0 ? qty / (mp * hours) : 0 };   // a later row of the same day wins
    });
  }
  cachePutBig_('plan_agg', out, 1800);
  return out;
}
function planOf_(date, dept, srn) { return planAgg_()[str_(dept) + '|' + str_(srn).toUpperCase() + '|' + str_(date)] || null; }

// the plans of one date for some lines: { 'line|SRN': { qty, mp, hours, rate } } (phone attendance screen)
function planOfDay_(date, depts) {
  var all = planAgg_(), want = {}, out = {};
  depts.forEach(function(d) { want[d] = 1; });
  Object.keys(all).forEach(function(k) { var p = k.split('|'); if (p[2] === date && want[p[0]]) out[p[0] + '|' + p[1]] = all[k]; });
  return out;
}

// New line codes reach SETTINGS by themselves: every line / floor in the loading sheet or the production plan that is
// not a DEPT row yet is added (factory from the loading row or the code "FAC666-…"; category from the name: "Line" ->
// STITCH, "Packing" -> PACKING; contractors are not added). Runs in the background refresh (m.warm) and on Fresh data.
function syncLines_() {
  var known = {}, add = [], wake = [];
  readTab_(CFG.TABS.MASTERS).forEach(function(r) { if (str_(r.type) === 'DEPT') known[str_(r.key).toUpperCase()] = r; });
  var ld = loadingAgg_(), plan = {}, cand = {};
  try { plan = planAgg_(); } catch (e) {}
  // only lines in use: a loading challan in the last 30 days, or a production plan row (-45 … +15 days)
  var since = fmtDate_(new Date(new Date().getTime() - 30 * 86400000));
  Object.keys(ld.lastLoad || {}).forEach(function(k) { var d = k.slice(0, k.lastIndexOf('|')); if (ld.lastLoad[k] >= since) cand[d] = (ld.partyFac || {})[d] || ''; });
  Object.keys(plan).forEach(function(k) { var d = k.split('|')[0]; if (!(d in cand)) cand[d] = ''; });
  Object.keys(cand).forEach(function(d) {
    d = str_(d); if (!d) return;
    var had = known[d.toUpperCase()];
    if (had) { if (had !== 1 && !isTrue_(had.active) && CFG.ACTIVE_CATS.indexOf(str_(had.extra)) >= 0) { wake.push(had); known[d.toUpperCase()] = 1; } return; }   // in use again: active
    var cat = deptCategory_(d); if (CFG.ACTIVE_CATS.indexOf(cat) < 0) return;
    var fac = cand[d] || ((d.match(/FAC\s*(\d+)/i) || [])[1] || '');
    if (!fac || CFG.FACTORIES.indexOf(fac) < 0) return;
    known[d.toUpperCase()] = 1;
    add.push({ type: 'DEPT', key: d, value: d, factory: fac, extra: cat, active: 'TRUE' });
  });
  if (add.length || wake.length) {
    withLock_(function() { wake.forEach(function(r) { setField_(CFG.TABS.MASTERS, r._row, 'active', 'TRUE'); }); if (add.length) appendRows_(CFG.TABS.MASTERS, add); });
    invalidateMasters_();
  }
  return add.map(function(a) { return 'added ' + a.key + ' (FAC' + a.factory + ', ' + a.extra + ')'; }).concat(wake.map(function(r) { return 'active again ' + str_(r.key); }));
}
