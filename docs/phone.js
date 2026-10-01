// phone.js — the phone app's data store. One call (m.all) brings Attendance (of the chosen date), Output and PMS together.
// The reply is kept in memory and on the phone, so switching tabs never loads, and the next app open shows the last data
// at once. It is refreshed silently every 5 min (while the app is open), after a save, and on the header refresh button.
(function () {
  'use strict';
  var S = window.SG, state = S.state;
  var EVERY = 5 * 60 * 1000;
  var PD = S.pd = { data: null, key: '', at: 0, p: null, dirty: false };

  function key() { return 'sg_pd_' + state.factory + '_' + state.date; }
  function load_(k) { try { var o = JSON.parse(localStorage.getItem(k) || 'null'); return o && o.d ? o : null; } catch (e) { return null; } }
  // the data for the current factory + date (memory, else what the phone saved last time), or null
  PD.get = function () {
    var k = key();
    if (PD.data && PD.key === k) return PD.data;
    var o = load_(k); if (!o) return null;
    PD.data = o.d; PD.key = k; PD.at = o.t; return PD.data;
  };
  PD.stale = function () { return PD.dirty || !PD.get() || Date.now() - PD.at > EVERY; };
  // fetch fresh data; silent = no progress bar. Re-renders the open tab when it arrives.
  PD.load = function (silent) {
    var k = key();
    if (PD.p && PD.pk === k) return PD.p;
    PD.pk = k;
    PD.p = S.api('m.all', { date: state.date, factory: state.factory }, { quiet: true, silent: !!silent })
      .then(function (d) {
        PD.p = null; if (k !== key()) return d;   // the date / factory changed meanwhile
        PD.data = d; PD.key = k; PD.at = Date.now(); PD.dirty = false;
        try {
          Object.keys(localStorage).forEach(function (x) { if (x.indexOf('sg_pd_') === 0 && x !== k) localStorage.removeItem(x); });   // keep one copy only
          localStorage.setItem(k, JSON.stringify({ t: PD.at, d: d }));
        } catch (e) {}
        PD.render();
        if (S.trBadge && d.att && d.att.incoming) S.trBadge(d.att.incoming.length);
        S.warm();
        return d;
      })
      .catch(function (e) { PD.p = null; throw e; });
    return PD.p;
  };
  // re-draw the phone tab that is open (not while the attendance form or another screen is open)
  PD.render = function () {
    var t = S.curTab && S.curTab();
    if (t && S.pdRender && S.pdRender[t]) S.pdRender[t]();
  };
  // a tab asks for its data: draw what we have at once; fetch only when there is nothing yet or it is old / changed
  PD.need = function () {
    var d = PD.get();
    if (!d || PD.stale()) PD.load(!!d && !PD.dirty).catch(function (e) { if (!PD.get()) PD.fail(e); });
    return d;
  };
  PD.fail = function (e) { var t = S.curTab && S.curTab(); if (t && S.pdFail && S.pdFail[t]) S.pdFail[t](e); };

  // silent refresh every 5 min while the app is open and visible; and when the phone comes back to the app
  setInterval(function () {
    if (document.visibilityState === 'visible' && state.user && S.isMobile() && Date.now() - PD.at >= EVERY - 5000) PD.load(true).catch(function () {});
  }, 30000);
  document.addEventListener('visibilitychange', function () {
    if (document.visibilityState === 'visible' && state.user && S.isMobile() && PD.stale()) PD.load(true).catch(function () {});
  });
  S.pdRender = S.pdRender || {}; S.pdFail = S.pdFail || {};
})();
