// app.js — SG Data core: state, API + offline queue, auth, navigation (tabs + pushed screens),
// context bar (line · factory · date), attendance form, Main tab. Feature tabs live in home.js / entry.js / data.js.
(function () {
  'use strict';

  var API_URL = (window.SG_CONFIG && window.SG_CONFIG.API_URL) || '';
  var VERSION = '2.0';
  var $ = function (s, el) { return (el || document).querySelector(s); };
  var $$ = function (s, el) { return Array.prototype.slice.call((el || document).querySelectorAll(s)); };

  var state = {
    token: localStorage.getItem('sg_token') || '',
    user: parse(localStorage.getItem('sg_user')),
    masters: parse(localStorage.getItem('sg_masters')),
    date: todayStr(),
    factory: localStorage.getItem('sg_factory') || '666',
    line: localStorage.getItem('sg_line') || ''
  };
  var nav = { tab: 'home', sub: null };
  var tabs = {}, screens = {};
  var WRITE_ACTIONS = ['att.save', 'hourly.save', 'hourly.slot', 'manpower.save'];

  function parse(s) { try { return s ? JSON.parse(s) : null; } catch (e) { return null; } }
  function pad(n) { return String(n).padStart(2, '0'); }
  function todayStr() { var d = new Date(); return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); }
  function fmtDay(iso) {
    var p = (iso || '').split('-'); if (p.length !== 3) return iso;
    var d = new Date(+p[0], +p[1] - 1, +p[2]);
    return ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][d.getDay()] + ' ' + d.getDate() + ' ' + ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][d.getMonth()];
  }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function nowHour() { var d = new Date(); return d.getHours() + d.getMinutes() / 60; }
  function isToday() { return state.date === todayStr(); }
  function remember(k, v) { try { localStorage.setItem('sg_' + k, v); } catch (e) {} }
  function recall(k) { return localStorage.getItem('sg_' + k) || ''; }

  // ---------- ui helpers ----------

  var toastTimer;
  function toast(msg, kind, ms) {
    var t = $('#toast');
    t.textContent = msg; t.className = 'toast ' + (kind || ''); t.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { t.hidden = true; }, ms || 3200);
  }
  function busy(on) { $('#busy').hidden = !on; }
  function pill(s) { return s ? '<span class="pill ' + esc(s) + '">' + esc(s) + '</span>' : ''; }
  function icon(name) { return '<svg><use href="#i-' + name + '"/></svg>'; }

  // ---------- navigation ----------

  function showOnly(id) {
    $$('.screen').forEach(function (s) { s.hidden = s.id !== id; s.classList.remove('in'); });
    var el = document.getElementById(id); if (el) { void el.offsetWidth; el.classList.add('in'); }
    window.scrollTo(0, 0);
  }
  function setHeader(title, sub, back) {
    $('#hdr-title').textContent = title;
    $('#hdr-sub').textContent = sub || '';
    $('#hdr-back').hidden = !back;
    $('#hdr-ctx').disabled = !!back;
  }
  function shortLine(d) { return (d || '').replace(/^FAC\d+-/, ''); }
  function ctxSub() { return 'FAC' + state.factory + ' · ' + fmtDay(state.date) + (isToday() ? '' : ' (purana din)'); }

  var popping = false, skipPop = false;
  function pushHist(st) { if (popping) return; try { history.pushState(st, ''); } catch (e) {} }
  window.addEventListener('popstate', function () {
    if (skipPop) { skipPop = false; return; }
    popping = true;
    try {
      if (!$('#sheet').hidden) { $('#sheet').hidden = true; }
      else if (nav.sub) { tab(nav.tab); }
      else if (nav.tab !== 'home' && state.user) { tab('home'); }
      else { pushHist({ tab: 'home' }); } // stay in the app; a second back on Home is left to the browser
    } finally { popping = false; }
  });

  function tab(name) {
    if (!state.user) return;
    if (name === 'review' && !isAdmin()) name = 'home';
    if (nav.sub || nav.tab !== name) pushHist({ tab: name });
    nav.tab = name; nav.sub = null;
    showOnly('tab-' + name);
    document.body.classList.add('has-nav');
    $('#nav').hidden = false;
    $$('#nav button').forEach(function (b) { b.classList.toggle('on', b.dataset.tab === name); });
    $('#hdr-refresh').hidden = false;
    if (name === 'home' || name === 'hourly' || name === 'pms') setHeader('FAC' + state.factory + ' · ' + fmtDay(state.date), (name === 'pms' ? 'PMS · meri lines' : (isToday() ? 'Aaj' : 'Purana din') + ' · poori factory'), false);
    else if (name === 'data') setHeader(shortLine(state.line) || 'Line chuno', ctxSub(), false);
    else if (name === 'review') setHeader('Review', 'FAC' + state.factory, false);
    else setHeader('Main', state.user.name, false);
    if (tabs[name]) tabs[name]();
  }
  function push(id, title) {
    if (nav.sub !== id) pushHist({ sub: id });
    nav.sub = id;
    showOnly('scr-' + id);
    $('#nav').hidden = true;
    document.body.classList.remove('has-nav');
    $('#hdr-refresh').hidden = true;
    setHeader(title, '', true);
  }
  function back() { tab(nav.tab); }
  function refresh() { if (nav.sub) return; tab(nav.tab); }
  function home() { tab('home'); }

  // ---------- api + offline queue ----------

  function rawPost(body) {
    return fetch(API_URL, { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: JSON.stringify(body), redirect: 'follow' })
      .then(function (r) { return r.json(); });
  }
  var inflight = 0;
  var progTimer;
  function prog(on) {
    inflight += on ? 1 : -1; if (inflight < 0) inflight = 0;
    $('#hdr-prog').hidden = inflight === 0;
    clearTimeout(progTimer);
    if (inflight) progTimer = setTimeout(function () { inflight = 0; $('#hdr-prog').hidden = true; }, 20000);
  }
  function api(action, payload, opts) {
    opts = opts || {};
    if (!API_URL) return Promise.reject(new Error('API URL set nahi hai — docs/config.js me daalo'));
    var blocking = opts.busy || (WRITE_ACTIONS.indexOf(action) >= 0 || /\.(save|decide|send|submit|create|clear|delete|refresh)$/.test(action)) && !opts.quiet;
    if (blocking) busy(true); else prog(true);
    return rawPost(Object.assign({}, payload || {}, { action: action, token: state.token }))
      .then(function (data) {
        if (!data.ok) {
          if (data.error === 'AUTH') logout();
          var err = new Error(data.message || data.error || 'Server error'); err.code = data.error; err.data = data; throw err;
        }
        if (queue().length) setTimeout(flushQueue, 50);
        return data;
      })
      .catch(function (err) {
        if (err instanceof TypeError) {
          if (WRITE_ACTIONS.indexOf(action) >= 0 && !opts.noQueue) { enqueue(action, payload); return { ok: true, queued: true }; }
          throw new Error('Network nahi mila — internet check karo');
        }
        throw err;
      })
      .finally(function () { if (blocking) busy(false); else prog(false); });
  }

  // stale-while-revalidate for read calls: instant data from the last copy + a promise for fresh data
  function swr(action, payload, ttl) {
    var key = 'sg_c_' + action + '_' + JSON.stringify(payload || {});
    var hit = parse(localStorage.getItem(key)), fresh = hit && Date.now() - hit.t < (ttl || 15000);
    var p = fresh ? Promise.resolve(hit.d) : api(action, payload, { quiet: true }).then(function (d) { try { localStorage.setItem(key, JSON.stringify({ t: Date.now(), d: d })); } catch (e) {} return d; });
    return { data: hit ? hit.d : null, fresh: fresh, promise: p };
  }
  function clearLocalCaches() { Object.keys(localStorage).forEach(function (k) { if (k.indexOf('sg_c_') === 0 || k.indexOf('sg_ft_') === 0) localStorage.removeItem(k); }); }
  function hardRefresh() {
    clearLocalCaches(); invalidateAll();
    return api('cache.clear').then(function () { return api('me', {}, { quiet: true }); }).then(function (d) { setUser(d.user); return loadMasters(); })
      .then(function () { ensureLine(); toast('Sab data refresh ho gaya', 'ok'); refresh(); }).catch(function (e) { toast(e.message, 'bad'); refresh(); });
  }

  function queue() { return parse(localStorage.getItem('sg_queue')) || []; }
  function saveQueue(q) { localStorage.setItem('sg_queue', JSON.stringify(q)); renderQueueBadge(); }
  function enqueue(action, payload) {
    var q = queue();
    q.push({ id: Date.now() + '-' + Math.random().toString(36).slice(2, 7), action: action, payload: payload, ts: new Date().toISOString(), error: '' });
    saveQueue(q);
    toast('Offline — entry save hogi jab net aayega (' + q.length + ' pending)', '', 4000);
  }
  var flushing = false;
  function flushQueue() {
    if (flushing || !navigator.onLine || !state.token) return Promise.resolve();
    var q = queue(); if (!q.length) return Promise.resolve();
    var item = q.filter(function (x) { return !x.error; })[0]; if (!item) return Promise.resolve();
    flushing = true;
    return rawPost(Object.assign({}, item.payload, { action: item.action, token: state.token }))
      .then(function (data) {
        var cur = queue();
        if (data.ok) { saveQueue(cur.filter(function (x) { return x.id !== item.id; })); toast('Offline entry sync ho gayi', 'ok'); invalidate(); }
        else if (data.error === 'AUTH') logout();
        else saveQueue(cur.map(function (x) { if (x.id === item.id) x.error = data.message || data.error; return x; }));
      })
      .catch(function () {})
      .finally(function () { flushing = false; if (queue().some(function (x) { return !x.error; })) setTimeout(flushQueue, 500); });
  }
  function renderQueueBadge() { var q = queue(); var b = $('#queue-badge'); b.hidden = !q.length; b.textContent = '⏳ ' + q.length; }
  window.addEventListener('online', function () { flushQueue(); });

  // ---------- auth ----------

  function login() {
    var pin = $('#in-pin').value.trim();
    $('#login-msg').textContent = '';
    if (!pin) { $('#login-msg').textContent = 'PIN daalo'; return; }
    api('login', { pin: pin })
      .then(function (d) {
        state.token = d.token; state.user = d.user;
        localStorage.setItem('sg_token', d.token); localStorage.setItem('sg_user', JSON.stringify(d.user));
        $('#in-pin').value = '';
        return loadMasters();
      })
      .then(function () { ensureLine(); home(); flushQueue(); })
      .catch(function (e) { $('#login-msg').textContent = e.message; });
  }
  function logout() {
    state.token = ''; state.user = null;
    localStorage.removeItem('sg_token'); localStorage.removeItem('sg_user');
    $('#nav').hidden = true; document.body.classList.remove('has-nav');
    setHeader('SG Data', '', false);
    showOnly('scr-login');
  }
  function setUser(u) { if (!u) return; state.user = u; localStorage.setItem('sg_user', JSON.stringify(u)); }
  function loadMasters() {
    return api('masters').then(function (d) { state.masters = d; localStorage.setItem('sg_masters', JSON.stringify(d)); });
  }

  // ---------- masters helpers ----------

  function M(type) { return (state.masters && state.masters.masters && state.masters.masters[type]) || []; }
  function isManager() { return !!state.user && (state.user.role === 'Manager' || state.user.role === 'Admin'); }
  function isAdmin() { return !!state.user && state.user.role === 'Admin'; }
  function allowedFactories() {
    var all = (state.masters && state.masters.factories) || ['666', '117'];
    return state.user && state.user.factory ? all.filter(function (f) { return f === state.user.factory; }) : all;
  }
  function catOrder(cat) { var cats = (state.masters && state.masters.categories) || []; for (var i = 0; i < cats.length; i++) if (cats[i].key === cat) return i; return cats.length; }
  function catLabel(cat) { var c = ((state.masters && state.masters.categories) || []).filter(function (x) { return x.key === cat; })[0]; return c ? c.label : (cat || ''); }
  function deptsFor(factory, cat) {
    var list = M('DEPT').filter(function (d) { return d.factory === factory && (!cat || d.extra === cat) && (d.extra === 'STITCH' || d.extra === 'PACKING'); });
    if (state.user && state.user.depts && state.user.depts.length) list = list.filter(function (d) { return state.user.depts.indexOf(d.key) >= 0; });
    return list.sort(function (a, b) { return (catOrder(a.extra) - catOrder(b.extra)) || a.key.localeCompare(b.key); });
  }
  function deptCategory(dept) { var d = M('DEPT').filter(function (x) { return x.key === dept; })[0]; return d ? d.extra : ''; }
  function rolesForDept(dept) {
    var cat = deptCategory(dept);
    var list = M('CAT_ROLE').filter(function (r) { return r.key === cat; }).sort(function (a, b) { return Number(a.extra) - Number(b.extra); }).map(function (r) { return r.value; });
    return list.length ? list : M('ROLE').map(function (r) { return r.key; });
  }
  function deptOptions(depts, selected) {
    var groups = {}, order = [];
    depts.forEach(function (d) { var g = catLabel(d.extra) || 'Other'; if (!groups[g]) { groups[g] = []; order.push(g); } groups[g].push(d); });
    return order.map(function (g) {
      return '<optgroup label="' + esc(g) + '">' + groups[g].map(function (d) { return '<option value="' + esc(d.key) + '"' + (d.key === selected ? ' selected' : '') + '>' + esc(d.key) + '</option>'; }).join('') + '</optgroup>';
    }).join('');
  }
  function slots(shift) { return (state.masters.slots || []).filter(function (s) { return !shift || s.shift === shift; }); }
  function slotDef(key) { return (state.masters.slots || []).filter(function (s) { return s.key === key; })[0]; }
  function slotStart(key) { return Number(key.split('-')[0]); }
  function lineCat() { return deptCategory(state.line); }
  function hourlyType() { var c = lineCat(); return c === 'STITCH' ? 'STITCH' : c === 'PACKING' ? 'PACKING' : ''; }
  function ensureLine() {
    var facs = allowedFactories(); if (facs.indexOf(state.factory) < 0) state.factory = facs[0];
    var depts = deptsFor(state.factory);
    if (!depts.some(function (d) { return d.key === state.line; })) state.line = depts.length ? depts[0].key : '';
    localStorage.setItem('sg_line', state.line); localStorage.setItem('sg_factory', state.factory);
  }

  // ---------- today's data (shared cache) ----------

  var cache = { key: '', data: null, t: 0, p: null };
  function invalidate() { cache.data = null; cache.p = null; fcache.t = 0; }
  function loadToday(force) {
    var key = [state.date, state.factory, state.line].join('|');
    if (!force && cache.key === key && cache.data && Date.now() - cache.t < 30000) return Promise.resolve(cache.data);
    if (cache.key === key && cache.p) return cache.p;
    cache.key = key; cache.data = null;
    cache.p = api('line.today', { date: state.date, factory: state.factory, dept: state.line }, { quiet: true })
      .then(function (d) { cache.data = d; cache.t = Date.now(); cache.p = null; return d; })
      .catch(function (e) { cache.p = null; throw e; });
    return cache.p;
  }
  function today() { return cache.data; }

  // factory.today: instant render from the last copy, then refresh from the server
  var fcache = { key: '', data: null, t: 0, p: null };
  function fkey() { return state.date + '|' + state.factory; }
  function factoryData() { if (fcache.key !== fkey()) return parse(localStorage.getItem('sg_ft_' + fkey())); return fcache.data; }
  function loadFactory(force) {
    var key = fkey();
    if (!force && fcache.key === key && fcache.data && Date.now() - fcache.t < 20000) return Promise.resolve(fcache.data);
    if (fcache.key === key && fcache.p) return fcache.p;
    fcache.key = key;
    fcache.p = api('factory.today', { date: state.date, factory: state.factory }, { quiet: true })
      .then(function (d) { fcache.data = d; fcache.t = Date.now(); fcache.p = null; try { localStorage.setItem('sg_ft_' + key, JSON.stringify(d)); } catch (e) {} return d; })
      .catch(function (e) { fcache.p = null; throw e; });
    return fcache.p;
  }
  function invalidateAll() { invalidate(); fcache.data = null; fcache.t = 0; }
  function lockedType(type) { var s = today() && today().statuses && today().statuses[type]; s = s && s.status; return s === 'Submitted' || s === 'Approved' || s === 'Sent'; }

  // ---------- context: line / factory / date ----------

  function setLine(d) { state.line = d; localStorage.setItem('sg_line', d); invalidate(); refresh(); }
  function setFactory(f) { state.factory = f; localStorage.setItem('sg_factory', f); ensureLine(); invalidate(); refresh(); }
  function setDate(d) { state.date = d || todayStr(); invalidate(); refresh(); }

  function openContext() {
    var facs = allowedFactories(), depts = deptsFor(state.factory);
    var html = '';
    if (facs.length > 1) html += '<label>Factory</label><div class="toggle">' + facs.map(function (f) { return '<button data-f="' + esc(f) + '" class="' + (f === state.factory ? 'on' : '') + '">FAC' + esc(f) + '</button>'; }).join('') + '</div>';
    html += '<label>Line / Dept</label>';
    if (depts.length <= 10) html += '<div class="chips" style="flex-wrap:wrap">' + depts.map(function (d) { return '<button data-d="' + esc(d.key) + '" class="' + (d.key === state.line ? 'on' : '') + '">' + esc(d.key) + '</button>'; }).join('') + '</div>';
    else html += '<select id="ctx-line">' + deptOptions(depts, state.line) + '</select>';
    html += '<label>Date</label><div class="row"><input id="ctx-date" type="date" value="' + esc(state.date) + '"><button class="btn ghost" data-today="1">Aaj</button></div>';
    SG.sheet.open('Line · Factory · Date', html);
    var c = $('#sheet-content');
    c.onclick = function (e) {
      var b = e.target.closest('button'); if (!b) return;
      if (b.dataset.f) { setFactory(b.dataset.f); openContext(); }
      else if (b.dataset.d) { setLine(b.dataset.d); SG.sheet.close(); }
      else if (b.dataset.today) { setDate(todayStr()); SG.sheet.close(); }
    };
    c.onchange = function (e) {
      if (e.target.id === 'ctx-date') { setDate(e.target.value); SG.sheet.close(); }
      if (e.target.id === 'ctx-line') { setLine(e.target.value); SG.sheet.close(); }
    };
  }

  // ---------- attendance form (pushed screen) ----------

  var att = { dept: '', shift: 'Final', srn: '', srns: [] };
  function attType() { var c = deptCategory(att.dept); return c === 'PACKING' ? 'PACKING' : 'STITCH'; }
  function renderAttSrns() {
    var box = $('#att-srn'), list = att.srns || [];
    if (attType() === 'PACKING') {
      box.className = '';
      SG.srnPicker(box, { list: list, value: att.srn, placeholder: 'SRN number likho (jaise 596)', onPick: function (v) { att.srn = v; } });
      return;
    }
    box.className = 'chips';
    if (att.srn && !list.some(function (x) { return x.srn === att.srn; })) list = [{ srn: att.srn, balance: '' }].concat(list);
    box.innerHTML = list.length ? list.map(function (x) { return '<button data-srn="' + esc(x.srn) + '" class="' + (x.srn === att.srn ? 'on' : '') + '">' + esc(x.srn) + (x.balance !== '' ? '<small>bal ' + x.balance + '</small>' : '') + '</button>'; }).join('')
      : '<span class="muted" style="font-size:12px">Is line par loading nahi mili</span>';
  }
  function loadAttSrns() {
    att.srns = []; renderAttSrns();
    api('orders.active', { factory: state.factory, dept: att.dept, type: attType() }, { quiet: true })
      .then(function (d) { att.srns = d.srns; if (!att.srn && d.srns[0] && !d.all) att.srn = d.srns[0].srn; renderAttSrns(); })
      .catch(function () {});
  }
  $('#att-srn').addEventListener('click', function (e) { var b = e.target.closest('.chips button[data-srn]'); if (!b) return; att.srn = b.dataset.srn; renderAttSrns(); });
  function openAttendance(shift, dept) {
    var depts = deptsFor(state.factory);
    if (!depts.length) { toast('Is factory ke depts MASTERS me nahi hain', 'bad'); return; }
    if (shift) att.shift = shift;
    att.dept = dept || state.line || depts[0].key;
    if (!depts.some(function (d) { return d.key === att.dept; })) {
      if (dept) { depts = depts.concat([{ key: dept, factory: state.factory, extra: deptCategory(dept) || 'STITCH' }]); loadMasters().catch(function () {}); }
      else att.dept = depts[0].key;
    }
    $('#att-dept').innerHTML = deptOptions(depts, att.dept);
    $('#att-shift').innerHTML = state.masters.shifts.map(function (s) { return '<option value="' + esc(s.key) + '"' + (s.key === att.shift ? ' selected' : '') + '>' + esc(s.label) + '</option>'; }).join('');
    push('att', (att.shift === 'Final' ? 'Attendance' : att.shift + ' attendance') + ' · ' + fmtDay(state.date));
    att.srn = ''; loadAttendance();
  }
  function shiftDef() { return state.masters.shifts.filter(function (s) { return s.key === att.shift; })[0] || state.masters.shifts[0]; }
  function loadAttendance() {
    var banner = $('#att-banner'); banner.hidden = true;
    api('att.get', { date: state.date, factory: state.factory, dept: att.dept, shift: att.shift })
      .then(function (d) {
        att.srn = d.srn || ''; loadAttSrns();
        renderAttRows(d.rows);
        if (d.prefill) { banner.className = 'banner'; banner.hidden = false; banner.textContent = 'Ye ' + d.prefillDate + ' ka data prefill hai — check karke Save karo'; }
        else if (d.rows.length) { banner.className = 'banner ok'; banner.hidden = false; banner.textContent = 'Saved (' + d.rows[0].by + ', ' + d.rows[0].at + '). Badal ke phir Save kar sakte ho.'; }
      })
      .catch(function (e) { toast(e.message, 'bad'); renderAttRows([]); });
  }
  function renderAttRows(rows) {
    var sd = shiftDef(), byRole = {};
    rows.forEach(function (r) { byRole[r.role] = r; });
    var roles = rolesForDept(att.dept);
    rows.forEach(function (r) { if (roles.indexOf(r.role) < 0) roles.push(r.role); });
    $('#att-rows').innerHTML = roles.map(function (role) {
      var r = byRole[role] || { hours: sd.hours, count: 0 }, opts = sd.hourOptions.slice();
      if (opts.indexOf(r.hours) < 0 && r.hours) opts.push(r.hours);
      return '<tr data-role="' + esc(role) + '" class="' + (r.count ? 'filled' : '') + '"><td>' + esc(role) + '</td>' +
        '<td><select class="att-hrs">' + opts.map(function (h) { return '<option value="' + h + '"' + (h === r.hours ? ' selected' : '') + '>' + h + '</option>'; }).join('') + '</select></td>' +
        '<td><div class="step"><button type="button" class="st-dec" tabindex="-1">−</button><input class="att-count" type="number" inputmode="numeric" min="0" step="1" value="' + (r.count || '') + '" placeholder="0"><button type="button" class="st-inc" tabindex="-1">+</button></div></td></tr>';
    }).join('');
    updateAttTotals();
  }
  function collectAttRows() { return $$('#att-rows tr').map(function (tr) { return { role: tr.dataset.role, hours: Number($('.att-hrs', tr).value), count: Number($('.att-count', tr).value || 0) }; }); }
  function updateAttTotals() {
    var c = 0, h = 0;
    collectAttRows().forEach(function (r) { c += r.count; h += r.count * r.hours; });
    $('#att-total-count').textContent = c; $('#att-total-hrs').textContent = h;
    $$('#att-rows tr').forEach(function (tr) { tr.classList.toggle('filled', Number($('.att-count', tr).value || 0) > 0); });
  }
  function saveAttendance() {
    var rows = collectAttRows().filter(function (r) { return r.count > 0; });
    if (!rows.length && !confirm('Koi count nahi bhara. Khali save karein?')) return;
    if (!att.srn && (att.srns || []).length) { toast('Pehle SRN chuno', 'bad'); return; }
    api('att.save', { date: state.date, factory: state.factory, dept: att.dept, shift: att.shift, srn: att.srn, rows: rows })
      .then(function (d) { toast(d.queued ? 'Offline me save — baad me sync hoga' : 'Saved: ' + d.saved + ' roles', 'ok'); invalidateAll(); back(); if (!d.queued) setTimeout(function () { offerGroup((att.shift === 'Final' ? 'Attendance' : att.shift + ' attendance') + ' group me bhejein?'); }, 400); })
      .catch(function (e) { toast(e.message, 'bad'); });
  }

  // ---------- WhatsApp: attendance summary for the group ----------
  var ROLE_SHORT = { Operator: 'Op', Helper: 'Hlp', Supervisor: 'Sup', Incharge: 'Inch', Feeder: 'Fdr', 'Data Collector': 'DC', 'Thread cutter': 'TC', 'End Line Checker': 'ELC', 'Hand needle': 'HN', Paster: 'Pst', Checker: 'Chk', 'Press Man': 'Press', 'Line Qc.': 'QC', 'Final Checker': 'FC', 'Cutting master': 'CM', 'Die cutter': 'Die', 'Layer cutter': 'Layer', Assistant: 'Asst' };
  var EV_LABEL = { HALF_DAY: 'half day', LEFT_AT: 'chhutti gaya', LATE_JOIN: 'late aaya', ABSENT: 'absent', EXTRA: 'extra aaya', TRANSFER_OUT: 'transfer gaya', TRANSFER_IN: 'transfer se aaya' };
  function longDate(iso) {
    var p = iso.split('-'), d = new Date(+p[0], +p[1] - 1, +p[2]);
    return ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'][d.getDay()] + ', ' + pad(d.getDate()) + ' ' + ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][d.getMonth()] + ' ' + d.getFullYear();
  }
  function ampm(hhmm) { var m = (hhmm || '').match(/^(\d{1,2}):(\d{2})/); if (!m) return hhmm || ''; var h = +m[1]; return (h % 12 || 12) + ':' + m[2] + ' ' + (h >= 12 ? 'PM' : 'AM'); }
  function floorOf(dept) {
    var lf = M('LINE_FLOOR').filter(function (x) { return x.key === dept; })[0];
    var m = lf && lf.value.match(/(Ground|First|Second|Third)/i);
    return m ? m[1].charAt(0).toUpperCase() + m[1].slice(1).toLowerCase() + ' floor' : '';
  }
  function waAttendanceText(d, shift) {
    shift = shift || 'Final';
    var lines = d.depts.filter(function (x) { return d.att[x.dept + '|' + shift]; });
    if (!lines.length) return '';
    var floors = lines.map(function (x) { return floorOf(x.dept); }).filter(String);
    var oneFloor = floors.length && floors.every(function (f) { return f === floors[0]; }) ? floors[0] : '';
    var p = state.date.split('-'), dateStr = pad(+p[2]) + ' ' + ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][+p[1] - 1] + ' ' + p[0];
    var out = [], grand = 0;
    out.push('Date:- ' + dateStr + (oneFloor ? ' - ' + oneFloor : '') + (shift !== 'Final' ? ' - ' + shift : '') + ' - FAC' + state.factory);
    out.push('');
    lines.forEach(function (x) {
      var mp = d.att[x.dept + '|' + shift], roles = (d.attRoles && d.attRoles[x.dept + '|' + shift]) || {};
      grand += mp;
      var fl = !oneFloor ? floorOf(x.dept) : '';
      out.push(shortLine(x.dept) + (d.attSrn && d.attSrn[x.dept] ? ' - ' + d.attSrn[x.dept] : '') + (fl ? ' (' + fl + ')' : ''));
      Object.keys(roles).forEach(function (r) { out.push(r + ' - ' + roles[r]); });
      out.push('Total manpower ' + mp);
      out.push('');
    });
    if (lines.length > 1) { out.push('Grand total ' + grand + ' manpower'); out.push(''); }
    var evs = (d.eventList || []);
    if (shift === 'Final' && evs.length) {
      out.push('Changes:');
      var byDept = {};
      evs.forEach(function (e) { (byDept[e.dept] = byDept[e.dept] || []).push(e); });
      Object.keys(byDept).forEach(function (dept) {
        var parts = byDept[dept].map(function (e) { return e.count + ' ' + e.role + ' ' + (EV_LABEL[e.event] || e.event) + (e.time ? ' (' + ampm(e.time) + ')' : ''); });
        var nowMp = d.mpNow && d.mpNow[dept];
        out.push(shortLine(dept) + ' - ' + parts.join(', ') + (nowMp !== undefined ? ' - ab ' + nowMp : ''));
      });
      out.push('');
    }
    out.push('- ' + (state.user.name || ''));
    return out.join('\n');
  }
  // fresh data -> preview sheet -> WhatsApp (the button click is the user gesture that opens the app)
  function sendToGroup(shift) {
    busy(true);
    loadFactory(true).then(function (d) {
      busy(false);
      var text = waAttendanceText(d, shift);
      if (!text) { toast('Abhi koi attendance nahi bhari', 'bad'); return; }
      SG.sheet.open('Group me bhejo', '<pre class="wa-prev">' + esc(text) + '</pre>' +
        '<a class="btn big wa" id="wa-open" href="https://wa.me/?text=' + encodeURIComponent(text) + '" target="_blank" rel="noopener" style="display:flex;align-items:center;justify-content:center;gap:8px;text-decoration:none">' + icon('wa') + ' WhatsApp me bhejo</a>' +
        '<button class="btn ghost big" id="wa-copy">Copy text</button>');
      $('#sheet-content').onclick = function (e) {
        if (e.target.closest('#wa-copy')) { try { navigator.clipboard.writeText(text); toast('Copy ho gaya', 'ok'); } catch (er) { toast('Copy nahi hua', 'bad'); } }
        if (e.target.closest('#wa-open')) setTimeout(SG.sheet.close, 300);
      };
    }).catch(function (e) { busy(false); toast(e.message, 'bad'); });
  }
  function offerGroup(msg) { if (confirm(msg || 'Attendance update group me bhejein?')) sendToGroup('Final'); }

  // ---------- Main tab ----------

  tabs.main = function () {
    var u = state.user, q = queue();
    var html = '<div class="card me"><div class="av">' + esc((u.name || '?').charAt(0).toUpperCase()) + '</div><div><div class="n">' + esc(u.name) + '</div><div class="s">' + esc(u.role) + (u.factory ? ' · FAC' + esc(u.factory) : ' · dono factory') + (u.depts && u.depts.length ? ' · ' + u.depts.length + ' dept' : '') + '</div></div></div>';
    if (u.role === 'Admin') html += '<h2>Admin</h2><div class="menu"><div class="task" data-m="users"><div class="ic">' + icon('user') + '</div><div class="b"><div class="n">Users & access</div><div class="s">Naya user, PIN, lines / floors, active</div></div>' + icon('chev') + '</div></div>';
    html += '<h2>Setting</h2><div class="menu">';
    html += '<div class="task" data-m="ctx"><div class="ic">' + icon('home') + '</div><div class="b"><div class="n">Entry / Data ki line</div><div class="s">' + esc(state.line || '—') + ' · FAC' + esc(state.factory) + '</div></div>' + icon('chev') + '</div>';
    html += '<div class="task" data-m="endline"><div class="ic">' + icon('qc') + '</div><div class="b"><div class="n">Endline timeline me dikhao</div><div class="s">QC checker ke liye on karo</div></div><span class="v">' + (recall('show_endline') === '1' ? 'On' : 'Off') + '</span></div>';
    html += '<div class="task" data-m="hard"><div class="ic">' + icon('refresh') + '</div><div class="b"><div class="n">Refresh sab data</div><div class="s">Sheet me haath se kuch badla / delete kiya ho to</div></div>' + icon('chev') + '</div>';
    html += '<div class="task" data-m="refresh"><div class="ic">' + icon('refresh') + '</div><div class="b"><div class="n">Loading refresh</div><div class="s">Nayi loading sheet me aayi ho to</div></div>' + icon('chev') + '</div>';
    html += '<div class="task" data-m="masters"><div class="ic">' + icon('table') + '</div><div class="b"><div class="n">Masters reload</div><div class="s">Depts / roles badle ho to</div></div>' + icon('chev') + '</div>';
    html += '</div>';
    if (q.length) {
      html += '<h2>Offline pending (' + q.length + ')</h2><div class="list">' + q.map(function (x) {
        var p = x.payload || {};
        return '<div class="item"><div><div class="name">' + esc(x.action.replace('.save', '').replace('.slot', ' slot')) + ' · ' + esc(p.dept || '') + (p.srn ? ' · ' + esc(p.srn) : '') + (p.slot ? ' · ' + esc(p.slot) : '') + '</div><div class="sub" style="color:' + (x.error ? 'var(--bad)' : 'var(--muted)') + '">' + esc(x.error || 'Sync ka wait') + '</div></div>' +
          '<div class="actions-inline"><button class="btn small" data-retry="' + x.id + '">Retry</button><button class="btn danger small" data-drop="' + x.id + '">✕</button></div></div>';
      }).join('') + '</div>';
    }
    html += '<h2>App</h2><div class="menu"><div class="task" data-m="logout"><div class="ic" style="background:var(--bad-soft);color:var(--bad)">' + icon('logout') + '</div><div class="b"><div class="n">Logout</div><div class="s">SG Data v' + VERSION + '</div></div></div></div>';
    $('#main-body').innerHTML = html;
  };
  $('#main-body').addEventListener('click', function (e) {
    var b = e.target.closest('button'); var t = e.target.closest('[data-m]');
    if (b && b.dataset.drop) { if (confirm('Ye offline entry hata dein?')) { saveQueue(queue().filter(function (x) { return x.id !== b.dataset.drop; })); tabs.main(); } return; }
    if (b && b.dataset.retry) { saveQueue(queue().map(function (x) { if (x.id === b.dataset.retry) x.error = ''; return x; })); flushQueue().then(tabs.main); return; }
    if (!t) return;
    var m = t.dataset.m;
    if (m === 'ctx') openContext();
    else if (m === 'users') screens.users();
    else if (m === 'hard') hardRefresh();
    else if (m === 'endline') { remember('show_endline', recall('show_endline') === '1' ? '0' : '1'); tabs.main(); }
    else if (m === 'refresh') api('orders.refresh').then(function () { toast('Loading refresh ho gayi', 'ok'); invalidate(); }).catch(function (er) { toast(er.message, 'bad'); });
    else if (m === 'masters') loadMasters().then(function () { ensureLine(); toast('Masters reload ho gaye', 'ok'); }).catch(function (er) { toast(er.message, 'bad'); });
    else if (m === 'logout') { if (confirm('Logout?')) logout(); }
  });

  // ---------- events ----------

  $('#btn-login').addEventListener('click', login);
  $('#in-pin').addEventListener('keydown', function (e) { if (e.key === 'Enter') login(); });
  $('#hdr-back').addEventListener('click', back);
  $('#hdr-ctx').addEventListener('click', function () { if (state.user && !nav.sub) openContext(); });
  $('#hdr-refresh').addEventListener('click', hardRefresh);
  $('#nav').addEventListener('click', function (e) { var b = e.target.closest('button[data-tab]'); if (b) tab(b.dataset.tab); });
  $('#att-dept').addEventListener('change', function () { att.dept = this.value; att.srn = ''; loadAttendance(); });
  $('#att-shift').addEventListener('change', function () { att.shift = this.value; loadAttendance(); });
  $('#att-rows').addEventListener('input', updateAttTotals);
  $('#att-rows').addEventListener('click', function (e) {
    var b = e.target.closest('.st-dec, .st-inc'); if (!b) return;
    var inp = $('.att-count', b.parentNode), v = Number(inp.value || 0) + (b.classList.contains('st-inc') ? 1 : -1);
    inp.value = v > 0 ? v : ''; updateAttTotals();
  });
  $('#btn-att-save').addEventListener('click', saveAttendance);

  // ---------- shared namespace ----------

  window.SG = {
    state: state, nav: nav, tabs: tabs, screens: screens, VERSION: VERSION,
    $: $, $$: $$, esc: esc, api: api, toast: toast, busy: busy, pill: pill, icon: icon,
    M: M, isManager: isManager, deptsFor: deptsFor, deptOptions: deptOptions, deptCategory: deptCategory, rolesForDept: rolesForDept, catLabel: catLabel,
    todayStr: todayStr, fmtDay: fmtDay, nowHour: nowHour, isToday: isToday, slots: slots, slotDef: slotDef, slotStart: slotStart,
    lineCat: lineCat, hourlyType: hourlyType, lockedType: lockedType, remember: remember, recall: recall,
    tab: tab, push: push, back: back, refresh: refresh, home: home, invalidate: invalidate, invalidateAll: invalidateAll, loadToday: loadToday, today: today,
    loadFactory: loadFactory, factoryData: factoryData, shortLine: shortLine, swr: swr, hardRefresh: hardRefresh, clearLocalCaches: clearLocalCaches,
    skipPop: function () { skipPop = true; }, isAdmin: isAdmin, sendToGroup: sendToGroup, waAttendanceText: waAttendanceText, offerGroup: offerGroup,
    setLine: setLine, setDate: setDate, setFactory: setFactory, openContext: openContext, openAttendance: openAttendance, loadMasters: loadMasters
  };

  // ---------- boot ----------

  function boot() {
    try { history.replaceState({ tab: 'home' }, ''); } catch (e) {}
    if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(function () {});
    renderQueueBadge();
    $$('.manager-only').forEach(function (el) { el.hidden = !isManager(); });
    $$('.admin-only').forEach(function (el) { el.hidden = !isAdmin(); });
    if (!API_URL) { showOnly('scr-login'); $('#login-msg').textContent = 'docs/config.js me API_URL set karo'; return; }
    if (state.token && state.user) {
      if (state.masters) { ensureLine(); home(); }
      api('me', {}, { quiet: true }).then(function (d) { setUser(d.user); return loadMasters(); }).then(function () { ensureLine(); $$('.manager-only').forEach(function (el) { el.hidden = !isManager(); }); $$('.admin-only').forEach(function (el) { el.hidden = !isAdmin(); }); if (!nav.sub) tab(nav.tab); flushQueue(); })
        .catch(function (e) { if (!state.masters || !/Network/.test(e.message || '')) logout(); });
    } else showOnly('scr-login');
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot); else setTimeout(boot, 0);
})();
