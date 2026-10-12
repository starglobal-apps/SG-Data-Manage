// Notify.js — who gets a phone notification after a save.
//
// Apps Script decides (it knows the users and their lines); the Cloudflare Worker (cloudflare/) sends them as Web Push.
// doPost adds { notify: [{ to: [user_id], title, body, tag, url }] } to a successful reply; the Worker reads it, sends
// the pushes and nobody else uses it. Without the Worker (direct calls) nothing is sent — the data is the same.
//
//   attendance saved / changed / cancelled (phone)  -> admins
//   half day / absent update                         -> admins
//   output sent for approval                         -> admins
//   transfer request                                 -> recorders of the receiving line (no one there: admins)
//   transfer accepted / rejected                     -> who made the request
//   output approved / sent back / edited by admin    -> recorders of that line + who submitted it

function notifyFor_(action, req, user, res) {
  if (!res || !res.ok || !user) return null;
  var me = str_(user.user_id), by = userName_(user), out = [];
  var add = function(to, title, body, tag, url) {
    var seen = {}, ids = (to || []).filter(function(id) { id = str_(id); if (!id || id === me || seen[id]) return false; seen[id] = 1; return true; });
    if (ids.length) out.push({ to: ids, title: title, body: body, tag: tag || '', url: url || '' });
  };
  var L = function(d) { return notifyLine_(d); };
  var factory = str_(req.factory), date = str_(req.date), dept = str_(req.dept);

  if (action === 'att.save' && req.phone) {
    var rows = Array.isArray(req.rows) ? req.rows : [], shift = str_(req.shift) || 'Final';
    var n = rows.reduce(function(t, r) { return t + num_(r.count); }, 0);
    var what = shift === 'Final' ? 'Attendance' : shift + ' attendance';
    if (!rows.length) add(notifyAdmins_(factory), what + ' cancelled · ' + L(dept), 'by ' + by, 'att|' + date + '|' + dept + '|' + shift, '#matt');
    else add(notifyAdmins_(factory), what + ' · ' + L(dept), n + ' people' + (str_(req.srn) ? ' · ' + str_(req.srn) : '') + ' · by ' + by, 'att|' + date + '|' + dept + '|' + shift, '#matt');
  }
  else if (action === 'm.attUpd') {
    var parts = [];
    if (num_(req.halfDay)) parts.push(num_(req.halfDay) + ' ' + str_(req.role) + ' half day');
    if (num_(req.absent)) parts.push(num_(req.absent) + ' ' + str_(req.role) + ' absent');
    add(notifyAdmins_(factory), 'Attendance updated · ' + L(dept), (parts.join(' · ') || 'changed') + ' · by ' + by, 'att|' + date + '|' + dept + '|Final', '#matt');
  }
  else if (action === 'm.outSave') {
    var shiftO = str_(req.shift) || 'Final';
    add(notifyAdmins_(factory), 'Output for approval · ' + L(dept), num_(req.qty) + ' pcs' + (shiftO !== 'Final' ? ' · ' + shiftO : '') + (str_(req.srn) ? ' · ' + str_(req.srn) : '') + ' · by ' + by, 'out|' + date + '|' + dept + '|' + shiftO, '#mrev');
  }
  else if (action === 'm.trCreate') {
    var to = str_(req.to_dept), from = str_(req.from_dept), hour = num_(req.hour);
    var items = Array.isArray(req.items) ? req.items : [], total = items.reduce(function(t, x) { return t + num_(x.count); }, 0);
    var who = notifyLineUsers_(to, factory, me);
    add(who.length ? who : notifyAdmins_(factory), 'Transfer request · ' + L(from) + ' → ' + L(to),
      total + (total === 1 ? ' person' : ' people') + ' from ' + notifyHour_(hour) + ' · by ' + by + ' · accept or reject', 'tr|' + str_(res.id), '#matt');
  }
  else if (action === 'm.trDecide') {
    var t = readDaily_(CFG.TABS.TRANSFERS).filter(function(r) { return str_(r.id) === str_(req.id); })[0];
    if (t) {
      var ok = str_(req.decision) === 'accept';
      add(notifyUsersByName_(t.by), 'Transfer ' + (ok ? 'accepted' : 'rejected') + ' · ' + L(t.from_dept) + ' → ' + L(t.to_dept),
        num_(t.count) + ' people · ' + (ok ? 'they work on ' + L(t.to_dept) + ' from ' + str_(t.time) : 'they stay on ' + L(t.from_dept)) + ' · by ' + by, 'tr|' + str_(t.id), '#matt');
    }
  }
  else if (action === 'm.reviewDecide' || action === 'm.reviewEdit') {
    var ids = action === 'm.reviewEdit' ? [str_(res.id || req.id)] : (Array.isArray(req.ids) ? req.ids.map(str_) : []);
    var decision = action === 'm.reviewEdit' ? (req.approve ? 'approve' : 'edit') : str_(req.decision);
    var byLine = {};
    readTab_(CFG.TABS.DAY_SUMMARY).forEach(function(r) {
      if (ids.indexOf(str_(r.id)) < 0) return;
      var k = str_(r.dept) + '|' + str_(r.factory);
      (byLine[k] = byLine[k] || { dept: str_(r.dept), factory: str_(r.factory), date: str_(r.date), shift: str_(r.shift) || 'Final', qty: 0, subs: [] });
      byLine[k].qty += notifyQty_(r.payload);
      byLine[k].subs.push(str_(r.submitted_by));
    });
    Object.keys(byLine).forEach(function(k) {
      var g = byLine[k], to = notifyLineUsers_(g.dept, g.factory, me);
      g.subs.forEach(function(nm) { to = to.concat(notifyUsersByName_(nm, true)); });
      var title = decision === 'approve' ? 'Output approved · ' + L(g.dept) : decision === 'reject' ? 'Output sent back · ' + L(g.dept) : 'Output edited by admin · ' + L(g.dept);
      var body = (g.qty ? g.qty + ' pcs · ' : '') + notifyDay_(g.date) + (decision === 'reject' && str_(req.remark) ? ' · ' + str_(req.remark).slice(0, 120) : '') + ' · by ' + by;
      add(to, title, body, 'out|' + g.date + '|' + g.dept + '|' + g.shift, '#mout');
    });
  }
  return out.length ? out : null;
}

