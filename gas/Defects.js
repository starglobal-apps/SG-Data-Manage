// Defects.js — endline / final defect master from the QMS spreadsheet ('Defect validation' sheet of the ENDLINE source):
//   A2:A  fixed endline defects (every SRN)      E2:F  SRN-wise endline defects      H2:I  SRN-wise final defects (later)
// Hourly endline rows store the chosen defects as JSON in HOURLY_LOG.defects: [{d: 'Stitch Open', n: 3}, ...]

var DEFECT_SHEET = 'Defect validation';

function defectsMaster_() {
  var hit = cacheGetBig_('defects_master');
  if (hit) return hit;
  var id = srcId_('ENDLINE');
  var res = Sheets.Spreadsheets.Values.get(id, "'" + DEFECT_SHEET + "'!A2:I", { valueRenderOption: 'FORMATTED_VALUE' });
  var out = { fixed: [], endline: {}, final: {} };
  var seenFixed = {};
  (res.values || []).forEach(function(r) {
    var f = str_(r[0]); if (f && !seenFixed[f]) { seenFixed[f] = 1; out.fixed.push(f); }
    var s1 = str_(r[4]).toUpperCase(), d1 = str_(r[5]);
    if (s1 && d1) { (out.endline[s1] = out.endline[s1] || []); if (out.endline[s1].indexOf(d1) < 0) out.endline[s1].push(d1); }
    var s2 = str_(r[7]).toUpperCase(), d2 = str_(r[8]);
    if (s2 && d2) { (out.final[s2] = out.final[s2] || []); if (out.final[s2].indexOf(d2) < 0) out.final[s2].push(d2); }
  });
  cachePutBig_('defects_master', out, 600);
  return out;
}

// {} -> whole master (small); the app filters per SRN
function defectsList_(req, user) {
  var m = defectsMaster_();
  return { ok: true, fixed: m.fixed, endline: m.endline, final: m.final };
}

// { srn, defect, kind: 'endline' | 'final' } -> appends to the SRN-wise list in the sheet
function defectsAdd_(req, user) {
  var srn = str_(req.srn).toUpperCase(), d = str_(req.defect), kind = str_(req.kind) || 'endline';
  if (!srn || !d) return fail_('VAL', 'SRN aur defect dono chahiye');
  var m = defectsMaster_(), list = (kind === 'final' ? m.final : m.endline)[srn] || [];
  var dup = m.fixed.concat(list).some(function(x) { return x.toLowerCase() === d.toLowerCase(); });
  if (dup) return { ok: true, existed: true };
  var range = kind === 'final' ? "'" + DEFECT_SHEET + "'!H2:I" : "'" + DEFECT_SHEET + "'!E2:F";
  Sheets.Spreadsheets.Values.append({ values: [[srn, d]] }, srcId_('ENDLINE'), range, { valueInputOption: 'RAW', insertDataOption: 'INSERT_ROWS' });
  cacheDelBig_('defects_master');
  audit_(user, 'defects.add', srn, { defect: d, kind: kind });
  return { ok: true };
}

// [{d, n}] -> cleaned list; total = sum of n
function cleanDefects_(v) {
  var arr = Array.isArray(v) ? v : parseJsonArr_(v), out = [], total = 0;
  arr.forEach(function(x) { var d = str_(x && x.d), n = num_(x && x.n); if (d && n > 0) { out.push({ d: d, n: n }); total += n; } });
  return { list: out, total: total };
}
