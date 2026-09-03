// app.js — SG Data mobile app core: auth, api + offline queue, navigation, home, attendance.
// Other screens live in modules.js and register through window.SG.
(function () {
  'use strict';

  var API_URL = (window.SG_CONFIG && window.SG_CONFIG.API_URL) || '';
  var $ = function (s, el) { return (el || document).querySelector(s); };
  var $$ = function (s, el) { return Array.prototype.slice.call((el || document).querySelectorAll(s)); };

  var state = {
    token: localStorage.getItem('sg_token') || '',
    user: parse(localStorage.getItem('sg_user')),
    masters: parse(localStorage.getItem('sg_masters')),
    date: todayStr(),
    factory: localStorage.getItem('sg_factory') || '666',
    screen: 'login'
  };
  var screens = {};       // name -> open function (registered by modules)
  var WRITE_ACTIONS = ['att.save', 'hourly.save', 'manpower.save'];

  function parse(s) { try { return s ? JSON.parse(s) : null; } catch (e) { return null; } }
  function pad(n) { return String(n).padStart(2, '0'); }
  function todayStr() { var d = new Date(); return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }

  // ---------- ui helpers ----------

  var toastTimer;
  function toast(msg, kind, ms) {
    var t = $('#toast');
    t.textContent = msg; t.className = 'toast ' + (kind || ''); t.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { t.hidden = true; }, ms || 3200);
  }
  function busy(on) { $('#busy').hidden = !on; }

  function show(name, title) {
    state.screen = name;
    $$('.screen').forEach(function (s) { s.hidden = s.id !== 'scr-' + name; });
    $('#topbar-title').textContent = title || 'SG Data';
    $('#btn-back').hidden = (name === 'login' || name === 'home');
    $('#btn-logout').hidden = (name !== 'home');
    window.scrollTo(0, 0);
  }

  function ctxTitle(prefix) { return prefix + ' · ' + state.date + ' · FAC' + state.factory; }

  // ---------- api + offline queue ----------

  function rawPost(body) {
    return fetch(API_URL, {
      method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify(body), redirect: 'follow'
    }).then(function (r) { return r.json(); });
  }

  function api(action, payload, opts) {
    opts = opts || {};
    if (!API_URL) return Promise.reject(new Error('API URL set nahi hai — docs/config.js me daalo'));
    if (!opts.quiet) busy(true);
    var body = Object.assign({}, payload || {}, { action: action, token: state.token });
    return rawPost(body)
      .then(function (data) {
        if (!data.ok) {
          if (data.error === 'AUTH') { logout(); }
          var err = new Error(data.message || data.error || 'Server error');
          err.code = data.error; err.data = data;
          throw err;
        }
        if (queue().length) setTimeout(flushQueue, 50);
        return data;
      })
      .catch(function (err) {
        if (err instanceof TypeError) {
          if (WRITE_ACTIONS.indexOf(action) >= 0 && !opts.noQueue) {
            enqueue(action, payload);
            return { ok: true, queued: true };
          }
          throw new Error('Network nahi mila — internet check karo');
        }
        throw err;
      })
      .finally(function () { if (!opts.quiet) busy(false); });
  }

  function queue() { return parse(localStorage.getItem('sg_queue')) || []; }
  function saveQueue(q) { localStorage.setItem('sg_queue', JSON.stringify(q)); renderQueue(); }
  function enqueue(action, payload) {
    var q = queue();
    q.push({ id: Date.now() + '-' + Math.random().toString(36).slice(2, 7), action: action, payload: payload, ts: new Date().toISOString(), error: '' });
    saveQueue(q);
    toast('Offline — entry save hogi jab net aayega (' + q.length + ' pending)', '', 4000);
  }
  var flushing = false;
  function flushQueue() {
    if (flushing || !navigator.onLine || !state.token) return Promise.resolve();
    var q = queue();
    if (!q.length) return Promise.resolve();
    flushing = true;
    var item = q[0];
    return rawPost(Object.assign({}, item.payload, { action: item.action, token: state.token }))
      .then(function (data) {
        var cur = queue();
        if (data.ok) { cur = cur.filter(function (x) { return x.id !== item.id; }); saveQueue(cur); toast('Offline entry sync ho gayi', 'ok'); }
        else if (data.error === 'AUTH') { logout(); }
        else {
          // server rejected it (validation, lock...) — keep it visible for the user to retry or delete
          cur = cur.map(function (x) { if (x.id === item.id) x.error = data.message || data.error; return x; });
          // move failed item to the end so others can flush
          var failed = cur.filter(function (x) { return x.id === item.id; }), rest = cur.filter(function (x) { return x.id !== item.id; });
          saveQueue(rest.concat(failed));
        }
      })
      .catch(function () { /* still offline */ })
      .finally(function () {
        flushing = false;
        var left = queue();
        if (left.length && left.some(function (x) { return !x.error; })) setTimeout(flushQueue, 500);
      });
  }
  function renderQueue() {
    var q = queue();
    var b = $('#queue-badge'); b.hidden = !q.length; b.textContent = '⏳ ' + q.length;
    var box = $('#queue-box'); box.hidden = !q.length;
    $('#queue-list').innerHTML = q.map(function (x) {
      var p = x.payload || {};
      var what = x.action.replace('.save', '') + ' · ' + esc(p.dept || '') + (p.srn ? ' · ' + esc(p.srn) : '') + ' · ' + esc(p.date || '');
      return '<div class="item"><div><div class="name">' + what + '</div><div class="sub" style="color:' + (x.error ? 'var(--bad)' : 'var(--muted)') + '">' + esc(x.error || 'Sync ka wait') + '</div></div>' +
        '<div class="actions-inline"><button class="primary small" data-retry="' + x.id + '">Retry</button><button class="danger small" data-drop="' + x.id + '">✕</button></div></div>';
    }).join('');
  }
  $('#queue-list').addEventListener('click', function (e) {
    var b = e.target.closest('button'); if (!b) return;
    var q = queue();
    if (b.dataset.drop) { if (confirm('Ye offline entry hata dein?')) saveQueue(q.filter(function (x) { return x.id !== b.dataset.drop; })); }
    if (b.dataset.retry) { saveQueue(q.map(function (x) { if (x.id === b.dataset.retry) x.error = ''; return x; })); flushQueue(); }
  });
  window.addEventListener('online', function () { flushQueue(); });

  // ---------- auth ----------

  function login() {
    var pin = $('#in-pin').value.trim();
    $('#login-msg').textContent = '';
    if (!pin) { $('#login-msg').textContent = 'PIN daalo'; return; }
    api('login', { pin: pin })
      .then(function (d) {
        state.token = d.token; state.user = d.user;
        localStorage.setItem('sg_token', d.token);
        localStorage.setItem('sg_user', JSON.stringify(d.user));
        $('#in-pin').value = '';
        return loadMasters();
      })
      .then(function () { goHome(); flushQueue(); })
      .catch(function (e) { $('#login-msg').textContent = e.message; });
  }

  function logout() {
    state.token = ''; state.user = null;
    localStorage.removeItem('sg_token'); localStorage.removeItem('sg_user');
    show('login');
  }

  function loadMasters() {
    return api('masters').then(function (d) {
      state.masters = d;
      localStorage.setItem('sg_masters', JSON.stringify(d));
    });
  }

  function M(type) { return (state.masters && state.masters.masters && state.masters.masters[type]) || []; }
  function isManager() { return state.user && (state.user.role === 'Manager' || state.user.role === 'Admin'); }

  function allowedFactories() {
    var all = (state.masters && state.masters.factories) || ['666', '117'];
    return state.user && state.user.factory ? all.filter(function (f) { return f === state.user.factory; }) : all;
  }

  function catOrder(cat) {
    var cats = (state.masters && state.masters.categories) || [];
    for (var i = 0; i < cats.length; i++) if (cats[i].key === cat) return i;
    return cats.length;
  }
  function catLabel(cat) {
    var c = ((state.masters && state.masters.categories) || []).filter(function (x) { return x.key === cat; })[0];
    return c ? c.label : (cat || '');
  }

  // Depts for a factory, restricted to the user's allowed depts (and optionally a category), grouped by category
  function deptsFor(factory, cat) {
    var list = M('DEPT').filter(function (d) { return d.factory === factory && (!cat || d.extra === cat); });
    if (state.user && state.user.depts && state.user.depts.length) {
      list = list.filter(function (d) { return state.user.depts.indexOf(d.key) >= 0; });
    }
    return list.sort(function (a, b) { return (catOrder(a.extra) - catOrder(b.extra)) || a.key.localeCompare(b.key); });
  }

  function deptCategory(dept) {
    var d = M('DEPT').filter(function (x) { return x.key === dept; })[0];
    return d ? d.extra : '';
  }

  function rolesForDept(dept) {
    var cat = deptCategory(dept);
    var list = M('CAT_ROLE').filter(function (r) { return r.key === cat; })
      .sort(function (a, b) { return Number(a.extra) - Number(b.extra); })
      .map(function (r) { return r.value; });
    return list.length ? list : M('ROLE').map(function (r) { return r.key; });
  }

  function deptOptions(depts, selected) {
    var groups = {}, order = [];
    depts.forEach(function (d) {
      var g = catLabel(d.extra) || 'Other';
      if (!groups[g]) { groups[g] = []; order.push(g); }
      groups[g].push(d);
    });
    return order.map(function (g) {
      return '<optgroup label="' + esc(g) + '">' + groups[g].map(function (d) {
        return '<option value="' + esc(d.key) + '"' + (d.key === selected ? ' selected' : '') + '>' + esc(d.key) + '</option>';
      }).join('') + '</optgroup>';
    }).join('');
  }

  // ---------- home ----------

  function goHome() {
    show('home', 'SG Data');
    $('#in-date').value = state.date;
    var facs = allowedFactories();
    if (facs.indexOf(state.factory) < 0) state.factory = facs[0];
    $('#factory-toggle').innerHTML = facs.map(function (f) {
      return '<button data-f="' + esc(f) + '" class="' + (f === state.factory ? 'on' : '') + '">FAC' + esc(f) + '</button>';
    }).join('');
    $$('.manager-only').forEach(function (el) { el.hidden = !isManager(); });
    renderQueue();
    refreshStatus();
  }

  function pill(s) { return s ? '<span class="pill ' + esc(s) + '">' + esc(s) + '</span>' : ''; }

  function refreshStatus() {
    var box = $('#att-status');
    box.innerHTML = '<div class="empty">Loading…</div>';
    Promise.all([
      api('att.status', { date: state.date, factory: state.factory }, { quiet: true }),
      api('hourly.day', { date: state.date, factory: state.factory }, { quiet: true })
    ]).then(function (res) {
      var att = {}, hr = {}, st = res[1].statuses || {};
      res[0].depts.forEach(function (x) { att[x.dept + '|' + x.shift] = x; });
      res[1].hourly.forEach(function (x) { hr[x.dept + '|' + x.type] = x; });
      var depts = deptsFor(state.factory);
      if (!depts.length) { box.innerHTML = '<div class="empty">Is factory ke depts MASTERS me nahi hain</div>'; return; }
      box.innerHTML = depts.map(function (dp) {
        var f = att[dp.key + '|Final'], o = att[dp.key + '|OT'], n = att[dp.key + '|Night'];
        var parts = [catLabel(dp.extra)];
        if (o) parts.push('OT ' + o.manpower);
        if (n) parts.push('Night ' + n.manpower);
        ['STITCH', 'ENDLINE', 'PACKING'].forEach(function (t) { var h = hr[dp.key + '|' + t]; if (h) parts.push(t.toLowerCase() + ' ' + h.qty + ' (' + h.slots + ' slot)'); });
        var status = (st[dp.key + '|STITCH'] || st[dp.key + '|ENDLINE'] || st[dp.key + '|PACKING'] || st[dp.key + '|ATT'] || {}).status;
        var val = f ? f.manpower + ' mp' : '—';
        return '<div class="item" data-dept="' + esc(dp.key) + '"><div><div class="name">' + esc(dp.key) + pill(status) + '</div><div class="sub">' + esc(parts.join(' · ')) + '</div></div><div class="val" style="color:' + (f ? 'var(--ok)' : 'var(--muted)') + '">' + esc(val) + '</div></div>';
      }).join('');
    }).catch(function (e) { box.innerHTML = '<div class="empty">' + esc(e.message) + '</div>'; });
  }

  // ---------- attendance ----------

  var att = { dept: '', shift: 'Final', prefill: false };

  function openAttendance(dept) {
    var depts = deptsFor(state.factory);
    if (!depts.length) { toast('Is factory ke depts MASTERS me nahi hain', 'bad'); return; }
    att.dept = dept || att.dept || depts[0].key;
    if (!depts.some(function (d) { return d.key === att.dept; })) att.dept = depts[0].key;
    $('#att-dept').innerHTML = deptOptions(depts, att.dept);
    $('#att-shift').innerHTML = state.masters.shifts.map(function (s) {
      return '<option value="' + esc(s.key) + '"' + (s.key === att.shift ? ' selected' : '') + '>' + esc(s.label) + '</option>';
    }).join('');
    show('att', ctxTitle('Attendance'));
    loadAttendance();
  }

  function shiftDef() {
    return state.masters.shifts.filter(function (s) { return s.key === att.shift; })[0] || state.masters.shifts[0];
  }

  function loadAttendance() {
    var banner = $('#att-banner');
    banner.hidden = true;
    api('att.get', { date: state.date, factory: state.factory, dept: att.dept, shift: att.shift })
      .then(function (d) {
        att.prefill = d.prefill;
        renderAttRows(d.rows);
        if (d.prefill) {
          banner.className = 'banner'; banner.hidden = false;
          banner.textContent = 'Ye ' + d.prefillDate + ' ka data prefill hai — check karke Save karo';
        } else if (d.rows.length) {
          banner.className = 'banner ok'; banner.hidden = false;
          banner.textContent = 'Aaj ki entry saved hai (' + d.rows[0].by + ', ' + d.rows[0].at + '). Badal ke phir Save kar sakte ho.';
        }
      })
      .catch(function (e) { toast(e.message, 'bad'); renderAttRows([]); });
  }

  function renderAttRows(rows) {
    var sd = shiftDef();
    var byRole = {};
    rows.forEach(function (r) { byRole[r.role] = r; });
    var roles = rolesForDept(att.dept);
    rows.forEach(function (r) { if (roles.indexOf(r.role) < 0) roles.push(r.role); });
    $('#att-rows').innerHTML = roles.map(function (role) {
      var r = byRole[role] || { hours: sd.hours, count: 0 };
      var opts = sd.hourOptions.slice();
      if (opts.indexOf(r.hours) < 0 && r.hours) opts.push(r.hours);
      return '<tr data-role="' + esc(role) + '" class="' + (r.count ? 'filled' : '') + '">' +
        '<td>' + esc(role) + '</td>' +
        '<td><select class="att-hrs">' + opts.map(function (h) { return '<option value="' + h + '"' + (h === r.hours ? ' selected' : '') + '>' + h + '</option>'; }).join('') + '</select></td>' +
        '<td><input class="att-count" type="number" inputmode="numeric" min="0" step="1" value="' + (r.count || '') + '" placeholder="0"></td>' +
        '</tr>';
    }).join('');
    updateAttTotals();
  }

  function collectAttRows() {
    return $$('#att-rows tr').map(function (tr) {
      return { role: tr.getAttribute('data-role'), hours: Number($('.att-hrs', tr).value), count: Number($('.att-count', tr).value || 0) };
    });
  }

  function updateAttTotals() {
    var rows = collectAttRows(), c = 0, h = 0;
    rows.forEach(function (r) { c += r.count; h += r.count * r.hours; });
    $('#att-total-count').textContent = c;
    $('#att-total-hrs').textContent = h;
    $$('#att-rows tr').forEach(function (tr) { tr.classList.toggle('filled', Number($('.att-count', tr).value || 0) > 0); });
  }

  function saveAttendance() {
    var rows = collectAttRows().filter(function (r) { return r.count > 0; });
    if (!rows.length && !confirm('Koi count nahi bhara. Is dept ki aaj ki entry khali save karein?')) return;
    api('att.save', { date: state.date, factory: state.factory, dept: att.dept, shift: att.shift, rows: rows })
      .then(function (d) {
        toast(d.queued ? 'Offline me save — baad me sync hoga' : 'Saved: ' + d.saved + ' roles', 'ok');
        goHome();
      })
      .catch(function (e) { toast(e.message, 'bad'); });
  }

  // ---------- events ----------

  $('#btn-login').addEventListener('click', login);
  $('#in-pin').addEventListener('keydown', function (e) { if (e.key === 'Enter') login(); });
  $('#btn-logout').addEventListener('click', function () { if (confirm('Logout?')) logout(); });
  $('#btn-back').addEventListener('click', goHome);

  $('#in-date').addEventListener('change', function () { state.date = this.value || todayStr(); refreshStatus(); });
  $('#factory-toggle').addEventListener('click', function (e) {
    var b = e.target.closest('button'); if (!b) return;
    state.factory = b.getAttribute('data-f'); localStorage.setItem('sg_factory', state.factory);
    goHome();
  });
  $$('.tile').forEach(function (t) {
    t.addEventListener('click', function () {
      var go = t.getAttribute('data-go');
      if (go === 'att') openAttendance();
      else if (screens[go]) screens[go]();
      else toast('Ye module abhi banega', '');
    });
  });
  $('#att-status').addEventListener('click', function (e) {
    var it = e.target.closest('.item'); if (!it) return;
    openAttendance(it.getAttribute('data-dept'));
  });

  $('#att-dept').addEventListener('change', function () { att.dept = this.value; loadAttendance(); });
  $('#att-shift').addEventListener('change', function () { att.shift = this.value; loadAttendance(); });
  $('#att-rows').addEventListener('input', updateAttTotals);
  $('#btn-att-save').addEventListener('click', saveAttendance);

  // ---------- shared namespace for modules.js ----------

  window.SG = {
    state: state, $: $, $$: $$, esc: esc, api: api, show: show, toast: toast, busy: busy, pill: pill,
    M: M, isManager: isManager, deptsFor: deptsFor, deptOptions: deptOptions, deptCategory: deptCategory,
    rolesForDept: rolesForDept, catLabel: catLabel, goHome: goHome, ctxTitle: ctxTitle, todayStr: todayStr, screens: screens
  };

  // ---------- boot ----------

  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('sw.js').catch(function () {});
  }
  renderQueue();

  if (!API_URL) {
    show('login');
    $('#login-msg').textContent = 'docs/config.js me API_URL set karo';
  } else if (state.token && state.user) {
    // always refresh masters on open so MASTERS sheet edits reach the phone without re-login
    api('me').then(loadMasters).then(function () { goHome(); flushQueue(); }).catch(function (e) {
      if (state.masters && e.message && /Network/.test(e.message)) goHome(); else show('login');
    });
  } else {
    show('login');
  }
})();
