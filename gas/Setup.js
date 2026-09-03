// Setup.js — one-time setup: create app tabs, seed MASTERS from MASTER DATA, create the first admin user.
// Run setupAppSheets() from the Apps Script editor (or via the SG Data menu) once, then again anytime to add missing tabs.

function setupAppSheets() {
  var log = [];
  Object.keys(CFG.TABS).forEach(function(k) {
    var name = CFG.TABS[k];
    var existed = !!tab_(name, false);
    tab_(name, true);
    var added = existed ? ensureHeaders_(name) : [];
    log.push(name + (existed ? ' : exists' + (added.length ? ' (+' + added.join(',') + ')' : '') : ' : created'));
  });

  var users = readTab_(CFG.TABS.USERS);
  if (!users.length) {
    appendRows_(CFG.TABS.USERS, [{
      user_id: 'admin', name: 'Admin', pin: '1234', role: 'Admin', factory: '', depts: '', active: 'TRUE', created_at: nowStr_()
    }]);
    log.push('USERS : admin user created with PIN 1234 — change it in the USERS tab');
  }

  var masters = readTab_(CFG.TABS.MASTERS);
  if (!masters.length) {
    var seeded = seedMasters_();
    log.push('MASTERS : seeded ' + seeded + ' rows');
  } else {
    log.push('MASTERS : already has ' + masters.length + ' rows (not touched)');
  }

  var out = log.join('\n');
  Logger.log(out);
  return out;
}

// Pulls depts, lines and roles out of MASTER DATA (JSON-packed columns) so the app starts with real names.
function seedMasters_() {
  var ss = getSS_();
  var md = ss.getSheetByName(MASTER_SHEET_NAME);
  var rows = [];
  var add = function(type, key, value, factory, extra, active) {
    rows.push({ type: type, key: key, value: value || '', factory: factory || '', extra: extra || '', active: active === false ? 'FALSE' : 'TRUE' });
  };

  CFG.FACTORIES.forEach(function(f) { add('FACTORY', f, 'FAC' + f, f); });
  CFG.FLOORS.forEach(function(f) { add('FLOOR', f, f); });

  var roles = {}, depts = {}, lines = {}, lineFloor = {}, lineStaff = {};
  var cutoff = new Date(); cutoff.setDate(cutoff.getDate() - 90);
  CFG.DEFAULT_ROLES.forEach(function(r) { roles[r] = true; });

  if (md && md.getLastRow() >= 3) {
    var vals = md.getRange(3, 1, md.getLastRow() - 2, MASTER_PUSH.length).getValues();
    vals.forEach(function(row) {
      // col 1 = FAC666 attendance, col 3 = FAC117 attendance  ->  [date, factory, dept, role, hours, count]
      [0, 2].forEach(function(ci) {
        var a = parseJson_(row[ci]); if (!a) return;
        var d = parseDate_(a[0]), fac = str_(a[1]), dept = str_(a[2]), role = str_(a[3]);
        if (role) roles[role] = true;
        if (!dept) return;
        var k = fac + '|' + dept;
        if (!depts[k] || (d && depts[k] < d)) depts[k] = d || depts[k] || null;
      });
      // col 4 = Stitching Data -> [date, line, dept, srn, floor, ...] ; col 5 = FAC117 stitching -> [date, floor, line, dept, srn, ...]
      var s = parseJson_(row[3]);
      if (s && str_(s[1]) && str_(s[2])) {
        noteLine_(lines, '666', str_(s[1]), str_(s[2]), parseDate_(s[0]));
        noteLatest_(lineFloor, str_(s[2]), str_(s[4]), '', parseDate_(s[0]));
        noteLatest_(lineStaff, str_(s[2]), str_(s[9]), str_(s[10]), parseDate_(s[0]));
      }
      var s7 = parseJson_(row[4]);
      if (s7 && str_(s7[2]) && str_(s7[3])) {
        noteLine_(lines, '117', str_(s7[2]), str_(s7[3]), parseDate_(s7[0]));
        noteLatest_(lineFloor, str_(s7[3]), str_(s7[1]), '', parseDate_(s7[0]));
        noteLatest_(lineStaff, str_(s7[3]), str_(s7[9]), str_(s7[10]), parseDate_(s7[0]));
      }
      // col 6 = Packing -> [srn, date, '', qty, cartons, pcs, '', factory, ..., supervisor(14), ..., floor(22)]
      var pk = parseJson_(row[5]);
      if (pk && str_(pk[21]) && /^SG\d+/.test(str_(pk[13]))) noteLatest_(lineStaff, str_(pk[21]), str_(pk[13]), '', parseDate_(pk[1]));
    });
  }

  CFG.DEPT_CATEGORIES.forEach(function(c) {
    c.roles.forEach(function(r, i) { add('CAT_ROLE', c.key, r, '', i + 1); roles[r] = true; });
  });
  Object.keys(roles).sort().forEach(function(r) { add('ROLE', r, r); });
  Object.keys(depts).sort().forEach(function(k) {
    var p = k.split('|'), last = depts[k];
    var active = !last || last >= cutoff;
    add('DEPT', p[1], p[1], p[0], deptCategory_(p[1]), active);
  });
  Object.keys(lineFloor).sort().forEach(function(k) { add('LINE_FLOOR', k, lineFloor[k].value, '', lineFloor[k].extra); });
  Object.keys(lineStaff).sort().forEach(function(k) { add('LINE_STAFF', k, lineStaff[k].value, '', lineStaff[k].extra); });
  Object.keys(lines).sort().forEach(function(k) {
    var p = k.split('|'), L = lines[k];
    add('LINE', p[1], L.dept, p[0], L.date ? fmtDate_(L.date) : '', !L.date || L.date >= cutoff);
  });

  appendRows_(CFG.TABS.MASTERS, rows);
  return rows.length;
}

// Wipes MASTERS and rebuilds it from MASTER DATA + CFG.DEPT_CATEGORIES.
// Run after changing categories/roles in Config.js. Manual edits in MASTERS are lost.
function reseedMasters() {
  var sh = tab_(CFG.TABS.MASTERS, true);
  if (sh.getLastRow() > 1) sh.getRange(2, 1, sh.getLastRow() - 1, sh.getLastColumn()).clearContent();
  var n = seedMasters_();
  var out = 'MASTERS : reseeded ' + n + ' rows';
  Logger.log(out);
  return out;
}

function noteLatest_(map, key, value, extra, date) {
  if (!key || !value) return;
  if (!map[key] || (date && (!map[key].date || map[key].date < date))) map[key] = { value: value, extra: extra, date: date };
}

function noteLine_(lines, factory, line, dept, date) {
  var k = factory + '|' + line;
  if (!lines[k] || (date && (!lines[k].date || lines[k].date < date))) lines[k] = { dept: dept, date: date };
}

function parseJson_(v) {
  if (v === '' || v === null || v === undefined) return null;
  try { var a = JSON.parse(v); return Array.isArray(a) ? a : null; } catch (e) { return null; }
}

function parseDate_(v) {
  if (v instanceof Date) return v;
  var s = str_(v);
  if (!s) return null;
  var d = new Date(s);
  if (!isNaN(d.getTime())) return d;
  var m = s.match(/^(\d{1,2})[\/-](\d{1,2})[\/-](\d{4})/); // dd/mm/yyyy
  if (m) { d = new Date(+m[3], +m[2] - 1, +m[1]); if (!isNaN(d.getTime())) return d; }
  return null;
}
