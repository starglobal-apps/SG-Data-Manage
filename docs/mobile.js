// mobile.js — phone "Output" tab: only what is still to be filled. Every line / shift (from 29 Sep 2026) that has
// attendance — filled in the app or typed in the main sheet — but no stitching output yet, grouped by date. Once the
// output is saved (or found typed in the main sheet) the line drops off the list, so nothing is entered twice.
// Tap -> type the pieces; SRN, manpower and hours come by themselves; loading is checked while typing (more is allowed
// with an alert). Save = goes to the admin for review (day.submit); only after approval does it reach the main sheet.
// Stored in the shift's last slot (Day 5–6 PM, OT 9–10 PM) so Day Close / reports / PMS / Send to Final work unchanged.
(function () {
  'use strict';
  var S = window.SG, $ = S.$, esc = S.esc, api = S.api, state = S.state, toast = S.toast, icon = S.icon;
  var O = { groups: [], done: [], waiting: [], today: '', saving: false, loaded: false, view: 'pending', day: '', dayRows: null, dayErr: '' };
  function num(v) { var n = Number(v); return isNaN(n) ? 0 : n; }
  function pad(n) { return String(n).padStart(2, '0'); }
  function shLabel(sh) { return sh === 'OT' ? 'OT' : sh === 'Night' ? 'Night' : 'Shift'; }
  function shBadge(sh) { return '<em class="ot sh-' + esc(sh) + '">' + shLabel(sh) + ' output</em>'; }
  function total(l) { var t = 0; (l.entries || []).forEach(function (e) { t += num(e.total); }); return t; }
  function srnOpt(l, srn) { return (l.srns || []).filter(function (x) { return x.srn === srn; })[0] || null; }
  function statusText(st) { return st === 'Submitted' ? '⏳ Pending approval' : st === 'Approved' ? 'Approved' : st === 'Sent' ? '✓ In main sheet' : st === 'Rejected' ? 'Sent back by admin — fill again' : st; }

  // data comes from the phone store (phone.js): drawn at once, fetched only when missing / old / after a save
  function apply(r) { O.loaded = true; O.groups = r.groups || []; O.done = r.done || []; O.waiting = r.waiting || []; O.today = r.today || S.todayStr(); render(); }
  function fail(e) { $('#mout-body').innerHTML = '<div class="empty">' + esc(e.message) + '<br><button class="btn primary" data-reload="1" style="margin-top:10px">Try again</button></div>'; }
  S.tabs.mout = function () {
    var d = S.pd.need();
    if (d && d.out && d.out.ok !== false) apply(d.out);
    else if (d && d.out) fail(new Error(d.out.message || 'Error'));
    else $('#mout-body').innerHTML = '<div class="empty">Loading pending output…</div>';
  };
  S.pdRender.mout = function () { var d = S.pd.get(); if (d && d.out && d.out.ok !== false) apply(d.out); };
  S.pdFail.mout = fail;

  function card(l, gi, li) {
    return '<button type="button" class="mo-card" data-open="' + gi + '|' + li + '">' +
      '<span class="b"><span class="nm">' + esc(S.shortLine(l.dept)) + ' ' + shBadge(l.shift) + (l.fromSheet ? ' <em class="ot">sheet att.</em>' : '') + '</span>' +
      '<span class="s">' + esc(l.attSrn || ((l.srns || [])[0] || {}).srn || 'SRN') + ' · ' + l.mp + ' people' + (l.mp !== l.mpBase ? ' (morning ' + l.mpBase + ')' : '') + ' · ' + l.hours + ' hrs</span>' +
      (l.status === 'Rejected' ? '<span class="st" style="color:var(--bad)">' + esc(statusText(l.status)) + (l.remark ? ' · ' + esc(l.remark) : '') + '</span>' : '') + '</span>' +
      '<span class="v"><small>fill ›</small></span></button>';
  }
  // top switch: Pending (what is still to fill + waiting for the admin) · By date (who entered how much that day)
  function viewTabs() {
    return '<div class="seg mo-seg"><button data-view="pending" class="' + (O.view === 'pending' ? 'on' : '') + '">Pending</button><button data-view="day" class="' + (O.view === 'day' ? 'on' : '') + '">By date</button></div>';
  }
  function render() {
    if (O.view === 'day') { renderDay(); return; }
    var html = viewTabs(), n = 0;
    O.groups.forEach(function (g, gi) {
      html += '<h2 class="mo-date">' + (g.date === O.today ? 'Today · ' : '') + esc(S.fmtDay(g.date)) + ' <span>' + g.lines.length + ' pending</span></h2>';
      g.lines.forEach(function (l, li) { n++; html += card(l, gi, li); });
    });
    if (!n) html += '<div class="empty">✓ No output pending<br><span class="muted" style="font-size:13px">Lines with attendance show up here for output</span></div>';
    if (O.waiting.length) {
      html += '<h2 class="mo-date">Waiting for approval <span>' + O.waiting.length + '</span></h2>' + O.waiting.map(function (l, i) {
        var edit = l.status === 'Submitted';
        return '<' + (edit ? 'button type="button" data-wopen="' + i + '"' : 'div') + ' class="mo-card wait' + (edit ? '' : ' lock') + '"><span class="b"><span class="nm">' + esc(S.shortLine(l.dept)) + ' ' + shBadge(l.shift) + '</span><span class="s">' + esc(S.fmtDay(l.date)) + ' · ' + l.entries.map(function (e) { return esc(e.srn); }).join(', ') + ' · ' + l.mp + ' people</span>' +
          '<span class="st" style="color:var(--warn)">' + (l.status === 'Approved' ? 'Approved — going to main sheet' : '⏳ Pending approval · tap to edit') + '</span></span><span class="v">' + total(l) + '<small>pcs</small></span></' + (edit ? 'button' : 'div') + '>';
      }).join('');
    }
    if (O.done.length) {
      var t = 0; O.done.forEach(function (l) { t += total(l); });
      html += '<h2 class="mo-date">Filled today <span>' + t + ' pcs</span></h2>' + O.done.map(function (l) {
        return '<div class="mo-card done lock"><span class="b"><span class="nm">' + esc(S.shortLine(l.dept)) + ' ' + shBadge(l.shift) + '</span><span class="s">' + l.entries.map(function (e) { return esc(e.srn); }).join(', ') + ' · ' + l.mp + ' people</span>' + (l.status ? '<span class="st">' + esc(statusText(l.status)) + '</span>' : '') + '</span><span class="v">' + total(l) + '<small>pcs</small></span></div>';
      }).join('');
      html += '<div class="sticky-bottom"><button class="btn big wa" data-wa="1" style="display:flex;align-items:center;justify-content:center;gap:8px">' + icon('wa') + ' Send today\'s output to group</button></div>';
    }
    $('#mout-body').innerHTML = html;
  }

  // ---- By date: every line's output of the chosen date and who entered it (m.outDay, small call)
  function renderDay() {
    if (!O.day) O.day = S.todayStr();
    var html = viewTabs() + '<div class="card pa-top"><div class="field"><label>Date</label><input type="date" id="mo-day" value="' + esc(O.day) + '" max="' + S.todayStr() + '"></div></div>';
    if (O.dayErr) html += '<div class="empty">' + esc(O.dayErr) + '</div>';
    else if (!O.dayRows) html += '<div class="empty">Loading…</div>';
    else if (!O.dayRows.length) html += '<div class="empty">No output entered on this date</div>';
    else {
      var by = {}, grand = 0;
      O.dayRows.forEach(function (r) { (by[r.by || '—'] = by[r.by || '—'] || []).push(r); grand += r.qty; });
      html += '<div class="mo-sum">' + O.dayRows.length + ' entries · <b>' + grand + ' pcs</b></div>';
      Object.keys(by).forEach(function (who) {
        var list = by[who], t = 0; list.forEach(function (r) { t += r.qty; });
        html += '<h2 class="mo-date">' + esc(who) + ' <span>' + t + ' pcs</span></h2>' + list.map(function (r) {
          var st = r.status === 'Submitted' ? '⏳ Pending approval' : r.status === 'Sent' ? '✓ In main sheet' : r.status === 'Approved' ? 'Approved' : r.status === 'Rejected' ? 'Sent back' + (r.remark ? ': ' + r.remark : '') : r.status;
          var col = r.status === 'Rejected' ? 'var(--bad)' : r.status === 'Submitted' || r.status === 'Not submitted' ? 'var(--warn)' : 'var(--ok)';
          return '<div class="mo-card lock"><span class="b"><span class="nm">' + esc(S.shortLine(r.dept)) + ' ' + shBadge(r.shift) + (r.type !== 'STITCH' ? ' <em class="ot">' + esc(r.type.toLowerCase()) + '</em>' : '') + '</span><span class="s">' + esc(r.srn) + '</span><span class="st" style="color:' + col + '">' + esc(st) + '</span></span><span class="v">' + r.qty + '<small>pcs</small></span></div>';
        }).join('');
      });
    }
    $('#mout-body').innerHTML = html;
  }
  function loadDay() {
    O.dayRows = null; O.dayErr = ''; renderDay();
    var d = O.day;
    api('m.outDay', { date: d, factory: state.factory }, { quiet: true })
      .then(function (r) { if (d !== O.day) return; O.dayRows = r.rows || []; if (O.view === 'day') renderDay(); })
      .catch(function (e) { if (d !== O.day) return; O.dayErr = e.message; if (O.view === 'day') renderDay(); });
  }

  // ---- one line + shift of a date: SRN dropdown (this line's loading), auto manpower/hours, qty, live loading check
  function openLine(l) {
    if (!l) return;
    var opts = l.srns || [], cur = l.entries[0] || { srn: l.attSrn || (opts[0] || {}).srn || '', total: 0, other: 0 };
    var fixed = !!l.entries.length;
    var mpNote = l.events && l.events.length ? l.events.map(function (e) { return e.event === 'LINE_CLOSED' ? 'line closed ' + e.time : e.count + ' ' + e.role + ' ' + evLabel(e.event) + (e.time ? ' ' + e.time : ''); }).join(', ') : '';
    var html = '<div class="mo-info"><div><span>People</span><b>' + l.mp + '</b>' + (l.mp !== l.mpBase ? '<small>morning ' + l.mpBase + '</small>' : '') + '</div><div><span>Hours</span><b>' + l.hours + '</b></div><div><span>Date</span><b style="font-size:15px">' + esc(S.fmtDay(l.date)) + '</b></div></div>' +
      (mpNote ? '<div class="hint" style="margin:0 0 8px">Changes: ' + esc(mpNote) + '</div>' : '') +
      '<label>SRN</label><select id="mo-srn"' + (fixed ? ' disabled' : '') + '>' + (cur.srn && !srnOpt(l, cur.srn) ? '<option>' + esc(cur.srn) + '</option>' : '') + (opts.length ? '' : '<option value="">No loading found on this line</option>') +
        opts.map(function (o) { return '<option value="' + esc(o.srn) + '"' + (o.srn === cur.srn ? ' selected' : '') + '>' + esc(o.srn) + ' · ' + o.balance + ' left</option>'; }).join('') + '</select>' +
      '<div id="mo-load" class="mo-load"></div>' +
      '<label>Pieces made (' + shLabel(l.shift) + ' output)</label><input id="mo-qty" class="mo-big" type="number" inputmode="numeric" min="0" placeholder="0" value="' + (cur.total || '') + '">' +
      (cur.other ? '<div class="hint">' + cur.other + ' already filled hour-wise (from computer) — total cannot be less than this</div>' : '') +
      '<div id="mo-chk" class="mo-chk"></div>' +
      '<button class="btn primary big" id="mo-save">Save · send to admin</button>';
    S.sheet.open(S.shortLine(l.dept) + ' · ' + shLabel(l.shift) + ' output', html);
    var box = $('#sheet-content');
    function srnNow() { return fixed ? cur.srn : ($('#mo-srn') || {}).value || ''; }
    function check() {
      var srn = srnNow(), o = srnOpt(l, srn), q = num($('#mo-qty').value), delta = q - num(cur.total), info = $('#mo-load'), chk = $('#mo-chk');
      if (!o) { info.innerHTML = srn ? 'No loading of this SRN found on this line' : ''; chk.innerHTML = q && srn ? '<div class="warn">⚠ No loading found — it will save, admin gets an alert</div>' : ''; return { over: q > 0 ? q : 0 }; }
      info.innerHTML = 'Loading <b>' + o.limit + '</b> · made <b>' + o.used + '</b> · can still make <b>' + Math.max(0, o.balance + num(cur.total)) + '</b>';
      var over = delta - o.balance;
      chk.innerHTML = !q ? '' : over > 0 ? '<div class="warn">⚠ <b>' + over + '</b> more than loading. You can save, admin gets an alert.</div>' : '<div class="okk">✓ Within loading</div>';
      return { over: over > 0 ? over : 0 };
    }
    box.oninput = check; box.onchange = function (e) { if (e.target.id === 'mo-srn') check(); };
    check();
    setTimeout(function () { var q = $('#mo-qty'); if (q) q.focus(); }, 150);
    box.onclick = function (e) {
      if (!e.target.closest('#mo-save')) return;
      var srn = srnNow(), v = String($('#mo-qty').value).trim(), q = num(v);
      if (!v || !/^\d+$/.test(v)) { toast('Pieces made — enter a whole number', 'bad'); return; }
      if (q === 0 && !num(cur.total)) { toast('Pieces made must be more than 0', 'bad'); return; }
      if (q > 0 && !srn) { toast('Select SRN', 'bad'); return; }
      if (q < num(cur.other)) { toast(cur.other + ' already filled hour-wise from computer — total cannot be less than ' + cur.other, 'bad', 6000); return; }
      var c = check(), go = function () { saveLine(l, { srn: srn, qty: q, other: num(cur.other), allowOver: c.over > 0 }); };
      if (c.over > 0) S.ask(c.over + ' pcs more than loading. Save anyway? Admin gets an alert.', { ok: 'Yes, save', cancel: 'Let me fix it' }).then(function (ok) { if (ok) go(); });
      else go();
    };
  }
  function evLabel(k) { return { HALF_DAY: 'half day', LEFT_AT: 'left early', LATE_JOIN: 'came late', ABSENT: 'absent', EXTRA: 'extra', TRANSFER_OUT: 'transferred out', TRANSFER_IN: 'transferred in', LINE_CLOSED: 'line closed' }[k] || k; }

  function saveLine(l, x) {
    if (O.saving) return; O.saving = true; S.busy(true);
    var reopen = l.status === 'Submitted' ? api('m.outReopen', { date: l.date, factory: state.factory, dept: l.dept, shift: l.shift }) : Promise.resolve();
    reopen.then(function () { return api('hour.save', { lite: true, date: l.date, factory: state.factory, slot: l.slot, items: [{ type: 'STITCH', dept: l.dept, srn: x.srn, qty: x.qty - x.other, floor: l.floor, allowOver: x.allowOver }] }); })
      .then(function (d) {
        var f = d.results.filter(function (r) { return !r.ok; })[0];
        if (f) throw new Error(f.message);
        // straight to the admin's review (that line's day: attendance + output)
        return api('day.submit', { lite: true, date: l.date, factory: state.factory, dept: l.dept });
      })
      .then(function (s) {
        O.saving = false; S.busy(false); S.sheet.close();
        toast('Saved · ' + S.shortLine(l.dept) + ' sent to admin review ✓' + (s.blocks && s.blocks.length ? ' (with alert)' : ''), 'ok', 5000);
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
      out.push(S.shortLine(l.dept) + (l.shift !== 'Final' ? ' (' + l.shift + ')' : '') + ' - ' + l.entries.filter(function (e) { return e.total; }).map(function (e) { return e.srn; }).join(', '));
      out.push('Manpower ' + l.mp + (l.mp !== l.mpBase ? ' (morning ' + l.mpBase + ')' : ''));
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
      '<a class="btn big wa" id="wa-open" href="https://wa.me/?text=' + encodeURIComponent(text) + '" target="_blank" rel="noopener" style="display:flex;align-items:center;justify-content:center;gap:8px;text-decoration:none">' + icon('wa') + ' Send on WhatsApp</a>' +
      '<button class="btn ghost big" id="wa-copy">Copy text</button>');
    $('#sheet-content').onclick = function (e) {
      if (e.target.closest('#wa-copy')) { try { navigator.clipboard.writeText(text); toast('Copied', 'ok'); } catch (er) { toast('Could not copy', 'bad'); } }
      if (e.target.closest('#wa-open')) setTimeout(S.sheet.close, 300);
    };
  };

  $('#mout-body').addEventListener('change', function (ev) {
    if (ev.target.id === 'mo-day') { var v = ev.target.value; if (v && v <= S.todayStr()) { O.day = v; loadDay(); } else ev.target.value = O.day; }
  });
  $('#mout-body').addEventListener('click', function (ev) {
    var b = ev.target.closest('button'); if (!b) return;
    if (b.dataset.view) { O.view = b.dataset.view; if (O.view === 'day') loadDay(); else render(); return; }
    if (b.dataset.open) { var p = b.dataset.open.split('|'); openLine(O.groups[+p[0]] && O.groups[+p[0]].lines[+p[1]]); return; }
    if (b.dataset.wopen) { openLine(O.waiting[+b.dataset.wopen]); return; }
    if (b.dataset.wa) { S.shareText('Send output to group', waOutputText()); return; }
    if (b.dataset.reload) { $('#mout-body').innerHTML = '<div class="empty">Loading…</div>'; S.pd.load(false).catch(fail); return; }
  });
})();
