// target.js — "Target" tab: line code + SRN -> today's attendance manpower × 60 / SAM = hourly target,
// with efficiency %, the day's target, and hour-by-hour target vs actual (manpower changes applied per hour).
(function () {
  'use strict';
  var S = window.SG, $ = S.$, $$ = S.$$, esc = S.esc, api = S.api, state = S.state, toast = S.toast;
  var T = { dept: '', srn: '', data: null, basis: S.recall('tg_basis') || 'prod', eff: Number(S.recall('tg_eff')) || 100, loading: false };
  function num(v) { var n = Number(v); return isNaN(n) ? 0 : n; }
  function r0(n) { return Math.round(n); }

  S.tabs.target = function () {
    var lines = attLines();
    if (!T.dept && lines.length) T.dept = lines[0].dept;
    render();
    if (T.dept) load();
    else S.loadFactory().then(function () { var l = attLines(); if (!T.dept && l.length) { T.dept = l[0].dept; load(); } else render(); }).catch(function () {});
  };

  function attLines() {
    var d = S.factoryData(); if (!d) return [];
    return d.depts.filter(function (x) { return x.cat === 'STITCH' && d.att[x.dept + '|Final']; });
  }
  function allLines() { return S.deptsFor(state.factory).filter(function (x) { return (x.extra || S.deptCategory(x.key)) === 'STITCH'; }).map(function (x) { return x.key; }); }
  // "SL033", "033", "33", "line 3-sl033" -> the matching dept
  function findDept(code) {
    var c = String(code || '').trim().toUpperCase(); if (!c) return '';
    var all = allLines(), exact = all.filter(function (d) { return d.toUpperCase() === c; })[0]; if (exact) return exact;
    var digits = c.replace(/\D/g, '');
    var hits = all.filter(function (d) { var u = d.toUpperCase(); return u.indexOf(c) >= 0 || (digits && (u.match(/SL0*(\d+)/) || [])[1] === String(Number(digits))); });
    return hits.length === 1 ? hits[0] : (hits.filter(function (d) { return d.toUpperCase().slice(-c.length) === c; })[0] || '');
  }

  function load() {
    T.loading = true; T.samPreview = 0; render();
    api('target.get', { date: state.date, factory: state.factory, dept: T.dept, srn: T.srn }, { quiet: true })
      .then(function (d) { T.loading = false; T.data = d; if (!T.srn) T.srn = d.srn; render(); })
      .catch(function (e) { T.loading = false; T.data = null; render(); toast(e.message, 'bad'); });
  }

  function basisMp(d, slotRow) {
    if (T.basis === 'total') return slotRow ? slotRow.mp : d.total;
    if (T.basis === 'op') { if (!slotRow) return d.operators; var lost = d.productive - slotRow.mpProd; return Math.max(0, d.operators - Math.max(0, lost)); }
    return slotRow ? slotRow.mpProd : d.productive;
  }
  function perHour(mp, sam, eff) { return sam > 0 ? mp * 60 / sam * (eff / 100) : 0; }

  function render() {
    var lines = attLines(), d = T.data;
    var html = '<div class="card tg-in">' +
      '<div class="row"><div class="field"><label>Line code</label><input id="tg-line" type="text" list="tg-lines" placeholder="jaise SL033" value="' + esc(T.dept ? S.shortLine(T.dept) : '') + '" autocomplete="off"></div>' +
      '<div class="field"><label>SRN</label><button type="button" class="tg-srn" id="tg-srn">' + (T.srn ? esc(T.srn) : 'SRN chuno') + '</button></div></div>' +
      '<datalist id="tg-lines">' + allLines().map(function (x) { return '<option value="' + esc(S.shortLine(x)) + '">'; }).join('') + '</datalist>' +
      (lines.length ? '<div class="chips tg-chips">' + lines.map(function (x) { return '<button type="button" data-line="' + esc(x.dept) + '" class="' + (x.dept === T.dept ? 'on' : '') + '">' + esc(S.shortLine(x.dept)) + '</button>'; }).join('') + '</div>' : '') +
      '</div>';
    if (!T.dept) { html += '<div class="empty">Line code likho ya upar se line chuno</div>'; $('#target-body').innerHTML = html; return; }
    if (T.loading && !d) { html += '<div class="empty">Attendance aa rahi hai…</div>'; $('#target-body').innerHTML = html; return; }
    if (!d) { $('#target-body').innerHTML = html; return; }
    if (!d.hasAtt) { html += '<div class="banner">' + esc(S.shortLine(d.dept)) + ' ki aaj (' + esc(S.fmtDay(state.date)) + ') attendance nahi — pehle attendance bharo</div>'; $('#target-body').innerHTML = html; return; }

    var dirty = T.samPreview && T.samPreview !== num(d.sam);
    var mp = basisMp(d), sam = num(T.samPreview || d.sam), eff = T.eff, h100 = perHour(mp, sam, 100), hEff = perHour(mp, sam, eff), day = hEff * d.hours;
    html += '<div class="card tg-mp"><div class="tg-k">Aaj ki attendance · ' + esc(S.shortLine(d.dept)) + (d.item ? ' · ' + esc(d.item.slice(0, 28)) : '') + '</div>' +
      '<div class="seg tg-basis">' +
        '<button data-basis="prod" class="' + (T.basis === 'prod' ? 'on' : '') + '">Kaam wale <b>' + d.productive + '</b></button>' +
        '<button data-basis="op" class="' + (T.basis === 'op' ? 'on' : '') + '">Sirf operator <b>' + d.operators + '</b></button>' +
        '<button data-basis="total" class="' + (T.basis === 'total' ? 'on' : '') + '">Sab <b>' + d.total + '</b></button></div>' +
      '<div class="hint" style="margin:4px 0 0">' + Object.keys(d.roles).map(function (r) { return esc(r) + ' ' + d.roles[r]; }).join(' · ') + ' · ' + d.hours + ' ghante' + (d.closedAt ? ' (line band ' + esc(d.closedAt) + ')' : '') + '</div>' +
      (T.basis === 'prod' ? '<div class="hint" style="margin:2px 0 0">Kaam wale = sab − ' + esc(d.nonProductiveRoles.join(' / ')) + '</div>' : '') + '</div>';

    html += '<div class="card tg-sam"><div class="row">' +
      '<div class="field"><label>SAM (minute / piece)</label><div class="tg-samrow"><input id="tg-sam" type="number" inputmode="decimal" step="0.01" min="0" placeholder="jaise 12.5" value="' + (sam || '') + '"><button class="btn primary small" id="tg-sam-save">Save</button></div>' +
      '<div class="hint">' + (dirty ? '<b style="color:var(--warn)">Abhi save nahi hua — Save dabao</b>' : num(d.sam) ? esc(d.srn) + ' ka SAM saved' + (d.samBy ? ' · ' + esc(d.samBy) : '') : esc(d.srn || 'SRN') + ' ka SAM ek baar daalo — sab ke liye yaad rahega') + '</div></div>' +
      '<div class="field small"><label>Efficiency %</label><input id="tg-eff" type="number" inputmode="numeric" min="1" max="150" value="' + eff + '"></div></div></div>';

    if (!sam) { html += '<div class="empty">SAM daalo — target turant dikhega</div>'; $('#target-body').innerHTML = html; return; }

    html += '<div class="tg-hero"><div class="k">Hourly target · ' + mp + ' log × 60 ÷ ' + sam + ' SAM' + (eff !== 100 ? ' × ' + eff + '%' : '') + '</div>' +
      '<div class="v">' + r0(hEff) + ' <small>pcs / ghanta</small></div>' +
      '<div class="m"><span>100% par <b>' + r0(h100) + '</b></span><span>Din ka target <b>' + r0(day) + '</b> (' + d.hours + ' ghante)</span></div></div>';

    // hour by hour: target (manpower of that hour) vs actual
    var now = S.isToday() ? S.nowHour() : 24, totT = 0, totA = 0;
    html += '<h2>Ghante ke hisaab se · ' + esc(d.srn || '') + '</h2><div class="tbl-wrap"><table class="tbl tg-tbl"><thead><tr><th>Ghanta</th><th class="num">Log</th><th class="num">Target</th><th class="num">Actual</th><th class="num">%</th></tr></thead><tbody>';
    d.slots.forEach(function (x) {
      var st = S.slotStart(x.slot), m = x.closed ? 0 : basisMp(d, x), t = x.closed ? 0 : r0(perHour(m, sam, eff)), a = x.actual, past = now >= st + 1, cur = now >= st && now < st + 1;
      if (past || a) { totT += t; totA += a; }
      var pct = t && (past || a) ? Math.round(a / t * 100) : null, cls = pct === null ? '' : pct >= 100 ? 'ok' : pct >= 80 ? 'mid' : 'low';
      html += '<tr class="' + (cur ? 'cur' : '') + (x.closed ? ' closed' : '') + '"><td>' + esc(x.label) + (cur ? ' <small>abhi</small>' : '') + '</td><td class="num">' + (x.closed ? '—' : m) + '</td><td class="num">' + (x.closed ? 'band' : t) + '</td><td class="num">' + (a || (past ? '0' : '')) + '</td><td class="num"><span class="tg-pct ' + cls + '">' + (pct === null ? '' : pct + '%') + '</span></td></tr>';
    });
    var tp = totT ? Math.round(totA / totT * 100) : null;
    html += '</tbody><tfoot><tr><td>Ab tak</td><td></td><td class="num">' + totT + '</td><td class="num">' + totA + '</td><td class="num">' + (tp === null ? '' : '<span class="tg-pct ' + (tp >= 100 ? 'ok' : tp >= 80 ? 'mid' : 'low') + '">' + tp + '%</span>') + '</td></tr></tfoot></table></div>';
    html += '<p class="hint">Har ghante ka target us ghante ke log se (koi gaya / aaya / line band ho to apne aap kam). Actual = is SRN ka stitching output.</p>';
    $('#target-body').innerHTML = html;
  }

  function pickSrn() {
    if (!T.dept) { toast('Pehle line chuno', 'bad'); return; }
    api('orders.active', { factory: state.factory, dept: T.dept, type: 'STITCH' }, { quiet: true }).then(function (d) {
      var list = d.srns || [];
      S.sheet.open(S.shortLine(T.dept) + ' · SRN', '<div id="tg-srnp"></div>' + (list.length ? '<label>Is line ki loading</label><div class="chips" style="flex-wrap:wrap">' + list.slice(0, 12).map(function (o) { return '<button data-pick="' + esc(o.srn) + '" class="' + (o.srn === T.srn ? 'on' : '') + '">' + esc(o.srn) + '<small>bal ' + o.balance + '</small></button>'; }).join('') + '</div>' : ''));
      S.srnPicker($('#tg-srnp'), { list: list, value: '', placeholder: 'SRN number likho…', onPick: function (v) { T.srn = v; S.sheet.close(); load(); } });
      $('#sheet-content').onclick = function (e) { var b = e.target.closest('[data-pick]'); if (!b) return; T.srn = b.dataset.pick; S.sheet.close(); load(); };
    }).catch(function (e) { toast(e.message, 'bad'); });
  }

  $('#target-body').addEventListener('click', function (e) {
    var b = e.target.closest('button'); if (!b) return;
    if (b.dataset.line) { T.dept = b.dataset.line; T.srn = ''; T.data = null; load(); return; }
    if (b.id === 'tg-srn') { pickSrn(); return; }
    if (b.dataset.basis) { T.basis = b.dataset.basis; S.remember('tg_basis', T.basis); render(); return; }
    if (b.id === 'tg-sam-save') {
      var v = num($('#tg-sam').value); if (!(v > 0)) { toast('SAM minute me daalo (jaise 12.5)', 'bad'); return; }
      if (!T.data || !T.data.srn) { toast('Pehle SRN chuno', 'bad'); return; }
      api('target.sam', { srn: T.data.srn, sam: v }).then(function () { toast(T.data.srn + ' ka SAM ' + v + ' saved', 'ok'); T.data.sam = v; T.samPreview = 0; T.data.samBy = state.user.name; render(); }).catch(function (er) { toast(er.message, 'bad'); });
    }
  });
  $('#target-body').addEventListener('change', function (e) {
    if (e.target.id === 'tg-line') {
      var d = findDept(e.target.value);
      if (!d) { toast('"' + e.target.value + '" naam ki line nahi mili', 'bad'); return; }
      T.dept = d; T.srn = ''; T.data = null; load();
    } else if (e.target.id === 'tg-eff') {
      var v = num(e.target.value); if (!(v > 0)) { e.target.value = T.eff; return; }
      T.eff = Math.min(150, v); S.remember('tg_eff', String(T.eff)); render();
    } else if (e.target.id === 'tg-sam' && T.data) {
      var s = num(e.target.value); if (s > 0) { T.samPreview = s; render(); }   // preview before Save
    }
  });
  $('#target-body').addEventListener('keydown', function (e) {
    if (e.key !== 'Enter') return;
    if (e.target.id === 'tg-line' || e.target.id === 'tg-eff' || e.target.id === 'tg-sam') { e.preventDefault(); e.target.blur(); }
  });
})();
