// Summary.js — 'APP SUMMARY' tab (app spreadsheet): formulas over MASTER DATA give the phone everything it shows, so the
// app reads this one small tab instead of the whole MASTER DATA history (that took 40+ s to read and parse).
//   A SRN · B Line · C Output · D Remaining (loading - output) · E Loading          — one row per SRN + line it is loaded on
//   F SRN · G Loading · H Stitching · I Endline pass · J Pack · K Unloading · L Shipped · M Shipped status · N Order qty
//   · O Factory · P Style                                                            — PMS, one row per SRN
//   R Type (S stitching / E endline / P pack) · S Line · T SRN · U Date · V Qty · W Shift — sheet rows since the app
//     started (CFG.APP_START_DATE): a day the app also has for that line + SRN counts once (the app's rows), as before
//   AA… helper columns: each MASTER DATA cell (a JSON row) split into the fields used above
// MASTER DATA columns: D Stitching · E 117 stitching · F Packing · G Endline · H Loading · I All order · J Unloading.
// setupAppSummary() writes / re-writes the formulas (safe to run again).

var SUMMARY_TAB = 'APP SUMMARY';
var LITE_MEMO_ = null;

// n-th field (0-based) of the JSON row in each cell of rng, as text
function sumFx_(rng, n) {
  return 'REGEXREPLACE(IFERROR(REGEXEXTRACT(' + rng + ',"^\\[(?:(?:""(?:[^""\\\\]|\\\\.)*""|[^,\\]]*),){' + n + '}(""(?:[^""\\\\]|\\\\.)*""|[^,\\]]*)"),""),"^""|""$","")';
}
function sumNum_(rng, n) { return 'IFERROR(VALUE(' + sumFx_(rng, n) + '),0)'; }
function sumCol_(src, body) { return '=ARRAYFORMULA(IF(' + src + '="","",' + body + '))'; }

