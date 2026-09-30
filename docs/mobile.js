// mobile.js — phone "Output" tab. Only lines that worked (attendance filled) are shown, Day and OT separately.
// Tap -> type how many pieces were made; SRN, manpower and hours come by themselves. Loading is checked while typing
// (more than the loading is allowed, with an alert). Save = goes to the admin for review (day.submit); only after the
// admin approves does it reach the main sheet. Earlier days still missing output are listed on top until filled
// (a line/day typed straight into the main sheet drops off the list, so nothing is entered twice).
// Stored in the shift's last slot (Day 5–6 PM, OT 9–10 PM) so Day Close / reports / PMS / Send to Final work unchanged.
(function () {
  'use strict';
  var S = window.SG, $ = S.$, esc = S.esc, api = S.api, state = S.state, toast = S.toast, icon = S.icon;
  var O = { lines: [], pending: [], saving: false, date: '' };
  function num(v) { var n = Number(v); return isNaN(n) ? 0 : n; }
  function pad(n) { return String(n).padStart(2, '0'); }
  function shLabel(sh) { return sh === 'OT' ? 'OT' : 'Day'; }

  S.tabs.mout = function () {
    if (O.date !== state.date) { O.lines = []; O.date = state.date; }
    if (!O.lines.length) $('#mout-body').innerHTML = '<div class="empty">Lines aa rahi hain…</div>';
    api('m.out', { date: state.date, factory: state.factory }, { quiet: true })
      .then(function (r) { O.pending = r.pending || []; O.lines = r.lines.map(build); render(); })
      .catch(function (e) { $('#mout-body').innerHTML = '<div class="empty">' + esc(e.message) + '<br><button class="btn primary" data-reload="1" style="margin-top:10px">Dobara try</button></div>'; });
  };

  function build(x) {
    var d = { dept: x.dept, floor: x.floor, srns: { STITCH: x.srns || [] } };
    var shifts = (x.shifts || []).map(function (s) {
      return { shift: s.shift, slot: s.slot, mp: s.mp, mpBase: s.mpBase, hours: s.hours || (s.shift === 'OT' ? 2 : 8),
               defSrn: s.attSrn || ((x.srns || [])[0] || {}).srn || '',
               entries: (s.entries || []).map(function (e) { return { srn: e.srn, total: num(e.total), other: num(e.other), fixed: true }; }) };
    });
    return { d: d, shifts: shifts, locked: x.locked || '', status: x.status || '', events: x.events || [] };
  }
  function shTotal(sh) { var t = 0; sh.entries.forEach(function (e) { t += e.total; }); return t; }
  function srnOpt(L, srn) { return (L.d.srns.STITCH || []).filter(function (x) { return x.srn === srn; })[0] || null; }
  function statusText(st) { return st === 'Submitted' ? 'Admin review me' : st === 'Approved' ? 'Approve ho gaya' : st === 'Sent' ? 'Main sheet me chala gaya' : st === 'Rejected' ? 'Admin ne wapas kiya — dobara bharo' : st; }

  function render() {
    var total = 0, filled = 0, rows = 0, today = S.todayStr(), past = state.date !== today;
    var html = '';
    if (past) html += '<div class="mo-past"><div><b>' + esc(S.fmtDay(state.date)) + '</b> · purana din</div><button class="btn small" data-day="' + today + '">Aaj par wapas</button></div>';
    if (O.pending.length) {
      html += '<div class="mo-pend"><div class="t">Pichhle din ka output baaki</div>' + O.pending.map(function (p) {
        var ot = p.lines.filter(function (l) { return l.shift === 'OT'; }).length, day = p.lines.length - ot;
        return '<button type="button" data-day="' + esc(p.date) + '"><span>' + esc(S.fmtDay(p.date)) + '</span><small>' + (day ? day + ' line' : '') + (day && ot ? ' + ' : '') + (ot ? ot + ' OT' : '') + '</small><b>Bharo ›</b></button>';
      }).join('') + '</div>';
    }
    html += '<p class="hint" style="margin:0 0 8px">Line par tap karo aur <b>' + (past ? 'us din' : 'aaj') + ' kitne pcs bane</b> wo likho. Baaki sab apne aap.</p>';
    if (!O.lines.length) html += '<div class="empty">' + (past ? 'Is din kisi line ki attendance nahi' : 'Aaj abhi kisi line ki attendance nahi bhari — pehle Attendance') + '</div>';
    O.lines.forEach(function (L, li) {
      L.shifts.forEach(function (sh, si) {
        var t = shTotal(sh); rows++; total += t; if (t) filled++;
        var srns = sh.entries.length ? sh.entries.map(function (e) { return esc(e.srn) + (sh.entries.length > 1 ? ' · ' + e.total : ''); }).join(' + ') : esc(sh.defSrn || 'SRN');
        var st = L.locked || L.status;
        html += '<button type="button" class="mo-card' + (t ? ' done' : '') + (L.locked ? ' lock' : '') + '" data-open="' + li + '|' + si + '">' +
          '<span class="b"><span class="nm">' + esc(S.shortLine(L.d.dept)) + (sh.shift === 'OT' ? ' <em class="ot">OT</em>' : '') + '</span><span class="s">' + srns + ' · ' + sh.mp + ' log' + (sh.mp !== sh.mpBase ? ' (subah ' + sh.mpBase + ')' : '') + ' · ' + sh.hours + ' ghante</span>' +
          (st ? '<span class="st">' + esc(statusText(st)) + '</span>' : '') + '</span>' +
          '<span class="v">' + (t ? t + '<small>pcs</small>' : '<small>bharo ›</small>') + '</span></button>';
      });
    });
    if (past && O.lines.length) html += '<p class="hint">OT hua tha par OT attendance nahi bhari? <button class="lnk" data-tab="matt">Attendance me "+ OT" bharo</button></p>';
    if (rows) {
      html += '<div class="mo-total"><span>' + (past ? 'Us din ka total' : 'Aaj ka total') + '</span><b>' + total + ' pcs</b><small>' + filled + ' / ' + rows + '</small></div>';
      if (total) html += '<div class="sticky-bottom"><button class="btn big wa" data-wa="1" style="display:flex;align-items:center;justify-content:center;gap:8px">' + icon('wa') + ' Output group me bhejo</button></div>';
    }
    $('#mout-body').innerHTML = html;
  }

  // ---- one line + shift: SRN (dropdown of this line's loading), auto manpower/hours, qty, live loading check
  function openLine(li, si, srnForNew) {
    var L = O.lines[li], sh = L && L.shifts[si]; if (!sh) return;
    if (L.locked) { toast(L.locked === 'Submitted' ? 'Admin review me hai — badalna ho to admin se wapas karwao' : statusText(L.locked) + ' — ab badal nahi sakte', '', 6000); return; }
    var opts = L.d.srns.STITCH || [];
    var cur = srnForNew !== undefined ? { srn: srnForNew, total: 0, other: 0, fixed: false } : (sh.entries[0] || { srn: sh.defSrn, total: 0, other: 0, fixed: false });
    var mpNote = sh.shift === 'Final' && L.events.length ? L.events.map(function (e) { return e.event === 'LINE_CLOSED' ? 'line band ' + e.time : e.count + ' ' + e.role + ' ' + evLabel(e.event) + (e.time ? ' ' + e.time : ''); }).join(', ') : '';
    var html = '<div class="mo-info"><div><span>Log</span><b>' + sh.mp + '</b>' + (sh.mp !== sh.mpBase ? '<small>subah ' + sh.mpBase + '</small>' : '') + '</div><div><span>Ghante</span><b>' + sh.hours + '</b></div><div><span>Ab tak</span><b>' + shTotal(sh) + '</b></div></div>' +
      (mpNote ? '<div class="hint" style="margin:0 0 8px">Badlav: ' + esc(mpNote) + '</div>' : '') +
      '<label>SRN</label><select id="mo-srn"' + (cur.fixed ? ' disabled' : '') + '>' + (cur.srn && !srnOpt(L, cur.srn) ? '<option>' + esc(cur.srn) + '</option>' : '') + (opts.length ? '' : '<option value="">Is line par loading nahi mili</option>') +
        opts.map(function (o) { return '<option value="' + esc(o.srn) + '"' + (o.srn === cur.srn ? ' selected' : '') + '>' + esc(o.srn) + ' · ' + o.balance + ' baaki</option>'; }).join('') + '</select>' +
      '<div id="mo-load" class="mo-load"></div>' +
      '<label>' + (state.date === S.todayStr() ? 'Aaj' : S.fmtDay(state.date) + ' ko') + ' kitne pcs bane' + (sh.shift === 'OT' ? ' (OT me)' : '') + '</label><input id="mo-qty" class="mo-big" type="number" inputmode="numeric" min="0" placeholder="0" value="' + (cur.total || '') + '">' +
      (cur.other ? '<div class="hint">Ghante-wise pehle se ' + cur.other + ' bhara hai (computer se) — kul isse kam nahi ho sakta</div>' : '') +
      '<div id="mo-chk" class="mo-chk"></div>' +
      '<button class="btn primary big" id="mo-save">Save · admin ko bhejo</button>' +
      (sh.entries.length && srnForNew === undefined ? '<button class="lnk" id="mo-add" style="display:block;margin:10px auto 0">+ is line par dusra SRN bhi chala</button>' : '');
    S.sheet.open(S.shortLine(L.d.dept) + ' · ' + shLabel(sh.shift) + ' output', html);
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
      if (e.target.closest('#mo-add')) { S.sheet.close(); setTimeout(function () { openLine(li, si, ''); }, 50); return; }
      if (!e.target.closest('#mo-save')) return;
      var srn = srnNow(), v = String($('#mo-qty').value).trim(), q = num(v);
      if (v !== '' && !/^\d+$/.test(v)) { toast('Sirf poora number (pcs)', 'bad'); return; }
      if (q > 0 && !srn) { toast('SRN chuno', 'bad'); return; }
      if (q < cur.other) { toast('Computer se ghante-wise ' + cur.other + ' bhara hai — kul ' + cur.other + ' se kam nahi', 'bad', 6000); return; }
      if (q === cur.total && cur.fixed) { toast('Kuch badla nahi', ''); S.sheet.close(); return; }
      var c = check(), go = function () { saveLine(L, sh, { srn: srn, qty: q, other: cur.other, allowOver: c.over > 0 }); };
      if (c.over > 0) S.ask('Loading se ' + c.over + ' pcs zyada hai. Phir bhi save karein? Admin ko alert jayega.', { ok: 'Haan, save karo', cancel: 'Theek karta hoon' }).then(function (ok) { if (ok) go(); });
      else go();
    };
  }
  function evLabel(k) { return { HALF_DAY: 'half day', LEFT_AT: 'beech me gaya', LATE_JOIN: 'late aaya', ABSENT: 'absent', EXTRA: 'extra aaya', TRANSFER_OUT: 'transfer gaya', TRANSFER_IN: 'transfer se aaya', LINE_CLOSED: 'line band' }[k] || k; }

  function saveLine(L, sh, x) {
    if (O.saving) return; O.saving = true; S.busy(true);
    api('hour.save', { date: state.date, factory: state.factory, slot: sh.slot, items: [{ type: 'STITCH', dept: L.d.dept, srn: x.srn, qty: x.qty - x.other, floor: L.d.floor, allowOver: x.allowOver }] })
      .then(function (d) {
        var f = d.results.filter(function (r) { return !r.ok; })[0];
        if (f) throw new Error(f.message);
        // straight to the admin's review (attendance + output of this line for that day)
        return api('day.submit', { date: state.date, factory: state.factory, dept: L.d.dept });
      })
      .then(function (s) {
        O.saving = false; S.busy(false); S.sheet.close();
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
      L.shifts.forEach(function (sh) {
        var t = shTotal(sh); if (!t) return; grand += t;
        out.push(S.shortLine(L.d.dept) + (sh.shift === 'OT' ? ' (OT)' : '') + ' - ' + sh.entries.filter(function (e) { return e.total; }).map(function (e) { return e.srn; }).join(', '));
        out.push('Manpower ' + sh.mp + (sh.mp !== sh.mpBase ? ' (subah ' + sh.mpBase + ')' : ''));
        if (sh.entries.length > 1) sh.entries.forEach(function (e) { if (e.total) out.push(e.srn + ' - ' + e.total + ' pcs'); });
        out.push('Output ' + t + ' pcs');
        out.push('');
      });
    });
    out.push('Total output ' + grand + ' pcs'); out.push('');
    out.push('- ' + (state.user.name || ''));
    return out.join('\n');
  }
  S.shareText = function (title, text) {
    S.sheet.open(title, '<pre class="wa-prev">' + esc(text) + '</pre>' +
      '<a class="btn big wa" id="wa-open" href="https://wa.me/?text=' + encodeURIComponent(text) + '" target="_blank" rel="noopener" style="display:flex;align-items:center;justify-content:center;gap:8px;text-decoration:none">' + icon('wa') + ' WhatsApp me bhejo</a>' +
      '<button class="btn ghost big" id="wa-copy">Copy text</button>');
    $('#sheet-content').onclick = function (e) {
      if (e.target.closest('#wa-copy')) { try { navigator.clipboard.writeText(text); toast('Copy ho gaya', 'ok'); } catch (er) { toast('Copy nahi hua', 'bad'); } }
      if (e.target.closest('#wa-open')) setTimeout(S.sheet.close, 300);
    };
  };
  function shareOutput() { S.shareText('Output group me bhejo', waOutputText()); }

  $('#mout-body').addEventListener('click', function (ev) {
    var b = ev.target.closest('button'); if (!b) return;
    if (b.dataset.open) { var p = b.dataset.open.split('|'); openLine(+p[0], +p[1]); return; }
    if (b.dataset.day) { S.setDate(b.dataset.day); return; }
    if (b.dataset.tab) { S.tab(b.dataset.tab); return; }
    if (b.dataset.wa) { shareOutput(); return; }
    if (b.dataset.reload) { S.tabs.mout(); return; }
  });
})();
