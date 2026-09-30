// mobile.js — phone "Output" tab: once in the evening, each line's stitching output for the whole day. No hourly entry.
// Stored as the day's last Day slot (5–6 PM) through hour.save, so Day Close / reports / PMS / Send to Final work unchanged.
// If the web already has hour-wise rows for that line, the phone shows the day total and only adjusts the 5–6 PM row.
(function () {
  'use strict';
  var S = window.SG, $ = S.$, $$ = S.$$, esc = S.esc, api = S.api, state = S.state, toast = S.toast;
  var DAY_SLOT = '17-18';
  var O = { lines: [], noAtt: [], saving: false };
  function num(v) { var n = Number(v); return isNaN(n) ? 0 : n; }

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

  // one line -> [{srn, total (day), other (all slots except 5–6 PM), val}]
  function build(x) {
    var d = x.d, st = (x.lt.slots || {}).STITCH || {}, by = {};
    Object.keys(st).forEach(function (sk) {
      st[sk].forEach(function (r) {
        var e = by[r.srn] = by[r.srn] || { srn: r.srn, total: 0, other: 0 };
        e.total += num(r.qty); if (sk !== DAY_SLOT) e.other += num(r.qty);
      });
    });
    var entries = Object.keys(by).map(function (k) { var e = by[k]; e.val = e.total ? String(e.total) : ''; e.fixed = true; return e; });
    if (!entries.length) entries.push({ srn: d.attSrn || d.lastSrn.STITCH || ((d.srns.STITCH || [])[0] || {}).srn || '', total: 0, other: 0, val: '', fixed: false });
    return { d: d, entries: entries, locked: d.locked.STITCH || '' };
  }
  function balOf(d, srn) { var o = (d.srns.STITCH || []).filter(function (x) { return x.srn === srn; })[0]; return o ? o.balance : null; }

  function render() {
    var total = 0, filled = 0;
    var html = '<p class="hint" style="margin:0 0 8px">Shaam ko har line ka <b>poore din ka stitching output</b> bharo. Ghante-wise kuch nahi bharna.</p>';
    if (!O.lines.length && !O.noAtt.length) html += '<div class="empty">Koi line nahi mili</div>';
    O.lines.forEach(function (L, li) {
      var lineTotal = 0; L.entries.forEach(function (e) { lineTotal += num(e.val); }); total += lineTotal; if (lineTotal) filled++;
      html += '<div class="mo-line' + (lineTotal ? ' done' : '') + (L.locked ? ' lock' : '') + '"><div class="mo-h"><span class="nm">' + esc(S.shortLine(L.d.dept)) + '</span><span class="mp">' + L.d.mpBase + ' log</span></div>';
      if (L.locked) html += '<div class="hint">' + esc(L.locked) + ' — ab edit nahi hoga</div>';
      L.entries.forEach(function (e, ei) {
        var bal = balOf(L.d, e.srn);
        html += '<div class="mo-row' + (e.err ? ' bad' : '') + '" data-l="' + li + '" data-e="' + ei + '">' +
          '<button type="button" class="mo-srn" data-srn="' + li + '|' + ei + '"' + (e.fixed || L.locked ? ' disabled' : '') + '>' + (e.srn ? esc(e.srn) : 'SRN chuno') + (bal !== null && bal !== undefined ? '<small>' + bal + ' baaki</small>' : '') + '</button>' +
          '<input class="mo-qty" type="number" inputmode="numeric" min="0" placeholder="pcs" value="' + esc(e.val) + '" data-q="' + li + '|' + ei + '"' + (L.locked ? ' disabled' : '') + '>' +
          (e.other ? '<div class="mo-note">Ghante-wise pehle se ' + e.other + ' bhara hai (web se) — kul isse kam nahi ho sakta</div>' : '') +
          (e.err ? '<div class="mo-err">' + esc(e.err) + '</div>' : '') + '</div>';
      });
      if (!L.locked) html += '<button type="button" class="lnk mo-add" data-add="' + li + '">+ dusra SRN</button>';
      html += '</div>';
    });
    O.noAtt.forEach(function (dept) {
      html += '<div class="mo-line dim"><div class="mo-h"><span class="nm">' + esc(S.shortLine(dept)) + '</span><span class="mp">attendance nahi</span></div><button type="button" class="btn small ghost" data-att="1">Pehle attendance bharo</button></div>';
    });
    if (O.lines.length) {
      html += '<div class="mo-total"><span>Aaj ka total</span><b>' + total + ' pcs</b><small>' + filled + ' / ' + O.lines.length + ' line</small></div>';
      html += '<button type="button" class="lnk" data-close="1" style="display:block;margin:6px auto 0">Sab bhar diya? Din band karke admin ko bhejo ›</button>';
      html += '<div class="sticky-bottom"><button class="btn primary big" id="mo-save"' + (O.saving ? ' disabled' : '') + '>' + (O.saving ? 'Save ho raha hai…' : 'Output save karo') + '</button></div>';
    }
    $('#mout-body').innerHTML = html;
  }

  function save() {
    if (O.saving) return;
    var items = [], bad = null;
    O.lines.forEach(function (L) {
      if (L.locked) return;
      L.entries.forEach(function (e) {
        e.err = '';
        var v = String(e.val).trim(), n = num(v);
        if (v !== '' && (!/^\d+$/.test(v))) { e.err = 'Sirf poora number (pcs)'; bad = bad || e; return; }
        if (n === e.total) return;                                   // unchanged
        if (n > 0 && !e.srn) { e.err = 'SRN chuno'; bad = bad || e; return; }
        if (n < e.other) { e.err = 'Ghante-wise ' + e.other + ' pehle se bhara hai — kul ' + e.other + ' se kam nahi. Kam karna ho to computer par ghante badlo.'; bad = bad || e; return; }
        items.push({ type: 'STITCH', dept: L.d.dept, srn: e.srn, qty: n - e.other, floor: L.d.floor });
      });
    });
    if (bad) { render(); toast(bad.err, 'bad', 6000); return; }
    if (!items.length) { toast('Kuch badla nahi', ''); return; }
    O.saving = true; render();
    api('hour.save', { date: state.date, factory: state.factory, slot: DAY_SLOT, items: items })
      .then(function (d) {
        O.saving = false; S.invalidateAll(); S.clearLocalCaches();
        var fails = d.results.filter(function (r) { return !r.ok; });
        // rows that did save now count as saved (so they are not treated as changed again)
        d.results.forEach(function (r) { if (!r.ok) return; O.lines.forEach(function (L) { if (L.d.dept !== r.dept) return; L.entries.forEach(function (e) { if (e.srn === r.srn) { e.total = num(e.val); e.fixed = true; } }); }); });
        if (fails.length) {
          fails.forEach(function (f) { O.lines.forEach(function (L) { if (L.d.dept !== f.dept) return; L.entries.forEach(function (e) { if (e.srn === f.srn) e.err = f.message; }); }); });
          render(); toast(S.shortLine(fails[0].dept) + ': ' + fails[0].message + (d.saved ? ' · baaki ' + d.saved + ' saved' : ''), 'bad', 8000);
          return;
        }
        toast('Output saved · ' + d.saved + ' line ✓', 'ok');
        S.tabs.mout();
      })
      .catch(function (e) { O.saving = false; render(); toast(e.message, 'bad', 6000); });
  }

  function pickSrn(li, ei) {
    var L = O.lines[li], e = L.entries[ei], opts = L.d.srns.STITCH || [];
    if (!opts.length) { toast('Is line par loading nahi mili', 'bad'); return; }
    S.sheet.open(S.shortLine(L.d.dept) + ' · SRN chuno', '<div class="chips" style="flex-wrap:wrap">' + opts.map(function (o) { return '<button data-pick="' + esc(o.srn) + '" class="' + (o.srn === e.srn ? 'on' : '') + '">' + esc(o.srn) + '<small>' + o.balance + ' baaki</small></button>'; }).join('') + '</div>');
    $('#sheet-content').onclick = function (ev) { var b = ev.target.closest('[data-pick]'); if (!b) return; e.srn = b.dataset.pick; e.err = ''; S.sheet.close(); render(); };
  }

  $('#mout-body').addEventListener('input', function (ev) {
    var q = ev.target.dataset.q; if (!q) return;
    var p = q.split('|'), e = O.lines[+p[0]].entries[+p[1]]; e.val = ev.target.value; e.err = '';
    var row = ev.target.closest('.mo-row'); if (row) { row.classList.remove('bad'); var m = row.querySelector('.mo-err'); if (m) m.remove(); }
    var t = 0; O.lines.forEach(function (L) { L.entries.forEach(function (x) { t += num(x.val); }); });
    var tb = $('#mout-body .mo-total b'); if (tb) tb.textContent = t + ' pcs';
  });
  $('#mout-body').addEventListener('keydown', function (ev) {
    if (ev.key !== 'Enter' || !ev.target.dataset.q) return;
    ev.preventDefault();
    var all = $$('#mout-body .mo-qty:not(:disabled)'), i = all.indexOf(ev.target);
    if (all[i + 1]) all[i + 1].focus(); else ev.target.blur();
  });
  $('#mout-body').addEventListener('click', function (ev) {
    var b = ev.target.closest('button'); if (!b) return;
    if (b.id === 'mo-save') { save(); return; }
    if (b.dataset.srn) { var p = b.dataset.srn.split('|'); pickSrn(+p[0], +p[1]); return; }
    if (b.dataset.add !== undefined) { var L = O.lines[+b.dataset.add]; L.entries.push({ srn: '', total: 0, other: 0, val: '', fixed: false }); render(); pickSrn(+b.dataset.add, L.entries.length - 1); return; }
    if (b.dataset.att) { S.tab('matt'); return; }
    if (b.dataset.close) { S.screens.dayclose(''); return; }
    if (b.dataset.reload) { S.tabs.mout(); return; }
  });
})();