function setupAppSummary() {
  var ss = getSS_(), sh = ss.getSheetByName(SUMMARY_TAB) || ss.insertSheet(SUMMARY_TAB);
  var M = "'" + MASTER_SHEET_NAME + "'!", D = M + 'D3:D', E = M + 'E3:E', F = M + 'F3:F', G = M + 'G3:G', H = M + 'H3:H', I = M + 'I3:I', J = M + 'J3:J';
  sh.clear();
  if (sh.getMaxColumns() < 48) sh.insertColumnsAfter(sh.getMaxColumns(), 48 - sh.getMaxColumns());
  var f = {};
  // ---- helpers (row-aligned with MASTER DATA rows 3…)
  f.AA = sumCol_(H, 'UPPER(TRIM(' + sumFx_(H, 5) + '))');                 // loading SRN
  f.AB = sumCol_(H, 'TRIM(' + sumFx_(H, 10) + ')');                       // loading party (line code / contractor)
  f.AC = sumCol_(H, sumNum_(H, 7));                                       // loading qty
  f.AD = sumCol_(H, 'REGEXREPLACE(' + sumFx_(H, 3) + ',"^FAC","")');      // factory
  f.AE = sumCol_(H, sumFx_(H, 4));                                        // label "SRN - buyer - item (n pcs)"
  f.AF = sumCol_(D, 'UPPER(TRIM(' + sumFx_(D, 3) + '))&"|"&TRIM(' + sumFx_(D, 2) + ')');   // stitching SRN|line
  f.AG = sumCol_(D, 'UPPER(TRIM(' + sumFx_(D, 3) + '))');
  f.AH = sumCol_(D, sumNum_(D, 8));
  f.AI = sumCol_(E, 'UPPER(TRIM(' + sumFx_(E, 4) + '))&"|"&TRIM(' + sumFx_(E, 3) + ')');   // 117 stitching SRN|line
  f.AJ = sumCol_(E, 'UPPER(TRIM(' + sumFx_(E, 4) + '))');
  f.AK = sumCol_(E, sumNum_(E, 8));
  f.AL = sumCol_(G, 'UPPER(TRIM(' + sumFx_(G, 3) + '))');                 // endline SRN
  f.AM = sumCol_(G, sumNum_(G, 10));                                      // endline pass
  f.AN = sumCol_(F, 'UPPER(TRIM(' + sumFx_(F, 0) + '))');                 // packing SRN
  f.AO = sumCol_(F, sumNum_(F, 3));                                       // packed qty
  f.AP = sumCol_(J, 'UPPER(TRIM(' + sumFx_(J, 4) + '))');                 // unloading SRN
  f.AQ = sumCol_(J, 'IF(REGEXMATCH(LOWER(' + sumFx_(J, 15) + '),"reject|cancel"),0,IF(' + sumNum_(J, 17) + '>0,' + sumNum_(J, 17) + ',' + sumNum_(J, 10) + '))');   // approved qty, else challan qty; rejected = 0
  f.AR = sumCol_(I, 'UPPER(TRIM(' + sumFx_(I, 2) + '))');                 // order SRN
  f.AS = sumCol_(I, sumNum_(I, 23));                                      // shipped qty
  f.AT = sumCol_(I, sumFx_(I, 19));                                       // shipped status
  f.AU = sumCol_(I, sumNum_(I, 6));                                       // shipping (order) qty
  f.AV = sumCol_(I, sumFx_(I, 12));                                       // style
  f.AW = '=IFERROR(QUERY({AA3:AA,AB3:AB,AC3:AC},"select Col1, Col2, sum(Col3) where Col1 starts with \'SRN\' and Col2 <> \'\' group by Col1, Col2 order by Col1, Col2 label sum(Col3) \'\'",0),"")';
  // ---- line-wise output: SRN · line · output · remaining · loading
  f.A = '=ARRAYFORMULA(IF(AW3:AW="","",AW3:AW))';
  f.B = '=ARRAYFORMULA(IF(AW3:AW="","",AX3:AX))';
  f.C = '=ARRAYFORMULA(IF(A3:A="","",SUMIF(AF3:AF,A3:A&"|"&B3:B,AH3:AH)+SUMIF(AI3:AI,A3:A&"|"&B3:B,AK3:AK)))';
  f.D = '=ARRAYFORMULA(IF(A3:A="","",E3:E-C3:C))';
  f.E = '=ARRAYFORMULA(IF(A3:A="","",AY3:AY))';
  // ---- PMS per SRN
  f.F = '=IFERROR(SORT(UNIQUE(FILTER(AA3:AA,LEFT(AA3:AA,3)="SRN")),1,FALSE),"")';
  f.G = '=ARRAYFORMULA(IF(F3:F="","",SUMIF(AA3:AA,F3:F,AC3:AC)))';
  f.H = '=ARRAYFORMULA(IF(F3:F="","",SUMIF(AG3:AG,F3:F,AH3:AH)+SUMIF(AJ3:AJ,F3:F,AK3:AK)))';
  f.I = '=ARRAYFORMULA(IF(F3:F="","",SUMIF(AL3:AL,F3:F,AM3:AM)))';
  f.J = '=ARRAYFORMULA(IF(F3:F="","",SUMIF(AN3:AN,F3:F,AO3:AO)))';
  f.K = '=ARRAYFORMULA(IF(F3:F="","",SUMIF(AP3:AP,F3:F,AQ3:AQ)))';
  f.L = '=ARRAYFORMULA(IF(F3:F="","",SUMIF(AR3:AR,F3:F,AS3:AS)))';
  f.M = '=ARRAYFORMULA(IF(F3:F="","",IFERROR(VLOOKUP(F3:F,{AR3:AR,AT3:AT},2,FALSE),"")))';
  f.N = '=ARRAYFORMULA(IF(F3:F="","",SUMIF(AR3:AR,F3:F,AU3:AU)))';
  f.O = '=ARRAYFORMULA(IF(F3:F="","",IFERROR(VLOOKUP(F3:F,{AA3:AA,AD3:AD},2,FALSE),"")))';
  f.P = '=ARRAYFORMULA(IF(F3:F="","",IFERROR(VLOOKUP(F3:F,{AR3:AR,AV3:AV},2,FALSE),IFERROR(VLOOKUP(F3:F,{AA3:AA,AE3:AE},2,FALSE),""))))';
  // ---- sheet rows since the app started: S stitching (D, E) · E endline pass (G) · P packing (F)
  var p = CFG.APP_START_DATE.split('-'), since = 'DATE(' + (+p[0]) + ',' + (+p[1]) + ',' + (+p[2]) + ')';
  var late = function(src, type, dI, dAlt, deptI, srnI, qtyI, shiftI) {
    var dTxt = dAlt === null ? sumFx_('x', dI) : 'IF(' + sumFx_('x', dI) + '="",' + sumFx_('x', dAlt) + ',' + sumFx_('x', dI) + ')';
    return 'LET(x,FILTER(' + src + ',' + src + '<>""),dt,IFERROR(DATEVALUE(' + dTxt + '),0),IFERROR(FILTER(HSTACK(IF(dt,"' + type + '"),' +
      (deptI === null ? 'IF(dt,"")' : 'TRIM(' + sumFx_('x', deptI) + ')') + ',UPPER(TRIM(' + sumFx_('x', srnI) + ')),TEXT(dt,"yyyy-mm-dd"),' + sumNum_('x', qtyI) + ',' +
      (shiftI === null ? 'IF(dt,"")' : sumFx_('x', shiftI)) + '),dt>=' + since + '),{"","","","","",""}))';
  };
  f.R = '=ARRAYFORMULA(VSTACK(' + late(D, 'S', 0, null, 2, 3, 8, 5) + ',' + late(E, 'S', 0, null, 3, 4, 8, 5) + ',' + late(G, 'E', 2, 0, 5, 3, 10, null) + ',' + late(F, 'P', 1, null, null, 0, 3, null) + '))';
  var head = { A: 'SRN', B: 'Line', C: 'Output', D: 'Remaining', E: 'Loading', F: 'SRN', G: 'Loading', H: 'Stitching', I: 'Endline pass', J: 'Pack', K: 'Unloading', L: 'Shipped', M: 'Shipped status', N: 'Order qty', O: 'Factory', P: 'Style',
               R: 'Type', S: 'Line', T: 'SRN', U: 'Date', V: 'Qty', W: 'Shift', AA: 'ld SRN', AB: 'ld line', AC: 'ld qty', AD: 'ld fac', AE: 'ld label', AF: 'st key', AG: 'st SRN', AH: 'st qty', AI: '117 key', AJ: '117 SRN', AK: '117 qty',
               AL: 'end SRN', AM: 'end pass', AN: 'pack SRN', AO: 'pack qty', AP: 'unl SRN', AQ: 'unl qty', AR: 'ord SRN', AS: 'shipped', AT: 'status', AU: 'ship qty', AV: 'style', AW: 'q SRN', AX: 'q line', AY: 'q loading' };
  // row 1: titles + how many rows each block has (the app reads exactly that many rows)
  sh.getRange('A1').setValue('Line-wise output (from loading)'); sh.getRange('F1').setValue('PMS (per SRN)'); sh.getRange('R1').setValue('Sheet rows since app start');
  sh.getRange('C1').setFormula('=COUNTIF(A3:A,"SRN*")'); sh.getRange('H1').setFormula('=COUNTIF(F3:F,"SRN*")'); sh.getRange('V1').setFormula('=COUNTA(R3:R)+4'); sh.getRange('AA1').setValue('Helpers — fields from MASTER DATA (do not edit)');
  Object.keys(head).forEach(function(c) { sh.getRange(c + '2').setValue(head[c]); });
  Object.keys(f).forEach(function(c) { sh.getRange(c + '3').setFormula(f[c]); });
  sh.getRange('1:2').setFontWeight('bold'); sh.setFrozenRows(2);
  cacheDelBig_('app_summary');
  return 'APP SUMMARY formulas written (' + Object.keys(f).length + ')';
}

