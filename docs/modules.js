// modules.js — Hourly Output, Manpower, Day Close, Review screens. Uses window.SG from app.js.
(function () {
  'use strict';
  var S = window.SG, $ = S.$, $$ = S.$$, esc = S.esc, api = S.api, state = S.state, toast = S.toast;

  function opt(list, sel, keyF, labelF) {
    return list.map(function (x) {
      var k = keyF ? keyF(x) : x, l = labelF ? labelF(x) : k;
      return '<option value="' + esc(k) + '"' + (k === sel ? ' selected' : '') + '>' + esc(l) + '</option>';
    }).join('');
  }
  function num(v) { var n = Number(v); return isNaN(n) ? 0 : n; }
  function typeDef(key) { return (state.masters.hourlyTypes || []).filter(function (t) { return t.key === key; })[0]; }
  function remember(k, v) { try { localStorage.setItem('sg_' + k, v); } catch (e) {} }
  function recall(k) { return localStorage.getItem('sg_' + k) || ''; }

  // =====================================================================
  // HOURLY OUTPUT
  // =====================================================================
  var hr = { type: recall('hr_type') || 'STITCH', dept: '', srn: '', floor: '', status: '', limit: 0, used: 0, saved: {} };

  function openHourly() {
    var types = state.masters.hourlyTypes || [];
    $('#hr-types').innerHTML = types.map(function (t) {
      return '<button data-t="' + esc(t.key) + '" class="' + (t.key === hr.type ? 'on' : '') + '">' + esc(t.label) + '</button>';
    }).join('');
    S.show('hourly', S.ctxTitle('Hourly'));
    loadHourlyDepts();
  }

  function loadHourlyDepts() {
    var td = typeDef(hr.type) || {};
    var depts = S.deptsFor(state.factory, td.cat);
    $('#hr-dept-label').textContent = hr.type === 'PACKING' ? 'Packing dept' : 'Line';
    if (!depts.length) { $('#hr-dept').innerHTML = ''; $('#hr-srn').innerHTML = ''; renderSlots([]); toast('Is type ke depts MASTERS me nahi hain', 'bad'); return; }
    var want = recall('hr_dept_' + hr.type);
    hr.dept = depts.some(function (d) { return d.key === want; }) ? want : depts[0].key;
    $('#hr-dept').innerHTML = S.deptOptions(depts, hr.dept);
    $('#hr-floor-wrap').hidden = hr.type !== 'STITCH';
    $('#hr-checker-wrap').hidden = hr.type !== 'ENDLINE';
    if (hr.type === 'ENDLINE') $('#hr-checker').value = recall('hr_checker_' + hr.dept);
    renderFloors();
    loadSrns();
  }

  function renderFloors() {
    var lf = S.M('LINE_FLOOR').filter(function (x) { return x.key === hr.dept; })[0];
    var floors = (state.masters.floors || []).map(function (f) { return 'FAC' + state.factory + '-Stitching ' + f; });
    var def = lf ? lf.value : floors[0];
    if (floors.indexOf(def) < 0) floors.unshift(def);
    hr.floor = def;
    $('#hr-floor').innerHTML = opt(floors, def);
  }

  function loadSrns() {
    $('#hr-srn').innerHTML = '<option>Loading…</option>';
    api('orders.active', { factory: state.factory, dept: hr.dept, type: hr.type })
      .then(function (d) {
        hr.srnList = d.srns;
        if (!d.srns.length) {
          $('#hr-srn').innerHTML = '<option value="">' + (hr.type === 'STITCH' ? 'Is line par koi loading nahi' : hr.type === 'ENDLINE' ? 'Is line par stitching nahi hui' : 'Koi endline-pass balance nahi') + '</option>';
          hr.srn = ''; renderSlots([]); renderBalance(); return;
        }
        var want = recall('hr_srn_' + hr.type + '_' + hr.dept);
        hr.srn = d.srns.some(function (x) { return x.srn === want; }) ? want : d.srns[0].srn;
        $('#hr-srn').innerHTML = opt(d.srns, hr.srn, function (x) { return x.srn; }, function (x) { return x.srn + ' — ' + (x.item || '').slice(0, 28) + ' (bal ' + x.balance + ')'; });
        loadHourly();
      })
      .catch(function (e) { toast(e.message, 'bad'); $('#hr-srn').innerHTML = ''; });
  }

  function loadHourly() {
    if (!hr.srn) return;
    api('hourly.get', { date: state.date, factory: state.factory, type: hr.type, dept: hr.dept, srn: hr.srn })
      .then(function (d) {
        hr.status = d.status; hr.limit = d.limit; hr.used = d.used;
        if (d.floor) { hr.floor = d.floor; if (!$$('#hr-floor option').some(function (o) { return o.value === d.floor; })) $('#hr-floor').insertAdjacentHTML('afterbegin', '<option>' + esc(d.floor) + '</option>'); $('#hr-floor').value = d.floor; }
        if (hr.type === 'ENDLINE' && d.rows.length && d.rows[0].checker) $('#hr-checker').value = d.rows[0].checker;
        renderSlots(d.rows);
        var b = $('#hr-banner');
        if (d.status && d.status !== 'Draft' && d.status !== 'Rejected') { b.hidden = false; b.className = 'banner'; b.textContent = 'Ye din ' + d.status + ' hai — edit band. Manager reject kare to khulega.'; }
        else if (d.status === 'Rejected') { b.hidden = false; b.className = 'banner'; b.textContent = 'Manager ne reject kiya — sudhar ke Day Close se dobara submit karo.'; }
        else b.hidden = true;
        $('#btn-hr-save').disabled = !!(d.status && d.status !== 'Draft' && d.status !== 'Rejected');
      })
      .catch(function (e) { toast(e.message, 'bad'); });
  }

  function renderSlots(rows) {
    var saved = {}; rows.forEach(function (r) { saved[r.slot] = r; });
    hr.saved = saved;
    var slots = state.masters.slots || [];
    var head = hr.type === 'ENDLINE' ? '<tr><th>Slot</th><th>Checked</th><th>Pass</th><th>Reject</th></tr>'
             : hr.type === 'PACKING' ? '<tr><th>Slot</th><th>Pcs</th><th>Cartons</th></tr>'
             : '<tr><th>Slot</th><th>Output</th></tr>';
    $('#hr-head').innerHTML = head;
    var html = '', lastShift = '';
    slots.forEach(function (s) {
      if (s.shift !== lastShift) { lastShift = s.shift; html += '<tr class="shift-head"><td colspan="4">' + esc(s.shift === 'Final' ? 'Day 9–6' : s.shift === 'OT' ? 'OT 6–10 PM' : 'Night') + '</td></tr>'; }
      var r = saved[s.key] || {};
      var v = function (f) { return r[f] ? r[f] : ''; };
      html += '<tr data-slot="' + esc(s.key) + '" class="' + (saved[s.key] ? 'filled' : '') + '"><td>' + esc(s.label) + '</td>';
      if (hr.type === 'ENDLINE') html += '<td><input class="f-checked" type="number" inputmode="numeric" min="0" value="' + v('checked') + '" placeholder="0"></td><td><input class="f-pass" type="number" inputmode="numeric" min="0" value="' + v('pass') + '" placeholder="0"></td><td><input class="f-reject" type="number" inputmode="numeric" min="0" value="' + v('reject') + '" placeholder="0"></td>';
      else if (hr.type === 'PACKING') html += '<td><input class="f-qty" type="number" inputmode="numeric" min="0" value="' + v('qty') + '" placeholder="0"></td><td><input class="f-cartons" type="number" inputmode="numeric" min="0" value="' + v('cartons') + '" placeholder="0"></td>';
      else html += '<td><input class="f-qty" type="number" inputmode="numeric" min="0" value="' + v('qty') + '" placeholder="0"></td>';
      html += '</tr>';
    });
    $('#hr-rows').innerHTML = html;
    renderBalance();
  }

  function collectSlots() {
    return $$('#hr-rows tr[data-slot]').map(function (tr) {
      var g = function (c) { var el = $('.' + c, tr); return el ? num(el.value) : 0; };
      return { slot: tr.dataset.slot, qty: g('f-qty'), checked: g('f-checked'), pass: g('f-pass'), reject: g('f-reject'), cartons: g('f-cartons') };
    });
  }

  function renderBalance() {
    var rows = collectSlots(), total = 0;
    rows.forEach(function (r) { total += hr.type === 'ENDLINE' ? r.checked : r.qty; });
    var limitLabel = hr.type === 'STITCH' ? 'Loading' : hr.type === 'ENDLINE' ? 'Stitched' : 'Endline pass';
    var bal = hr.limit - hr.used - total;
    $('#hr-balance').innerHTML = hr.srn ? '<span>' + limitLabel + ' <b>' + hr.limit + '</b></span><span>Pehle <b>' + hr.used + '</b></span><span>Aaj <b>' + total + '</b></span><span>Balance <b class="' + (bal < 0 ? 'neg' : '') + '">' + bal + '</b></span>' : '';
    $('#hr-foot').innerHTML = '<tr><td>Total</td><td colspan="3">' + total + '</td></tr>';
    $$('#hr-rows tr[data-slot]').forEach(function (tr) {
      var any = $$('input', tr).some(function (i) { return num(i.value) > 0; });
      tr.classList.toggle('filled', any);
    });
  }

  function saveHourly() {
    if (!hr.srn) { toast('SRN chuno', 'bad'); return; }
    var rows = collectSlots().filter(function (r) { return r.qty || r.checked; });
    if (hr.type === 'ENDLINE') {
      var bad = rows.filter(function (r) { return r.pass + r.reject > r.checked; });
      if (bad.length) { toast(bad[0].slot + ': pass + reject checked se zyada', 'bad'); return; }
      if (!$('#hr-checker').value.trim()) { toast('Checker ka naam likho', 'bad'); return; }
    }
    var payload = { date: state.date, factory: state.factory, type: hr.type, dept: hr.dept, srn: hr.srn,
                    floor: hr.type === 'STITCH' ? $('#hr-floor').value : '', checker: hr.type === 'ENDLINE' ? $('#hr-checker').value.trim() : '', rows: rows };
    api('hourly.save', payload)
      .then(function (d) {
        if (d.queued) { toast('Offline me save — baad me sync hoga', 'ok'); S.goHome(); return; }
        toast('Saved · aaj ' + d.total + ' · balance ' + d.balance, 'ok');
        remember('hr_srn_' + hr.type + '_' + hr.dept, hr.srn);
        if (hr.type === 'ENDLINE') remember('hr_checker_' + hr.dept, payload.checker);
        loadHourly();
      })
      .catch(function (e) { toast(e.message, 'bad', 6000); });
  }

  $('#hr-types').addEventListener('click', function (e) {
    var b = e.target.closest('button'); if (!b) return;
    hr.type = b.dataset.t; remember('hr_type', hr.type);
    $$('#hr-types button').forEach(function (x) { x.classList.toggle('on', x === b); });
    loadHourlyDepts();
  });
  $('#hr-dept').addEventListener('change', function () { hr.dept = this.value; remember('hr_dept_' + hr.type, hr.dept); renderFloors(); if (hr.type === 'ENDLINE') $('#hr-checker').value = recall('hr_checker_' + hr.dept); loadSrns(); });
  $('#hr-srn').addEventListener('change', function () { hr.srn = this.value; loadHourly(); });
  $('#hr-floor').addEventListener('change', function () { hr.floor = this.value; });
  $('#hr-refresh').addEventListener('click', function () { api('orders.refresh').then(function () { toast('Loading refresh ho gayi', 'ok'); loadSrns(); }).catch(function (e) { toast(e.message, 'bad'); }); });
  $('#hr-rows').addEventListener('input', renderBalance);
  $('#btn-hr-save').addEventListener('click', saveHourly);

  // =====================================================================
  // MANPOWER EVENTS
  // =====================================================================
  var mp = { dept: '' };

  function openManpower() {
    var depts = S.deptsFor(state.factory);
    if (!depts.length) { toast('Depts nahi mile', 'bad'); return; }
    mp.dept = depts.some(function (d) { return d.key === mp.dept; }) ? mp.dept : depts[0].key;
    $('#mp-dept').innerHTML = S.deptOptions(depts, mp.dept);
    $('#mp-event').innerHTML = opt(state.masters.mpEvents || [], null, function (x) { return x.key; }, function (x) { return x.label; });
    renderMpRoles(); mpTimeToggle();
    S.show('manpower', S.ctxTitle('Manpower'));
    loadMp();
  }
  function renderMpRoles() { $('#mp-role').innerHTML = opt(S.rolesForDept(mp.dept)); }
  function mpTimeToggle() {
    var ev = (state.masters.mpEvents || []).filter(function (x) { return x.key === $('#mp-event').value; })[0] || {};
    $('#mp-time-wrap').hidden = !ev.needsTime;
  }
  function loadMp() {
    api('manpower.get', { date: state.date, factory: state.factory, dept: mp.dept }, { quiet: true })
      .then(function (d) {
        var evs = state.masters.mpEvents || [];
        $('#mp-list').innerHTML = d.events.length ? d.events.map(function (e) {
          var lab = (evs.filter(function (x) { return x.key === e.event; })[0] || {}).label || e.event;
          return '<div class="item"><div><div class="name">' + esc(e.role) + ' × ' + e.count + '</div><div class="sub">' + esc(lab) + (e.time ? ' @ ' + esc(e.time) : '') + ' → ' + e.eff_hours + ' hrs' + (e.note ? ' · ' + esc(e.note) : '') + '</div></div><button class="danger small" data-del="' + esc(e.id) + '">✕</button></div>';
        }).join('') : '<div class="empty">Aaj koi event nahi</div>';
      })
      .catch(function (e) { $('#mp-list').innerHTML = '<div class="empty">' + esc(e.message) + '</div>'; });
  }
  function saveMp() {
    var ev = $('#mp-event').value;
    var payload = { date: state.date, factory: state.factory, dept: mp.dept, role: $('#mp-role').value, event: ev,
                    count: num($('#mp-count').value), time: $('#mp-time-wrap').hidden ? '' : $('#mp-time').value, note: $('#mp-note').value.trim() };
    if (payload.count < 1) { toast('Count 1 ya zyada', 'bad'); return; }
    if (!$('#mp-time-wrap').hidden && !payload.time) { toast('Time daalo', 'bad'); return; }
    api('manpower.save', payload)
      .then(function (d) { toast(d.queued ? 'Offline me save' : 'Added (' + d.eff_hours + ' hrs)', 'ok'); $('#mp-note').value = ''; $('#mp-count').value = 1; loadMp(); })
      .catch(function (e) { toast(e.message, 'bad'); });
  }
  $('#mp-dept').addEventListener('change', function () { mp.dept = this.value; renderMpRoles(); loadMp(); });
  $('#mp-event').addEventListener('change', mpTimeToggle);
  $('#btn-mp-save').addEventListener('click', saveMp);
  $('#mp-list').addEventListener('click', function (e) {
    var b = e.target.closest('button[data-del]'); if (!b) return;
    if (!confirm('Ye event hatayein?')) return;
    api('manpower.delete', { id: b.dataset.del }).then(loadMp).catch(function (er) { toast(er.message, 'bad'); });
  });

  // =====================================================================
  // DAY CLOSE
  // =====================================================================
  function openDayClose() {
    var depts = S.deptsFor(state.factory);
    $('#dc-dept').innerHTML = '<option value="">— Sab depts —</option>' + S.deptOptions(depts, '');
    $('#dc-out').innerHTML = '';
    $('#btn-dc-submit').disabled = true;
    S.show('dayclose', S.ctxTitle('Day Close'));
  }
  function flagsHtml(flags) { return (flags || []).map(function (f) { return '<div class="flag ' + esc(f.level) + '">' + esc(f.msg) + '</div>'; }).join(''); }
  function renderDayRows(rows, locked) {
    var groups = { ATT: [], STITCH: [], ENDLINE: [], PACKING: [] };
    rows.forEach(function (r) { (groups[r.type] = groups[r.type] || []).push(r); });
    var titles = { ATT: 'Attendance', STITCH: 'Stitching', ENDLINE: 'Endline', PACKING: 'Packing' };
    var html = '';
    Object.keys(groups).forEach(function (t) {
      if (!groups[t].length) return;
      html += '<div class="dc-group"><h3>' + titles[t] + ' (' + groups[t].length + ')</h3>';
      groups[t].forEach(function (r) {
        var p = r.payload, line;
        if (t === 'ATT') line = '<b>' + esc(r.dept) + '</b> · ' + esc(r.shift) + ' · ' + p.manpower + ' mp / ' + p.manhours + ' hrs';
        else if (t === 'STITCH') line = '<b>' + esc(r.dept) + '</b> · ' + esc(r.srn) + ' · ' + esc(r.shift) + ' → <b>' + p.output + '</b> pcs · mp ' + p.manpower + ' · ' + esc(p.floor);
        else if (t === 'ENDLINE') line = '<b>' + esc(r.dept) + '</b> · ' + esc(r.srn) + ' · ' + esc(p.checker) + ' → checked ' + p.checked + ' / pass <b>' + p.pass + '</b> / rej ' + p.reject;
        else line = '<b>' + esc(r.dept) + '</b> · ' + esc(r.srn) + ' → <b>' + p.qty + '</b> pcs · ' + p.cartons + ' ctn';
        html += '<div class="dc-row">' + line + flagsHtml(r.flags) + '</div>';
      });
      html += '</div>';
    });
    if (locked && locked.length) html += '<div class="dc-group"><h3>Pehle se submitted (lock)</h3>' + locked.map(function (l) { return '<div class="dc-row">' + esc(l) + '</div>'; }).join('') + '</div>';
    if (!html) html = '<div class="empty">Is din ka koi data nahi</div>';
    $('#dc-out').innerHTML = html;
  }
  $('#btn-dc-preview').addEventListener('click', function () {
    api('day.build', { date: state.date, factory: state.factory, dept: $('#dc-dept').value })
      .then(function (d) {
        renderDayRows(d.rows, d.locked);
        var blocks = d.rows.some(function (r) { return (r.flags || []).some(function (f) { return f.level === 'block'; }); });
        $('#btn-dc-submit').disabled = !d.rows.length || blocks;
        if (blocks) toast('Block flag hai — pehle sudharo', 'bad', 5000);
      })
      .catch(function (e) { toast(e.message, 'bad'); });
  });
  $('#btn-dc-submit').addEventListener('click', function () {
    if (!confirm('Submit karein? Iske baad is din ki entry lock ho jayegi.')) return;
    api('day.submit', { date: state.date, factory: state.factory, dept: $('#dc-dept').value })
      .then(function (d) { toast('Submitted: ' + d.submitted + ' rows', 'ok'); S.goHome(); })
      .catch(function (e) { toast(e.message, 'bad', 6000); });
  });

  // =====================================================================
  // REVIEW (manager)
  // =====================================================================
  var rv = { items: [] };
  function openReview() {
    if (!S.isManager()) { toast('Sirf manager', 'bad'); return; }
    $('#rv-date').value = '';
    S.show('review', 'Review · FAC' + state.factory);
    loadReview();
  }
  function loadReview() {
    $('#rv-list').innerHTML = '<div class="empty">Loading…</div>';
    api('review.list', { factory: state.factory, status: $('#rv-status').value, date: $('#rv-date').value })
      .then(function (d) {
        rv.items = d.items;
        if (!d.items.length) { $('#rv-list').innerHTML = '<div class="empty">Kuch nahi</div>'; return; }
        $('#rv-list').innerHTML = d.items.map(function (it) {
          var p = it.payload, nums;
          if (it.type === 'ATT') nums = p.manpower + ' mp / ' + p.manhours + ' hrs';
          else if (it.type === 'STITCH') nums = 'output ' + p.output + ' · mp ' + p.manpower + ' · ' + p.hours + ' hrs · ' + (p.floor || '');
          else if (it.type === 'ENDLINE') nums = 'checked ' + p.checked + ' / pass ' + p.pass + ' / rej ' + p.reject + ' · ' + (p.checker || '');
          else nums = p.qty + ' pcs · ' + p.cartons + ' ctn';
          return '<div class="rv-item"><input type="checkbox" data-id="' + esc(it.id) + '"><div class="body">' +
            '<div class="title">' + esc(it.type) + ' · ' + esc(it.dept) + (it.srn ? ' · ' + esc(it.srn) : '') + ' · ' + esc(it.shift) + S.pill(it.status) + '</div>' +
            '<div class="nums">' + esc(it.date) + ' · ' + esc(nums) + ' · by ' + esc(it.submitted_by) + (it.remark ? ' · <i>' + esc(it.remark) + '</i>' : '') + '</div>' +
            flagsHtml(it.flags) +
            '<details><summary>Final row → ' + esc(it.target) + '</summary><pre>' + esc(JSON.stringify(it.finalRows, null, 1)) + '</pre></details>' +
            '</div></div>';
        }).join('');
      })
      .catch(function (e) { $('#rv-list').innerHTML = '<div class="empty">' + esc(e.message) + '</div>'; });
  }
  function selectedIds() { return $$('#rv-list input[type=checkbox]:checked').map(function (c) { return c.dataset.id; }); }
  function decide(action) {
    var ids = selectedIds();
    if (!ids.length) { toast('Pehle select karo', 'bad'); return; }
    var hasBlock = rv.items.some(function (it) { return ids.indexOf(it.id) >= 0 && (it.flags || []).some(function (f) { return f.level === 'block'; }); });
    var remark = '', override = false;
    if (action === 'reject') { remark = prompt('Reject ka reason:'); if (!remark) return; }
    else if (hasBlock) { remark = prompt('Block flag hai. Override karke approve karna hai to reason likho:'); if (!remark) return; override = true; }
    api('review.decide', { ids: ids, action: action, remark: remark, override: override })
      .then(function (d) { toast(action + ': ' + d.done + (d.skipped.length ? ' · skipped ' + d.skipped.length + ': ' + d.skipped[0] : ''), d.skipped.length ? '' : 'ok', 6000); loadReview(); })
      .catch(function (e) { toast(e.message, 'bad'); });
  }
  $('#rv-status').addEventListener('change', loadReview);
  $('#rv-date').addEventListener('change', loadReview);
  $('#rv-all').addEventListener('change', function () { var on = this.checked; $$('#rv-list input[type=checkbox]').forEach(function (c) { c.checked = on; }); });
  $('#btn-rv-approve').addEventListener('click', function () { decide('approve'); });
  $('#btn-rv-reject').addEventListener('click', function () { decide('reject'); });
  $('#btn-rv-send').addEventListener('click', function () {
    var ids = selectedIds();
    if (!ids.length) { toast('Approved rows select karo', 'bad'); return; }
    if (!confirm('Selected Approved rows ko source sheets me likh dein? Ye wapas nahi hota.')) return;
    api('review.send', { ids: ids })
      .then(function (d) { toast('Sent ' + d.sent + ' · ' + d.log.join(' | '), 'ok', 8000); loadReview(); })
      .catch(function (e) { toast(e.message, 'bad', 6000); });
  });

  // ---------- register ----------
  S.screens.hourly = openHourly;
  S.screens.manpower = openManpower;
  S.screens.dayclose = openDayClose;
  S.screens.review = openReview;
})();
