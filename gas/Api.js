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
    'line.today':     lineToday_,
    'review.count':   reviewCount_,
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

function login_(req) {
  var pin = str_(req.pin);
  if (!pin) return fail_('PIN', 'PIN daalo');

  var cache = CacheService.getScriptCache();
  var fails = Number(cache.get('loginfail') || 0);
  if (fails >= LOGIN_MAX_FAILS) {
    return fail_('LOCKED', 'Bahut galat PIN — ' + Math.round(LOGIN_LOCK_SEC / 60) + ' minute baad try karo');
  }

  var users = readTab_(CFG.TABS.USERS).filter(function(u) {
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
  return JSON.parse(raw);
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
  var rows = readTab_(CFG.TABS.MASTERS).filter(function(r) { return isTrue_(r.active); });
  var m = {};
  rows.forEach(function(r) {
    var t = str_(r.type);
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
