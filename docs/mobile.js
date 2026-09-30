// mobile.js — phone "Output" tab. Tap a line -> type how many pieces were made today; SRN, manpower and hours come by
// themselves. Loading is checked while typing (more than the loading is allowed, with an alert). Save = the day's output
// goes to the admin for review (day.submit); only after the admin approves does it reach the main sheet.
// Stored in the Day's last slot (5–6 PM) so Day Close / reports / PMS / Send to Final work unchanged.
(function () {
  'use strict';
  var S = window.SG, $ = S.$, esc = S.esc, api = S.api, state = S.state, toast = S.toast, icon = S.icon;
  var DAY_SLOT = '17-18';
  var O = { lines: [], noAtt: [], saving: false };
  function num(v) { var n = Number(v); return isNaN(n) ? 0 : n; }
  function pad(n) { return String(n).padStart(2, '0'); }

  S.tabs.mout = function () {
    $('#mout-body').innerHTML = '<div class="empty">Lines aa rahi hain…</div>';
    Promise.all([api('hour.get', { date: state.date, factory: state.factory, slot: DAY_SLOT }, { quiet: true }), S.loadFactory()])
      .then(function (res) {
        var h = res[0], f = res[1];
        var att = h.depts.filter(function (d) { return d.cat === 'STITCH'; });
        var attSet = {}; att.forEach(function (d) { attSet[d.dept] = 1; });
        O.noAtt = f.depts.filter(function (x) { return x.cat === 'STITCH' && !attSet[x.dept]; }).map(function (x) { return x.dept; });
        return Promise.all(att.map(function (d) { return api('line.today', { date: state.date, factory: state.factory, dept: d.dept }, { quiet: true }).then(function (lt) { return { d: d, lt: lt }; }); }));
      })
      .then(function (list) { O.lines = list.map(build); render(); })
      .catch(function (e) { $('#mout-body').innerHTML = '<div class="empty">' + esc(e.message) + '<br><button class="btn primary" data-reload="1" style="margin-top:10px">Dobara try</button></div>'; });
  };

  // one line -> entries [{srn, total (day), other (all slots except 5–6 PM)}]
  function build(x) {
    var d = x.d, st = (x.lt.slots || {}).STITCH || {}, by = {};
    Object.keys(st).forEach(function (sk) {
      st[sk].forEach(function (r) {
        var e = by[r.srn] = by[r.srn] || { srn: r.srn, total: 0, other: 0, fixed: true };
        e.total += num(r.qty); if (sk !== DAY_SLOT) e.other += num(r.qty);
      });
    });
    var entries = Object.keys(by).map(function (k) { return by[k]; });
    var fin = (x.lt.att || {}).Final || {}, hours = 0;
    (fin.rows || []).forEach(function (r) { if (r.count > 0 && r.hours > hours) hours = r.hours; });
    var status = (x.lt.statuses || {}).STITCH ? x.lt.statuses.STITCH.status : '';
    return { d: d, entries: entries, locked: d.locked.STITCH || '', status: status, hours: hours || 8, events: x.lt.events || [], defSrn: d.attSrn || d.lastSrn.STITCH || ((d.srns.STITCH || [])[0] || {}).srn || '' };
  }
  function lineTotal(L) { var t = 0; L.entries.forEach(function (e) { t += e.total; }); return t; }
  function srnOpt(L, srn) { return (L.d.srns.STITCH || []).filter(function (x) { return x.srn === srn; })[0] || null; }

  function render() {
    var total = 0, filled = 0;
    var html = '<p class="hint" style="margin:0 0 8px">Line par tap karo aur <b>aaj kitne pcs bane</b> wo likho. Baaki sab apne aap.</p>';
    if (!O.lines.length && !O.noAtt.length) html += '<div class="empty">Koi line nahi mili</div>';
    O.lines.forEach(function (L, li) {
      var t = lineTotal(L); total += t; if (t) filled++;
      var srns = L.entries.length ? L.entries.map(function (e) { return esc(e.srn) + (L.entries.length > 1 ? ' · ' + e.total : ''); }).join(' + ') : esc(L.defSrn || 'SRN');
      var st = L.locked || L.status;
      html += '<button type="button" class="mo-card' + (t ? ' done' : '') + (L.locked ? ' lock' : '') + '" data-open="' + li + '">' +
        '<span class="b"><span class="nm">' + esc(S.shortLine(L.d.dept)) + '</span><span class="s">' + srns + ' · ' + L.d.mp + ' log' + (L.d.mp !== L.d.mpBase ? ' (subah ' + L.d.mpBase + ')' : '') + '</span>' +
        (st ? '<span class="st">' + (st === 'Submitted' ? 'Admin review me' : st === 'Approved' ? 'Approve ho gaya' : st === 'Sent' ? 'Main sheet me chala gaya' : st === 'Rejected' ? 'Admin ne wapas kiya — dobara bharo' : esc(st)) + '</span>' : '') + '</span>' +
        '<span class="v">' + (t ? t + '<small>pcs</small>' : '<small>bharo ›</small>') + '</span></button>';
    });
    O.noAtt.forEach(function (dept) {
      html += '<div class="mo-card dim"><span class="b"><span class="nm">' + esc(S.shortLine(dept)) + '</span><span class="s">Attendance nahi bhari</span></span><button type="button" class="btn small ghost" data-att="1">Attendance</button></div>';
    });
    if (O.lines.length) {
      html += '<div class="mo-total"><span>Aaj ka total</span><b>' + total + ' pcs</b><small>' + filled + ' / ' + O.lines.length + ' line</small></div>';
      if (total) html += '<div class="sticky-bottom"><button class="btn big wa" data-wa="1" style="display:flex;align-items:center;justify-content:center;gap:8px">' + icon('wa') + ' Output group me bhejo</button></div>';
    }
    $('#mout-body').innerHTML = html;
  }

  // ---- one line: SRN (dropdown of this line's loading), auto manpower/hours, qty, live loading check
  function openLine(li, srnForNew) {
    var L = O.lines[li]; if (!L) return;
    if (L.locked) { toast(L.locked === 'Submitted' ? 'Admin review me hai — badalna ho to admin se wapas karwao' : L.locked + ' — ab badal nahi sakte', '', 6000); return; }
    var opts = L.d.srns.STITCH || [];
    var cur = srnForNew !== undefined ? { srn: srnForNew, total: 0, other: 0, fixed: false } : (L.entries[0] || { srn: L.defSrn, total: 0, other: 0, fixed: false });
    var mpNote = L.events.length ? L.events.map(function (e) { return e.count + ' ' + e.role + ' ' + evLabel(e.event) + (e.time ? ' ' + e.time : ''); }).join(', ') : '';
    var html = '<div class="mo-info"><div><span>Log</span><b>' + L.d.mp + '</b>' + (L.d.mp !== L.d.mpBase ? '<small>subah ' + L.d.mpBase + '</small>' : '') + '</div><div><span>Ghante</span><b>' + L.hours + '</b></div><div><span>Aaj ab tak</span><b>' + lineTotal(L) + '</b></div></div>' +
      (mpNote ? '<div class="hint" style="margin:0 0 8px">Badlav: ' + esc(mpNote) + '</div>' : '') +
      '<label>SRN</label><select id="mo-srn"' + (cur.fixed ? ' disabled' : '') + '>' + (cur.srn && !srnOpt(L, cur.srn) ? '<option>' + esc(cur.srn) + '</option>' : '') + (opts.length ? '' : '<option value="">Is line par loading nahi mili</option>') +
        opts.map(function (o) { return '<option value="' + esc(o.srn) + '"' + (o.srn === cur.srn ? ' selected' : '') + '>' + esc(o.srn) + ' · ' + o.balance + ' baaki</option>'; }).join('') + '</select>' +
      '<div id="mo-load" class="mo-load"></div>' +
      '<label>Aaj kitne pcs bane (' + esc(cur.srn || 'is SRN') + ')</label><input id="mo-qty" class="mo-big" type="number" inputmode="numeric" min="0" placeholder="0" value="' + (cur.total || '') + '">' +
      (cur.other ? '<div class="hint">Ghante-wise pehle se ' + cur.other + ' bhara hai (computer se) — kul isse kam nahi ho sakta</div>' : '') +
      '<div id="mo-chk" class="mo-chk"></div>' +
      '<button class="btn primary big" id="mo-save">Save · admin ko bhejo</button>' +
      (L.entries.length && srnForNew === undefined ? '<button class="lnk" id="mo-add" style="display:block;margin:10px auto 0">+ is line par dusra SRN bhi chala</button>' : '');
    S.sheet.open(S.shortLine(L.d.dept) + ' · aaj ka output', html);
    var box = $('#sheet-content');
    function srnNow() { return cur.fixed ? cur.srn : ($('#mo-srn') || {}).value || ''; }
    function check() {
      var srn = srnNow(), o = srnOpt(L, srn), q = num($('#mo-qty').value), delta = q - cur.total, info = $('#mo-load'), chk = $('#mo-chk');
      if (!o) { info.innerHTML = srn ? 'Is SRN ki loading is line par nahi mili' : ''; chk.innerHTML = q && srn ? '<div class="warn">⚠ Loading nahi mili — save hoga, admin ko alert jayega</div>' : ''; return { over: q > 0 ? q : 0 }; }
      info.innerHTML = 'Loading <b>' + o.limit + '</b> · ban chuka <b>' + o.used + '</b> · aur ho sakta <b>' + Math.max(0, o.balance + cur.total) + '</b>';
      var over = delta - o.balance;
      chk.innerHTML = !q ? '' : over > 0 ? '<div class="warn">⚠ Loading se <b>' + over + '</b> zyada hai. Save kar sakte ho, admin ko alert jayega.</div>' : '<div class="okk">✓ Loading ke andar</div>';
      return { over: over > 0 ? over : 0 };
    }
    box.oninput = check; box.onchange = function (e) { if (e.target.id === 'mo-srn') check(); };
    check();
    setTimeout(function () { var q = $('#mo-qty'); if (q) q.focus(); }, 150);
    box.onclick = function (e) {
      if (e.target.closest('#mo-add')) { S.sheet.close(); setTimeout(function () { openLine(li, ''); }, 50); return; }
      if (!e.target.closest('#mo-save')) return;
      var srn = srnNow(), v = String($('#mo-qty').value).trim(), q = num(v);
      if (v !== '' && !/^\d+$/.test(v)) { toast('Sirf poora number (pcs)', 'bad'); return; }
      if (q > 0 && !srn) { toast('SRN chuno', 'bad'); return; }
      if (q < cur.other) { toast('Computer se ghante-wise ' + cur.other + ' bhara hai — kul ' + cur.other + ' se kam nahi', 'bad', 6000); return; }
      if (q === cur.total && cur.fixed) { toast('Kuch badla nahi', ''); S.sheet.close(); return; }
      var c = check(), go = function () { saveLine(L, { srn: srn, qty: q, other: cur.other, allowOver: c.over > 0 }); };
      if (c.over > 0) S.ask('Loading se ' + c.over + ' pcs zyada hai. Phir bhi save karein? Admin ko alert jayega.', { ok: 'Haan, save karo', cancel: 'Theek karta hoon' }).then(function (ok) { if (ok) go(); });
      else go();
    };
  }
  function evLabel(k) { return { HALF_DAY: 'half day', LEFT_AT: 'beech me gaya', LATE_JOIN: 'late aaya', ABSENT: 'absent', EXTRA: 'extra aaya', TRANSFER_OUT: 'transfer gaya', TRANSFER_IN: 'transfer se aaya', LINE_CLOSED: 'line band' }[k] || k; }

  function saveLine(L, x) {
    if (O.saving) return; O.saving = true; S.busy(true);
    api('hour.save', { date: state.date, factory: state.factory, slot: DAY_SLOT, items: [{ type: 'STITCH', dept: L.d.dept, srn: x.srn, qty: x.qty - x.other, floor: L.d.floor, allowOver: x.allowOver }] })
      .then(function (d) {
        var f = d.results.filter(function (r) { return !r.ok; })[0];
        if (f) throw new Error(f.message);
        // straight to the admin's review (attendance + output of this line)
        return api('day.submit', { date: state.date, factory: state.factory, dept: L.d.dept });
      })
      .then(function (s) {
        O.saving = false; S.busy(false); S.sheet.close(); S.invalidateAll(); S.clearLocalCaches();
        toast('Saved · ' + S.shortLine(L.d.dept) + ' admin ke review me gaya ✓' + (s.blocks && s.blocks.length ? ' (alert ke saath)' : ''), 'ok', 5000);
        S.tabs.mout();
      })
      .catch(function (e) { O.saving = false; S.busy(false); toast(e.message, 'bad', 7000); });
  }

  // ---- WhatsApp text for the day's output (same plain style as the attendance message)
  function waOutputText() {
    var p = state.date.split('-'), mon = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][+p[1] - 1];
    var out = ['Date:- ' + pad(+p[2]) + ' ' + mon + ' ' + p[0] + ' - FAC' + state.factory, 'Stitching Output', ''], grand = 0;
    O.lines.forEach(function (L) {
      var t = lineTotal(L); if (!t) return; grand += t;
      out.push(S.shortLine(L.d.dept) + ' - ' + L.entries.filter(function (e) { return e.total; }).map(function (e) { return e.srn; }).join(', '));
      out.push('Manpower ' + L.d.mp + (L.d.mp !== L.d.mpBase ? ' (subah ' + L.d.mpBase + ')' : ''));
      if (L.entries.length > 1) L.entries.forEach(function (e) { if (e.total) out.push(e.srn + ' - ' + e.total + ' pcs'); });
      out.push('Output ' + t + ' pcs');
      out.push('');
    });
    out.push('Total output ' + grand + ' pcs'); out.push('');
    out.push('- ' + (state.user.name || ''));
    return out.join('\n');
  }
  function shareOutput() {
    var text = waOutputText();
    S.sheet.open('Output group me bhejo', '<pre class="wa-prev">' + esc(text) + '</pre>' +
      '<a class="btn big wa" id="wa-open" href="https://wa.me/?text=' + encodeURIComponent(text) + '" target="_blank" rel="noopener" style="display:flex;align-items:center;justify-content:center;gap:8px;text-decoration:none">' + icon('wa') + ' WhatsApp me bhejo</a>' +
      '<button class="btn ghost big" id="wa-copy">Copy text</button>');
    $('#sheet-content').onclick = function (e) {
      if (e.target.closest('#wa-copy')) { try { navigator.clipboard.writeText(text); toast('Copy ho gaya', 'ok'); } catch (er) { toast('Copy nahi hua', 'bad'); } }
      if (e.target.closest('#wa-open')) setTimeout(S.sheet.close, 300);
    };
  }

  $('#mout-body').addEventListener('click', function (ev) {
    var b = ev.target.closest('button'); if (!b) return;
    if (b.dataset.open !== undefined) { openLine(+b.dataset.open); return; }
    if (b.dataset.wa) { shareOutput(); return; }
    if (b.dataset.att) { S.tab('matt'); return; }
    if (b.dataset.reload) { S.tabs.mout(); return; }
  });
})();
