// mobile.js — phone "Output" tab: only what is still to be filled. Every line / shift (from 29 Sep 2026) that has
// attendance — filled in the app or typed in the main sheet — but no stitching output yet, grouped by date. Once the
// output is saved (or found typed in the main sheet) the line drops off the list, so nothing is entered twice.
// Tap -> type the pieces; SRN, manpower and hours come by themselves; loading is checked while typing (more is allowed
// with an alert). Save = goes to the admin for review (day.submit); only after approval does it reach the main sheet.
// Stored in the shift's last slot (Day 5–6 PM, OT 9–10 PM) so Day Close / reports / PMS / Send to Final work unchanged.
(function () {
  'use strict';
  var S = window.SG, $ = S.$, esc = S.esc, api = S.api, state = S.state, toast = S.toast, icon = S.icon;
  var O = { groups: [], done: [], today: '', saving: false, loaded: false };
  function num(v) { var n = Number(v); return isNaN(n) ? 0 : n; }
  function pad(n) { return String(n).padStart(2, '0'); }
  function shLabel(sh) { return sh === 'OT' ? 'OT' : 'Day'; }
  function total(l) { var t = 0; (l.entries || []).forEach(function (e) { t += num(e.total); }); return t; }
  function srnOpt(l, srn) { return (l.srns || []).filter(function (x) { return x.srn === srn; })[0] || null; }
  function statusText(st) { return st === 'Submitted' ? 'Admin review me' : st === 'Approved' ? 'Approve ho gaya' : st === 'Sent' ? 'Main sheet me chala gaya' : st === 'Rejected' ? 'Admin ne wapas kiya — dobara bharo' : st; }

  S.tabs.mout = function () {
    if (!O.loaded) $('#mout-body').innerHTML = '<div class="empty">Baaki output dekh raha hoon…</div>';
    api('m.out', { factory: state.factory }, { quiet: true })
      .then(function (r) { O.loaded = true; O.groups = r.groups || []; O.done = r.done || []; O.today = r.today || S.todayStr(); render(); })
      .catch(function (e) { $('#mout-body').innerHTML = '<div class="empty">' + esc(e.message) + '<br><button class="btn primary" data-reload="1" style="margin-top:10px">Dobara try</button></div>'; });
  };

  function card(l, gi, li) {
    return '<button type="button" class="mo-card" data-open="' + gi + '|' + li + '">' +
      '<span class="b"><span class="nm">' + esc(S.shortLine(l.dept)) + (l.shift === 'OT' ? ' <em class="ot">OT</em>' : '') + (l.fromSheet ? ' <em class="ot">sheet att.</em>' : '') + '</span>' +
      '<span class="s">' + esc(l.attSrn || ((l.srns || [])[0] || {}).srn || 'SRN') + ' · ' + l.mp + ' log' + (l.mp !== l.mpBase ? ' (subah ' + l.mpBase + ')' : '') + ' · ' + l.hours + ' ghante</span>' +
      (l.status === 'Rejected' ? '<span class="st" style="color:var(--bad)">' + esc(statusText(l.status)) + '</span>' : '') + '</span>' +
      '<span class="v"><small>bharo ›</small></span></button>';
  }
  function render() {
    var html = '', n = 0;
    O.groups.forEach(function (g, gi) {
      html += '<h2 class="mo-date">' + (g.date === O.today ? 'Aaj · ' : '') + esc(S.fmtDay(g.date)) + ' <span>' + g.lines.length + ' baaki</span></h2>';
      g.lines.forEach(function (l, li) { n++; html += card(l, gi, li); });
    });
    if (!n) html += '<div class="empty">✓ Koi output baaki nahi<br><span class="muted" style="font-size:13px">Jis line ki attendance bhari hai, uska output yahan aayega</span></div>';
    if (O.done.length) {
      var t = 0; O.done.forEach(function (l) { t += total(l); });
      html += '<h2 class="mo-date">Aaj bhar diya <span>' + t + ' pcs</span></h2>' + O.done.map(function (l) {
        return '<div class="mo-card done lock"><span class="b"><span class="nm">' + esc(S.shortLine(l.dept)) + (l.shift === 'OT' ? ' <em class="ot">OT</em>' : '') + '</span><span class="s">' + l.entries.map(function (e) { return esc(e.srn); }).join(', ') + ' · ' + l.mp + ' log</span>' + (l.status ? '<span class="st">' + esc(statusText(l.status)) + '</span>' : '') + '</span><span class="v">' + total(l) + '<small>pcs</small></span></div>';
      }).join('');
      html += '<div class="sticky-bottom"><button class="btn big wa" data-wa="1" style="display:flex;align-items:center;justify-content:center;gap:8px">' + icon('wa') + ' Aaj ka output group me bhejo</button></div>';
    }
    $('#mout-body').innerHTML = html;
  }

  // ---- one line + shift of a date: SRN dropdown (this line's loading), auto manpower/hours, qty, live loading check
  function openLine(gi, li) {
    var l = O.groups[gi] && O.groups[gi].lines[li]; if (!l) return;
    var opts = l.srns || [], cur = l.entries[0] || { srn: l.attSrn || (opts[0] || {}).srn || '', total: 0, other: 0 };
    var fixed = !!l.entries.length;
    var mpNote = l.events && l.events.length ? l.events.map(function (e) { return e.event === 'LINE_CLOSED' ? 'line band ' + e.time : e.count + ' ' + e.role + ' ' + evLabel(e.event) + (e.time ? ' ' + e.time : ''); }).join(', ') : '';
    var html = '<div class="mo-info"><div><span>Log</span><b>' + l.mp + '</b>' + (l.mp !== l.mpBase ? '<small>subah ' + l.mpBase + '</small>' : '') + '</div><div><span>Ghante</span><b>' + l.hours + '</b></div><div><span>Din</span><b style="font-size:15px">' + esc(S.fmtDay(l.date)) + '</b></div></div>' +
      (mpNote ? '<div class="hint" style="margin:0 0 8px">Badlav: ' + esc(mpNote) + '</div>' : '') +
      '<label>SRN</label><select id="mo-srn"' + (fixed ? ' disabled' : '') + '>' + (cur.srn && !srnOpt(l, cur.srn) ? '<option>' + esc(cur.srn) + '</option>' : '') + (opts.length ? '' : '<option value="">Is line par loading nahi mili</option>') +
        opts.map(function (o) { return '<option value="' + esc(o.srn) + '"' + (o.srn === cur.srn ? ' selected' : '') + '>' + esc(o.srn) + ' · ' + o.balance + ' baaki</option>'; }).join('') + '</select>' +
      '<div id="mo-load" class="mo-load"></div>' +
      '<label>Kitne pcs bane' + (l.shift === 'OT' ? ' (OT me)' : '') + '</label><input id="mo-qty" class="mo-big" type="number" inputmode="numeric" min="0" placeholder="0" value="' + (cur.total || '') + '">' +
      (cur.other ? '<div class="hint">Ghante-wise pehle se ' + cur.other + ' bhara hai (computer se) — kul isse kam nahi ho sakta</div>' : '') +
      '<div id="mo-chk" class="mo-chk"></div>' +
      '<button class="btn primary big" id="mo-save">Save · admin ko bhejo</button>';
    S.sheet.open(S.shortLine(l.dept) + ' · ' + shLabel(l.shift) + ' output', html);
    var box = $('#sheet-content');
    function srnNow() { return fixed ? cur.srn : ($('#mo-srn') || {}).value || ''; }
    function check() {
      var srn = srnNow(), o = srnOpt(l, srn), q = num($('#mo-qty').value), delta = q - num(cur.total), info = $('#mo-load'), chk = $('#mo-chk');
      if (!o) { info.innerHTML = srn ? 'Is SRN ki loading is line par nahi mili' : ''; chk.innerHTML = q && srn ? '<div class="warn">⚠ Loading nahi mili — save hoga, admin ko alert jayega</div>' : ''; return { over: q > 0 ? q : 0 }; }
      info.innerHTML = 'Loading <b>' + o.limit + '</b> · ban chuka <b>' + o.used + '</b> · aur ho sakta <b>' + Math.max(0, o.balance + num(cur.total)) + '</b>';
      var over = delta - o.balance;
      chk.innerHTML = !q ? '' : over > 0 ? '<div class="warn">⚠ Loading se <b>' + over + '</b> zyada hai. Save kar sakte ho, admin ko alert jayega.</div>' : '<div class="okk">✓ Loading ke andar</div>';
      return { over: over > 0 ? over : 0 };
    }
    box.oninput = check; box.onchange = function (e) { if (e.target.id === 'mo-srn') check(); };
    check();
    setTimeout(function () { var q = $('#mo-qty'); if (q) q.focus(); }, 150);
    box.onclick = function (e) {
      if (!e.target.closest('#mo-save')) return;
      var srn = srnNow(), v = String($('#mo-qty').value).trim(), q = num(v);
      if (!v || !/^\d+$/.test(v)) { toast('Kitne pcs bane — poora number likho', 'bad'); return; }
      if (q > 0 && !srn) { toast('SRN chuno', 'bad'); return; }
      if (q < num(cur.other)) { toast('Computer se ghante-wise ' + cur.other + ' bhara hai — kul ' + cur.other + ' se kam nahi', 'bad', 6000); return; }
      var c = check(), go = function () { saveLine(l, { srn: srn, qty: q, other: num(cur.other), allowOver: c.over > 0 }); };
      if (c.over > 0) S.ask('Loading se ' + c.over + ' pcs zyada hai. Phir bhi save karein? Admin ko alert jayega.', { ok: 'Haan, save karo', cancel: 'Theek karta hoon' }).then(function (ok) { if (ok) go(); });
      else go();
    };
  }
  function evLabel(k) { return { HALF_DAY: 'half day', LEFT_AT: 'beech me gaya', LATE_JOIN: 'late aaya', ABSENT: 'absent', EXTRA: 'extra aaya', TRANSFER_OUT: 'transfer gaya', TRANSFER_IN: 'transfer se aaya', LINE_CLOSED: 'line band' }[k] || k; }

  function saveLine(l, x) {
    if (O.saving) return; O.saving = true; S.busy(true);
    api('hour.save', { date: l.date, factory: state.factory, slot: l.slot, items: [{ type: 'STITCH', dept: l.dept, srn: x.srn, qty: x.qty - x.other, floor: l.floor, allowOver: x.allowOver }] })
      .then(function (d) {
        var f = d.results.filter(function (r) { return !r.ok; })[0];
        if (f) throw new Error(f.message);
        // straight to the admin's review (that line's day: attendance + output)
        return api('day.submit', { date: l.date, factory: state.factory, dept: l.dept });
      })
      .then(function (s) {
        O.saving = false; S.busy(false); S.sheet.close();
        toast('Saved · ' + S.shortLine(l.dept) + ' admin ke review me gaya ✓' + (s.blocks && s.blocks.length ? ' (alert ke saath)' : ''), 'ok', 5000);
        S.tabs.mout();
      })
      .catch(function (e) { O.saving = false; S.busy(false); toast(e.message, 'bad', 7000); });
  }

  // ---- WhatsApp text for today's output (same plain style as the attendance message)
  function waOutputText() {
    var p = O.today.split('-'), mon = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][+p[1] - 1];
    var out = ['Date:- ' + pad(+p[2]) + ' ' + mon + ' ' + p[0] + ' - FAC' + state.factory, 'Stitching Output', ''], grand = 0;
    O.done.forEach(function (l) {
      var t = total(l); if (!t) return; grand += t;
      out.push(S.shortLine(l.dept) + (l.shift === 'OT' ? ' (OT)' : '') + ' - ' + l.entries.filter(function (e) { return e.total; }).map(function (e) { return e.srn; }).join(', '));
      out.push('Manpower ' + l.mp + (l.mp !== l.mpBase ? ' (subah ' + l.mpBase + ')' : ''));
      if (l.entries.length > 1) l.entries.forEach(function (e) { if (e.total) out.push(e.srn + ' - ' + e.total + ' pcs'); });
      out.push('Output ' + t + ' pcs');
      out.push('');
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

  $('#mout-body').addEventListener('click', function (ev) {
    var b = ev.target.closest('button'); if (!b) return;
    if (b.dataset.open) { var p = b.dataset.open.split('|'); openLine(+p[0], +p[1]); return; }
    if (b.dataset.wa) { S.shareText('Output group me bhejo', waOutputText()); return; }
    if (b.dataset.reload) { S.tabs.mout(); return; }
  });
})();