// The tab as the phone needs it. Cached (stale-while-revalidate, 10 min); m.warm refreshes it.
function summaryAgg_() {
  var hit = cacheGetBig_('app_summary');
  if (hit) return hit;
  var sh = getSS_().getSheetByName(SUMMARY_TAB), out = { lines: [], pms: [], late: [] };
  if (sh) {
    // only the filled rows of each block (the helper formulas make the tab ~20 000 rows long)
    var n = sh.getRange('A1:V1').getValues()[0], nl = num_(n[2]), np = num_(n[7]), nr = num_(n[21]);
    if (nl) sh.getRange(3, 1, nl, 5).getValues().forEach(function(r) { if (/^SRN/i.test(str_(r[0])) && str_(r[1])) out.lines.push([str_(r[0]).toUpperCase(), str_(r[1]), num_(r[2]), num_(r[4])]); });
    if (np) sh.getRange(3, 6, np, 11).getValues().forEach(function(r) { if (/^SRN/i.test(str_(r[0]))) out.pms.push([str_(r[0]).toUpperCase(), num_(r[1]), num_(r[2]), num_(r[3]), num_(r[4]), num_(r[5]), num_(r[6]), str_(r[7]), num_(r[8]), str_(r[9]), str_(r[10])]); });
    if (nr) sh.getRange(3, 18, nr, 6).getDisplayValues().forEach(function(r) { if (/^[SEP]$/.test(str_(r[0])) && str_(r[3])) out.late.push([str_(r[0]), str_(r[1]), str_(r[2]).toUpperCase(), str_(r[3]), num_(r[4]), /OT/i.test(str_(r[5])) ? 'OT' : 'Final']); });
  }
  cachePutBig_('app_summary', out, 600);
  return out;
}

