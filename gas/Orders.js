// Orders.js — loading balance and the cumulative ledger behind the validation chain:
//   Loading >= Stitching >= Endline checked ; Endline pass >= Packing   (per SRN, stitching/endline also per line-dept)
//
// History (before CFG.APP_START_DATE) comes from MASTER DATA; app-era rows come from HOURLY_LOG.
// Loading is never entered in the app, so it is read straight from the loading source sheet (cached 10 min).

var LOADING_JOB = { srcKey: 'LOADING', srcSheet: 'loading_chalaan', srcRow: 10, srcCol: 1, cols: 12 };

function k2_(a, b) { return str_(a) + '|' + str_(b); }
function addTo_(map, key, n) { map[key] = (map[key] || 0) + num_(n); }

// { loaded: {dept|srn: qty}, loadedSrn: {srn: qty}, srnInfo: {srn: {item, buyer, orderQty, factory, line}} }
function loadingAgg_() {
  var hit = cacheGetBig_('loading_agg');
  if (hit) return hit;

  var out = { loaded: {}, loadedSrn: {}, srnInfo: {}, deptSrns: {}, lastLoad: {} };
  var res = Sheets.Spreadsheets.Values.get(srcId_(LOADING_JOB.srcKey),
    a1_(LOADING_JOB.srcSheet, LOADING_JOB.srcRow, LOADING_JOB.srcCol, LOADING_JOB.cols),
    { valueRenderOption: 'UNFORMATTED_VALUE', dateTimeRenderOption: 'FORMATTED_STRING' });
  (res.values || []).forEach(function(r) {
    // [ts, date, challan, factory, label, srn, line, qty, lot, partyType, party, code]
    var srn = str_(r[5]), party = str_(r[10]), qty = num_(r[7]);
    if (!srn || !qty) return;
    addTo_(out.loaded, k2_(party, srn), qty);
    addTo_(out.loadedSrn, srn, qty);
    var ld = dateKey_(r[1]); if (ld !== '9999-12-31' && (!out.lastLoad[k2_(party, srn)] || out.lastLoad[k2_(party, srn)] < ld)) out.lastLoad[k2_(party, srn)] = ld;
    if (!out.deptSrns[party]) out.deptSrns[party] = {};
    out.deptSrns[party][srn] = true;
    if (!out.srnInfo[srn]) {
      var m = str_(r[4]).match(/^\S+\s*-\s*(.*?)\s*-\s*(.*?)\s*\((\d+(?:\.\d+)?)\s*pcs\)\s*$/i);
      out.srnInfo[srn] = { buyer: m ? m[1] : '', item: m ? m[2] : str_(r[4]), orderQty: m ? num_(m[3]) : 0,
                           factory: str_(r[3]).replace(/^FAC/, ''), line: str_(r[6]) };
    }
  });
  cachePutBig_('loading_agg', out, 900);
  return out;
}

// MASTER DATA aggregated. Rows dated before APP_START_DATE go straight into the totals; rows on/after it are kept
// per (dept, srn, date) in `late` and only count where the app has NO rows for that same line/SRN/date/type —
// so data typed straight into the source sheets still counts, while app rows that came back via Send to Final
// + import are never counted twice. Cached 6 h (re-import -> Main > Refresh sab data).
function historyAgg_() {
  var hit = cacheGetBig_('hist_agg2');
  if (hit) return hit;

  var out = { stitched: {}, endChecked: {}, endPass: {}, endPassSrn: {}, packed: {},
              late: { stitched: {}, endChecked: {}, endPass: {}, packed: {} } };
  var ss = getSS_();
  var md = ss.getSheetByName(MASTER_SHEET_NAME);
  if (md && md.getLastRow() >= 3) {
    var start = CFG.APP_START_DATE, BAD = '9999-12-31';
    var vals = md.getRange(3, 4, md.getLastRow() - 2, 4).getValues(); // cols 4..7: Stitching, 117 Stitching, Packing, Endline
    vals.forEach(function(row) {
      var s = parseJson_(row[0]), d;   // [date, line, dept, srn, floor, shift, manpower, hours, output]
      if (s) { d = dateKey_(s[0]); if (d < start) addTo_(out.stitched, k2_(s[2], s[3]), s[8]); else if (d !== BAD) addTo_(out.late.stitched, k2_(s[2], s[3]) + '|' + d, s[8]); }
      var s7 = parseJson_(row[1]);     // [date, floor, line, dept, srn, shift, manpower, hours, output]
      if (s7) { d = dateKey_(s7[0]); if (d < start) addTo_(out.stitched, k2_(s7[3], s7[4]), s7[8]); else if (d !== BAD) addTo_(out.late.stitched, k2_(s7[3], s7[4]) + '|' + d, s7[8]); }
      var p = parseJson_(row[2]);      // [srn, date, '', qty, ...]
      if (p) { d = dateKey_(p[1]); if (d < start) addTo_(out.packed, str_(p[0]), p[3]); else if (d !== BAD) addTo_(out.late.packed, str_(p[0]) + '|' + d, p[3]); }
      var e = parseJson_(row[3]);      // [entry, factory, prodDate, srn, item, dept, qfloor, checker, hours, checked, pass, reject]
      if (e) {
        d = dateKey_(e[2] || e[0]);
        if (d < start) { addTo_(out.endChecked, k2_(e[5], e[3]), e[9]); addTo_(out.endPass, k2_(e[5], e[3]), e[10]); addTo_(out.endPassSrn, str_(e[3]), e[10]); }
        else if (d !== BAD) { addTo_(out.late.endChecked, k2_(e[5], e[3]) + '|' + d, e[9]); addTo_(out.late.endPass, k2_(e[5], e[3]) + '|' + d, e[10]); }
      }
    });
  }
  cachePutBig_('hist_agg2', out, 21600);
  return out;
}

