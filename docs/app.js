// app.js — SG Data mobile app (PWA). Talks to the Apps Script API in gas/Api.js.
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

  function parse(s) { try { return s ? JSON.parse(s) : null; } catch (e) { return null; } }
  function pad(n) { return String(n).padStart(2, '0'); }
  function todayStr() { var d = new Date(); return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }

  // ---------- ui helpers ----------

  var toastTimer;
  function toast(msg, kind) {
    var t = $('#toast');
    t.textContent = msg; t.className = 'toast ' + (kind || ''); t.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { t.hidden = true; }, 2800);
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

  // ---------- api ----------

  function api(action, payload) {
    if (!API_URL) return Promise.reject(new Error('API URL set nahi hai — docs/config.js me daalo'));
    busy(true);
    var body = Object.assign({}, payload || {}, { action: action, token: state.token });
    return fetch(API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify(body),
      redirect: 'follow'
    })
      .then(function (r) { return r.json(); })
      .then(function (data) {
        if (!data.ok) {
          if (data.error === 'AUTH') { logout(); }
          throw new Error(data.message || data.error || 'Server error');
        }
        return data;
      })
      .catch(function (err) {
        if (err instanceof TypeError) throw new Error('Network nahi mila — internet check karo');
        throw err;
      })
      .finally(function () { busy(false); });
  }

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
      .then(function () { goHome(); })
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

  // Depts for a factory, restricted to the user's allowed depts, grouped by category order then name
  function deptsFor(factory) {
    var list = M('DEPT').filter(function (d) { return d.factory === factory; });
    if (state.user && state.user.depts && state.user.depts.length) {
      list = list.filter(function (d) { return state.user.depts.indexOf(d.key) >= 0; });
    }
    return list.sort(function (a, b) {
      return (catOrder(a.extra) - catOrder(b.extra)) || a.key.localeCompare(b.key);
    });
  }

  function deptCategory(dept) {
    var d = M('DEPT').filter(function (x) { return x.key === dept; })[0];
    return d ? d.extra : '';
  }

  // Fixed designation list for a dept's category (CAT_ROLE); falls back to every ROLE
  function rolesForDept(dept) {
    var cat = deptCategory(dept);
    var list = M('CAT_ROLE').filter(function (r) { return r.key === cat; })
      .sort(function (a, b) { return Number(a.extra) - Number(b.extra); })
      .map(function (r) { return r.value; });
    return list.length ? list : M('ROLE').map(function (r) { return r.key; });
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
    refreshStatus();
  }

  function refreshStatus() {
    var box = $('#att-status');
    box.innerHTML = '<div class="empty">Loading…</div>';
    api('att.status', { date: state.date, factory: state.factory })
      .then(function (d) {
        var done = {};
        d.depts.forEach(function (x) { done[x.dept + '|' + x.shift] = x; });
        var depts = deptsFor(state.factory);
        if (!depts.length) { box.innerHTML = '<div class="empty">Is factory ke depts MASTERS me nahi hain</div>'; return; }
        box.innerHTML = depts.map(function (dp) {
          var f = done[dp.key + '|Final'], o = done[dp.key + '|OT'], n = done[dp.key + '|Night'];
          var val = f ? f.manpower + ' mp' : '—';
          var sub = [catLabel(dp.extra), o ? 'OT ' + o.manpower : '', n ? 'Night ' + n.manpower : '', f ? 'by ' + f.by : ''].filter(String).join(' · ');
          return '<div class="item" data-dept="' + esc(dp.key) + '"><div><div class="name">' + esc(dp.key) + '</div><div class="sub">' + esc(sub || 'Entry baaki') + '</div></div><div class="val" style="color:' + (f ? 'var(--ok)' : 'var(--muted)') + '">' + esc(val) + '</div></div>';
        }).join('');
      })
      .catch(function (e) { box.innerHTML = '<div class="empty">' + esc(e.message) + '</div>'; });
  }

  // ---------- attendance ----------

  var att = { dept: '', shift: 'Final', prefill: false };

  function openAttendance(dept) {
    var depts = deptsFor(state.factory);
    if (!depts.length) { toast('Is factory ke depts MASTERS me nahi hain', 'bad'); return; }
    att.dept = dept || att.dept || depts[0].key;
    if (!depts.some(function (d) { return d.key === att.dept; })) att.dept = depts[0].key;

    var groups = {}, order = [];
    depts.forEach(function (d) {
      var g = catLabel(d.extra) || 'Other';
      if (!groups[g]) { groups[g] = []; order.push(g); }
      groups[g].push(d);
    });
    $('#att-dept').innerHTML = order.map(function (g) {
      return '<optgroup label="' + esc(g) + '">' + groups[g].map(function (d) {
        return '<option value="' + esc(d.key) + '"' + (d.key === att.dept ? ' selected' : '') + '>' + esc(d.key) + '</option>';
      }).join('') + '</optgroup>';
    }).join('');
    $('#att-shift').innerHTML = state.masters.shifts.map(function (s) {
      return '<option value="' + esc(s.key) + '"' + (s.key === att.shift ? ' selected' : '') + '>' + esc(s.label) + '</option>';
    }).join('');
    show('att', 'Attendance · ' + state.date + ' · FAC' + state.factory);
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
    rows.forEach(function (r) { if (roles.indexOf(r.role) < 0) roles.push(r.role); }); // keep any saved role not in the fixed list

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
        toast('Saved: ' + d.saved + ' roles', 'ok');
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

  // ---------- boot ----------

  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('sw.js').catch(function () {});
  }

  if (!API_URL) {
    show('login');
    $('#login-msg').textContent = 'docs/config.js me API_URL set karo';
  } else if (state.token && state.user) {
    // always refresh masters on open so MASTERS sheet edits reach the phone without re-login
    api('me').then(loadMasters).then(goHome).catch(function () { show('login'); });
  } else {
    show('login');
  }
})();