// Same shape as ledger_() (what the phone screens and the output checks use), built from APP SUMMARY + the app's own
// output that is not in the main sheet yet (rows of days not 'Sent').
function ledgerLite_() {
  if (LEDGER_MEMO_ON_ && LITE_MEMO_) return LITE_MEMO_;
  var S = summaryAgg_(), L = { loaded: {}, loadedSrn: {}, deptSrns: {}, stitched: {}, endChecked: {}, endPass: {}, endPassSrn: {}, packed: {}, srnInfo: {}, lastLoad: {}, pms: {}, recent: [] };
  S.lines.forEach(function(x) {
    var srn = x[0], line = x[1];
    L.loaded[k2_(line, srn)] = x[3]; L.stitched[k2_(line, srn)] = x[2];
    (L.deptSrns[line] = L.deptSrns[line] || {})[srn] = true;
  });
  S.pms.forEach(function(p) {
    var srn = p[0];
    L.loadedSrn[srn] = p[1]; L.endPassSrn[srn] = p[3]; L.packed[srn] = p[4];
    L.pms[srn] = { stitched: p[2], unloaded: p[5], shipped: p[6], status: p[7], order: p[8] };
    var m = str_(p[10]).match(/^\S+\s*-\s*(.*?)\s*-\s*(.*?)\s*\((\d+(?:\.\d+)?)\s*pcs\)\s*$/i);
    L.srnInfo[srn] = { buyer: m ? m[1] : '', item: m ? m[2] : p[10], orderQty: p[8], factory: p[9], line: '' };
  });
  // same rule as ledger_(): a day the app has for that line + SRN counts the app's rows, not the sheet's rows of that day
  var A = appAgg_(), keys = {};
  Object.keys(A.keys || {}).forEach(function(k) { var p = k.split('|'); if (p[0] === 'P') keys['P||' + p[1].toUpperCase() + '|' + p[2]] = 1; else keys[p[0] + '|' + p[1] + '|' + p[2].toUpperCase() + '|' + p[3]] = 1; });
  S.late.forEach(function(x) {   // [type, line, srn, date, qty, shift]
    var t = x[0], line = x[1], srn = x[2], d = x[3], q = x[4];
    if (t === 'S' && d >= PHONE_FROM) L.recent.push([d, line, x[5]]);
    if (!keys[t + '|' + line + '|' + srn + '|' + d]) return;
    if (t === 'S') { addTo_(L.stitched, k2_(line, srn), -q); if (L.pms[srn]) L.pms[srn].stitched -= q; }
    else if (t === 'E') { addTo_(L.endPassSrn, srn, -q); }
    else if (t === 'P') addTo_(L.packed, srn, -q);
  });
  var up = function(k) { var i = k.lastIndexOf('|'); return k.slice(0, i + 1) + k.slice(i + 1).toUpperCase(); };
  Object.keys(A.stitched).forEach(function(k) { var srn = k.slice(k.lastIndexOf('|') + 1).toUpperCase(); addTo_(L.stitched, up(k), A.stitched[k]); if (L.pms[srn]) L.pms[srn].stitched += num_(A.stitched[k]); });
  Object.keys(A.endPassSrn).forEach(function(s) { addTo_(L.endPassSrn, s.toUpperCase(), A.endPassSrn[s]); });
  Object.keys(A.endPass).forEach(function(k) { addTo_(L.endPass, up(k), A.endPass[k]); });
  Object.keys(A.endChecked).forEach(function(k) { addTo_(L.endChecked, up(k), A.endChecked[k]); });
  Object.keys(A.packed).forEach(function(s) { addTo_(L.packed, s.toUpperCase(), A.packed[s]); });
  // loading straight from the loading sheet (fresh within minutes) — APP SUMMARY only has it after the next import
  var ld = loadingAgg_(), up2 = function(k) { var i = k.lastIndexOf('|'); return k.slice(0, i + 1) + k.slice(i + 1).toUpperCase(); };
  L.loaded = {}; L.loadedSrn = {}; L.deptSrns = {};
  Object.keys(ld.loaded || {}).forEach(function(k) { L.loaded[up2(k)] = ld.loaded[k]; });
  Object.keys(ld.loadedSrn || {}).forEach(function(s) { L.loadedSrn[s.toUpperCase()] = ld.loadedSrn[s]; });
  Object.keys(ld.deptSrns || {}).forEach(function(d) { L.deptSrns[d] = {}; Object.keys(ld.deptSrns[d]).forEach(function(s) { L.deptSrns[d][s.toUpperCase()] = true; }); });
  Object.keys(ld.srnInfo || {}).forEach(function(s) { var S2 = s.toUpperCase(), a = L.srnInfo[S2] || {}, b = ld.srnInfo[s];
    L.srnInfo[S2] = { buyer: a.buyer || b.buyer, item: a.item || b.item, orderQty: a.orderQty || b.orderQty, factory: a.factory || b.factory, line: b.line };
    if (!L.pms[S2]) L.pms[S2] = { stitched: 0, unloaded: 0, shipped: 0, status: '', order: b.orderQty || 0 }; });
  L.lastLoad = ld.lastLoad || {};
  if (LEDGER_MEMO_ON_) LITE_MEMO_ = L;
  return L;
}