function dateKey_(v) { var d = parseDate_(v); return d ? fmtDate_(d) : '9999-12-31'; }

// HOURLY_LOG rows on/after APP_START_DATE, aggregated the same way. Optionally exclude one entry key
// (date|factory|type|dept|srn) so a re-save of that key is not counted twice.
function appAgg_(excludeKey) {
  if (!excludeKey) { var hit = cacheGetBig_('app_agg'); if (hit) return hit; }
  var out = { stitched: {}, endChecked: {}, endPass: {}, endPassSrn: {}, packed: {}, keys: {} };
  readTab_(CFG.TABS.HOURLY_LOG).forEach(function(r) {
    if (str_(r.date) < CFG.APP_START_DATE) return;
    if (excludeKey && hourlyKey_(r) === excludeKey) return;
    var t = str_(r.type), dept = str_(r.dept), srn = str_(r.srn), d = str_(r.date);
    if (t === 'STITCH') { addTo_(out.stitched, k2_(dept, srn), r.qty); out.keys['S|' + k2_(dept, srn) + '|' + d] = 1; }
    else if (t === 'ENDLINE') {
      addTo_(out.endChecked, k2_(dept, srn), r.checked);
      addTo_(out.endPass, k2_(dept, srn), r.pass);
      addTo_(out.endPassSrn, srn, r.pass);
      out.keys['E|' + k2_(dept, srn) + '|' + d] = 1;
    } else if (t === 'PACKING') { addTo_(out.packed, srn, r.qty); out.keys['P|' + srn + '|' + d] = 1; }
  });
  if (!excludeKey) cachePutBig_('app_agg', out, 120);
  return out;
}
function invalidateAppAgg_() { cacheDelBig_('app_agg'); }

function hourlyKey_(r) { return [str_(r.date), str_(r.factory), str_(r.type), str_(r.dept), str_(r.srn)].join('|'); }

function mergeAgg_(a, b) {
  var out = {};
  Object.keys(a).forEach(function(k) { out[k] = {}; Object.keys(a[k]).forEach(function(x) { out[k][x] = a[k][x]; }); });
  Object.keys(b).forEach(function(k) { if (!out[k]) out[k] = {}; Object.keys(b[k]).forEach(function(x) { addTo_(out[k], x, b[k][x]); }); });
  return out;
}

function ledger_(excludeKey) {
  var H = historyAgg_(), A = appAgg_(excludeKey), keys = A.keys || {};
  var NUM = ['stitched', 'endChecked', 'endPass', 'endPassSrn', 'packed'];
  var hb = {}, ab = {}; NUM.forEach(function(f) { hb[f] = H[f] || {}; ab[f] = A[f] || {}; });
  var L = mergeAgg_(hb, ab);
  var late = H.late || { stitched: {}, endChecked: {}, endPass: {}, packed: {} };
  Object.keys(late.stitched).forEach(function(k) { if (keys['S|' + k]) return; var p = k.split('|'); addTo_(L.stitched, k2_(p[0], p[1]), late.stitched[k]); });
  Object.keys(late.endChecked).forEach(function(k) { if (keys['E|' + k]) return; var p = k.split('|'); addTo_(L.endChecked, k2_(p[0], p[1]), late.endChecked[k]); });
  Object.keys(late.endPass).forEach(function(k) { if (keys['E|' + k]) return; var p = k.split('|'); addTo_(L.endPass, k2_(p[0], p[1]), late.endPass[k]); addTo_(L.endPassSrn, p[1], late.endPass[k]); });
  Object.keys(late.packed).forEach(function(k) { if (keys['P|' + k]) return; var p = k.split('|'); addTo_(L.packed, p[0], late.packed[k]); });
  var ld = loadingAgg_();
  L.loaded = ld.loaded; L.loadedSrn = ld.loadedSrn; L.srnInfo = ld.srnInfo; L.deptSrns = ld.deptSrns; L.lastLoad = ld.lastLoad || {};
  return L;
}

