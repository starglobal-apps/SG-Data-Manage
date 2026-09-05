// Pms.js — production monitoring: per line x SRN, Loading vs Stitching vs Endline pass vs Packing.
// Rows for the user's own lines/floors (last N days of loading) or any SRN by number search.

function pmsRow_(L, stitchedSrn, dept, srn) {
  var k = k2_(dept, srn), info = L.srnInfo[srn] || {};
  return { dept: dept, srn: srn, item: info.item || '', buyer: info.buyer || '',
           loaded: num_(L.loaded[k]), stitched: num_(L.stitched[k]), endPass: num_(L.endPass[k]), endChecked: num_(L.endChecked[k]),
           loadedSrn: num_(L.loadedSrn[srn]), stitchedSrn: num_(stitchedSrn[srn]), endPassSrn: num_(L.endPassSrn[srn]), packed: num_(L.packed[srn]),
           lastLoad: L.lastLoad[k] || '' };
}

// { factory, days, q }  q = digits of a master SRN ("597") -> every variant on every line
function pmsGet_(req, user) {
  var factory = str_(req.factory), days = num_(req.days) || 50, q = str_(req.q).replace(/\D/g, '');
  var L = ledger_();
  var stitchedSrn = {};
  Object.keys(L.stitched).forEach(function(k) { addTo_(stitchedSrn, k.split('|')[1], L.stitched[k]); });
  var cutoff = fmtDate_(new Date(new Date().getTime() - days * 86400000));
  var rows = [];
  if (q) {
    Object.keys(L.loaded).forEach(function(k) {
      var p = k.split('|'); if (p[1].replace(/\D/g, '').indexOf(q) < 0) return;
      rows.push(pmsRow_(L, stitchedSrn, p[0], p[1]));
    });
    // SRNs known only from endline/packing history (no loading row)
    var seen = {}; rows.forEach(function(r) { seen[r.srn] = true; });
    Object.keys(L.endPassSrn).concat(Object.keys(L.packed)).forEach(function(srn) {
      if (seen[srn] || srn.replace(/\D/g, '').indexOf(q) < 0) return; seen[srn] = true;
      rows.push(pmsRow_(L, stitchedSrn, '', srn));
    });
  } else {
    var mine = writableDepts_(user, factory), myMap = {}; mine.forEach(function(d) { myMap[d.dept] = d.cat; });
    Object.keys(L.loaded).forEach(function(k) {
      var p = k.split('|'); if (!myMap[p[0]]) return;
      if ((L.lastLoad[k] || '') < cutoff) return;
      rows.push(pmsRow_(L, stitchedSrn, p[0], p[1]));
    });
    // packing floors: SRNs packed on that floor in the app era
    var packedHere = {};
    readTab_(CFG.TABS.HOURLY_LOG).forEach(function(r) {
      if (str_(r.type) !== 'PACKING' || !myMap[str_(r.dept)] || str_(r.date) < cutoff) return;
      addTo_(packedHere, k2_(str_(r.dept), str_(r.srn)), r.qty);
    });
    Object.keys(packedHere).forEach(function(k) {
      var p = k.split('|'), row = pmsRow_(L, stitchedSrn, p[0], p[1]);
      row.packedHere = num_(packedHere[k]); row.floor = true;
      rows.push(row);
    });
  }
  rows.sort(function(a, b) { return (b.lastLoad || '').localeCompare(a.lastLoad || '') || a.srn.localeCompare(b.srn); });
  return { ok: true, rows: rows, days: days, cutoff: cutoff };
}
