// Import.js

var MASTER_SHEET_NAME = 'MASTER DATA';

var MASTER_PUSH = [
  { col: 1, sheet: 'FAC666-Final Attendance',       width: 6,  dataRow: 2 },
  { col: 2, sheet: 'FAC666 & FAC117-OT Attendance', width: 8,  dataRow: 2 },
  { col: 3, sheet: 'FAC117-Final Attendance',       width: 7,  dataRow: 2 },
  { col: 4, sheet: 'Stitching Data',                width: 16, dataRow: 3 },
  { col: 5, sheet: 'FAC117 STITCHING DATA',         width: 16, dataRow: 3 },
  { col: 6, sheet: 'Packing Data',                  width: 22, dataRow: 2 },
  { col: 7, sheet: 'END LINE DATA',                 width: 12, dataRow: 2 },
  { col: 8, sheet: 'Loading Data',                  width: 12, dataRow: 2 },
  { col: 9, sheet: 'All order',                     width: 27, dataRow: 2 }
];

var IMPORT_JOBS = [
  { srcKey: 'ATT', srcSheet: ' karigar att_666', srcRow: 13939, srcCol: 3, cols: 6, tgt: 'FAC666-Final Attendance', tgtCol: 1 },
  { srcKey: 'ATT', srcSheet: 'OT att', srcRow: 8274, srcCol: 3, cols: 8, tgt: 'FAC666 & FAC117-OT Attendance', tgtCol: 1 },
  { srcKey: 'ATT', srcSheet: '117', srcRow: 2227, srcCol: 3, cols: 7, tgt: 'FAC117-Final Attendance', tgtCol: 1 },
  { srcKey: 'ATT', srcSheet: 'Data', srcRow: 100, srcCol: 1, cols: 27, tgt: 'Stitching Data', tgtCol: 1, pick: [1,2,3,4,5,6,7,8,9,10,11,23,24,25,26,27] },
  { srcKey: 'STITCH117', srcSheet: 'FAC117-Stitching Output', srcRow: 2, srcCol: 1, cols: 16, tgt: 'FAC117 STITCHING DATA', tgtCol: 1 },
  { srcKey: 'PACKING', srcSheet: 'Finishing_Res', srcRow: 100, srcCol: 2, cols: 22, tgt: 'Packing Data', tgtCol: 1 },
  { srcKey: 'ENDLINE', srcSheet: 'Quality Endline data', srcRow: 3, srcCol: 1, cols: 12, tgt: 'END LINE DATA', tgtCol: 1 },
  { srcKey: 'LOADING', srcSheet: 'loading_chalaan', srcRow: 10, srcCol: 1, cols: 12, tgt: 'Loading Data', tgtCol: 1 },
  { srcKey: 'ALLORDER', srcSheet: 'All Orders', srcRow: 700, srcCol: 1, cols: 27, tgt: 'All order', tgtCol: 1 },
  { srcKey: 'COST', srcSheet: 'COST', srcRow: 2, srcCol: 1, cols: 6, pick: [1, 4, 5, 6], sheetOnly: { sheet: 'VALIDATION', row: 3, col: 15 } }
];

