// data.js — Data tab: what has been recorded for the selected line & date. Summary + per-type tables; tap a row to edit
// one slot, or "✎ Edit" to change every slot of the day at once (add / correct / delete qty, SRN, endline, packing).
(function () {
  'use strict';
  var S = window.SG, $ = S.$, $$ = S.$$, esc = S.esc, api = S.api, state = S.state, toast = S.toast;
  var seg = 'out';
  var ed = { on: false, type: '', srns: [], ot: false };
  function num(v) { var n = Number(v); return isNaN(n) ? 0 : n; }
  function sum(rows, f) { var t = 0; (rows || []).forEach(function (r) { t += Number(r[f]) || 0; }); return t; }
  function flat(m) { var o = []; Object.keys(m || {}).forEach(function (k) { o = o.concat(m[k]); }); return o; }

  S.tabs.data = function () {
    if (!state.line) { $('#data-summary').innerHTML = '<div class="empty">Pehle upar se line chuno</div>'; $('#data-seg').innerHTML = ''; $('#data-body').innerHTML = ''; return; }
    if (!ed.on) $('#data-body').innerHTML = '<div class="empty">Loading…</div>';
    S.loadToday().then(render).catch(function (e) { $('#data-body').innerHTML = '<div class="empty">' + esc(e.message) + '</div>'; });
  };
  function editBtn(type) {
    if (S.lockedType(type)) return '<span class="muted" style="font-size:12px">' + esc(S.today().statuses[type].status) + ' — edit band</span>';
    return '<button class="lnk" data-edit="' + type + '" style="margin:0">✎ Edit / manual entry</button>';
  }

  function render(d) {
    var type = S.hourlyType(), cat = S.lineCat();
    var sl = (d.slots || {})[type] || {}, el = (d.slots || {}).ENDLINE || {};
    var out = sum(flat(sl), 'qty'), mp = d.att.Final ? d.att.Final.manpower : 0, mh = d.att.Final ? d.att.Final.manhours : 0;
    var eChk = sum(flat(el), 'checked'), ePass = sum(flat(el), 'pass');
    var statuses = d.statuses || {}, stKeys = Object.keys(statuses);
    var stats = '<div class="stats">';
    if (type) stats += '<div class="stat"><div class="k">' + (type === 'PACKING' ? 'Packed' : 'Output') + '</div><div class="v">' + out + '<small> pcs</small></div></div>';
    var aF = d.att.Final || {}, mhNote = aF.closedAt ? ' · band ' + aF.closedAt : (aF.rawManhours && aF.rawManhours !== mh ? ' · events ke baad' : '');
    stats += '<div class="stat"><div class="k">Manpower</div><div class="v">' + mp + '<small> · ' + mh + ' hrs' + esc(mhNote) + '</small></div></div>';
    if (type) stats += '<div class="stat"><div class="k">Pcs / man-hr</div><div class="v">' + (mh ? (out / mh).toFixed(1) : '—') + '</div></div>';
    if (cat === 'STITCH') stats += '<div class="stat"><div class="k">Endline pass</div><div class="v">' + (eChk ? Math.round(ePass / eChk * 100) + '<small>%</small>' : '—') + '</div></div>';
    if (type === 'PACKING') stats += '<div class="stat"><div class="k">Cartons</div><div class="v">' + sum(flat(sl), 'cartons') + '</div></div>';
    stats += '<div class="stat"><div class="k">Status</div><div class="v" style="font-size:14px;margin-top:6px">' + (stKeys.length ? stKeys.map(function (k) { return S.pill(statuses[k].status); }).filter(function (v, i, a) { return a.indexOf(v) === i; }).join('') : '<span class="muted">Draft</span>') + '</div></div>';
    stats += '</div>';
    $('#data-summary').innerHTML = stats;

    var segs = [];
    if (type) segs.push({ k: 'out', l: type === 'PACKING' ? 'Packing' : 'Output' });
    segs.push({ k: 'att', l: 'Attendance' });
    if (cat === 'STITCH') segs.push({ k: 'end', l: 'Endline' });
    segs.push({ k: 'ev', l: 'Manpower' });
    if (!segs.some(function (x) { return x.k === seg; })) seg = segs[0].k;
    $('#data-seg').innerHTML = segs.map(function (x) { return '<button data-seg="' + x.k + '" class="' + (x.k === seg ? 'on' : '') + '">' + x.l + '</button>'; }).join('');

    if (ed.on && ((seg === 'out' && ed.type === type) || (seg === 'end' && ed.type === 'ENDLINE'))) { renderEdit(d); return; }
    ed.on = false;
    var body = '';
    if (seg === 'out') {
      var keys = S.slots().filter(function (s) { return sl[s.key]; });
      body = '<div class="dt-head"><span>' + (type === 'PACKING' ? 'Packing' : 'Stitching output') + ' · ' + esc(S.fmtDay(state.date)) + '</span>' + editBtn(type) + '</div>';
      if (!keys.length) body += '<div class="empty">Is din koi output entry nahi<br><button class="btn primary" data-edit="' + type + '" style="margin-top:10px">Bharo</button></div>';
      else {
        body += '<table class="tbl"><thead><tr><th>Slot</th><th>SRN</th><th class="num">' + (type === 'PACKING' ? 'Pcs' : 'Output') + '</th>' + (type === 'PACKING' ? '<th class="num">Ctn</th>' : '') + '</tr></thead><tbody>';
        keys.forEach(function (s) {
          sl[s.key].forEach(function (r, i) {
            body += '<tr data-tap="slot:' + type + ':' + esc(s.key) + '" class="filled"><td>' + (i === 0 ? esc(s.label) : '') + '</td><td>' + esc(r.srn) + '</td><td class="num">' + r.qty + '</td>' + (type === 'PACKING' ? '<td class="num">' + r.cartons + '</td>' : '') + '</tr>';
          });
        });
        body += '</tbody><tfoot><tr><td>Total</td><td>' + keys.length + ' slot</td><td class="num">' + out + '</td>' + (type === 'PACKING' ? '<td class="num">' + sum(flat(sl), 'cartons') + '</td>' : '') + '</tr></tfoot></table><p class="hint">Row tap = us ghante ki entry · ✎ Edit = poore din ka data ek saath</p>';
      }
    } else if (seg === 'att') {
      body = '';
      ['Final', 'OT', 'Night'].forEach(function (sh) {
        var a = d.att[sh]; if (!a && sh !== 'Final') return;
        body += '<h2>' + (sh === 'Final' ? 'Day' : sh) + (a ? ' · ' + a.manpower + ' mp · ' + a.manhours + ' hrs' : '') + '</h2>';
        if (!a) { body += '<div class="empty">Attendance nahi bhari<br><button class="btn primary" data-go="att:Final" style="margin-top:10px">Bharo</button></div>'; return; }
        body += '<table class="tbl" data-tap="att:' + sh + '"><thead><tr><th>Role</th><th class="num">Hrs</th><th class="num">Count</th></tr></thead><tbody>' +
          a.rows.map(function (r) { return '<tr data-tap="att:' + sh + '"><td>' + esc(r.role) + '</td><td class="num">' + r.hours + '</td><td class="num">' + r.count + '</td></tr>'; }).join('') + '</tbody></table>';
      });
      if (!d.att.OT) body += '<button class="lnk" data-go="att:OT" style="margin-top:10px">+ OT attendance</button>';
    } else if (seg === 'end') {
      var ek = S.slots().filter(function (s) { return el[s.key]; });
      body = '<div class="dt-head"><span>Endline · ' + esc(S.fmtDay(state.date)) + '</span>' + editBtn('ENDLINE') + '</div>';
      if (!ek.length) body += '<div class="empty">Is din koi endline entry nahi<br><button class="btn primary" data-edit="ENDLINE" style="margin-top:10px">Bharo</button></div>';
      else {
        body += '<table class="tbl"><thead><tr><th>Slot</th><th>Checker</th><th class="num">Chk</th><th class="num">Pass</th><th class="num">Rej</th></tr></thead><tbody>';
        ek.forEach(function (s) { el[s.key].forEach(function (r, i) { body += '<tr data-tap="slot:ENDLINE:' + esc(s.key) + '" class="filled"><td>' + (i === 0 ? esc(s.label) : '') + '</td><td>' + esc(r.checker) + '<div class="muted" style="font-size:11px">' + esc(r.srn) + '</div></td><td class="num">' + r.checked + '</td><td class="num">' + r.pass + '</td><td class="num">' + r.reject + '</td></tr>'; }); });
        body += '</tbody><tfoot><tr><td colspan="2">Total</td><td class="num">' + eChk + '</td><td class="num">' + ePass + '</td><td class="num">' + sum(flat(el), 'reject') + '</td></tr></tfoot></table><p class="hint">Row tap = us ghante ki entry · ✎ Edit = poore din ka data ek saath</p>';
      }
    } else if (seg === 'ev') {
      var evs = d.events || [], defs = state.masters.mpEvents || [];
      body = evs.length ? '<div class="list">' + evs.map(function (e) { var lab = (defs.filter(function (x) { return x.key === e.event; })[0] || {}).label || e.event; return '<div class="item" data-go="manpower"><div><div class="name">' + esc(e.role) + ' × ' + e.count + '</div><div class="sub">' + esc(lab) + (e.time ? ' @ ' + esc(e.time) : '') + ' → ' + e.eff_hours + ' hrs' + (e.note ? ' · ' + esc(e.note) : '') + '</div></div></div>'; }).join('') + '</div>'
        : '<div class="empty">Aaj koi manpower change nahi<br><button class="btn primary" data-go="manpower" style="margin-top:10px">Add karo</button></div>';
    }
    $('#data-body').innerHTML = body;
  }

  // ---------- edit mode: every slot of the day for one type ----------
  function startEdit(type) {
    if (S.lockedType(type)) { toast('Ye din ' + S.today().statuses[type].status + ' hai — edit band', 'bad'); return; }
    ed.on = true; ed.type = type; ed.srns = []; ed.ot = false;
    seg = type === 'ENDLINE' ? 'end' : 'out';
    $('#data-body').innerHTML = '<div class="empty">SRN list…</div>';
    if (type === 'ENDLINE' && S.ensureStaff) S.ensureStaff();
    Promise.all([api('orders.active', { factory: state.factory, dept: state.line, type: type }, { quiet: true }), S.loadToday()])
      .then(function (res) { ed.srns = res[0].srns || []; render(res[1]); })
      .catch(function (e) { toast(e.message, 'bad'); ed.on = false; S.tabs.data(); });
  }
  function srnSel(cur) {
    var opts = ed.srns.slice();
    if (cur && !opts.some(function (o) { return o.srn === cur; })) opts.unshift({ srn: cur, balance: '' });
    var remembered = S.recall('srn_' + ed.type + '_' + state.line), def = cur || (opts.some(function (o) { return o.srn === remembered; }) ? remembered : (opts[0] ? opts[0].srn : ''));
    return '<select class="e-srn"><option value="">— SRN —</option>' + opts.map(function (o) { return '<option value="' + esc(o.srn) + '"' + (o.srn === def ? ' selected' : '') + '>' + esc(o.srn) + (o.balance !== '' && o.balance !== null && o.balance !== undefined ? ' · bal ' + o.balance : '') + '</option>'; }).join('') + '</select>';
  }
  function edRow(s, r, i) {
    r = r || {};
    var orig = r.srn ? esc(JSON.stringify({ srn: r.srn, qty: r.qty || 0, checked: r.checked || 0, pass: r.pass || 0, reject: r.reject || 0, cartons: r.cartons || 0, checker: r.checker || '' })) : '';
    var t = '<span class="t">' + (i ? '' : esc(s.label)) + '</span>';
    if (ed.type === 'ENDLINE') {
      return '<div class="ed-row end" data-slot="' + esc(s.key) + '" data-orig="' + orig + '">' + t + srnSel(r.srn) +
        '<input class="e-chk" type="number" inputmode="numeric" placeholder="chk" value="' + (r.checked || '') + '"><input class="e-pass" type="number" inputmode="numeric" placeholder="pass" value="' + (r.pass || '') + '"><input class="e-rej" type="number" inputmode="numeric" placeholder="rej" value="' + (r.reject || '') + '">' +
        '<input class="e-checker" type="text" list="staff-qc" placeholder="checker ka naam" value="' + esc(r.checker || S.recall('checker_' + state.line) || '') + '"></div>';
    }
    if (ed.type === 'PACKING') {
      return '<div class="ed-row pack" data-slot="' + esc(s.key) + '" data-orig="' + orig + '">' + t + srnSel(r.srn) +
        '<input class="e-qty" type="number" inputmode="numeric" placeholder="pcs" value="' + (r.qty || '') + '"><input class="e-ctn" type="number" inputmode="numeric" placeholder="ctn" value="' + (r.cartons || '') + '"></div>';
    }
    return '<div class="ed-row" data-slot="' + esc(s.key) + '" data-orig="' + orig + '">' + t + srnSel(r.srn) +
      '<input class="e-qty" type="number" inputmode="numeric" placeholder="qty" value="' + (r.qty || '') + '"></div>';
  }
  function renderEdit(d) {
    var sl = (d.slots || {})[ed.type] || {};
    var anyOT = S.slots('OT').concat(S.slots('Night')).some(function (s) { return sl[s.key]; });
    var list = S.slots('Final').concat(ed.ot || anyOT ? S.slots('OT') : []).concat(S.slots('Night').filter(function (s) { return sl[s.key]; }));
    var html = '<div class="dt-head"><span>✎ ' + esc(S.typeLabel(ed.type)) + ' · ' + esc(S.fmtDay(state.date)) + ' · ' + esc(S.shortLine(state.line)) + '</span><button class="lnk" data-cancel="1" style="margin:0">Cancel</button></div>' +
      '<p class="hint" style="margin:0 0 6px">' + (ed.type === 'ENDLINE' ? 'Chk / Pass / Rej aur checker ka naam. ' : 'Qty badlo ya nayi bharo. ') + 'Qty 0 / khali = entry hat jayegi. Loading se zyada stitching block hogi.</p>';
    if (!ed.srns.length) html += '<div class="banner">' + (ed.type === 'STITCH' ? 'Is line par koi loading nahi mili — loading sheet check karo.' : ed.type === 'ENDLINE' ? 'Is line par stitching output nahi hai — pehle stitching bharo.' : 'Koi SRN nahi.') + '</div>';
    html += '<div class="ed-list">';
    list.forEach(function (s) {
      var rows = sl[s.key] || [];
      if (!rows.length) html += edRow(s, null, 0);
      else rows.forEach(function (r, i) { html += edRow(s, r, i); });
    });
    html += '</div>';
    if (!ed.ot && !anyOT) html += '<button class="lnk" data-ot="1">+ OT slots (6–10 PM)</button>';
    html += '<button class="lnk" data-addsrn="1">+ kisi ghante me dusra SRN</button>';
    html += '<div class="ed-bar"><button class="btn ghost" data-cancel="1">Cancel</button><button class="btn primary" data-save="1">Save changes</button></div>';
    $('#data-body').innerHTML = html;
  }
  function rowVal(row) {
    var v = { srn: ($('.e-srn', row) || {}).value || '', qty: 0, checked: 0, pass: 0, reject: 0, cartons: 0, checker: '' };
    if (ed.type === 'ENDLINE') { v.checked = num($('.e-chk', row).value); v.pass = num($('.e-pass', row).value); v.reject = num($('.e-rej', row).value); v.checker = ($('.e-checker', row).value || '').trim(); }
    else { v.qty = num($('.e-qty', row).value); if (ed.type === 'PACKING') v.cartons = num($('.e-ctn', row).value); }
    return v;
  }
  function amt(v) { return ed.type === 'ENDLINE' ? v.checked : v.qty; }
  function collectEdit() {
    var items = [], errs = [];
    $$('#data-body .ed-row').forEach(function (row) {
      var slot = row.dataset.slot, v = rowVal(row), o = row.dataset.orig ? JSON.parse(row.dataset.orig) : null;
      row.classList.remove('bad');
      var same = o && o.srn === v.srn && ['qty', 'checked', 'pass', 'reject', 'cartons', 'checker'].every(function (f) { return (o[f] || 0) === (v[f] || 0) || (o[f] === '' && v[f] === ''); });
      if (same || (!o && !amt(v))) return;
      var lf = S.M('LINE_FLOOR').filter(function (x) { return x.key === state.line; })[0], floor = lf ? lf.value : '';
      var base = function (srn) { return { slot: slot, type: ed.type, srn: srn, floor: floor }; };
      if (o && (o.srn !== v.srn || !amt(v))) items.push(Object.assign(base(o.srn), { qty: 0, checked: 0, pass: 0, reject: 0, checker: ed.type === 'ENDLINE' ? o.checker : 'x' }));   // delete the old row
      if (amt(v) > 0) {
        if (!v.srn) { errs.push((S.slotDef(slot) || {}).label + ': SRN chuno'); row.classList.add('bad'); return; }
        if (ed.type === 'ENDLINE') {
          if (!v.checker) { errs.push((S.slotDef(slot) || {}).label + ': checker ka naam'); row.classList.add('bad'); return; }
          if (v.pass + v.reject > v.checked) { errs.push((S.slotDef(slot) || {}).label + ': pass + reject > checked'); row.classList.add('bad'); return; }
          items.push(Object.assign(base(v.srn), { checked: v.checked, pass: v.pass, reject: v.reject, checker: v.checker }));
        } else items.push(Object.assign(base(v.srn), { qty: v.qty, cartons: v.cartons }));
      }
    });
    return { items: items, errs: errs };
  }
  function saveEdit() {
    var c = collectEdit();
    if (c.errs.length) { toast(c.errs[0], 'bad'); return; }
    if (!c.items.length) { toast('Kuch badla nahi', ''); return; }
    var btn = $('#data-body [data-save]'); if (btn) { btn.disabled = true; btn.textContent = 'Saving…'; }
    api('line.save', { date: state.date, factory: state.factory, dept: state.line, items: c.items })
      .then(function (d) {
        S.invalidateOrders && S.invalidateOrders(); S.invalidateAll(); S.clearLocalCaches();
        var fails = d.results.filter(function (r) { return !r.ok; }), warns = d.results.filter(function (r) { return r.ok && r.warn; });
        if (fails.length) {
          fails.forEach(function (f) { $$('#data-body .ed-row[data-slot="' + f.slot + '"]').forEach(function (row) { if (($('.e-srn', row) || {}).value === f.srn) { row.classList.add('bad'); var m = $('.msg', row); if (m) m.remove(); row.insertAdjacentHTML('beforeend', '<span class="msg">' + esc(f.message) + '</span>'); } }); });
          toast((S.slotDef(fails[0].slot) || {}).label + ': ' + fails[0].message + (d.saved ? ' · baaki ' + d.saved + ' saved' : ''), 'bad', 9000);
          if (btn) { btn.disabled = false; btn.textContent = 'Save changes'; }
          return;
        }
        toast(d.saved ? 'Saved · ' + d.saved + ' entry' : 'Kuch badla nahi', 'ok');
        if (warns.length) setTimeout(function () { toast('⚠ ' + warns[0].warn, '', 7000); }, 1500);
        ed.on = false; S.tabs.data();
      })
      .catch(function (e) { toast(e.message, 'bad', 6000); if (btn) { btn.disabled = false; btn.textContent = 'Save changes'; } });
  }

  $('#data-seg').addEventListener('click', function (e) { var b = e.target.closest('button[data-seg]'); if (!b) return; if (ed.on && b.dataset.seg !== seg) ed.on = false; seg = b.dataset.seg; S.tabs.data(); });
  $('#data-body').addEventListener('click', function (e) {
    var b = e.target.closest('button');
    if (b) {
      if (b.dataset.edit) { startEdit(b.dataset.edit); return; }
      if (b.dataset.cancel) { ed.on = false; S.tabs.data(); return; }
      if (b.dataset.save) { saveEdit(); return; }
      if (b.dataset.ot) { ed.ot = true; S.loadToday().then(render); return; }
      if (b.dataset.addsrn) {
        var slots = S.slots('Final').concat(ed.ot ? S.slots('OT') : []);
        S.sheet.open('Kis ghante me dusra SRN?', '<div class="chips" style="flex-wrap:wrap">' + slots.map(function (s) { return '<button data-slot="' + esc(s.key) + '">' + esc(s.label) + '</button>'; }).join('') + '</div>');
        $('#sheet-content').onclick = function (ev) {
          var x = ev.target.closest('button[data-slot]'); if (!x) return;
          var rows = $$('#data-body .ed-row[data-slot="' + x.dataset.slot + '"]'), last = rows[rows.length - 1];
          last.insertAdjacentHTML('afterend', edRow(S.slotDef(x.dataset.slot), { srn: '' }, 1));
          S.sheet.close();
        };
        return;
      }
    }
    if (ed.on) return;
    var g = e.target.closest('[data-go]'); if (g) { S.go(g.dataset.go); return; }
    var t = e.target.closest('[data-tap]'); if (t) S.go(t.dataset.tap);
  });
  $('#data-body').addEventListener('input', function (e) {
    var row = e.target.closest('.ed-row'); if (!row) return;
    row.classList.remove('bad'); var m = $('.msg', row); if (m) m.remove();
    if (ed.type === 'ENDLINE') { var c = $('.e-chk', row), r = $('.e-rej', row), p = $('.e-pass', row); if (e.target === p) p.dataset.touched = '1'; else if (!p.dataset.touched) p.value = Math.max(0, num(c.value) - num(r.value)); }
    if (e.target.classList.contains('e-checker') && e.target.value.trim()) S.remember('checker_' + state.line, e.target.value.trim());
  });
  $('#data-body').addEventListener('keydown', function (e) {
    if (e.key !== 'Enter' || e.target.tagName !== 'INPUT' || !ed.on) return;
    e.preventDefault();
    var inputs = $$('#data-body .ed-row input'), i = inputs.indexOf(e.target); if (inputs[i + 1]) inputs[i + 1].focus();
  });
})();