// active users of a role list, of the factory (blank factory = both)
function notifyUsers_(test) {
  return usersRows_().filter(function(u) { return isTrue_(u.active) && test(u); }).map(function(u) { return str_(u.user_id); });
}
function notifyAdmins_(factory) {
  return notifyUsers_(function(u) { return str_(u.role) === 'Admin' && (!factory || !str_(u.factory) || str_(u.factory) === factory); });
}
// users who have this line in their lines (recorders / supervisors), not admins (they get their own alerts)
function notifyLineUsers_(dept, factory, exceptId) {
  return notifyUsers_(function(u) { return str_(u.role) !== 'Admin' && str_(u.user_id) !== exceptId && csv_(u.depts).indexOf(dept) >= 0 && (!factory || !str_(u.factory) || str_(u.factory) === factory); });
}
// users stamped by name (entered_by / by / submitted_by hold the user's name); nonAdmin: skip admins
function notifyUsersByName_(name, nonAdmin) {
  name = str_(name).toLowerCase(); if (!name) return [];
  return notifyUsers_(function(u) { return (str_(u.name).toLowerCase() === name || str_(u.user_id).toLowerCase() === name) && !(nonAdmin && str_(u.role) === 'Admin'); });
}
function notifyLine_(d) { return str_(d).replace(/^FAC\d+-/i, ''); }   // same as the app's shortLine
function notifyHour_(h) { h = num_(h); return (h % 12 || 12) + (h >= 12 ? ' PM' : ' AM'); }
function notifyDay_(d) { var p = str_(d).split('-'); return p.length === 3 ? p[2] + '/' + p[1] : str_(d); }
function notifyQty_(payload) { var p = parseJsonObj_(payload); return num_(p.output) || num_(p.qty) || num_(p.total) || 0; }

// push.sub / push.unsub: the phone registers its notification address. Apps Script only confirms who the user is;
// the Worker stores the address against this user_id (and removes it on push.unsub).
function pushSub_(req, user) {
  var s = req.sub || {};
  if (!str_(s.endpoint) || !s.keys || !str_(s.keys.p256dh) || !str_(s.keys.auth)) return fail_('VAL', 'Notification address missing');
  return { ok: true, user_id: str_(user.user_id), name: userName_(user) };
}
function pushUnsub_(req, user) { return { ok: true, user_id: str_(user.user_id) }; }
