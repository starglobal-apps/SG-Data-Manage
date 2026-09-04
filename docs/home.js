// home.js — the data recorder's home: one line, today's checklist, one-tap slot entry.
(function () {
  'use strict';
  var S = window.SG, $ = S.$, $$ = S.$$, esc = S.esc, api = S.api, state = S.state, toast = S.toast;

  var ck = { dept: localStorage.getItem('sg_line') || '', data: null, showOT: false, showNight: false, orders: {} };

  function num(v) { var n = Number(v); return isNaN(n) ? 0 : n; }
  function slotStart(key) { return Number(key.split('-')[0]); }
  function nowHour() { var d = new Date(); return d.getHours() + d.getMinutes() / 60; }
  function isToday() { return state.date === S.todayStr(); }
  function myDepts() { return S.deptsFor(state.factory); }
  function cat() { return S.deptCategory(ck.dept); }
  function slotsOf(shift) { return (state.masters.slots || []).filter(function (s) { return s.shift === shift; }); }
  function slotLabel(key) { var s = (state.masters.slots || []).filter(function (x) { return x.key === key; })[0]; return s ? s.label : key; }

  // ---------- render ----------

  function open() {
    var depts = myDepts();
    if (!depts.length) { $('#line-pick').innerHTML = ''; $('#checklist').innerHTML = '<div class="empty">Is factory ke depts MASTERS me nahi hain</div>'; return; }
    if (!depts.some(function (d) { return d.key === ck.dept; })) ck.dept = depts[0].key;
    if (depts.length === 1) $('#line-pick').innerHTML = '<div class="chips"><button class="on">' + esc(depts[0].key) + '</button></div>';
    else if (depts.length <= 8) $('#line-pick').innerHTML = '<div class="chips">' + depts.map(function (d) { return '<button data-d="' + esc(d.key) + '" class="' + (d.key === ck.dept ? 'on' : '') + '">' + esc(d.key) + '</button>'; }).join('') + '</div>';
    else $('#line-pick').innerHTML = '<select id="line-sel">' + S.deptOptions(depts, ck.dept) + '</select>';
    load();
  }

  function load() {
    $('#checklist').innerHTML = '<div class="empty">Loading…</div>';
    var calls = [api('line.today', { date: state.date, factory: state.factory, dept: ck.dept }, { quiet: true })];
    if (S.isManager()) calls.push(api('review.count', { factory: state.factory }, { quiet: true }).catch(function () { return { count: 0 }; }));
    Promise.all(calls).then(function (res) { ck.data = res[0]; ck.pending = res[1] ? res[1].count : 0; render(); })
      .catch(function (e) { $('#checklist').innerHTML = '<div class="empty">' + esc(e.message) + '</div>'; });
  }

  function item(o) {
    // o: {act, ic, name, sub, subWarn, val, dim, extra}
    return '<div class="ck' + (o.dim ? ' dim' : '') + '" data-act="' + esc(o.act) + '"' + (o.extra || '') + '>' +
      '<span class="ck-ic ' + esc(o.ic || '') + '">' + (o.ic === 'done' ? '✓' : o.ic === 'lock' ? '🔒' : o.ic === 'now' ? '●' : o.ic === 'warn' ? '!' : '○') + '</span>' +
      '<div class="ck-body"><div class="ck-name">' + o.name + '</div>' + (o.sub ? '<div class="ck-sub' + (o.subWarn ? ' warn' : '') + '">' + o.sub + '</div>' : '') + '</div>' +
      (o.val ? '<span class="ck-val">' + o.val + '</span>' : '') + '<span class="chev">›</span></div>';
  }
  function sec(title, link, linkAct) {
    return '<div class="ck-sec"><span>' + title + '</span>' + (link ? '<button class="lnk" data-act="' + esc(linkAct) + '">' + link + '</button>' : '') + '</div>';
  }

  function render() {
    var d = ck.data, c = cat(), html = '', done = 0, total = 0, now = isToday() ? nowHour() : 24;
    var st = d.statuses || {};
    var locked = function (t) { var s = (st[t] || {}).status; return s === 'Submitted' || s === 'Approved' || s === 'Sent'; };

    // --- Subah: attendance
    html += sec('Subah');
    var af = d.att.Final; total++; if (af) done++;
    html += item({ act: 'att:Final', ic: af ? 'done' : (now >= 9 ? 'warn' : ''), name: 'Attendance', sub: af ? 'by ' + esc(af.by) + ' · ' + af.manhours + ' hrs' : 'Subah ki entry baaki', subWarn: !af && now >= 9, val: af ? af.manpower + ' mp' : '' });

    // --- hourly slots
    var hourlyType = c === 'STITCH' ? 'STITCH' : c === 'PACKING' ? 'PACKING' : '';
    if (hourlyType) {
      var slots = d.slots[hourlyType] || {};
      var anyOT = slotsOf('OT').some(function (s) { return slots[s.key]; }), anyNight = slotsOf('Night').some(function (s) { return slots[s.key]; });
      var showOT = ck.showOT || anyOT || now >= 18, showNight = ck.showNight || anyNight;
      var tlabel = hourlyType === 'STITCH' ? 'Stitching output' : 'Packing';
      var tot = d.totals[hourlyType];
      html += sec(tlabel + (tot ? ' · <b>' + tot.qty + '</b> pcs' : ''), 'Poori table', 'table:' + hourlyType);
      var renderSlots = function (shift) {
        slotsOf(shift).forEach(function (s) {
          var rows = slots[s.key] || [], q = 0; rows.forEach(function (r) { q += r.qty; });
          var start = slotStart(s.key), isNow = isToday() && now >= start && now < start + 1, past = now >= start + 1, future = now < start;
          var applicable = shift === 'Final' ? !future : rows.length > 0;
          if (applicable) { total++; if (rows.length) done++; }
          var srns = rows.map(function (r) { return r.srn; }).filter(function (v, i, a) { return a.indexOf(v) === i; });
          html += item({ act: 'slot:' + hourlyType + ':' + s.key, dim: future && !rows.length,
            ic: locked(hourlyType) ? 'lock' : rows.length ? 'done' : isNow ? 'now' : (past && shift === 'Final') ? 'warn' : '',
            name: esc(s.label) + (isNow ? ' <small style="color:var(--primary)">abhi</small>' : ''),
            sub: rows.length ? esc(srns.join(', ')) + (hourlyType === 'PACKING' ? ' · ' + rows.reduce(function (t, r) { return t + r.cartons; }, 0) + ' ctn' : '') : (past && shift === 'Final' ? 'Entry baaki' : isNow ? 'Tap karke bharo' : ''),
            subWarn: !rows.length && past && shift === 'Final', val: rows.length ? q : '' });
        });
      };
      renderSlots('Final');
      if (showOT) { html += sec('OT (6–10 PM)'); renderSlots('OT'); }
      else html += '<button class="lnk" data-act="showOT" style="margin:4px 0 0 10px">+ OT slots dikhao</button>';
      if (showNight) { html += sec('Night'); renderSlots('Night'); }
      else if (showOT) html += '<button class="lnk" data-act="showNight" style="margin:4px 0 0 10px">+ Night slots</button>';
    }

    // --- endline (stitching lines)
    if (c === 'STITCH') {
      var es = d.slots.ENDLINE || {}, et = d.totals.ENDLINE, eslots = Object.keys(es).length;
      html += sec('Endline checking', 'Poori table', 'table:ENDLINE');
      if (ck.showEndline || eslots) {
        slotsOf('Final').concat(now >= 18 || ck.showOT ? slotsOf('OT') : []).forEach(function (s) {
          var rows = es[s.key] || [], chk = 0, pass = 0; rows.forEach(function (r) { chk += r.checked; pass += r.pass; });
          var start = slotStart(s.key), future = now < start, isNow = isToday() && now >= start && now < start + 1;
          if (!future || rows.length) { total++; if (rows.length) done++; }
          html += item({ act: 'slot:ENDLINE:' + s.key, dim: future && !rows.length, ic: locked('ENDLINE') ? 'lock' : rows.length ? 'done' : isNow ? 'now' : '',
            name: esc(s.label), sub: rows.length ? 'checked ' + chk + ' · ' + esc(rows.map(function (r) { return r.checker; }).filter(function (v, i, a) { return v && a.indexOf(v) === i; }).join(', ')) : '',
            val: rows.length ? 'pass ' + pass : '' });
        });
      } else {
        html += item({ act: 'showEndline', ic: '', name: 'Endline slots', sub: 'Tap karke kholo (QC checker bharega)' });
      }
    }

    // --- manpower
    html += sec('Manpower change');
    html += item({ act: 'manpower', ic: d.events ? 'done' : '', name: d.events ? d.events + ' event' : 'Koi gaya / late aaya?', sub: d.events ? 'Half day, beech me gaya, late…' : 'Zaroorat ho to add karo', val: '' });

    // --- shaam
    html += sec('Shaam');
    var ao = d.att.OT, hasOT = (d.slots[hourlyType] && slotsOf('OT').some(function (s) { return (d.slots[hourlyType] || {})[s.key]; }));
    if (hasOT || ao || now >= 18) {
      total++; if (ao) done++;
      html += item({ act: 'att:OT', ic: ao ? 'done' : hasOT ? 'warn' : '', name: 'OT attendance', sub: ao ? ao.manhours + ' hrs' : (hasOT ? 'OT output hai, attendance baaki' : 'Agar OT laga ho'), subWarn: !ao && hasOT, val: ao ? ao.manpower + ' mp' : '' });
    }
    var dsKeys = Object.keys(st), dstat = dsKeys.length ? st[dsKeys[0]].status : '';
    var anyLocked = dsKeys.some(function (k) { return locked(k); });
    total++; if (anyLocked) done++;
    html += item({ act: 'dayclose', ic: anyLocked ? 'done' : dstat === 'Rejected' ? 'warn' : '', name: 'Din band karo', sub: anyLocked ? 'Submitted · manager review' + (dstat === 'Sent' ? ' · Final me gaya' : '') : dstat === 'Rejected' ? 'Reject hua: ' + esc((st[dsKeys[0]] || {}).remark || '') : 'Sab bhar ke shaam ko submit karo', subWarn: dstat === 'Rejected', val: dstat ? S.pill(dstat) : '' });

    // --- manager
    if (S.isManager()) {
      html += sec('Manager');
      html += item({ act: 'review', ic: ck.pending ? 'warn' : 'done', name: 'Review', sub: ck.pending ? ck.pending + ' submitted, approve baaki' : 'Kuch pending nahi', val: ck.pending || '' });
    }

    $('#checklist').innerHTML = html;
    var pct = total ? Math.round(done / total * 100) : 0;
    $('#prog-bar').style.width = pct + '%';
    $('#prog-text').textContent = done + '/' + total + ' done';
  }

  // ---------- actions ----------

  $('#line-pick').addEventListener('click', function (e) {
    var b = e.target.closest('button[data-d]'); if (!b) return;
    ck.dept = b.dataset.d; localStorage.setItem('sg_line', ck.dept); open();
  });
  $('#line-pick').addEventListener('change', function (e) {
    if (e.target.id === 'line-sel') { ck.dept = e.target.value; localStorage.setItem('sg_line', ck.dept); load(); }
  });

  $('#checklist').addEventListener('click', function (e) {
    var el = e.target.closest('[data-act]'); if (!el) return;
    var act = el.dataset.act, p = act.split(':');
    if (p[0] === 'att') S.openAttendance(ck.dept, p[1]);
    else if (p[0] === 'slot') openSheet(p[1], p[2]);
    else if (p[0] === 'table') S.screens.hourly(ck.dept, p[1]);
    else if (act === 'manpower') S.screens.manpower(ck.dept);
    else if (act === 'dayclose') S.screens.dayclose(ck.dept);
    else if (act === 'review') S.screens.review();
    else if (act === 'showOT') { ck.showOT = true; render(); }
    else if (act === 'showNight') { ck.showNight = true; render(); }
    else if (act === 'showEndline') { ck.showEndline = true; render(); }
  });

  // ---------- quick entry sheet ----------

  var sh = { type: '', slot: '', srn: '' };

  function openSheet(type, slot) {
    sh.type = type; sh.slot = slot;
    var st = (ck.data.statuses || {})[type], s = st && st.status;
    if (s === 'Submitted' || s === 'Approved' || s === 'Sent') { toast('Ye din ' + s + ' hai — edit band', 'bad'); return; }
    $('#sheet-title').textContent = slotLabel(slot) + ' · ' + (type === 'STITCH' ? 'Stitching' : type === 'ENDLINE' ? 'Endline' : 'Packing');
    $('#sheet-content').innerHTML = '<div class="empty">SRN list…</div>';
    $('#sheet').hidden = false;
    getOrders(type).then(renderSheet).catch(function (e) { $('#sheet-content').innerHTML = '<div class="empty">' + esc(e.message) + '</div>'; });
  }
  function closeSheet() { $('#sheet').hidden = true; }

  function getOrders(type) {
    var k = type + '|' + ck.dept;
    if (ck.orders[k] && Date.now() - ck.orders[k].t < 5 * 60000) return Promise.resolve(ck.orders[k].list);
    return api('orders.active', { factory: state.factory, dept: ck.dept, type: type }, { quiet: true }).then(function (d) { ck.orders[k] = { t: Date.now(), list: d.srns }; return d.srns; });
  }

  function renderSheet(srns) {
    var rows = ((ck.data.slots[sh.type] || {})[sh.slot]) || [];
    var remembered = localStorage.getItem('sg_srn_' + sh.type + '_' + ck.dept) || '';
    sh.srn = rows.length ? rows[0].srn : (srns.some(function (x) { return x.srn === remembered; }) ? remembered : (srns[0] ? srns[0].srn : ''));
    var html = '';
    if (!srns.length) {
      html += '<div class="banner">' + (sh.type === 'STITCH' ? 'Is line par koi loading nahi mili. Loading sheet me entry hone ke baad ↻ dabao.' : sh.type === 'ENDLINE' ? 'Is line par stitching output nahi hai — pehle stitching bharo.' : 'Koi SRN nahi jiska endline-pass balance ho.') + '</div>' +
              '<button class="primary big" data-refresh="1">↻ Loading refresh</button>';
      $('#sheet-content').innerHTML = html; return;
    }
    html += '<label>SRN</label><div class="chips" id="sh-srns">' + srns.map(function (x) {
      return '<button data-srn="' + esc(x.srn) + '" class="' + (x.srn === sh.srn ? 'on' : '') + '">' + esc(x.srn) + '<small>bal ' + x.balance + '</small></button>';
    }).join('') + '</div>';
    html += '<div id="sh-fields"></div>';
    if (rows.length) {
      html += '<div class="exist list">' + rows.map(function (r) {
        var v = sh.type === 'ENDLINE' ? 'chk ' + r.checked + ' · pass ' + r.pass + ' · rej ' + r.reject : r.qty + ' pcs' + (r.cartons ? ' · ' + r.cartons + ' ctn' : '');
        return '<div class="item"><div><div class="name">' + esc(r.srn) + '</div><div class="sub">' + esc(v) + (r.checker ? ' · ' + esc(r.checker) : '') + ' · by ' + esc(r.by) + '</div></div><button class="danger small" data-del="' + esc(r.srn) + '">Hatao</button></div>';
      }).join('') + '</div>';
    }
    html += '<button class="primary big" id="sh-save">Save</button>';
    $('#sheet-content').innerHTML = html;
    renderFields(rows);
  }

  function renderFields(rows) {
    var cur = (rows || ((ck.data.slots[sh.type] || {})[sh.slot]) || []).filter(function (r) { return r.srn === sh.srn; })[0] || {};
    var info = (ck.orders[sh.type + '|' + ck.dept] || { list: [] }).list.filter(function (x) { return x.srn === sh.srn; })[0];
    var html = '';
    if (sh.type === 'ENDLINE') {
      html += '<label>Checker</label><input id="f-checker" type="text" value="' + esc(cur.checker || localStorage.getItem('sg_checker_' + ck.dept) || '') + '" placeholder="Checker ka naam">';
      html += '<div class="three"><div class="field"><label>Checked</label><input id="f-checked" type="number" inputmode="numeric" value="' + (cur.checked || '') + '"></div><div class="field"><label>Pass</label><input id="f-pass" type="number" inputmode="numeric" value="' + (cur.pass || '') + '"></div><div class="field"><label>Reject</label><input id="f-reject" type="number" inputmode="numeric" value="' + (cur.reject || '') + '"></div></div>';
    } else if (sh.type === 'PACKING') {
      html += '<label>Pieces</label><input id="f-qty" class="bigin" type="number" inputmode="numeric" value="' + (cur.qty || '') + '" placeholder="0">';
      html += '<label>Cartons</label><input id="f-cartons" type="number" inputmode="numeric" value="' + (cur.cartons || '') + '" placeholder="0">';
    } else {
      html += '<label>Is ghante ka output</label><input id="f-qty" class="bigin" type="number" inputmode="numeric" value="' + (cur.qty || '') + '" placeholder="0">';
    }
    if (info) html += '<p class="hint">' + esc((info.item || '').slice(0, 40)) + ' · limit <b>' + info.limit + '</b> · ho chuka <b>' + info.used + '</b> · balance <b>' + info.balance + '</b></p>';
    $('#sh-fields').innerHTML = html;
    var first = $('#f-qty') || $('#f-checked'); if (first) setTimeout(function () { first.focus(); }, 50);
    // auto pass = checked - reject
    var c = $('#f-checked'), r = $('#f-reject'), p = $('#f-pass');
    if (c && r && p) { var auto = function () { if (num(c.value) && !p.dataset.touched) p.value = Math.max(0, num(c.value) - num(r.value)); }; c.addEventListener('input', auto); r.addEventListener('input', auto); p.addEventListener('input', function () { p.dataset.touched = '1'; }); }
  }

  function saveSlot(del) {
    var payload = { date: state.date, factory: state.factory, type: sh.type, dept: ck.dept, srn: del || sh.srn, slot: sh.slot };
    if (del) { payload.qty = 0; payload.checked = 0; payload.checker = 'x'; }
    else if (sh.type === 'ENDLINE') {
      payload.checker = $('#f-checker').value.trim(); payload.checked = num($('#f-checked').value); payload.pass = num($('#f-pass').value); payload.reject = num($('#f-reject').value);
      if (!payload.checker) { toast('Checker ka naam likho', 'bad'); return; }
      if (payload.pass + payload.reject > payload.checked) { toast('Pass + reject checked se zyada', 'bad'); return; }
      localStorage.setItem('sg_checker_' + ck.dept, payload.checker);
    } else {
      payload.qty = num($('#f-qty').value);
      if (sh.type === 'PACKING') payload.cartons = num($('#f-cartons').value);
      var lf = S.M('LINE_FLOOR').filter(function (x) { return x.key === ck.dept; })[0];
      payload.floor = lf ? lf.value : '';
    }
    if (!del && !payload.srn) { toast('SRN chuno', 'bad'); return; }
    if (!del) localStorage.setItem('sg_srn_' + sh.type + '_' + ck.dept, payload.srn);
    api('hourly.slot', payload)
      .then(function (d) {
        toast(del ? 'Hata diya' : 'Saved · aaj ' + d.total + ' · balance ' + d.balance, 'ok');
        delete ck.orders[sh.type + '|' + ck.dept];
        closeSheet(); load();
      })
      .catch(function (e) { toast(e.message, 'bad', 6000); });
  }

  $('#sheet-close').addEventListener('click', closeSheet);
  $('#sheet-bg').addEventListener('click', closeSheet);
  $('#sheet-content').addEventListener('click', function (e) {
    var b = e.target.closest('button'); if (!b) return;
    if (b.dataset.srn) { sh.srn = b.dataset.srn; $$('#sh-srns button').forEach(function (x) { x.classList.toggle('on', x === b); }); renderFields(); }
    else if (b.id === 'sh-save') saveSlot();
    else if (b.dataset.del) { if (confirm(b.dataset.del + ' ki is slot ki entry hatayein?')) saveSlot(b.dataset.del); }
    else if (b.dataset.refresh) { api('orders.refresh').then(function () { delete ck.orders[sh.type + '|' + ck.dept]; return getOrders(sh.type); }).then(renderSheet).catch(function (er) { toast(er.message, 'bad'); }); }
  });
  $('#sheet-content').addEventListener('keydown', function (e) { if (e.key === 'Enter' && e.target.tagName === 'INPUT') { e.preventDefault(); saveSlot(); } });

  S.screens.checklist = open;
})();
