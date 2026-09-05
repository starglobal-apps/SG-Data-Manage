// sheet.js — bottom sheet + quick entry (one slot, one SRN) + slot picker. Shared by Home / Entry / Data.
(function () {
  'use strict';
  var S = window.SG, $ = S.$, $$ = S.$$, esc = S.esc, api = S.api, state = S.state, toast = S.toast;
  function num(v) { var n = Number(v); return isNaN(n) ? 0 : n; }

  // ---------- generic sheet ----------
  S.sheet = {
    open: function (title, html) {
      $('#sheet-title').textContent = title; $('#sheet-content').innerHTML = html;
      $('#sheet-content').onclick = null; $('#sheet-content').onchange = null;
      if ($('#sheet').hidden) { try { history.pushState({ sheet: 1 }, ''); } catch (e) {} }
      $('#sheet').hidden = false;
    },
    close: function () {
      if ($('#sheet').hidden) return;
      $('#sheet').hidden = true;
      if (history.state && history.state.sheet) { S.skipPop(); try { history.back(); } catch (e) {} }
    }
  };
  $('#sheet-close').addEventListener('click', S.sheet.close);
  $('#sheet-bg').addEventListener('click', S.sheet.close);

  var typeLabel = { STITCH: 'Stitching output', ENDLINE: 'Endline checking', PACKING: 'Packing' };
  S.typeLabel = function (t) { return typeLabel[t] || t; };

  // ---------- orders cache ----------
  var orders = {};
  function getOrders(type, force) {
    var k = type + '|' + state.line + '|' + state.factory;
    if (!force && orders[k] && Date.now() - orders[k].t < 5 * 60000) return Promise.resolve(orders[k].list);
    return api('orders.active', { factory: state.factory, dept: state.line, type: type }, { quiet: true }).then(function (d) { orders[k] = { t: Date.now(), list: d.srns }; return d.srns; });
  }
  S.invalidateOrders = function () { orders = {}; };

  // ---------- slot picker ----------
  S.pickSlot = function (type) {
    S.loadToday().then(function (d) {
      var sl = (d.slots || {})[type] || {}, now = S.isToday() ? S.nowHour() : 24;
      var showOT = now >= 18 || S.slots('OT').some(function (s) { return sl[s.key]; });
      var build = function (shift) {
        return '<div class="slotpick">' + S.slots(shift).map(function (s) {
          var rows = sl[s.key] || [], q = 0; rows.forEach(function (r) { q += type === 'ENDLINE' ? r.pass : r.qty; });
          var st = S.slotStart(s.key), cls = rows.length ? 'done' : (S.isToday() && now >= st && now < st + 1) ? 'now' : (shift === 'Final' && now >= st + 1) ? 'warn' : '';
          return '<button data-slot="' + esc(s.key) + '" class="' + cls + '">' + esc(s.label) + '<small>' + (rows.length ? (type === 'ENDLINE' ? 'pass ' : '') + q : cls === 'warn' ? 'baaki' : cls === 'now' ? 'abhi' : '—') + '</small></button>';
        }).join('') + '</div>';
      };
      var html = '<label>Day (9–6)</label>' + build('Final');
      html += showOT ? '<label>OT (6–10 PM)</label>' + build('OT') : '<button class="lnk" data-ot="1">+ OT slots</button>';
      S.sheet.open(S.typeLabel(type) + ' · slot chuno', html);
      $('#sheet-content').onclick = function (e) {
        var b = e.target.closest('button'); if (!b) return;
        if (b.dataset.slot) S.quick(type, b.dataset.slot);
        else if (b.dataset.ot) { $('#sheet-content').insertAdjacentHTML('beforeend', '<label>OT (6–10 PM)</label>' + build('OT')); b.remove(); }
      };
    }).catch(function (e) { toast(e.message, 'bad'); });
  };

  // ---------- quick entry ----------
  var q = { type: '', slot: '', srn: '' };

  S.quick = function (type, slot) {
    if (S.lockedType(type)) { var st = S.today().statuses[type].status; toast('Ye din ' + st + ' hai — edit band', 'bad'); return; }
    q.type = type; q.slot = slot;
    S.sheet.open((S.slotDef(slot) || { label: slot }).label + ' · ' + S.typeLabel(type), '<div class="empty">SRN list…</div>');
    getOrders(type).then(renderQuick).catch(function (e) { $('#sheet-content').innerHTML = '<div class="empty">' + esc(e.message) + '</div>'; });
  };

  function rowsHere() { var d = S.today(); return ((d && d.slots && d.slots[q.type]) || {})[q.slot] || []; }

  function renderQuick(srns) {
    var rows = rowsHere(), remembered = S.recall('srn_' + q.type + '_' + state.line);
    q.srn = rows.length ? rows[0].srn : (srns.some(function (x) { return x.srn === remembered; }) ? remembered : (srns[0] ? srns[0].srn : ''));
    var html = '';
    if (!srns.length) {
      html += '<div class="banner">' + (q.type === 'STITCH' ? 'Is line par koi loading nahi mili. Loading sheet me entry hone ke baad refresh dabao.' : q.type === 'ENDLINE' ? 'Is line par stitching output nahi hai — pehle stitching bharo.' : 'Koi SRN nahi jiska endline-pass balance ho.') + '</div><button class="btn primary big" data-refresh="1">Loading refresh</button>';
      $('#sheet-content').innerHTML = html; bind(); return;
    }
    html += '<label>SRN</label><div class="chips" id="q-srns">' + srns.map(function (x) { return '<button data-srn="' + esc(x.srn) + '" class="' + (x.srn === q.srn ? 'on' : '') + '">' + esc(x.srn) + '<small>bal ' + x.balance + '</small></button>'; }).join('') + '</div>';
    html += '<div id="q-fields"></div>';
    if (rows.length) html += '<div class="exist list">' + rows.map(function (r) {
      var v = q.type === 'ENDLINE' ? 'chk ' + r.checked + ' · pass ' + r.pass + ' · rej ' + r.reject : r.qty + ' pcs' + (r.cartons ? ' · ' + r.cartons + ' ctn' : '');
      return '<div class="item"><div><div class="name">' + esc(r.srn) + '</div><div class="sub">' + esc(v) + (r.checker ? ' · ' + esc(r.checker) : '') + ' · by ' + esc(r.by) + '</div></div><button class="btn danger small" data-del="' + esc(r.srn) + '">Hatao</button></div>';
    }).join('') + '</div>';
    html += '<button class="btn primary big" id="q-save">Save</button>';
    $('#sheet-content').innerHTML = html;
    renderFields(srns); bind();
  }

  function renderFields(srns) {
    var cur = rowsHere().filter(function (r) { return r.srn === q.srn; })[0] || {};
    var info = (srns || []).filter(function (x) { return x.srn === q.srn; })[0];
    var html = '';
    if (q.type === 'ENDLINE') {
      html += '<label>Checker</label><input id="f-checker" type="text" value="' + esc(cur.checker || S.recall('checker_' + state.line)) + '" placeholder="Checker ka naam">';
      html += '<div class="three"><div class="field"><label>Checked</label><input id="f-checked" type="number" inputmode="numeric" value="' + (cur.checked || '') + '"></div><div class="field"><label>Pass</label><input id="f-pass" type="number" inputmode="numeric" value="' + (cur.pass || '') + '"></div><div class="field"><label>Reject</label><input id="f-reject" type="number" inputmode="numeric" value="' + (cur.reject || '') + '"></div></div>';
    } else if (q.type === 'PACKING') {
      html += '<label>Pieces</label><input id="f-qty" class="bigin" type="number" inputmode="numeric" value="' + (cur.qty || '') + '" placeholder="0"><label>Cartons</label><input id="f-cartons" type="number" inputmode="numeric" value="' + (cur.cartons || '') + '" placeholder="0">';
    } else {
      html += '<label>Is ghante ka output</label><input id="f-qty" class="bigin" type="number" inputmode="numeric" value="' + (cur.qty || '') + '" placeholder="0">';
    }
    if (info) html += '<p class="hint">' + esc((info.item || '').slice(0, 40)) + ' · limit <b>' + info.limit + '</b> · ho chuka <b>' + info.used + '</b> · balance <b>' + info.balance + '</b></p>';
    $('#q-fields').innerHTML = html;
    var first = $('#f-qty') || $('#f-checked'); if (first) setTimeout(function () { first.focus(); }, 60);
    var c = $('#f-checked'), r = $('#f-reject'), p = $('#f-pass');
    if (c && r && p) { var auto = function () { if (!p.dataset.touched) p.value = Math.max(0, num(c.value) - num(r.value)); }; c.addEventListener('input', auto); r.addEventListener('input', auto); p.addEventListener('input', function () { p.dataset.touched = '1'; }); }
  }

  function bind() {
    var c = $('#sheet-content');
    c.onclick = function (e) {
      var b = e.target.closest('button'); if (!b) return;
      if (b.dataset.srn) { q.srn = b.dataset.srn; $$('#q-srns button').forEach(function (x) { x.classList.toggle('on', x === b); }); getOrders(q.type).then(renderFields); }
      else if (b.id === 'q-save') save();
      else if (b.dataset.del) { if (confirm(b.dataset.del + ' ki is slot ki entry hatayein?')) save(b.dataset.del); }
      else if (b.dataset.refresh) { api('orders.refresh').then(function () { return getOrders(q.type, true); }).then(renderQuick).catch(function (er) { toast(er.message, 'bad'); }); }
    };
    c.onkeydown = function (e) { if (e.key === 'Enter' && e.target.tagName === 'INPUT') { e.preventDefault(); save(); } };
  }

  function save(del) {
    var p = { date: state.date, factory: state.factory, type: q.type, dept: state.line, srn: del || q.srn, slot: q.slot };
    if (del) { p.qty = 0; p.checked = 0; p.checker = 'x'; }
    else if (q.type === 'ENDLINE') {
      p.checker = $('#f-checker').value.trim(); p.checked = num($('#f-checked').value); p.pass = num($('#f-pass').value); p.reject = num($('#f-reject').value);
      if (!p.checker) { toast('Checker ka naam likho', 'bad'); return; }
      if (p.pass + p.reject > p.checked) { toast('Pass + reject checked se zyada', 'bad'); return; }
      S.remember('checker_' + state.line, p.checker);
    } else {
      p.qty = num($('#f-qty').value);
      if (q.type === 'PACKING') p.cartons = num($('#f-cartons').value);
      var lf = S.M('LINE_FLOOR').filter(function (x) { return x.key === state.line; })[0]; p.floor = lf ? lf.value : '';
    }
    if (!del && !p.srn) { toast('SRN chuno', 'bad'); return; }
    if (!del) S.remember('srn_' + q.type + '_' + state.line, p.srn);
    api('hourly.slot', p)
      .then(function (d) {
        toast(del ? 'Hata diya' : d.queued ? 'Offline me save — baad me sync hoga' : 'Saved · aaj ' + d.total + ' · balance ' + d.balance, 'ok');
        S.invalidateOrders(); S.invalidate(); S.sheet.close(); S.refresh();
      })
      .catch(function (e) { toast(e.message, 'bad', 6000); });
  }
})();
