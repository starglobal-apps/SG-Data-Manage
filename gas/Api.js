// Api.js — JSON API for the SG Data mobile app (Apps Script Web App)
//
// Client sends: POST <web app url>, body = JSON { action, token, ...payload }  (Content-Type: text/plain)
// Server replies: JSON { ok: true, ... } or { ok: false, error, message }

function doGet(e) {
  var p = (e && e.parameter) || {};
  if (p.action === 'ping') return json_({ ok: true, app: 'SG Data API', time: nowStr_() });
  return json_({ ok: true, app: 'SG Data API', hint: 'POST JSON { action, token, ... }' });
}

function doPost(e) {
  var req;
  try { req = JSON.parse(e.postData.contents); }
  catch (err) { return json_(fail_('BAD_JSON', 'Request body JSON nahi hai')); }

  try {
    var action = str_(req.action);
    if (action === 'login') return json_(login_(req));

    var user = auth_(req.token);
    if (!user) return json_(fail_('AUTH', 'Session khatam — dobara login karo'));

    var handler = routes_()[action];
    if (!handler) return json_(fail_('NO_ACTION', 'Unknown action: ' + action));
    return json_(handler(req, user));
  } catch (err) {
    return json_(fail_('SERVER', String(err && err.message || err)));
  }
}

function routes_() {
  return {
    'me':         function(req, user) { return { ok: true, user: user }; },
    'masters':    getMasters_,
    'att.get':    attGet_,
    'att.save':   attSave_,
    'att.status': attStatus_,
    'orders.active':  ordersActive_,
    'orders.refresh': ordersRefresh_,
    'hourly.get':     hourlyGet_,
    'hourly.save':    hourlySave_,
    'hourly.day':     hourlyDay_,
    'hourly.slot':    hourlySlot_,
    'hour.get':       hourGet_,
    'hour.save':      hourSave_,
    'line.save':      lineSave_,
    'audit.recent':   function(req, user) { if (!isAdmin_(user)) return fail_('PERM', 'Sirf admin'); return { ok: true, rows: readRecent_(CFG.TABS.AUDIT_LOG, num_(req.n) || 40) }; },
    'hourly.rows':    function(req, user) { if (!isAdmin_(user)) return fail_('PERM', 'Sirf admin'); return { ok: true, last: tab_(CFG.TABS.HOURLY_LOG, true).getLastRow(), rows: readRecent_(CFG.TABS.HOURLY_LOG, num_(req.n) || 60) }; },
    'factory.today':  factoryToday_,
    'line.today':     lineToday_,
    'review.count':   reviewCount_,
    'transfer.create': transferCreate_,
    'users.recorders': usersRecorders_,
    'transfer.decide': transferDecide_,
    'cache.clear':    cacheClear_,
    'pms.get':        pmsGet_,
    'report.check':   reportCheck_,
    'staff.list':     staffList_,
    'staff.save':     staffSave_,
    'staff.remove':   staffRemove_,
    'report.line':    reportLine_,
    'report.packing': reportPacking_,
    'report.srn':     reportSrn_,
    'report.endline': reportEndline_,
    'users.list':     usersList_,
    'users.save':     usersSave_,
    'manpower.get':   manpowerGet_,
    'manpower.save':  manpowerSave_,
    'manpower.delete': manpowerDelete_,
    'day.build':      dayBuild_,
    'day.submit':     daySubmit_,
    'review.list':    reviewList_,
    'review.decide':  reviewDecide_,
    'review.send':    reviewSend_
  };
}

// ---------- auth ----------

// The web app URL is public, so a 4-digit PIN needs a brute-force brake:
// after LOGIN_MAX_FAILS wrong PINs the whole endpoint pauses logins for LOGIN_LOCK_SEC.
var LOGIN_MAX_FAILS = 8;
var LOGIN_LOCK_SEC = 900;

// USERS rows cached 2 min (invalidated on every users.save)
function usersRows_() {
  var hit = cacheGetBig_('users_rows');
  if (hit) return hit;
  var rows = readTab_(CFG.TABS.USERS);
  cachePutBig_('users_rows', rows, 120);
  return rows;
}
function invalidateUsers_() { cacheDelBig_('users_rows'); }

function login_(req) {
  var pin = str_(req.pin);
  if (!pin) return fail_('PIN', 'PIN daalo');

  var cache = CacheService.getScriptCache();
  var fails = Number(cache.get('loginfail') || 0);
  if (fails >= LOGIN_MAX_FAILS) {
    return fail_('LOCKED', 'Bahut galat PIN — ' + Math.round(LOGIN_LOCK_SEC / 60) + ' minute baad try karo');
  }

  var users = usersRows_().filter(function(u) {
    return str_(u.pin) === pin && isTrue_(u.active);
  });
  if (req.user_id) users = users.filter(function(u) { return str_(u.user_id) === str_(req.user_id); });
  if (!users.length) {
    cache.put('loginfail', String(fails + 1), LOGIN_LOCK_SEC);
    Utilities.sleep(1000); // slow guessing down
    audit_(null, 'login.fail', '', { attempt: fails + 1 });
    return fail_('LOGIN', 'Galat PIN');
  }
  if (users.length > 1) return fail_('LOGIN', 'Ye PIN ek se zyada users ka hai — USERS tab me PIN unique karo');
  cache.remove('loginfail');

  var pub = publicUser_(users[0]);
  var token = uuid_();
  CacheService.getScriptCache().put('tok:' + token, JSON.stringify(pub), CFG.TOKEN_TTL_SEC);
  audit_(pub, 'login', pub.user_id, '');
  return { ok: true, token: token, user: pub };
}

