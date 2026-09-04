// hour.js — "Update output": one slot, three tabs (Stitching / Endline / Packing), every line as one compact row.
// SRN comes from attendance (auto), the recorder types only the quantity. One Save per tab.
(function () {
  'use strict';
  var S = window.SG, $ = S.$, $$ = S.$$, esc = S.esc, api = S.api, state = S.state, toast = S.toast, icon = S.icon;
  var H = { slot: '', type: 'STITCH', data: null, initial: '' };
  var TYPES = [{ k: 'STITCH', l: 'Stitching' }, { k: 'ENDLINE', l: 'Endline' }, { k: 'PACKING', l: 'Packing' }];
  function num(v) { var n = Number(v); return isNaN(n) ? 0 : n; }

  S.screens.hour = function (slot, type) {
    H.slot = slot || H.slot || S.slots('Final')[0].key;
    if (type) H.type = type;
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

  function deptsOf(type) { return H.data.depts.filter(function (d) { return type === 'PACKING' ? d.cat === 'PACKING' : d.cat === 'STITCH'; }); }
  function doneCount(type) { return deptsOf(type).filter(function (d) { return (d.rows[type] || []).length; }).length; }

  function srnSel(opts, sel) {
    if (sel && !opts.some(function (o) { return o.srn === sel; })) opts = [{ srn: sel, balance: '' }].concat(opts);
    return '<select class="f-srn">' + opts.map(function (o) { return '<option value="' + esc(o.srn) + '"' + (o.srn === sel ? ' selected' : '') + '>' + esc(o.srn) + (o.balance !== '' ? ' · ' + o.balance : '') + '</option>'; }).join('') + '</select>';
  }

  function lineRow(d, type, r, extra) {
    r = r || {};
    var opts = d.srns[type] || [], sel = r.srn || d.lastSrn[type] || d.attSrn || (opts[0] ? opts[0].srn : '');
    var lock = d.locked[type], noSrn = !opts.length && !sel;
    var cls = lock ? 'lock' : (r.srn ? 'done' : '');
    var nm = '<span class="nm">' + esc(S.shortLine(d.dept)) + (d.attSrn && !r.srn ? '<small>att: ' + esc(d.attSrn) + '</small>' : '') + '</span>';
    if (lock) return '<div class="hline lock" data-i="' + d._i + '">' + nm + '<span class="msg" style="color:var(--muted)">' + esc(lock) + ' — edit band</span></div>';
    if (noSrn) return '<div class="hline" data-i="' + d._i + '">' + nm + '<span class="msg" style="color:var(--warn)">' + (type === 'PACKING' ? 'Koi SRN nahi (endline-pass balance 0)' : type === 'ENDLINE' ? 'Pehle stitching output' : 'Loading nahi mili') + '</span></div>';
    var inputs = type === 'ENDLINE'
      ? '<input class="f-chk sm" type="number" inputmode="numeric" placeholder="chk" value="' + (r.checked || '') + '"><input class="f-pass sm" type="number" inputmode="numeric" placeholder="pass" value="' + (r.pass || '') + '"><input class="f-rej sm" type="number" inputmode="numeric" placeholder="rej" value="' + (r.reject || '') + '">'
      : '<input class="f-qty" type="number" inputmode="numeric" placeholder="' + (type === 'PACKING' ? 'pcs' : 'qty') + '" value="' + (r.qty || '') + '">' + (type === 'PACKING' ? '<input class="f-ctn sm" type="number" inputmode="numeric" placeholder="ctn" value="' + (r.cartons || '') + '">' : '');
    var checker = type === 'ENDLINE' ? '<div class="chk-name">' + icon('qc') + '<input class="f-checker" type="text" placeholder="checker ka naam" value="' + esc(r.checker || d.checker || '') + '"></div>' : '';
    return '<div class="hline ' + cls + (checker ? ' wrap' : '') + '" data-i="' + d._i + '" data-type="' + type + '" data-extra="' + (extra ? 1 : 0) + '">' + (extra ? '<span class="nm"><small>+ dusra SRN</small></span>' : nm) + srnSel(opts, sel) + inputs + checker + '</div>';
  }

  function render() {
    H.data.depts.forEach(function (d, i) { d._i = i; });
    var seg = '<div class="seg">' + TYPES.map(function (t) { var n = deptsOf(t.k).length; return n ? '<button data-t="' + t.k + '" class="' + (t.k === H.type ? 'on' : '') + '">' + t.l + ' <small>' + doneCount(t.k) + '/' + n + '</small></button>' : ''; }).join('') + '</div>';
    var depts = deptsOf(H.type), html = seg;
    if (!depts.length) html += '<div class="empty">Is type ki koi line nahi</div>';
    else {
      html += '<div class="hlist-hint">' + (H.type === 'ENDLINE' ? 'Checked / Pass / Reject — pass apne aap = checked − reject' : 'SRN attendance se aaya hai · sirf qty bharo') + '</div>';
      depts.forEach(function (d) {
        var rows = d.rows[H.type] || [];
        html += rows.length ? rows.map(function (r, j) { return lineRow(d, H.type, r, j > 0); }).join('') : lineRow(d, H.type);
      });
      html += '<button class="lnk" id="hour-add">+ kisi line me dusra SRN</button>';
    }
    $('#hour-list').innerHTML = html;
    H.initial = snapshot();
    $('#btn-hour-save').disabled = !depts.length;
    var first = $('#hour-list .hline:not(.done) input'); if (first) setTimeout(function () { first.focus(); }, 80);
  }

  function collect() {
    var items = [], seen = {};
    $$('#hour-list .hline[data-type]').forEach(function (row) {
      var d = H.data.depts[Number(row.dataset.i)], type = row.dataset.type, sel = $('.f-srn', row); if (!sel) return;
      var srn = sel.value, k = d.dept + '|' + srn; if (!srn || seen[k]) return; seen[k] = true;
      var it = { type: type, dept: d.dept, srn: srn, floor: d.floor };
      if (type === 'ENDLINE') { it.checked = num($('.f-chk', row).value); it.pass = num($('.f-pass', row).value); it.reject = num($('.f-rej', row).value); it.checker = ($('.f-checker', row) || { value: '' }).value.trim(); }
      else { it.qty = num($('.f-qty', row).value); if (type === 'PACKING') it.cartons = num(($('.f-ctn', row) || { value: 0 }).value); }
      items.push(it);
    });
    // rows that existed on the server for this type but are no longer on screen -> delete
    deptsOf(H.type).forEach(function (d) { (d.rows[H.type] || []).forEach(function (r) { if (!seen[d.dept + '|' + r.srn]) items.push({ type: H.type, dept: d.dept, srn: r.srn, qty: 0, checked: 0, checker: 'x' }); }); });
    return items;
  }
  function snapshot() { return JSON.stringify(collect()); }

  function save() {
    var items = collect().filter(function (it) { return it.qty > 0 || it.checked > 0 || it.checker === 'x'; });
    if (!items.length) { toast('Kuch bhara nahi', 'bad'); return; }
    var bad = items.filter(function (it) { return it.type === 'ENDLINE' && it.checked > 0 && (it.pass + it.reject > it.checked || !it.checker); })[0];
    if (bad) { toast(S.shortLine(bad.dept) + ': ' + (!bad.checker ? 'checker ka naam likho' : 'pass + reject > checked'), 'bad'); return; }
    api('hour.save', { date: state.date, factory: state.factory, slot: H.slot, items: items })
      .then(function (d) {
        S.invalidateAll();
        var fails = d.results.filter(function (r) { return !r.ok; });
        if (fails.length) { toast(d.saved + ' saved · ' + fails.length + ' nahi: ' + S.shortLine(fails[0].dept) + ' — ' + fails[0].message, 'bad', 8000); load(); return; }
        toast('Saved · ' + d.saved + ' lines', 'ok');
        // move to the next type that still has empty lines, else next slot, else back home
        var nextType = TYPES.map(function (t) { return t.k; }).filter(function (k) { return k !== H.type && deptsOf(k).length && doneCount(k) < deptsOf(k).length; })[0];
        if (nextType && nextType !== 'ENDLINE') { H.type = nextType; load(); return; }
        S.back();
      })
      .catch(function (e) { toast(e.message, 'bad', 6000); });
  }

  function nextSlot(dir) { var all = S.slots(), i = all.findIndex(function (s) { return s.key === H.slot; }); return all[i + dir] || null; }

  $('#hour-head').addEventListener('click', function (e) {
    var b = e.target.closest('button[data-nav]'); if (!b) return;
    if (snapshot() !== H.initial && !confirm('Bina save kiye slot badlein?')) return;
    var n = nextSlot(Number(b.dataset.nav)); if (n) { H.slot = n.key; load(); }
  });
  $('#hour-list').addEventListener('click', function (e) {
    var t = e.target.closest('.seg button[data-t]');
    if (t) { if (snapshot() !== H.initial && !confirm('Bina save kiye tab badlein?')) return; H.type = t.dataset.t; render(); return; }
    if (e.target.id === 'hour-add') {
      var depts = deptsOf(H.type).filter(function (d) { return !d.locked[H.type] && (d.srns[H.type] || []).length; });
      S.sheet.open('Kis line me dusra SRN?', '<div class="chips" style="flex-wrap:wrap">' + depts.map(function (d) { return '<button data-i="' + d._i + '">' + esc(S.shortLine(d.dept)) + '</button>'; }).join('') + '</div>');
      $('#sheet-content').onclick = function (ev) {
        var b = ev.target.closest('button[data-i]'); if (!b) return;
        var d = H.data.depts[Number(b.dataset.i)], rows = $$('#hour-list .hline[data-i="' + d._i + '"]'), last = rows[rows.length - 1];
        last.insertAdjacentHTML('afterend', lineRow(d, H.type, { srn: '' }, true));
        S.sheet.close();
      };
    }
  });
  $('#hour-list').addEventListener('input', function (e) {
    var row = e.target.closest('.hline'); if (!row) return;
    if (row.dataset.type === 'ENDLINE') {
      var c = $('.f-chk', row), r = $('.f-rej', row), p = $('.f-pass', row);
      if (e.target === p) p.dataset.touched = '1'; else if (p && !p.dataset.touched) p.value = Math.max(0, num(c.value) - num(r.value));
    }
    var any = $$('input[type=number]', row).some(function (i) { return num(i.value) > 0; });
    row.classList.toggle('done', any);
  });
  // Enter -> jump to the next line's input
  $('#hour-list').addEventListener('keydown', function (e) {
    if (e.key !== 'Enter' || e.target.tagName !== 'INPUT') return;
    e.preventDefault();
    var inputs = $$('#hour-list .hline input[type=number]'), i = inputs.indexOf(e.target);
    var nxt = inputs.slice(i + 1).filter(function (x) { return !x.classList.contains('sm'); })[0] || inputs[i + 1];
    if (nxt) nxt.focus(); else save();
  });
  $('#btn-hour-save').addEventListener('click', save);
})();
