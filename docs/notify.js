// notify.js — phone notifications (Web Push through the Cloudflare Worker).
//  · "Turn on" (a tap): ask permission, subscribe this phone with the Worker's key, register it for the logged-in user.
//  · App open: the registration is renewed once a day (and when a different user logs in on the phone).
//  · Logout: this phone stops getting that user's notifications.
//  · A push while the app is open refreshes the data; tapping a notification opens its tab (#mrev, #matt, ...).
(function () {
  'use strict';
  var S = window.SG, state = S.state, $ = S.$;
  var N = S.notify = {};
  function ls(k, v) { try { if (v === undefined) return localStorage.getItem(k); if (v === null) localStorage.removeItem(k); else localStorage.setItem(k, String(v)); } catch (e) {} return null; }
  function u8(b64) { var s = String(b64).replace(/-/g, '+').replace(/_/g, '/'); s += '==='.slice((s.length + 3) % 4); var raw = atob(s), out = new Uint8Array(raw.length); for (var i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i); return out; }
  function b64(buf) { var b = new Uint8Array(buf), s = ''; for (var i = 0; i < b.length; i++) s += String.fromCharCode(b[i]); return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''); }

  N.supported = function () { return 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window; };
  // 'granted' | 'denied' | 'default' | 'unsupported'
  N.state = function () { return N.supported() ? Notification.permission : 'unsupported'; };
  N.on = function () { return N.state() === 'granted' && !!ls('sg_push_at'); };

  function subscribe() {
    return navigator.serviceWorker.ready.then(function (reg) {
      return S.api('push.key', {}, { quiet: true, silent: true }).then(function (d) {
        if (!d.key) throw new Error('Notifications are not available right now');
        return reg.pushManager.getSubscription().then(function (sub) {
          // made with an older key: make a new one
          if (sub && sub.options && sub.options.applicationServerKey && b64(sub.options.applicationServerKey) !== d.key) return sub.unsubscribe().then(function () { return null; });
          return sub;
        }).then(function (sub) { return sub || reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: u8(d.key) }); });
      });
    }).then(function (sub) {
      return S.api('push.sub', { sub: sub.toJSON() }, { quiet: true, silent: true }).then(function (r) {
        // registered only when the notification server (Cloudflare Worker) really kept it
        if (!r || r.stored !== true) throw new Error('Notification server not reachable — try again in a minute');
        ls('sg_push_at', Date.now()); ls('sg_push_ep', sub.endpoint); ls('sg_push_user', state.user && state.user.user_id);
        return sub;
      });
    });
  }
  // from a tap (browsers allow the permission question only then)
  N.enable = function () {
    if (!N.supported()) { S.toast('This phone cannot show app notifications. On iPhone: add the app to the Home Screen first.', 'bad', 7000); return Promise.resolve(false); }
    return Notification.requestPermission().then(function (p) {
      if (p !== 'granted') { S.toast(p === 'denied' ? 'Notifications are blocked — allow them for this app in the phone settings' : 'Notifications not turned on', 'bad', 7000); return false; }
      return subscribe().then(function () { S.toast('Notifications on ✓', 'ok'); return true; });
    }).catch(function (e) { S.toast(e.message || 'Could not turn on notifications', 'bad', 6000); return false; });
  };
  // app opened / logged in: keep this phone linked to the user (once a day, or at once for a different user)
  N.refresh = function () {
    if (N.state() !== 'granted' || !state.user || !state.token) return;
    var at = Number(ls('sg_push_at') || 0), uid = ls('sg_push_user');
    if (Date.now() - at < 20 * 3600 * 1000 && uid === String(state.user.user_id)) return;
    subscribe().catch(function () {});
  };
  // logout (called while the token is still set)
  N.off = function () {
    var ep = ls('sg_push_ep'); ls('sg_push_at', null); ls('sg_push_user', null);
    if (ep && state.token) S.api('push.unsub', { endpoint: ep }, { quiet: true, silent: true }).catch(function () {});
  };
  // Main -> Notifications: this phone's state, a test notification, and (admin) who has notifications + what was sent
  function when(ms) { var d = new Date(Number(ms)); return ('0' + d.getDate()).slice(-2) + '/' + ('0' + (d.getMonth() + 1)).slice(-2) + ' ' + ('0' + d.getHours()).slice(-2) + ':' + ('0' + d.getMinutes()).slice(-2); }
  function resultText(x) { return x.status === 0 ? 'no phone registered' : x.status >= 200 && x.status < 300 ? 'delivered to the push service ✓' : 'refused (' + x.status + ') ' + (x.info || ''); }
  N.screen = function () {
    var st = N.state(), on = N.on(), esc = S.esc;
    var html = '<div class="nt-state"><b>This phone: ' + (on ? 'On ✓' : st === 'denied' ? 'Blocked' : st === 'unsupported' ? 'Not available' : 'Off') + '</b><span>' +
      (on ? 'Transfer requests, approvals and sent-back output arrive even when the app is closed.' : st === 'denied' ? 'Allow notifications for this app in the phone settings (Chrome → Site settings → Notifications), then come back.' :
        st === 'unsupported' ? 'This browser cannot show app notifications. iPhone: add the app to the Home Screen and open it from there.' : 'Turn on to get transfer requests, approvals and sent-back output at once.') + '</span></div>' +
      (on ? '<button class="btn big" data-nttest="1">Send a test notification to this phone</button>' : st === 'default' || st === 'granted' ? '<button class="btn big" data-ntenable="1">Turn on notifications</button>' : '') +
      '<div id="nt-res" class="hint"></div>' + (S.isAdmin && S.isAdmin() ? '<h2 style="margin-top:14px">Who gets notifications</h2><div id="nt-adm" class="hint">Loading…</div>' : '');
    S.sheet.open('Notifications', html);
    $('#sheet-content').onclick = function (e) {
      var b = e.target.closest('button'); if (!b) return;
      if (b.dataset.ntenable) N.enable().then(function () { N.screen(); });
      if (b.dataset.nttest) {
        b.disabled = true; $('#nt-res').textContent = 'Sending…';
        S.api('push.test', {}, { quiet: true }).then(function (r) {
          var res = r.results || [];
          $('#nt-res').innerHTML = !res.length ? 'Not sent — the notification server did not answer. Try again.' : res.map(function (x) { return esc(resultText(x)); }).join('<br>') + (res.some(function (x) { return x.status === 0; }) ? '<br>Tap "Turn on" again on this phone.' : '');
          if (res.some(function (x) { return x.status === 0; })) { ls('sg_push_at', null); }
        }).catch(function (er) { $('#nt-res').textContent = er.message; }).then(function () { b.disabled = false; });
      }
    };
    if (S.isAdmin && S.isAdmin()) S.api('push.status', {}, { quiet: true, silent: true }).then(function (r) {
      var ph = {}; (r.phones || []).forEach(function (p) { ph[p.user_id] = p; });
      var names = {}; (r.users || []).forEach(function (u) { names[u.id] = u.name; });
      var users = (r.users || []).slice().sort(function (a, b) { return (ph[b.id] ? 1 : 0) - (ph[a.id] ? 1 : 0) || a.name.localeCompare(b.name); });
      $('#nt-adm').innerHTML = '<div class="nt-list">' + users.map(function (u) { var p = ph[u.id]; return '<div class="' + (p ? 'on' : '') + '"><span>' + esc(u.name.replace(/^[A-Z]{1,4}\d{3,}\s*-\s*/i, '')) + '</span><b>' + (p ? '✓ ' + p.n + (p.n > 1 ? ' phones' : ' phone') : '— not on') + '</b></div>'; }).join('') + '</div>' +
        '<h2 style="margin-top:14px">Last notifications</h2><div class="nt-list log">' + ((r.log || []).map(function (l) { return '<div class="' + (l.status >= 200 && l.status < 300 ? 'on' : 'bad') + '"><span>' + when(l.at) + ' · ' + esc((names[l.user_id] || l.user_id).replace(/^[A-Z]{1,4}\d{3,}\s*-\s*/i, '')) + ' · ' + esc(l.title) + '</span><b>' + esc(resultText(l)) + '</b></div>'; }).join('') || '<div><span>None yet</span></div>') + '</div>';
    }).catch(function (e) { var el = $('#nt-adm'); if (el) el.textContent = e.message; });
  };
  // "turn on" card on the Attendance tab: only while the phone has not answered, hidden for 3 days after "Later"
  N.askHtml = function () {
    if (N.state() !== 'default' || Date.now() - Number(ls('sg_push_later') || 0) < 3 * 86400000) return '';
    return '<div class="card nt-ask"><div class="b"><b>Turn on notifications</b><span>Transfer requests, approvals and sent-back output arrive at once.</span></div>' +
      '<div class="nt-btns"><button class="btn small ghost" data-ntlater="1">Later</button><button class="btn small" data-nton="1">Turn on</button></div></div>';
  };
  document.addEventListener('click', function (e) {
    var b = e.target.closest && e.target.closest('[data-nton],[data-ntlater]'); if (!b) return;
    var card = b.closest('.nt-ask');
    if (b.dataset.ntlater) { ls('sg_push_later', Date.now()); if (card) card.remove(); return; }
    N.enable().then(function () { if (card) card.remove(); if (S.curTab && S.curTab() === 'main' && S.tabs.main) S.tabs.main(); });
  });

  // from the service worker: a push arrived (fresh data now) / a notification was tapped (open its tab)
  function openTab(u) { var t = String(u || '').replace(/^.*#/, ''); if (/^(matt|mout|mpms|mrev|main)$/.test(t) && state.user && S.tab) S.tab(t); }
  if ('serviceWorker' in navigator) navigator.serviceWorker.addEventListener('message', function (e) {
    var m = e.data || {};
    if (m.type === 'push' && state.user && S.pd && S.isMobile()) { S.pd.dirty = true; S.pd.load(true).catch(function () {}); }
    if (m.type === 'open') openTab(m.url);
  });
  // the app was opened by tapping a notification: ./#mrev
  N.openFromHash = function () {
    var h = location.hash; if (!h) return;
    try { history.replaceState(history.state, '', location.pathname + location.search); } catch (e) {}
    setTimeout(function () { openTab(h); }, 50);
  };
})();
