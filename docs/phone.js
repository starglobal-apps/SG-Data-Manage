// phone.js — the phone app's data store and its background saves.
//  · Store: one call (m.all) brings Attendance (of the chosen date), Output and PMS together. Kept in memory and on the
//    phone (per factory), so switching tabs never loads and the next open shows the last data at once (on a new day
//    Output / PMS show at once, attendance of the new date comes with the call). Refreshed silently every 5 min while
//    the app is open, after a save, and on the header refresh button.
//  · Outbox: attendance saves (att.save, Update attendance) show as saved at once and go to the server in the background,
//    one after the other. Each carries an id (rid), so the server never applies the same save twice. A failed one stays
//    on its line marked "Not saved" with a Resend button.
(function () {
  'use strict';
  var S = window.SG, state = S.state;
  var EVERY = 5 * 60 * 1000;
  var PD = S.pd = { data: null, key: '', at: 0, p: null, dirty: false };

  function key() { return 'sg_pd_' + state.factory; }
  function read_(k) { try { var o = JSON.parse(localStorage.getItem(k) || 'null'); return o && o.d ? o : null; } catch (e) { return null; } }
  // data of the current factory + date (memory, else what the phone saved). Another date: Output / PMS only (att missing).
  PD.get = function () {
    if (PD.data && PD.key === key() && PD.date === state.date) return PD.data;
    var o = read_(key()); if (!o) return null;
    if (o.date === state.date) { PD.data = o.d; PD.key = key(); PD.date = o.date; PD.at = o.t; return PD.data; }
    return { out: o.d.out, pms: o.d.pms, partial: true };
  };
  PD.stale = function () { var d = PD.get(); return PD.dirty || !d || d.partial || Date.now() - PD.at > EVERY; };
  // fetch fresh data; silent = no progress bar. Re-renders the open tab when it arrives.
  PD.load = function (silent) {
    var k = key(), date = state.date, pk = k + '|' + date;
    if (PD.p && PD.pk === pk) return PD.p;
    PD.pk = pk;
    PD.p = S.api('m.all', { date: date, factory: state.factory }, { quiet: true, silent: !!silent })
      .then(function (d) {
        PD.p = null; if (k !== key() || date !== state.date) return d;   // the date / factory changed meanwhile
        PD.data = d; PD.key = k; PD.date = date; PD.at = Date.now(); PD.dirty = false;
        try {
          Object.keys(localStorage).forEach(function (x) { if (x.indexOf('sg_pd_') === 0 && x !== k) localStorage.removeItem(x); });
          localStorage.setItem(k, JSON.stringify({ t: PD.at, date: date, d: d }));
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
    if (!d || PD.stale()) PD.load(!!d && !d.partial && !PD.dirty).catch(function (e) { if (!PD.get() || PD.get().partial) PD.fail(e); });
    return d;
  };
  PD.fail = function (e) { var t = S.curTab && S.curTab(); if (t && S.pdFail && S.pdFail[t]) S.pdFail[t](e); };

  // ---------- outbox ----------
  var OB = 'sg_outbox', sending = null;
  PD.outbox = function () { try { return JSON.parse(localStorage.getItem(OB) || '[]'); } catch (e) { return []; } };
  function obSave(list) { try { localStorage.setItem(OB, JSON.stringify(list)); } catch (e) {} }
  function uid() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 10); }
  // meta: { dept, date, shift, kind: 'att' | 'upd', label }. A newer attendance save of the same line / date / shift
  // replaces an older one still waiting (so a Resend can never bring old numbers back).
  PD.send = function (action, payload, meta) {
    var it = Object.assign({ id: uid(), action: action, payload: payload, state: 'sending', error: '', at: Date.now() }, meta);
    var list = PD.outbox().filter(function (x) {
      return !(x.id !== sending && it.kind === 'att' && x.kind === 'att' && x.dept === it.dept && x.date === it.date && x.shift === it.shift);
    });
    list.push(it); obSave(list); PD.render(); pump();
    return it;
  };
  PD.pending = function (date) { return PD.outbox().filter(function (x) { return x.date === date; }); };
  PD.resend = function (id) {
    var list = PD.outbox(); list.forEach(function (x) { if (x.id === id) { x.state = 'sending'; x.error = ''; } }); obSave(list); PD.render(); pump();
  };
  function pump() {
    if (sending || !state.user) return;
    var it = PD.outbox().filter(function (x) { return x.state === 'sending'; })[0];
    if (!it) return;
    sending = it.id;
    S.api(it.action, Object.assign({}, it.payload, { rid: it.id }), { quiet: true, silent: true, noQueue: true })
      .then(function (r) {
        var list = PD.outbox().filter(function (x) { return x.id !== it.id; });
        // saved in the app, but the main sheet was not updated: keep a Resend that only writes the sheet again
        if (r && r.sheetError) list.push({ id: uid(), action: 'm.attSync', payload: { date: it.date, factory: it.payload.factory, dept: it.dept, shift: it.shift || 'Final' },
                                           dept: it.dept, date: it.date, shift: it.shift, kind: 'sync', label: it.label, state: 'failed', error: r.sheetError, at: Date.now() });
        obSave(list); sending = null; PD.dirty = true;
        PD.load(true).catch(function () {}); pump();
      })
      .catch(function (e) {
        var list = PD.outbox(); list.forEach(function (x) { if (x.id === it.id) { x.state = 'failed'; x.error = e.message || 'Not saved'; } });
        obSave(list); sending = null; PD.render(); pump();
      });
  }
  PD.pump = pump;
  setTimeout(pump, 2000);   // saves left from last time (app closed while sending) go again — the server skips repeats

  // silent refresh every 5 min while the app is open and visible; and when the phone comes back to the app
  setInterval(function () {
    if (document.visibilityState === 'visible' && state.user && S.isMobile() && Date.now() - PD.at >= EVERY - 5000) PD.load(true).catch(function () {});
  }, 30000);
  document.addEventListener('visibilitychange', function () {
    if (document.visibilityState === 'visible' && state.user && S.isMobile()) { if (PD.stale()) PD.load(true).catch(function () {}); pump(); }
  });
  S.pdRender = S.pdRender || {}; S.pdFail = S.pdFail || {};
})();