// Chain check for adding `add` units of `type` at (dept, srn). Returns { ok, level, msg, limit, used }.
function chainCheck_(L, type, dept, srn, add) {
  var used, limit, what;
  if (type === 'STITCH') {
    limit = num_(L.loaded[k2_(dept, srn)]); used = num_(L.stitched[k2_(dept, srn)]);
    what = 'Loading (' + dept + ' / ' + srn + ')';
    if (!limit) return { ok: false, level: 'block', msg: srn + ' ki loading is line par nahi mili — loading sheet check karo', limit: 0, used: used };
  } else if (type === 'ENDLINE') {
    // hourly endline is never blocked (user decision 2026-09-05): mismatches show in PMS / review instead
    limit = num_(L.stitched[k2_(dept, srn)]); used = num_(L.endChecked[k2_(dept, srn)]);
    var over = used + num_(add) - limit;
    return { ok: true, level: over > 0 ? 'warn' : '', msg: over > 0 ? 'Endline stitching (' + limit + ') se ' + over + ' zyada' : '', limit: limit, used: used, balance: limit - used - num_(add) };
  } else if (type === 'PACKING') {
    // packing is never blocked either; PMS shows the mismatch
    limit = num_(L.endPassSrn[srn]); used = num_(L.packed[srn]);
    var overP = used + num_(add) - limit;
    return { ok: true, level: !limit ? 'warn' : overP > 0 ? 'warn' : '', msg: !limit ? srn + ' ka endline data nahi hai' : overP > 0 ? 'Packing endline pass (' + limit + ') se ' + overP + ' zyada' : '', limit: limit, used: used, balance: limit ? limit - used - num_(add) : null };
  } else return { ok: true };
  if (used + num_(add) > limit) {
    var left = Math.max(0, limit - used);
    return { ok: false, level: 'block', limit: limit, used: used,
      msg: srn + ' ki loading ' + limit + ' hai, ' + used + ' ban chuka — ab sirf ' + left + ' aur ho sakta hai' };
  }
  return { ok: true, limit: limit, used: used, balance: limit - used - num_(add) };
}

// ---------- API ----------

// { factory, dept, type }  ->  SRN options with balances for that dept/type
function ordersActive_(req, user) {
  var dept = str_(req.dept), type = str_(req.type) || 'STITCH', factory = str_(req.factory);
  var L = ledger_();
  var list = [];
  if (type === 'PACKING') {
    var seen = {};
    [L.srnInfo, L.endPassSrn, L.packed].forEach(function(m) { Object.keys(m || {}).forEach(function(k) { seen[k] = true; }); });
    Object.keys(seen).forEach(function(srn) {
      if (!/^SRN/i.test(srn)) return;
      var pass = num_(L.endPassSrn[srn]), packed = num_(L.packed[srn]);
      var info = L.srnInfo[srn] || {};
      list.push({ srn: srn, item: info.item || '', buyer: info.buyer || '', limit: pass, used: packed, balance: pass ? pass - packed : null, endline: pass > 0 });
    });
    list.sort(function(a, b) { return b.srn.localeCompare(a.srn); }); // newest SRN first
    return { ok: true, srns: list, all: true };
  } else {
    var srns = L.deptSrns[dept] || {};
    Object.keys(srns).forEach(function(srn) {
      var loaded = num_(L.loaded[k2_(dept, srn)]), stitched = num_(L.stitched[k2_(dept, srn)]);
      var checked = num_(L.endChecked[k2_(dept, srn)]);
      var info = L.srnInfo[srn] || {};
      var limit = type === 'STITCH' ? loaded : stitched;
      var used = type === 'STITCH' ? stitched : checked;
      list.push({ srn: srn, item: info.item || '', loaded: loaded, stitched: stitched, checked: checked,
                  limit: limit, used: used, balance: limit - used });
    });
  }
  list.sort(function(a, b) { return b.balance - a.balance || a.srn.localeCompare(b.srn); });
  return { ok: true, srns: list };
}

function ordersRefresh_(req, user) {
  cacheDelBig_('loading_agg'); cacheDelBig_('hist_agg'); cacheDelBig_('hist_agg2'); cacheDelBig_('app_agg');
  var L = loadingAgg_();
  return { ok: true, srns: Object.keys(L.loadedSrn).length };
}
