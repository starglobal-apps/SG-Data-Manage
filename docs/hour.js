// hour.js — "Update output" screen: one hour slot, every line of the factory on one page, one Save.
(function () {
  'use strict';
  var S = window.SG, $ = S.$, $$ = S.$$, esc = S.esc, api = S.api, state = S.state, toast = S.toast, icon = S.icon;
  var H = { slot: '', data: null, initial: '' };
  function num(v) { var n = Number(v); return isNaN(n) ? 0 : n; }
  function showEndline() { return S.recall('show_endline') === '1'; }

  S.screens.hour = function (slot) {
    H.slot = slot || H.slot || S.slots('Final')[0].key;
    S.push('hour', 'Update output');
    load();
  };

  function load() {
    var sd = S.slotDef(H.slot) || { label: H.slot, shift: '' };
    $('#hour-head').innerHTML = '<button class="hdr-btn dark" data-nav="-1">‹</button><div class="hour-title"><b>' + esc(sd.label) + '</b><span>' + esc(sd.shift === 'Final' ? 'Day' : sd.shift) + ' · FAC' + esc(state.factory) + ' · ' + esc(S.fmtDay(state.date)) + '</span></div><button class="hdr-btn dark" data-nav="1">›</button>';
    $('#hour-list').innerHTML = '<div class="empty">Loading…</div>';
    $('#btn-hour-save').disabled = true;
    api('hour.get', { date: state.date, factory: state.factory, slot: H.slot }, { quiet: true })
      .then(function (d) { H.data = d; render(); })
      .catch(function (e) { $('#hour-list').innerHTML = '<div class="empty">' + esc(e.message) + '</div>'; });
  }

  function srnSelect(opts, sel, cls) {
    return '<select class="' + cls + '">' + (sel && !opts.some(function (o) { return o.srn === sel; }) ? '<option value="' + esc(sel) + '" selected>' + esc(sel) + '</option>' : '') +
      opts.map(function (o) { return '<option value="' + esc(o.srn) + '"' + (o.srn === sel ? ' selected' : '') + '>' + esc(o.srn) + ' (bal ' + o.balance + ')</option>'; }).join('') + '</select>';
  }

  function outRow(d, type, r) {
    r = r || {};
    var opts = d.srns[type] || [], sel = r.srn || d.lastSrn[type] || (opts[0] ? opts[0].srn : '');
    return '<div class="hrow" data-type="' + type + '">' + srnSelect(opts, sel, 'f-srn') +
      '<input class="f-qty" type="number" inputmode="numeric" placeholder="' + (type === 'PACKING' ? 'pcs' : 'qty') + '" value="' + (r.qty || '') + '">' +
      (type === 'PACKING' ? '<input class="f-ctn" type="number" inputmode="numeric" placeholder="ctn" value="' + (r.cartons || '') + '">' : '') + '</div>';
  }
  function endRow(d, r) {
    r = r || {};
    var opts = d.srns.ENDLINE || [], sel = r.srn || d.lastSrn.ENDLINE || d.lastSrn.STITCH || (opts[0] ? opts[0].srn : '');
    return '<div class="hrow end" data-type="ENDLINE">' + srnSelect(opts, sel, 'f-srn') +
      '<input class="f-chk" type="number" inputmode="numeric" placeholder="chk" value="' + (r.checked || '') + '"><input class="f-pass" type="number" inputmode="numeric" placeholder="pass" value="' + (r.pass || '') + '"><input class="f-rej" type="number" inputmode="numeric" placeholder="rej" value="' + (r.reject || '') + '"></div>';
  }

  function render() {
    var d = H.data, html = '';
    if (!d.depts.length) { $('#hour-list').innerHTML = '<div class="empty">Is factory me aapki koi stitching/packing line nahi</div>'; return; }
    d.depts.forEach(function (dp, i) {
      var type = dp.cat === 'PACKING' ? 'PACKING' : 'STITCH';
      var rows = dp.rows[type] || [], erows = dp.rows.ENDLINE || [], lock = dp.locked[type];
      var noSrn = !(dp.srns[type] || []).length;
      html += '<div class="hcard' + (rows.length ? ' done' : '') + (lock ? ' lock' : '') + '" data-i="' + i + '" data-floor="' + esc(dp.floor) + '">';
      html += '<div class="hcard-h"><span class="nm">' + esc(dp.dept.replace(/^FAC\d+-/, '')) + '</span>' + (lock ? S.pill(lock) : rows.length ? '<span class="tick">✓ ' + rows.reduce(function (t, r) { return t + r.qty; }, 0) + '</span>' : '') + '</div>';
      if (lock) { html += '<div class="hint">' + esc(lock) + ' — edit band</div>'; }
      else if (noSrn) { html += '<div class="hint warn">' + (type === 'PACKING' ? 'Koi SRN nahi jiska endline-pass balance ho' : 'Is line par loading nahi mili') + '</div>'; }
      else {
        html += '<div class="hrows" data-type="' + type + '">' + (rows.length ? rows.map(function (r) { return outRow(dp, type, r); }).join('') : outRow(dp, type)) + '</div>';
        html += '<button class="lnk" data-add="' + type + '">+ dusra SRN</button>';
      }
      if (dp.cat === 'STITCH' && !dp.locked.ENDLINE && (showEndline() || erows.length)) {
        html += '<div class="hend"><div class="hend-h">' + icon('qc') + ' Endline <input class="f-checker" type="text" placeholder="checker" value="' + esc(erows.length ? erows[0].checker : dp.checker) + '"></div>' +
          '<div class="hrows" data-type="ENDLINE">' + (erows.length ? erows.map(function (r) { return endRow(dp, r); }).join('') : ((dp.srns.ENDLINE || []).length ? endRow(dp) : '<div class="hint">Stitching output pehle</div>')) + '</div></div>';
      }
      html += '</div>';
    });
    $('#hour-list').innerHTML = html;
    H.initial = snapshot();
    $('#btn-hour-save').disabled = false;
  }

  function snapshot() { return JSON.stringify(collect()); }

  // every (dept, type, srn) currently on screen -> item; also emits qty 0 for existing rows the user cleared
  function collect() {
    var items = [];
    $$('#hour-list .hcard').forEach(function (card) {
      var dp = H.data.depts[Number(card.dataset.i)];
      var checker = ($('.f-checker', card) || { value: '' }).value.trim();
      $$('.hrows', card).forEach(function (box) {
        var type = box.dataset.type, seen = {};
        $$('.hrow', box).forEach(function (row) {
          var srn = $('.f-srn', row).value; if (!srn || seen[srn]) return; seen[srn] = true;
          var it = { type: type, dept: dp.dept, srn: srn, floor: dp.floor };
          if (type === 'ENDLINE') { it.checked = num($('.f-chk', row).value); it.pass = num($('.f-pass', row).value); it.reject = num($('.f-rej', row).value); it.checker = checker; }
          else { it.qty = num($('.f-qty', row).value); if (type === 'PACKING') it.cartons = num(($('.f-ctn', row) || { value: 0 }).value); }
          items.push(it);
        });
        // rows that existed on the server but were removed from the screen -> delete
        (dp.rows[type] || []).forEach(function (r) { if (!seen[r.srn]) items.push({ type: type, dept: dp.dept, srn: r.srn, qty: 0, checked: 0, checker: 'x' }); });
      });
    });
    return items;
  }

  function save() {
    var items = collect().filter(function (it) { return it.qty > 0 || it.checked > 0 || it.checker === 'x'; });
    if (!items.length) { toast('Kuch bhara nahi', 'bad'); return; }
    var bad = items.filter(function (it) { return it.type === 'ENDLINE' && it.checked > 0 && (it.pass + it.reject > it.checked || !it.checker); })[0];
    if (bad) { toast(bad.dept.replace(/^FAC\d+-/, '') + ': ' + (!bad.checker ? 'checker ka naam likho' : 'pass + reject checked se zyada'), 'bad'); return; }
    api('hour.save', { date: state.date, factory: state.factory, slot: H.slot, items: items })
      .then(function (d) {
        var fails = d.results.filter(function (r) { return !r.ok; });
        S.invalidate();
        if (fails.length) {
          toast(d.saved + ' saved · ' + fails.length + ' nahi: ' + fails[0].dept.replace(/^FAC\d+-/, '') + ' — ' + fails[0].message, 'bad', 8000);
          load();
        } else {
          toast('Saved · ' + d.saved + ' lines', 'ok');
          var next = nextSlot(1);
          if (next && S.isToday() && S.nowHour() >= S.slotStart(next.key)) { H.slot = next.key; load(); } else S.back();
        }
      })
      .catch(function (e) { toast(e.message, 'bad', 6000); });
  }

  function nextSlot(dir) {
    var all = S.slots(), i = all.findIndex(function (s) { return s.key === H.slot; });
    return all[i + dir] || null;
  }

  $('#hour-head').addEventListener('click', function (e) {
    var b = e.target.closest('button[data-nav]'); if (!b) return;
    if (snapshot() !== H.initial && !confirm('Bina save kiye slot badlein?')) return;
    var n = nextSlot(Number(b.dataset.nav)); if (n) { H.slot = n.key; load(); }
  });
  $('#hour-list').addEventListener('click', function (e) {
    var b = e.target.closest('button[data-add]'); if (!b) return;
    var card = b.closest('.hcard'), dp = H.data.depts[Number(card.dataset.i)], type = b.dataset.add;
    $('.hrows[data-type="' + type + '"]', card).insertAdjacentHTML('beforeend', outRow(dp, type, { srn: '' }));
  });
  $('#hour-list').addEventListener('input', function (e) {
    var row = e.target.closest('.hrow'); if (!row || row.dataset.type !== 'ENDLINE') return;
    var c = $('.f-chk', row), r = $('.f-rej', row), p = $('.f-pass', row);
    if (e.target === p) p.dataset.touched = '1';
    else if (!p.dataset.touched) p.value = Math.max(0, num(c.value) - num(r.value));
  });
  $('#btn-hour-save').addEventListener('click', save);
})();
