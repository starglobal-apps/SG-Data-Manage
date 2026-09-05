// hour.js — "Update output": one slot, three tabs (Stitching / Endline / Packing), every line as one compact row.
// SRN comes from attendance (auto), the recorder types only the quantity. Stays on the screen after Save so the
// next tab can be filled. Per line: manpower for this hour, "−" to mark someone left/came, "⇄" to transfer.
(function () {
  'use strict';
  var S = window.SG, $ = S.$, $$ = S.$$, esc = S.esc, api = S.api, state = S.state, toast = S.toast, icon = S.icon;
  var H = { slot: '', type: 'STITCH', data: null, initial: '', dirty: false };
  var TYPES = [{ k: 'STITCH', l: 'Stitching' }, { k: 'ENDLINE', l: 'Endline' }, { k: 'PACKING', l: 'Packing' }];
  function num(v) { var n = Number(v); return isNaN(n) ? 0 : n; }
  function pad(n) { return String(n).padStart(2, '0'); }

  S.screens.hour = function (slot, type) {
    H.slot = slot || H.slot || S.slots('Final')[0].key;
    if (type) H.type = type;
    S.push('hour', 'Update output');
    load();
  };

  function load(force) {
    var sd = S.slotDef(H.slot) || { label: H.slot, shift: '' };
    $('#hour-head').innerHTML = '<button class="hdr-btn dark" data-nav="-1">‹</button><div class="hour-title"><b>' + esc(sd.label) + '</b><span>' + esc(sd.shift === 'Final' ? 'Day' : sd.shift) + ' · FAC' + esc(state.factory) + ' · ' + esc(S.fmtDay(state.date)) + '</span></div><button class="hdr-btn dark" data-nav="1">›</button>';
    var r = S.swr('hour.get', { date: state.date, factory: state.factory, slot: H.slot }, force ? 0 : 10000);
    if (r.data) { H.data = r.data; render(); } else { $('#hour-list').innerHTML = '<div class="empty">Loading…</div>'; $('#btn-hour-save').disabled = true; }
    r.promise.then(function (d) { if (d === H.data) return; H.data = d; if (!H.dirty) render(); })
      .catch(function (e) { if (!H.data) $('#hour-list').innerHTML = '<div class="empty">' + esc(e.message) + '</div>'; });
  }

  function deptsOf(type) { return H.data.depts.filter(function (d) { return type === 'PACKING' ? d.cat === 'PACKING' : d.cat === 'STITCH'; }); }
  function doneCount(type) { return deptsOf(type).filter(function (d) { return (d.rows[type] || []).length; }).length; }

  function srnSel(opts, sel) {
    if (sel && !opts.some(function (o) { return o.srn === sel; })) opts = [{ srn: sel, balance: '' }].concat(opts);
    return '<select class="f-srn">' + opts.map(function (o) { return '<option value="' + esc(o.srn) + '"' + (o.srn === sel ? ' selected' : '') + '>' + esc(o.srn) + (o.balance !== '' ? ' · ' + o.balance : '') + '</option>'; }).join('') + '</select>';
  }

  function lineRow(d, type, r, extra) {
    r = r || {};
    var opts = d.srns[type] || [], sel = r.srn || d.lastSrn[type] || d.attSrn || (type !== 'PACKING' && opts[0] ? opts[0].srn : '');
    var lock = d.locked[type], noSrn = !opts.length && !sel;
    var cls = lock ? 'lock' : (r.srn ? 'done' : '');
    var mp = '<span class="mpb' + (d.mp !== d.mpBase ? ' chg' : '') + '" title="Is ghante manpower">' + d.mp + ' mp</span>';
    var acts = type === 'ENDLINE' ? '' : '<button type="button" class="act" data-mp="' + d._i + '" title="Koi gaya / aaya">−</button><button type="button" class="act" data-tr="' + d._i + '" title="Transfer">⇄</button>';
    var nm = '<span class="nm">' + esc(S.shortLine(d.dept)) + (d.attSrn && !r.srn ? '<small>att: ' + esc(d.attSrn) + '</small>' : '<small>' + (d.mpBase ? d.mpBase + ' subah' : 'attendance nahi') + '</small>') + '</span>';
    if (lock) return '<div class="hline lock" data-i="' + d._i + '">' + nm + mp + '<span class="msg" style="color:var(--muted)">' + esc(lock) + ' — edit band</span></div>';
    if (noSrn) return '<div class="hline" data-i="' + d._i + '">' + nm + mp + acts + '<span class="msg" style="color:var(--warn)">' + (type === 'PACKING' ? 'Koi SRN nahi (endline-pass balance 0)' : type === 'ENDLINE' ? 'Pehle stitching output' : 'Loading nahi mili') + '</span></div>';
    var inputs = type === 'ENDLINE'
      ? '<input class="f-chk sm" type="number" inputmode="numeric" placeholder="chk" value="' + (r.checked || '') + '"><input class="f-pass sm" type="number" inputmode="numeric" placeholder="pass" value="' + (r.pass || '') + '"><input class="f-rej sm" type="number" inputmode="numeric" placeholder="rej" value="' + (r.reject || '') + '">'
      : '<input class="f-qty" type="number" inputmode="numeric" placeholder="' + (type === 'PACKING' ? 'pcs' : 'qty') + '" value="' + (r.qty || '') + '">' + (type === 'PACKING' ? '<input class="f-ctn sm" type="number" inputmode="numeric" placeholder="ctn" value="' + (r.cartons || '') + '">' : '');
    var checker = type === 'ENDLINE' ? '<div class="chk-name">' + icon('qc') + '<input class="f-checker" type="text" placeholder="checker ka naam" value="' + esc(r.checker || d.checker || '') + '"></div>' : '';
    if (type === 'PACKING') {
      // two lines: [name · mp · actions] / [SRN search · pcs · ctn]
      return '<div class="hline pack ' + cls + '" data-i="' + d._i + '" data-type="' + type + '" data-extra="' + (extra ? 1 : 0) + '">' +
        '<div class="top">' + (extra ? '<span class="nm"><small>+ dusra SRN</small></span>' : nm + mp + acts) + '</div>' +
        '<div class="bot"><div class="srnp-mount" data-sel="' + esc(sel) + '"></div>' + inputs + '</div></div>';
    }
    return '<div class="hline ' + cls + (checker ? ' wrap' : '') + '" data-i="' + d._i + '" data-type="' + type + '" data-extra="' + (extra ? 1 : 0) + '">' + (extra ? '<span class="nm"><small>+ dusra SRN</small></span>' : nm) + (extra || type === 'ENDLINE' ? '' : mp) + srnSel(opts, sel) + inputs + (extra || type === 'ENDLINE' ? '' : acts) + checker + '</div>';
  }
  function mountPickers() {
    $$('#hour-list .srnp-mount').forEach(function (m) {
      var row = m.closest('.hline'), d = H.data.depts[Number(row.dataset.i)];
      S.srnPicker(m, { list: d.srns.PACKING || [], value: m.dataset.sel, placeholder: 'SRN no.', onPick: function () { H.dirty = true; } });
    });
  }

  function render() {
    H.data.depts.forEach(function (d, i) { d._i = i; });
    var seg = '<div class="seg">' + TYPES.map(function (t) { var n = deptsOf(t.k).length; return n ? '<button data-t="' + t.k + '" class="' + (t.k === H.type ? 'on' : '') + '">' + t.l + ' <small>' + doneCount(t.k) + '/' + n + '</small></button>' : ''; }).join('') + '</div>';
    var depts = deptsOf(H.type), html = seg;
    var allDone = TYPES.every(function (t) { return !deptsOf(t.k).length || doneCount(t.k) >= deptsOf(t.k).length; });
    html += '<div class="hour-tools"><span>' + (H.type === 'ENDLINE' ? 'Chk / Pass / Rej · pass auto = chk − rej' : 'SRN attendance se · sirf qty bharo · Enter = agli line') + '</span><button class="lnk hdone" data-done="1">' + (allDone ? '✓ Ghanta poora · Home' : 'Home ‹') + '</button></div>';
    if (!depts.length) html += '<div class="empty">Is type ki koi line nahi</div>';
    else {
      depts.forEach(function (d) {
        var rows = d.rows[H.type] || [];
        html += rows.length ? rows.map(function (r, j) { return lineRow(d, H.type, r, j > 0); }).join('') : lineRow(d, H.type);
      });
      html += '<button class="lnk" id="hour-add">+ kisi line me dusra SRN</button>';
    }
    $('#hour-list').innerHTML = html;
    mountPickers();
    H.initial = snapshot(); H.dirty = false;
    $('#btn-hour-save').disabled = !depts.length;
    var first = $('#hour-list .hline:not(.done) input[type=number]'); if (first) setTimeout(function () { first.focus(); }, 80);
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
    deptsOf(H.type).forEach(function (d) { (d.rows[H.type] || []).forEach(function (r) { if (!seen[d.dept + '|' + r.srn]) items.push({ type: H.type, dept: d.dept, srn: r.srn, qty: 0, checked: 0, checker: 'x' }); }); });
    return items;
  }
  function snapshot() { return JSON.stringify(collect()); }

  function save() {
    var items = collect().filter(function (it) { return it.qty > 0 || it.checked > 0 || it.checker === 'x'; });
    if (!items.length) { toast('Kuch bhara nahi', 'bad'); return; }
    var bad = items.filter(function (it) { return it.type === 'ENDLINE' && it.checked > 0 && (it.pass + it.reject > it.checked || !it.checker); })[0];
    if (bad) { toast(S.shortLine(bad.dept) + ': ' + (!bad.checker ? 'checker ka naam likho' : 'pass + reject > checked'), 'bad'); return; }
    var savedType = H.type;
    api('hour.save', { date: state.date, factory: state.factory, slot: H.slot, items: items })
      .then(function (d) {
        S.invalidateAll(); S.clearLocalCaches();
        var fails = d.results.filter(function (r) { return !r.ok; });
        if (fails.length) { toast(d.saved + ' saved · ' + fails.length + ' nahi: ' + S.shortLine(fails[0].dept) + ' — ' + fails[0].message, 'bad', 8000); H.dirty = false; load(true); return; }
        // stay here: move to the next tab that still has empty lines (Stitching -> Endline -> Packing)
        var order = TYPES.map(function (t) { return t.k; }), i = order.indexOf(savedType);
        var nextType = order.slice(i + 1).concat(order.slice(0, i)).filter(function (k) { return deptsOf(k).length && doneCount(k) + (k === savedType ? d.saved : 0) < deptsOf(k).length; })[0];
        toast('Saved · ' + d.saved + ' lines' + (nextType ? ' → ab ' + TYPES.filter(function (t) { return t.k === nextType; })[0].l : ' · ghanta poora ✓'), 'ok');
        if (nextType) H.type = nextType;
        H.dirty = false; load(true);
      })
      .catch(function (e) { toast(e.message, 'bad', 6000); });
  }

  function nextSlot(dir) { var all = S.slots(), i = all.findIndex(function (s) { return s.key === H.slot; }); return all[i + dir] || null; }
  function slotTime() { var h = S.slotStart(H.slot); return pad(h) + ':00'; }
  function nowTime() { var d = new Date(); return pad(d.getHours()) + ':' + pad(d.getMinutes()); }

  // ---- manpower change sheet (someone left / came) ----
  function mpSheet(d) {
    var evs = (state.masters.mpEvents || []).filter(function (e) { return e.key !== 'TRANSFER_IN' && e.key !== 'TRANSFER_OUT'; });
    var html = '<label>Role</label><select id="m-role">' + S.rolesForDept(d.dept).map(function (r) { return '<option>' + esc(r) + '</option>'; }).join('') + '</select>' +
      '<div class="row"><div class="field"><label>Kya hua</label><select id="m-ev">' + evs.map(function (e) { return '<option value="' + esc(e.key) + '"' + (e.key === 'LEFT_AT' ? ' selected' : '') + '>' + esc(e.label) + '</option>'; }).join('') + '</select></div>' +
      '<div class="field small"><label>Kitne</label><input id="m-count" type="number" inputmode="numeric" value="1" min="1"></div></div>' +
      '<div class="row"><div class="field small"><label>Time</label><input id="m-time" type="time" value="' + (S.isToday() ? nowTime() : slotTime()) + '"></div><div class="field"><label>Note</label><input id="m-note" type="text" placeholder="optional"></div></div>' +
      '<button class="btn primary big" id="m-save">Save</button>';
    S.sheet.open(S.shortLine(d.dept) + ' · manpower change', html);
    var c = $('#sheet-content');
    c.onclick = function (e) {
      if (!e.target.closest('#m-save')) return;
      var ev = $('#m-ev').value, needs = (evs.filter(function (x) { return x.key === ev; })[0] || {}).needsTime;
      var p = { date: state.date, factory: state.factory, dept: d.dept, role: $('#m-role').value, event: ev, count: num($('#m-count').value), time: needs ? $('#m-time').value : '', note: $('#m-note').value.trim() };
      if (p.count < 1) { toast('Count 1 ya zyada', 'bad'); return; }
      api('manpower.save', p).then(function (r) { toast('Saved (' + r.eff_hours + ' hrs)', 'ok'); S.sheet.close(); S.invalidateAll(); S.clearLocalCaches(); load(true); setTimeout(function () { S.offerGroup('Manpower change group me bhejein?'); }, 400); }).catch(function (er) { toast(er.message, 'bad'); });
    };
  }

  // ---- transfer sheet: my line -> another data recorder, any number of roles ----
  function availByRole(d) {
    // this hour's manpower per role: attendance roles ± today's events for this dept
    var ft = S.factoryData() || {}, roles = (ft.attRoles && ft.attRoles[d.dept + '|Final']) || {}, out = {};
    Object.keys(roles).forEach(function (r) { out[r] = roles[r]; });
    (ft.eventList || []).forEach(function (e) {
      if (e.dept !== d.dept) return;
      var add = e.event === 'EXTRA' || e.event === 'TRANSFER_IN' || e.event === 'LATE_JOIN';
      out[e.role] = (out[e.role] || 0) + (add ? e.count : -e.count);
    });
    return out;
  }
  function trSheet(d) {
    var avail = availByRole(d), roles = Object.keys(avail).filter(function (r) { return avail[r] > 0; });
    if (!roles.length) roles = S.rolesForDept(d.dept);
    var html = '<div class="hint" style="margin:0 0 6px">Se: <b>' + esc(S.shortLine(d.dept)) + '</b> · abhi ' + d.mp + ' mp</div>' +
      '<label>Kis data recorder ko</label><select id="t-to"><option value="">Loading…</option></select>' +
      '<label>Kitne log (role-wise)</label><div id="t-roles">' + roles.map(function (r) { return '<div class="tr-role"><span class="n">' + esc(r) + '</span><span class="av">' + (avail[r] || 0) + ' hai</span><input type="number" inputmode="numeric" min="0" max="' + (avail[r] || 99) + '" placeholder="0" data-role="' + esc(r) + '"></div>'; }).join('') + '</div>' +
      '<div class="row"><div class="field small"><label>Time</label><input id="t-time" type="time" value="' + (S.isToday() ? nowTime() : slotTime()) + '"></div><div class="field"><label>Note</label><input id="t-note" type="text" placeholder="optional"></div></div>' +
      '<p class="hint">Wo recorder decide karega kis line / floor par lagana hai. Aapki line se abhi hat jayenge.</p>' +
      '<button class="btn primary big" id="t-save">Transfer bhejo · <span id="t-total">0</span></button>';
    S.sheet.open(S.shortLine(d.dept) + ' → transfer', html);
    api('users.recorders', { factory: state.factory }, { quiet: true }).then(function (r) {
      var sel = $('#t-to'); if (!sel) return;
      sel.innerHTML = '<option value="">— recorder chuno —</option>' + r.users.map(function (u) { return '<option value="' + esc(u.user_id) + '">' + esc(u.name) + (u.depts.length ? ' (' + u.depts.map(S.shortLine).join(', ') + ')' : '') + '</option>'; }).join('');
    }).catch(function (e) { toast(e.message, 'bad'); });
    var c = $('#sheet-content');
    c.oninput = function () { var t = 0; $$('#t-roles input').forEach(function (i) { t += num(i.value); }); var el = $('#t-total'); if (el) el.textContent = t; };
    c.onclick = function (e) {
      if (!e.target.closest('#t-save')) return;
      var items = $$('#t-roles input').map(function (i) { return { role: i.dataset.role, count: num(i.value) }; }).filter(function (x) { return x.count > 0; });
      var over = items.filter(function (x) { return avail[x.role] !== undefined && x.count > avail[x.role]; })[0];
      if (over) { toast(over.role + ': sirf ' + avail[over.role] + ' hain', 'bad'); return; }
      var p = { date: state.date, factory: state.factory, from_dept: d.dept, to_user: $('#t-to').value, items: items, time: $('#t-time').value, note: $('#t-note').value.trim() };
      if (!p.to_user) { toast('Recorder chuno', 'bad'); return; }
      if (!items.length) { toast('Kitne log — qty daalo', 'bad'); return; }
      api('transfer.create', p).then(function (r) {
        toast('Transfer bheja · ' + r.to_name + ' adjust karega', 'ok');
        S.invalidateAll(); S.clearLocalCaches(); load(true);
        S.sendTransferToGroup({ from_dept: d.dept, to_name: r.to_name, items: items, time: p.time, note: p.note });
      }).catch(function (er) { toast(er.message, 'bad'); });
    };
  }

  $('#hour-head').addEventListener('click', function (e) {
    var b = e.target.closest('button[data-nav]'); if (!b) return;
    var go = function () { var n = nextSlot(Number(b.dataset.nav)); if (n) { H.slot = n.key; H.dirty = false; load(); } };
    if (H.dirty && snapshot() !== H.initial) S.ask('Bina save kiye slot badlein?', { ok: 'Haan, badlo', cancel: 'Ruko' }).then(function (ok) { if (ok) go(); }); else go();
  });
  $('#hour-list').addEventListener('click', function (e) {
    var b = e.target.closest('button'); if (!b) return;
    if (b.dataset.t) { var sw = function () { H.type = b.dataset.t; render(); }; if (H.dirty && snapshot() !== H.initial) S.ask('Bina save kiye tab badlein?', { ok: 'Haan, badlo', cancel: 'Ruko' }).then(function (ok) { if (ok) sw(); }); else sw(); return; }
    if (b.dataset.done) { S.back(); return; }
    if (b.dataset.mp !== undefined) { mpSheet(H.data.depts[Number(b.dataset.mp)]); return; }
    if (b.dataset.tr !== undefined) { trSheet(H.data.depts[Number(b.dataset.tr)]); return; }
    if (b.id === 'hour-add') {
      var depts = deptsOf(H.type).filter(function (d) { return !d.locked[H.type] && (d.srns[H.type] || []).length; });
      S.sheet.open('Kis line me dusra SRN?', '<div class="chips" style="flex-wrap:wrap">' + depts.map(function (d) { return '<button data-i="' + d._i + '">' + esc(S.shortLine(d.dept)) + '</button>'; }).join('') + '</div>');
      $('#sheet-content').onclick = function (ev) {
        var x = ev.target.closest('button[data-i]'); if (!x) return;
        var d = H.data.depts[Number(x.dataset.i)], rows = $$('#hour-list .hline[data-i="' + d._i + '"]'), last = rows[rows.length - 1];
        last.insertAdjacentHTML('afterend', lineRow(d, H.type, { srn: '' }, true));
        mountPickers(); H.dirty = true; S.sheet.close();
      };
    }
  });
  $('#hour-list').addEventListener('input', function (e) {
    var row = e.target.closest('.hline'); if (!row) return;
    H.dirty = true;
    if (row.dataset.type === 'ENDLINE') {
      var c = $('.f-chk', row), r = $('.f-rej', row), p = $('.f-pass', row);
      if (e.target === p) p.dataset.touched = '1'; else if (p && !p.dataset.touched) p.value = Math.max(0, num(c.value) - num(r.value));
    }
    var any = $$('input[type=number]', row).some(function (i) { return num(i.value) > 0; });
    row.classList.toggle('done', any);
  });
  $('#hour-list').addEventListener('keydown', function (e) {
    if (e.key !== 'Enter' || e.target.tagName !== 'INPUT') return;
    e.preventDefault();
    var inputs = $$('#hour-list .hline input[type=number]'), i = inputs.indexOf(e.target);
    var nxt = inputs.slice(i + 1).filter(function (x) { return !x.classList.contains('sm'); })[0] || inputs[i + 1];
    if (nxt) nxt.focus(); else save();
  });
  $('#btn-hour-save').addEventListener('click', save);
})();