function colLetter_(n) {
  var s = '';
  while (n > 0) {
    var r = (n - 1) % 26;
    s = String.fromCharCode(65 + r) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

function a1_(sheet, row, col, width, endRow) {
  var c1 = colLetter_(col);
  var c2 = colLetter_(col + width - 1);
  return "'" + String(sheet).replace(/'/g, "''") + "'!" + c1 + row + ':' + c2 + (endRow || '');
}

function padRow_(r, w) {
  var out = (r || []).slice(0, w);
  while (out.length < w) out.push('');
  for (var i = 0; i < out.length; i++) if (out[i] === null || out[i] === undefined) out[i] = '';
  return out;
}

function isBlankRow_(r) {
  for (var i = 0; i < r.length; i++) {
    var v = r[i];
    if (v !== '' && v !== null && v !== undefined) return false;
  }
  return true;
}

function mdCell_(v) {
  if (v === null || v === undefined) return '';
  if (typeof v === 'number' || typeof v === 'boolean') return v;
  return String(v).trim();
}

function srcId_(key) {
  if (typeof SOURCE_IDS === 'object' && SOURCE_IDS && SOURCE_IDS[key]) return SOURCE_IDS[key];
  var p = PropertiesService.getScriptProperties().getProperty('SRC_' + key);
  if (p) return p;
  throw new Error('Source id missing for ' + key + ' — gas/Sources.js ya Script Property SRC_' + key + ' set karo');
}

function fetchAll_() {
  var bySrc = {};
  IMPORT_JOBS.forEach(function(j, i) {
    var id = srcId_(j.srcKey);
    if (!bySrc[id]) bySrc[id] = [];
    bySrc[id].push({ i: i, range: a1_(j.srcSheet, j.srcRow, j.srcCol, j.cols) });
  });

  var result = {};
  Object.keys(bySrc).forEach(function(id) {
    var list = bySrc[id];
    try {
      var res = Sheets.Spreadsheets.Values.batchGet(id, {
        ranges: list.map(function(x) { return x.range; }),
        valueRenderOption: 'UNFORMATTED_VALUE',
        dateTimeRenderOption: 'FORMATTED_STRING'
      });
      (res.valueRanges || []).forEach(function(vr, k) {
        result[list[k].i] = vr.values || [];
      });
    } catch (e) {
      list.forEach(function(x) { result[x.i] = null; });
    }
  });
  return result;
}

function shapeJob_(job, raw) {
  var w = job.pick && job.pick.length ? job.pick.length : job.cols;
  var out = [];
  for (var i = 0; i < raw.length; i++) {
    var row = padRow_(raw[i], job.cols);
    if (job.pick && job.pick.length) {
      var sel = [];
      for (var j = 0; j < job.pick.length; j++) sel.push(row[job.pick[j] - 1]);
      row = sel;
    }
    out.push(padRow_(row, w));
  }
  while (out.length && isBlankRow_(out[out.length - 1])) out.pop();
  return { values: out, width: w };
}

function runAllImport() {
  var t0 = new Date().getTime();
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var ssId = ss.getId();
  var log = [];

  var raws = fetchAll_();
  log.push('SOURCE FETCH: ' + (new Date().getTime() - t0) + ' ms');

  var grid = {};
  MASTER_PUSH.forEach(function(m) { grid[m.sheet] = { width: m.width, rows: [] }; });

  var sheetWrites = [];

  IMPORT_JOBS.forEach(function(job, i) {
    var raw = raws[i];
    if (raw === null || raw === undefined) { log.push('READ FAIL: ' + job.srcSheet); return; }
    var got = shapeJob_(job, raw);

    if (job.sheetOnly) {
      if (got.values.length) {
        sheetWrites.push({
          range: a1_(job.sheetOnly.sheet, job.sheetOnly.row, job.sheetOnly.col, got.width, job.sheetOnly.row + got.values.length - 1),
          values: got.values
        });
      }
      log.push(job.sheetOnly.sheet + ' <- ' + job.srcSheet + ' : ' + got.values.length + ' rows');
      return;
    }

    var g = grid[job.tgt];
    if (!g) { log.push('NO MASTER COLUMN FOR: ' + job.tgt); return; }
    var off = job.tgtCol - 1;
    for (var r = 0; r < got.values.length; r++) {
      if (!g.rows[r]) g.rows[r] = new Array(g.width).fill('');
      for (var c = 0; c < got.width; c++) {
        if (off + c < g.width) g.rows[r][off + c] = got.values[r][c];
      }
    }
    log.push(job.tgt + ' <- ' + job.srcSheet + ' : ' + got.values.length + ' rows');
  });

  if (sheetWrites.length) {
    try { Sheets.Spreadsheets.Values.batchUpdate({ valueInputOption: 'USER_ENTERED', data: sheetWrites }, ssId); }
    catch (e) { log.push('SHEET WRITE FAIL: ' + e); }
  }

  log.push('');
  log.push(writeMaster_(ss, ssId, grid));
  log.push('');
  log.push('TOTAL: ' + (new Date().getTime() - t0) + ' ms');

  var out = log.join('\n');
  Logger.log(out);
  return out;
}

function writeMaster_(ss, ssId, grid) {
  var t0 = new Date().getTime();
  var md = ss.getSheetByName(MASTER_SHEET_NAME);
  if (!md) md = ss.insertSheet(MASTER_SHEET_NAME);

  var selfNeed = [];
  MASTER_PUSH.forEach(function(m) {
    var g = grid ? grid[m.sheet] : null;
    if (!g || !g.rows.length) {
      if (ss.getSheetByName(m.sheet)) selfNeed.push(m);
    }
  });

  if (selfNeed.length) {
    try {
      var sr = Sheets.Spreadsheets.Values.batchGet(ssId, {
        ranges: selfNeed.map(function(m) { return a1_(m.sheet, m.dataRow, 1, m.width); }),
        valueRenderOption: 'UNFORMATTED_VALUE',
        dateTimeRenderOption: 'FORMATTED_STRING'
      });
      (sr.valueRanges || []).forEach(function(vr, i) {
        var m = selfNeed[i];
        if (!grid[m.sheet]) grid[m.sheet] = { width: m.width, rows: [] };
        grid[m.sheet].rows = vr.values || [];
      });
    } catch (e) {}
  }

  var log = [];
  var data = [];
  var clears = [];
  var maxNeed = 0;
  var needs = {};

  MASTER_PUSH.forEach(function(m) {
    var rows = (grid[m.sheet] && grid[m.sheet].rows) ? grid[m.sheet].rows : [];
    if (!rows.length) {
      log.push(m.sheet + ' : no source (job or sheet) \u2014 column left untouched');
      needs[m.col] = 0;
      return;
    }
    var col = [];
    for (var i = 0; i < rows.length; i++) {
      var r = padRow_(rows[i], m.width).map(mdCell_);
      var blank = true;
      for (var j = 0; j < r.length; j++) { if (r[j] !== '' && r[j] !== 0) { blank = false; break; } }
      if (blank) continue;
      col.push([JSON.stringify(r)]);
    }
    var need = col.length + 2;
    needs[m.col] = need;
    if (need > maxNeed) maxNeed = need;

    data.push({ range: a1_(MASTER_SHEET_NAME, 1, m.col, 1, 1), values: [[m.sheet]] });
    if (col.length) data.push({ range: a1_(MASTER_SHEET_NAME, 3, m.col, 1, need), values: col });
    log.push(m.sheet + ' : ' + col.length + ' rows');
  });

  var mdRows = md.getMaxRows();
  if (maxNeed > mdRows) {
    md.insertRowsAfter(mdRows, maxNeed - mdRows + 500);
    mdRows = md.getMaxRows();
  }

  MASTER_PUSH.forEach(function(m) {
    var need = needs[m.col];
    if (!need) return;
    if (need < mdRows) clears.push(a1_(MASTER_SHEET_NAME, need + 1, m.col, 1, mdRows));
  });

  var lastCol = md.getLastColumn();
  if (lastCol > MASTER_PUSH.length) {
    clears.push(a1_(MASTER_SHEET_NAME, 1, MASTER_PUSH.length + 1, lastCol - MASTER_PUSH.length, mdRows));
  }

  if (clears.length) {
    try { Sheets.Spreadsheets.Values.batchClear({ ranges: clears }, ssId); } catch (e) {}
  }
  if (data.length) {
    Sheets.Spreadsheets.Values.batchUpdate({ valueInputOption: 'RAW', data: data }, ssId);
  }

  log.push('MASTER DATA WRITE: ' + (new Date().getTime() - t0) + ' ms');
  return log.join('\n');
}

function rebuildMasterOnly() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var out = writeMaster_(ss, ss.getId(), {});
  Logger.log(out);
  return out;
}

function setMasterHeaders() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var md = ss.getSheetByName(MASTER_SHEET_NAME);
  if (!md) return 'MASTER DATA not found';
  var data = [];
  MASTER_PUSH.forEach(function(m) {
    var sh = ss.getSheetByName(m.sheet);
    var head = [];
    if (sh) {
      var hr = Math.max(1, m.dataRow - 1);
      head = padRow_(sh.getRange(hr, 1, 1, m.width).getValues()[0], m.width).map(mdCell_);
    }
    data.push({ range: a1_(MASTER_SHEET_NAME, 2, m.col, 1, 2), values: [[JSON.stringify(head)]] });
  });
  Sheets.Spreadsheets.Values.batchUpdate({ valueInputOption: 'RAW', data: data }, ss.getId());
  return 'Headers written for ' + data.length + ' columns';
}

function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('SG Data')
    .addItem('Refresh All Data Now', 'runAllImport')
    .addSeparator()
    .addItem('Rebuild MASTER DATA only', 'rebuildMasterOnly')
    .addItem('Check import speed', 'diagImportSpeed')
    .addToUi();
}

function diagImportSpeed() {
  var t0 = new Date().getTime();
  var raws = fetchAll_();
  var lines = ['SOURCE\tROWS'];
  IMPORT_JOBS.forEach(function(job, i) {
    lines.push(job.srcSheet + '\t' + (raws[i] === null || raws[i] === undefined ? 'FAIL' : raws[i].length));
  });
  lines.push('FETCH ALL\t' + (new Date().getTime() - t0) + ' ms');
  var out = lines.join('\n');
  Logger.log(out);
  return out;
}
