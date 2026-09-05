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

  function lineRow(d, type, r, extra, qcFixed) {
    r = r || {};
    var opts = d.srns[type] || [], sel = r.srn || d.lastSrn[type] || d.attSrn || (type !== 'PACKING' && opts[0] ? opts[0].srn : '');
    var lock = d.locked[type], noSrn = !opts.length && !sel;
    var cls = (lock ? 'lock' : (r.srn ? 'done' : '')) + (r.warn ? ' warn' : '');
    var warnChip = r.warn ? '<button type="button" class="act wchip" data-warn="' + esc(r.warn) + '" title="' + esc(r.warn) + '">⚠</button>' : '';
    var mp = '<span class="mpb' + (d.mp !== d.mpBase ? ' chg' : '') + '" title="Is ghante manpower">' + d.mp + ' mp</span>';
    var acts = type === 'ENDLINE' ? '' : '<button type="button" class="act" data-mp="' + d._i + '" title="Koi gaya / aaya">−</button><button type="button" class="act" data-tr="' + d._i + '" title="Transfer">⇄</button>';
    var nm = '<span class="nm">' + esc(S.shortLine(d.dept)) + (d.attSrn && !r.srn ? '<small>att: ' + esc(d.attSrn) + '</small>' : '<small>' + (d.mpBase ? d.mpBase + ' subah' : 'attendance nahi') + '</small>') + '</span>';
    if (lock) return '<div class="hline lock" data-i="' + d._i + '">' + nm + mp + '<span class="msg" style="color:var(--muted)">' + esc(lock) + ' — edit band</span></div>';
    if (d.closed && !r.srn) return '<div class="hline lock" data-i="' + d._i + '">' + nm + mp + '<span class="msg" style="color:var(--muted)">Line band ' + esc(d.closed) + ' — is ghante entry nahi</span></div>';
    if (noSrn) return '<div class="hline" data-i="' + d._i + '">' + nm + mp + acts + '<span class="msg" style="color:var(--warn)">' + (type === 'PACKING' ? 'Koi SRN nahi (endline-pass balance 0)' : type === 'ENDLINE' ? 'Pehle stitching output' : 'Loading nahi mili') + '</span></div>';
    var inputs = type === 'ENDLINE'
      ? '<input class="f-chk sm" type="number" inputmode="numeric" placeholder="chk" value="' + (r.checked || '') + '"><input class="f-pass sm" type="number" inputmode="numeric" placeholder="pass" value="' + (r.pass || '') + '"><input class="f-rej sm" type="number" inputmode="numeric" placeholder="rej" value="' + (r.reject || '') + '">'
      : '<input class="f-qty" type="number" inputmode="numeric" placeholder="' + (type === 'PACKING' ? 'pcs' : 'qty') + '" value="' + (r.qty || '') + '">' + (type === 'PACKING' ? '<input class="f-ctn sm" type="number" inputmode="numeric" placeholder="ctn" value="' + (r.cartons || '') + '">' : '');
    var qcs = d.qcNames || [], defQc = qcFixed || r.checker || d.checker || (qcs.length === 1 ? qcs[0] : '');
    var checker = type === 'ENDLINE' ? '<div class="chk-name">' + icon('qc') + (qcs.length ? '<select class="f-checker">' + (defQc && qcs.indexOf(defQc) < 0 ? '<option>' + esc(defQc) + '</option>' : '') + qcs.map(function (n) { return '<option' + (n === defQc ? ' selected' : '') + '>' + esc(n) + '</option>'; }).join('') + '</select>' : '<input class="f-checker" type="text" list="staff-qc" placeholder="checker ka naam" value="' + esc(defQc) + '">') + '</div>' : '';
    if (type === 'PACKING') {
      // two lines: [name · mp · actions] / [SRN search · pcs · ctn]
      return '<div class="hline pack ' + cls + '" data-i="' + d._i + '" data-type="' + type + '" data-extra="' + (extra ? 1 : 0) + '">' +
        '<div class="top">' + (extra ? '<span class="nm"><small>+ dusra SRN</small></span>' : nm + mp + acts) + '</div>' +
        '<div class="bot"><div class="srnp-mount" data-sel="' + esc(sel) + '"></div>' + inputs + warnChip + '</div></div>';
    }
    var nmCell = extra ? '<span class="nm"><small>' + (qcFixed ? '↳ ' + esc(qcFixed) : '+ dusra SRN') + '</small></span>' : nm;
    return '<div class="hline ' + cls + (checker ? ' wrap' : '') + '" data-i="' + d._i + '" data-type="' + type + '" data-extra="' + (extra ? 1 : 0) + '">' + nmCell + (extra || type === 'ENDLINE' ? '' : mp) + srnSel(opts, sel) + inputs + warnChip + (extra || type === 'ENDLINE' ? '' : acts) + checker + '</div>';
  }
  // ENDLINE: one row per QC of the line (each QC's checked/pass/reject saved separately)
  function endlineRows(d) {
    var rows = d.rows.ENDLINE || [], qcs = d.qcNames || [];
    if (!qcs.length) return rows.length ? rows.map(function (r, j) { return lineRow(d, 'ENDLINE', r, j > 0); }).join('') : lineRow(d, 'ENDLINE');
    var used = {};
    var html = qcs.map(function (q, j) { var r = rows.filter(function (x) { return x.checker === q && !used[x.srn + '|' + x.checker]; })[0]; if (r) used[r.srn + '|' + r.checker] = 1; return lineRow(d, 'ENDLINE', r || {}, j > 0, q); }).join('');
    rows.forEach(function (r) { if (!used[r.srn + '|' + r.checker]) html += lineRow(d, 'ENDLINE', r, true, r.checker); });
    return html;
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
        if (H.type === 'ENDLINE') { html += endlineRows(d); return; }
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
      var srn = sel.value, chk = type === 'ENDLINE' ? (($('.f-checker', row) || { value: '' }).value || '').trim() : '';
      var k = d.dept + '|' + srn + (type === 'ENDLINE' ? '|' + chk : ''); if (!srn || seen[k]) return; seen[k] = true;
      var it = { type: type, dept: d.dept, srn: srn, floor: d.floor };
      if (type === 'ENDLINE') { it.checked = num($('.f-chk', row).value); it.pass = num($('.f-pass', row).value); it.reject = num($('.f-rej', row).value); it.checker = chk; }
      else { it.qty = num($('.f-qty', row).value); if (type === 'PACKING') it.cartons = num(($('.f-ctn', row) || { value: 0 }).value); }
      items.push(it);
    });
    deptsOf(H.type).forEach(function (d) { (d.rows[H.type] || []).forEach(function (r) { var k = d.dept + '|' + r.srn + (H.type === 'ENDLINE' ? '|' + (r.checker || '') : ''); if (!seen[k]) items.push({ type: H.type, dept: d.dept, srn: r.srn, qty: 0, checked: 0, checker: H.type === 'ENDLINE' ? (r.checker || '') : 'x' }); }); });
    return items;
  }
  function snapshot() { return JSON.stringify(collect()); }

  function save() {
    var items = collect().filter(function (it) { return it.qty > 0 || it.checked > 0 || it.checker === 'x'; });
    if (!items.length) { toast('Kuch bhara nahi', 'bad'); return; }
    var bad = items.filter(function (it) { return it.type === 'ENDLINE' && it.checked > 0 && (it.pass + it.reject > it.checked || !it.checker); })[0];
    if (bad) { toast(S.shortLine(bad.dept) + ': ' + (!bad.checker ? 'checker ka naam likho' : 'pass + reject > checked'), 'bad'); return; }
    var savedType = H.type;
    // only lines whose numbers differ from what is already saved (the server skips the rest too)
    var unchanged = function (it) {
      if (it.checker === 'x') return false;
      var d = H.data.depts.filter(function (x) { return x.dept === it.dept; })[0]; if (!d) return false;
      var ex = (d.rows[it.type] || []).filter(function (r) { return r.srn === it.srn && (it.type !== 'ENDLINE' || (r.checker || '') === (it.checker || '')); })[0];
      if (!ex) return false;
      return it.type === 'ENDLINE' ? (ex.checked === it.checked && ex.pass === it.pass && ex.reject === it.reject)
        : (ex.qty === it.qty && (it.type !== 'PACKING' || (ex.cartons || 0) === (it.cartons || 0)));
    };
    var changed = items.filter(function (it) { return !unchanged(it); });
    if (!changed.length) { toast('Kuch badla nahi — sab pehle se saved hai', ''); H.dirty = false; return; }
    api('hour.save', { date: state.date, factory: state.factory, slot: H.slot, items: changed })
      .then(function (d) {
        S.invalidateAll(); S.clearLocalCaches();
        var fails = d.results.filter(function (r) { return !r.ok; }), warns = d.results.filter(function (r) { return r.ok && r.warn; });
        if (fails.length) {
          // keep what was typed: the blocked line turns red with the reason, the rest is already saved
          $$('#hour-list .hline[data-type]').forEach(function (row) {
            var dd = H.data.depts[Number(row.dataset.i)], sel = $('.f-srn', row) || $('.srnp-in', row);
            var f = fails.filter(function (x) { return x.dept === dd.dept && x.type === row.dataset.type && sel && x.srn === sel.value; })[0];
            row.classList.toggle('bad', !!f); var m = $('.msg.err', row); if (m) m.remove();
            if (f) row.insertAdjacentHTML('beforeend', '<span class="msg err">' + esc(f.message) + '</span>');
          });
          toast(S.shortLine(fails[0].dept) + ': ' + fails[0].message + (d.saved ? ' · baaki ' + d.saved + ' saved' : ''), 'bad', 9000);
          H.dirty = true; return;
        }
        // stay here: move to the next tab that still has empty lines (Stitching -> Endline -> Packing)
        var order = TYPES.map(function (t) { return t.k; }), i = order.indexOf(savedType);
        var nextType = order.slice(i + 1).concat(order.slice(0, i)).filter(function (k) { return deptsOf(k).length && doneCount(k) + (k === savedType ? d.saved : 0) < deptsOf(k).length; })[0];
        var what = d.saved ? 'Saved · ' + d.saved + ' line' + (d.saved > 1 ? 's' : '') : 'Kuch badla nahi';
        toast(what + (nextType ? ' → ab ' + TYPES.filter(function (t) { return t.k === nextType; })[0].l : ' · ghanta poora ✓'), 'ok');
        if (warns.length) setTimeout(function () { toast('⚠ ' + S.shortLine(warns[0].dept) + ': ' + warns[0].warn + (warns.length > 1 ? ' (+' + (warns.length - 1) + ')' : ''), '', 7000); }, 1500);
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
    if (!evs.some(function (e) { return e.key === 'LINE_CLOSED'; })) evs.push({ key: 'LINE_CLOSED', label: 'Line band / shift khatam', needsTime: true });
    var html = '<div class="row"><div class="field"><label>Kya hua</label><select id="m-ev">' + evs.map(function (e) { return '<option value="' + esc(e.key) + '"' + (e.key === 'LEFT_AT' ? ' selected' : '') + '>' + esc(e.label) + '</option>'; }).join('') + '</select></div>' +
      '<div class="field small" id="m-count-wrap"><label>Kitne</label><input id="m-count" type="number" inputmode="numeric" value="1" min="1"></div></div>' +
      '<div id="m-role-wrap"><label>Role</label><select id="m-role">' + S.rolesForDept(d.dept).map(function (r) { return '<option>' + esc(r) + '</option>'; }).join('') + '</select></div>' +
      '<div id="m-close-wrap" hidden><label class="chk"><input type="checkbox" id="m-all"> Sab lines band (poori factory) — ' + H.data.depts.length + ' line</label><p class="hint" style="margin:4px 0 8px">Is time ke baad ke ghante "baaki" nahi dikhenge; man-hours yahin tak ginenge.</p></div>' +
      '<div class="row"><div class="field small"><label>Time</label><input id="m-time" type="time" value="' + (S.isToday() ? nowTime() : slotTime()) + '"></div><div class="field"><label>Note</label><input id="m-note" type="text" placeholder="optional"></div></div>' +
      '<button class="btn primary big" id="m-save">Save</button>';
    S.sheet.open(S.shortLine(d.dept) + ' · manpower change', html);
    var c = $('#sheet-content');
    var sync = function () { var close = $('#m-ev').value === 'LINE_CLOSED'; $('#m-role-wrap').hidden = close; $('#m-count-wrap').hidden = close; $('#m-close-wrap').hidden = !close; $('#m-save').textContent = close ? 'Line band karo' : 'Save'; };
    c.onchange = function (e) { if (e.target.id === 'm-ev') sync(); };
    c.onclick = function (e) {
      if (!e.target.closest('#m-save')) return;
      var ev = $('#m-ev').value, needs = (evs.filter(function (x) { return x.key === ev; })[0] || {}).needsTime, close = ev === 'LINE_CLOSED';
      var p = { date: state.date, factory: state.factory, dept: d.dept, role: close ? 'ALL' : $('#m-role').value, event: ev, count: close ? 0 : num($('#m-count').value), time: needs ? $('#m-time').value : '', note: $('#m-note').value.trim() };
      if (close && $('#m-all').checked) p.depts = H.data.depts.map(function (x) { return x.dept; });
      if (!close && p.count < 1) { toast('Count 1 ya zyada', 'bad'); return; }
      if (close && !p.time) { toast('Time daalo', 'bad'); return; }
      api('manpower.save', p).then(function (r) {
        toast(close ? 'Line band · ' + p.time + ' (' + r.eff_hours + ' hrs)' + (p.depts ? ' · ' + p.depts.length + ' lines' : '') : 'Saved (' + r.eff_hours + ' hrs)', 'ok');
        S.sheet.close(); S.invalidateAll(); S.clearLocalCaches(); load(true);
        setTimeout(function () { S.offerGroup(close ? 'Line band — group me bhejein?' : 'Manpower change group me bhejein?'); }, 400);
      }).catch(function (er) { toast(er.message, 'bad'); });
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
    if (!S.factoryData()) { toast('Data aa raha hai…', ''); S.loadFactory().then(function () { trSheet(d); }).catch(function (e) { toast(e.message, 'bad'); }); return; }
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
    if (b.dataset.warn) { toast('⚠ ' + b.dataset.warn + ' — Report / Day Close se pehle theek karo', '', 6000); return; }
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