function auth_(token) {
  token = str_(token);
  if (!token) return null;
  var cache = CacheService.getScriptCache();
  var raw = cache.get('tok:' + token);
  if (!raw) return null;
  cache.put('tok:' + token, raw, CFG.TOKEN_TTL_SEC); // sliding expiry
  var pub = JSON.parse(raw);
  // access can be changed by the admin at any time: refresh role/factory/depts from USERS on every call
  var fresh = usersRows_().filter(function(u) { return str_(u.user_id) === pub.user_id; })[0];
  if (!fresh || !isTrue_(fresh.active)) return null;
  return publicUser_(fresh);
}

// ---------- admin: user management ----------

function usersList_(req, user) {
  if (user.role !== 'Admin') return fail_('PERM', 'Sirf admin');
  return { ok: true, users: usersRows_().map(function(u) {
    return { user_id: str_(u.user_id), name: str_(u.name), pin: str_(u.pin), role: str_(u.role), factory: str_(u.factory),
             depts: csv_(u.depts), active: isTrue_(u.active), created_at: str_(u.created_at) };
  }), roles: CFG.USER_ROLES };
}

// { user_id?, name, pin, role, factory, depts: [], active }  — user_id blank = new user
function usersSave_(req, user) {
  if (user.role !== 'Admin') return fail_('PERM', 'Sirf admin');
  var id = str_(req.user_id), name = str_(req.name), pin = str_(req.pin), role = str_(req.role), factory = str_(req.factory);
  var depts = Array.isArray(req.depts) ? req.depts.map(str_).filter(String) : csv_(req.depts);
  var active = req.active === undefined ? true : isTrue_(req.active);
  if (!name) return fail_('VAL', 'Naam likho');
  if (!/^\d{4,8}$/.test(pin)) return fail_('VAL', 'PIN 4 se 8 digit ka number ho');
  if (CFG.USER_ROLES.indexOf(role) < 0) return fail_('VAL', 'Role galat');
  if (factory && CFG.FACTORIES.indexOf(factory) < 0) return fail_('VAL', 'Factory galat');
  if (role !== 'Admin' && role !== 'Manager' && !depts.length) return fail_('VAL', 'Kam se kam ek line / floor chuno');

  var rows = readTab_(CFG.TABS.USERS);
  var dup = rows.filter(function(u) { return str_(u.pin) === pin && str_(u.user_id) !== id; })[0];
  if (dup) return fail_('VAL', 'Ye PIN pehle se ' + str_(dup.name) + ' ka hai — dusra PIN do');
  if (id === user.user_id && (role !== 'Admin' || !active)) return fail_('VAL', 'Apna hi admin access nahi hata sakte');

  var sh = tab_(CFG.TABS.USERS, true), head = CFG.HEADERS.USERS;
  var vals = { name: name, pin: pin, role: role, factory: factory, depts: depts.join(','), active: active ? 'TRUE' : 'FALSE' };
  withLock_(function() {
    if (id) {
      var hit = rows.filter(function(u) { return str_(u.user_id) === id; })[0];
      if (!hit) throw new Error('User nahi mila');
      Object.keys(vals).forEach(function(k) { sh.getRange(hit._row, head.indexOf(k) + 1).setValue(vals[k]); });
    } else {
      id = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 20) + '-' + Math.random().toString(36).slice(2, 6);
      appendRows_(CFG.TABS.USERS, [Object.assign({ user_id: id, created_at: nowStr_() }, vals)]);
    }
  });
  invalidateUsers_();
  audit_(user, 'users.save', id, { name: name, role: role, factory: factory, depts: depts.length, active: active });
  return { ok: true, user_id: id };
}


function publicUser_(u) {
  return {
    user_id: str_(u.user_id),
    name: str_(u.name),
    role: str_(u.role),
    factory: str_(u.factory),     // '' = all factories
    depts: csv_(u.depts)          // [] = all depts
  };
}

function isTrue_(v) {
  if (v === true) return true;
  var s = str_(v).toUpperCase();
  return s === 'TRUE' || s === 'YES' || s === '1' || s === 'Y';
}

function isManager_(user) { return user.role === 'Manager' || user.role === 'Admin'; }

// Data Collector / Supervisor can only write to their own factory/depts
function canWrite_(user, factory, dept) {
  if (isManager_(user)) return true;
  if (user.factory && user.factory !== str_(factory)) return false;
  if (user.depts.length && user.depts.indexOf(str_(dept)) < 0) return false;
  return true;
}

// ---------- masters ----------

function getMasters_(req, user) {
  var rows = mastersRows_().filter(function(r) { return isTrue_(r.active); });
  var m = {};
  rows.forEach(function(r) {
    var t = str_(r.type);
    if (t === 'DEPT' && CFG.ACTIVE_CATS.indexOf(str_(r.extra)) < 0) return;
    if (!m[t]) m[t] = [];
    m[t].push({ key: str_(r.key), value: str_(r.value), factory: str_(r.factory), extra: str_(r.extra) });
  });
  return {
    ok: true,
    factories: CFG.FACTORIES,
    shifts: CFG.SHIFTS,
    slots: CFG.SLOTS,
    floors: CFG.FLOORS,
    categories: CFG.DEPT_CATEGORIES.map(function(c) { return { key: c.key, label: c.label }; }),
    hourlyTypes: CFG.HOURLY_TYPES,
    mpEvents: CFG.MP_EVENTS,
    appStart: CFG.APP_START_DATE,
    masters: m
  };
}
