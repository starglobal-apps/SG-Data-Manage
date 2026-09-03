// Setup.js — one-time setup: create app tabs, seed MASTERS from MASTER DATA, create the first admin user.
// Run setupAppSheets() from the Apps Script editor (or via the SG Data menu) once, then again anytime to add missing tabs.

function setupAppSheets() {
  var log = [];
  Object.keys(CFG.TABS).forEach(function(k) {
    var name = CFG.TABS[k];
    var existed = !!tab_(name, false);
    tab_(name, true);
    log.push(name + (existed ? ' : exists' : ' : created'));
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

  var roles = {}, depts = {}, lines = {};
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
      if (s && str_(s[1]) && str_(s[2])) noteLine_(lines, '666', str_(s[1]), str_(s[2]), parseDate_(s[0]));
      var s7 = parseJson_(row[4]);
      if (s7 && str_(s7[2]) && str_(s7[3])) noteLine_(lines, '117', str_(s7[2]), str_(s7[3]), parseDate_(s7[0]));
    });
  }

  Object.keys(roles).sort().forEach(function(r) { add('ROLE', r, r); });
  Object.keys(depts).sort().forEach(function(k) {
    var p = k.split('|'), last = depts[k];
    var active = !last || last >= cutoff;
    add('DEPT', p[1], p[1], p[0], last ? fmtDate_(last) : '', active);
  });
  Object.keys(lines).sort().forEach(function(k) {
    var p = k.split('|'), L = lines[k];
    add('LINE', p[1], L.dept, p[0], L.date ? fmtDate_(L.date) : '', !L.date || L.date >= cutoff);
  });

  appendRows_(CFG.TABS.MASTERS, rows);
  return rows.length;
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
