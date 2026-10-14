// mrep.js — phone "Report" tab: pick an SRN (and its line) -> the day-wise Making Output Report (same table as Approve ->
// Review) + a WhatsApp message of it. Read-only, every user. Data: m.srnReport (main stitching sheet + app output waiting
// for approval + loading challans of that SRN).
(function () {
  'use strict';
  var S = window.SG, $ = S.$, esc = S.esc, state = S.state, icon = S.icon;
  var P = { srn: '', dept: '', r: null, busy: false, err: '', mode: 'srn', pdate: '', pdr: null, pbusy: false, perr: '' };
  try { P.mode = localStorage.getItem('sg_rep_mode') === 'pdr' ? 'pdr' : 'srn'; } catch (e) {}
  function yesterday() { var d = new Date(); d.setDate(d.getDate() - 1); return d.getFullYear() + '-' + ('0' + (d.getMonth() + 1)).slice(-2) + '-' + ('0' + d.getDate()).slice(-2); }
  function seg() { return '<div class="seg mo-seg"><button data-rmode="srn" class="' + (P.mode === 'srn' ? 'on' : '') + '">SRN report</button><button data-rmode="pdr" class="' + (P.mode === 'pdr' ? 'on' : '') + '">PDR · day report</button></div>'; }

  // every SRN name (open and shipped) for the picker: from the PMS data on the phone
  function srnList() { var d = S.pd && S.pd.get(); return S.srnNames || (d && d.pms && (d.pms.names || (d.pms.rows || []).map(function (r) { return r.srn; }))) || []; }
  function styleOf(srn) { var d = S.pd && S.pd.get(), r = ((d && d.pms && d.pms.rows) || []).filter(function (x) { return x.srn === srn; })[0]; return r ? [r.style, r.buyer].filter(Boolean).join(' · ') : ''; }
  // SRNs matching what is typed: "630" -> SRN0630, SRN0630A, SRN1630 …; the closest number first
  function matches(q) {
    q = String(q || '').toUpperCase().replace(/\s+/g, ''); if (!q) return [];
    var digits = q.replace(/^SRN/, '');
    return srnList().filter(function (s) { return s.indexOf(q) >= 0 || s.replace(/^SRN0*/, '').indexOf(digits.replace(/^0+/, '')) === 0 || s.indexOf(digits) >= 0; })
      .sort(function (a, b) { var na = a.replace(/^SRN0*/, ''), nb = b.replace(/^SRN0*/, ''), d0 = digits.replace(/^0+/, ''); return (nb.indexOf(d0) === 0) - (na.indexOf(d0) === 0) || b.localeCompare(a); }).slice(0, 30);
  }
  // what the server finds for the typed text (open + shipped SRNs), added to the phone's own list
  var extra = { q: '', list: [] }, findT = null;
  function serverFind(q) {
    clearTimeout(findT); if (q.length < 2) return;
    findT = setTimeout(function () {
      S.api('m.pmsFind', { factory: state.factory, q: q }, { quiet: true, silent: true }).then(function (r) {
        extra = { q: q, list: (r.rows || []).map(function (x) { return x.srn; }) };
        var i = $('#rp-srn'); if (i && i.value.trim() === q && document.activeElement === i) showDd(q, true);
      }).catch(function () {});
    }, 300);
  }
  function showDd(q, fromServer) {
    var dd = $('#rp-dd'); if (!dd) return;
    var list = matches(q);
    if (extra.q === q) extra.list.forEach(function (s) { if (list.indexOf(s) < 0) list.push(s); });
    if (!fromServer) serverFind(q);
    if (!q) { dd.hidden = true; return; }
    if (!list.length) { dd.innerHTML = '<div class="rp-none">' + (q.length >= 2 && !fromServer && extra.q !== q ? 'Looking for "' + esc(q) + '"…' : 'No SRN with "' + esc(q) + '"') + '</div>'; dd.hidden = false; return; }
    dd.innerHTML = list.map(function (s) { var st = styleOf(s); return '<button type="button" data-pick="' + esc(s) + '"><b>' + esc(s) + '</b>' + (st ? '<small>' + esc(st) + '</small>' : '') + '</button>'; }).join('');
    dd.hidden = false;
  }
  function n(v) { return (Math.round(+v || 0)).toLocaleString('en-IN'); }

  S.tabs.mrep = function () { render(); };

  // ---- PDR: previous day report, master-wise (image to share by hand)
  function nm(v) { return String(v || '').replace(/^[A-Z]{1,4}\d{3,}\s*-\s*/i, ''); }
  function achCls(a) { return a === '' ? '' : a >= 100 ? 'ok' : a >= 85 ? 'mid' : 'low'; }
  function renderPdr() {
    if (!P.pdate) P.pdate = yesterday();
    var d = P.pdr, html = seg() + '<div class="card rp-top"><div class="row"><div class="field"><label>Date</label><input type="date" id="pdr-date" value="' + esc(P.pdate) + '" max="' + S.todayStr() + '"></div>' +
      '<button class="btn" id="pdr-go" style="flex:0 0 auto;margin:0">Show</button></div></div>';
    if (P.pbusy) html += '<div class="empty">Making the day report…</div>';
    else if (P.perr) html += '<div class="empty">' + esc(P.perr) + '</div>';
    else if (!d) html += '<div class="empty">Pick a date (yesterday is set) and press Show.</div>';
    else if (!d.masters.length) html += '<div class="empty">No stitching output on ' + esc(S.fmtDay(d.date)) + '</div>';
    else {
      var t = d.total;
      html += '<div class="rp-sum"><div><small>Plan</small><b>' + n(t.planOut) + '</b></div><div><small>Actual</small><b>' + n(t.out) + '</b></div><div><small>Achieve</small><b class="ach ' + achCls(t.ach) + '">' + (t.ach === '' ? '–' : t.ach + '%') + '</b></div></div>';
      html += '<button class="btn big wa" data-pdrimg="" style="display:flex;align-items:center;justify-content:center;gap:8px;margin:0 0 10px">' + icon('wa') + ' Share PDR image · all masters</button>';
      d.masters.forEach(function (m) {
        html += '<div class="pdr-m"><div class="pdr-h"><div><small>Master</small><b>' + esc(nm(m.master)) + '</b></div><span class="ach ' + achCls(m.ach) + '">' + (m.ach === '' ? 'no plan' : m.ach + '%') + '</span>' +
          '<button class="btn small ghost" data-pdrimg="' + esc(m.master) + '">Image</button></div>' +
          '<table class="pdr-t"><thead><tr><th class="l">Supervisor · line · SRN</th><th>Plan</th><th>Actual</th><th>Var</th><th>Ach</th></tr></thead><tbody>' +
          m.lines.map(function (l) {
            return '<tr><td class="l">' + (l.supervisor ? '<em class="sup">' + esc(nm(l.supervisor)) + '</em>' : '') + '<b>' + esc(S.shortLine(l.dept)) + '</b><small>' + esc(l.srn) + ' · MP ' + (l.planMp === '' ? '–' : l.planMp) + '/' + l.mp + (l.mpOt ? '+' + l.mpOt + 'OT' : '') + ' · ' + l.hours + (l.hoursOt ? '+' + l.hoursOt : '') + ' h' + (l.pending ? ' · <i>waiting approval</i>' : '') + '</small></td>' +
              '<td>' + (l.planOut === '' ? '–' : n(l.planOut)) + '</td><td><b>' + n(l.out) + '</b></td><td class="' + (l.variance !== '' && l.variance < 0 ? 'neg' : '') + '">' + (l.variance === '' ? '–' : (l.variance > 0 ? '+' : '') + n(l.variance)) + '</td>' +
              '<td class="ach ' + achCls(l.ach) + '">' + (l.ach === '' ? '–' : l.ach + '%') + '</td></tr>';
          }).join('') + '</tbody></table></div>';
      });
      html += '<p class="hint" style="margin:6px 2px">MP = planned / actual production manpower (operator, helper, paster, QC, thread cutter, hand needle) · hours = shift + OT · achievement = actual ÷ plan output</p>';
    }
    $('#mrep-body').innerHTML = html;
  }
  function loadPdr() {
    var el = $('#pdr-date'); if (el && el.value) P.pdate = el.value;
    P.pbusy = true; P.perr = ''; renderPdr();
    S.api('m.pdr', { factory: state.factory, date: P.pdate }, { quiet: true })
      .then(function (d) { P.pdr = d; P.pbusy = false; renderPdr(); })
      .catch(function (e) { P.pbusy = false; P.perr = e.message; P.pdr = null; renderPdr(); });
  }

  function render() {
    if (P.mode === 'pdr') { renderPdr(); return; }
    var r = P.r, html = seg() + '<div class="card rp-top"><div class="row"><div class="field"><label>SRN</label>' +
      '<div class="rp-pick"><input id="rp-srn" type="text" autocomplete="off" inputmode="text" placeholder="Type SRN number, e.g. 630" value="' + esc(P.srn) + '"><div id="rp-dd" class="rp-dd" hidden></div></div></div>' +
      '<button class="btn" id="rp-go" style="flex:0 0 auto;margin:0">Show</button></div></div>';
    if (P.busy) html += '<div class="empty">Loading the report…</div>';
    else if (P.err) html += '<div class="empty">' + esc(P.err) + '</div>';
    else if (!r) html += '<div class="empty">Pick an SRN to see its day-wise output report.<br><span class="muted" style="font-size:12.5px">Tip: in the PMS tab, tap an SRN.</span></div>';
    else if (!r.lines.length) html += '<div class="empty">No output or loading found for ' + esc(r.srn) + '</div>';
    else {
      var info = r.info || {};
      html += '<div class="rp-head"><b>' + esc(r.srn) + '</b><span>' + esc([info.buyer, info.item].filter(Boolean).join(' · ')) + (info.orderQty ? ' · order ' + n(info.orderQty) : '') + '</span></div>';
      html += '<div class="chips rp-lines">' + r.lines.map(function (l) {
        return '<button data-rpl="' + esc(l.dept) + '" class="' + (l.dept === r.dept ? 'on' : '') + '">' + esc(S.shortLine(l.dept)) + '<small>' + n(l.output) + ' out · ' + n(l.load) + ' load</small></button>';
      }).join('') + '</div>';
      if (r.head) {
        var last = r.rows.length ? r.rows[r.rows.length - 1] : {}, out = +last.total || 0, load = +last.loadTotal || 0;
        html += '<div class="rp-sum"><div><small>Output</small><b>' + n(out) + '</b></div><div><small>Loading</small><b>' + n(load) + '</b></div><div><small>Balance</small><b class="' + (load - out < 0 ? 'bad' : '') + '">' + n(load - out) + '</b></div></div>';
        html += S.morTable(r, {});
        html += '<p class="hint" style="margin:6px 0">Light rows = output in the app, waiting for approval / not in the main sheet yet.</p>';
        html += '<button class="btn big wa" id="rp-wa" style="display:flex;align-items:center;justify-content:center;gap:8px">' + icon('wa') + ' Share image on WhatsApp</button>';
      }
    }
    $('#mrep-body').innerHTML = html;
  }

  function load(srn, dept) {
    srn = String(srn || '').trim().toUpperCase(); if (!srn) { S.toast('Type or pick an SRN', 'bad'); return; }
    var m = /^(\d+)([A-Z]?)$/.exec(srn); if (m) srn = 'SRN' + ('0000' + m[1]).slice(-Math.max(4, m[1].length)) + m[2];   // "620a" -> SRN0620A
    P.srn = srn; P.dept = dept || ''; P.busy = true; P.err = ''; render();
    S.api('m.srnReport', { factory: state.factory, srn: srn, dept: dept || '' }, { quiet: true })
      .then(function (r) { P.r = r; P.dept = r.dept; P.busy = false; render(); })
      .catch(function (e) { P.busy = false; P.err = e.message; P.r = null; render(); });
  }
  S.openSrnReport = function (srn) { S.tab('mrep'); load(srn); };
  S.openPdr = function (date) { P.mode = 'pdr'; try { localStorage.setItem('sg_rep_mode', 'pdr'); } catch (e) {} P.pdate = date || yesterday(); P.pdr = null; S.tab('mrep'); loadPdr(); };

  // WhatsApp: an image of the report in its printed format (the text version stays below for reference)
  function reportImage(r) {
    var h = r.head || {}, info = r.info || {}, nm = function (v) { return String(v || '').replace(/^[A-Z]{1,4}\d{3,}\s*-\s*/i, ''); };
    var v = function (x) { return x === '' || x === null || x === undefined ? '' : n(x); };
    var last = r.rows.length ? r.rows[r.rows.length - 1] : {}, out = +last.total || 0, ld = +last.loadTotal || 0;
    var rows = [];
    if (r.carry) rows.push({ fill: '#f3f4f6', bold: true, cells: ['Carry fwd', r.carry.days + ' days', v(r.carry.plan), v(r.carry.actual), v(r.carry.total), v(r.carry.variance), '', '', '', '', '', '', '', '', '', v(r.carry.load), v(r.carry.loadTotal)] });
    r.rows.forEach(function (x) {
      var p = (x.date || '').split('-'), d = p.length === 3 ? p[2] + '/' + p[1] + '/' + p[0].slice(2) : x.date;
      rows.push({ fill: x.src === 'app' ? '#eef3ff' : '', boldCols: [4], colors: { 5: x.variance > 0 ? '#c81e1e' : '' },
        cells: [d, x.shift === 'OT' ? 'OT' : x.shift ? 'Shift' : '', v(x.plan), x.src === 'loading' ? '' : v(x.actual), v(x.total), v(x.variance), x.remark || '',
                v(x.op), v(x.r1), v(x.r2), v(x.r4), v(x.r3), v(x.r5), v(x.hours), x.challan || '', v(x.load), x.load ? v(x.loadTotal) : ''] });
    });
    return S.tableImage({
      title: 'Making Output Report', sub: [h.factory, S.shortLine(r.dept), r.srn].join(' · '),
      info: [['Factory', h.factory], ['Incharge', nm(h.incharge)], ['SRN', r.srn + (info.item ? ' · ' + info.item : '') + (info.buyer ? ' (' + info.buyer + ')' : '')], ['Supervisor', nm(h.supervisor)],
             ['Line', S.shortLine(r.dept)], ['Junior supervisor', nm(h.junior)]],
      groups: [{ t: 'Output detail', n: 7 }, { t: 'Manpower detail', n: 7 }, { t: 'Loading details', n: 3 }],
      cols: [{ t: 'Date', w: 104 }, { t: 'Operation', w: 84 }, { t: 'Plan output', w: 84 }, { t: 'Actual output', w: 88 }, { t: 'Total act output', w: 100 }, { t: 'Variance', w: 88 }, { t: 'Remark / reason', w: 210, align: 'left' },
             { t: 'Operator', w: 82 }, { t: 'Helper', w: 72 }, { t: 'Paster', w: 72 }, { t: 'Endline QC', w: 80 }, { t: 'Thread cutter', w: 80 }, { t: 'Hand needle', w: 80 }, { t: 'Working hour', w: 80 },
             { t: 'Challan no.', w: 120 }, { t: 'Loading qty', w: 84 }, { t: 'Total loading', w: 96 }],
      rows: rows,
      foot: ['Total output ' + n(out) + ' pcs   ·   Total loading ' + n(ld) + ' pcs   ·   Balance ' + n(ld - out) + ' pcs'],
      stamp: S.imgStamp()
    });
  }

  // plain-text version (kept for reference / copy)
  function waText(r) {
    var info = r.info || {}, rows = r.rows.filter(function (x) { return x.src !== 'loading' || x.load; });
    var last = r.rows.length ? r.rows[r.rows.length - 1] : {}, out = +last.total || 0, load = +last.loadTotal || 0;
    var t = ['SRN:- ' + r.srn + ' - FAC' + state.factory, 'Line:- ' + S.shortLine(r.dept)];
    if (info.buyer || info.item) t.push('Style:- ' + [info.item, info.buyer].filter(Boolean).join(' / '));
    var nm = function (v) { return String(v || '').replace(/^[A-Z]{1,4}\d{3,}\s*-\s*/i, '') || '-'; };
    if (r.head && (r.head.incharge || r.head.supervisor)) t.push('Incharge:- ' + nm(r.head.incharge) + ' · Supervisor:- ' + nm(r.head.supervisor));
    t.push('', 'Date - Output (Total)');
    if (r.carry) t.push('Earlier ' + r.carry.days + ' days - ' + n(r.carry.actual) + ' (' + n(r.carry.total) + ')');
    rows.forEach(function (x) {
      var p = x.date.split('-'), d = p[2] + '/' + p[1];
      if (x.src === 'loading' && !+x.actual) { t.push(d + ' - loading ' + n(x.load)); return; }
      t.push(d + (x.shift === 'OT' ? ' OT' : '') + ' - ' + n(x.actual) + ' (' + n(x.total) + ')' + (x.plan !== '' && x.plan !== undefined ? ' · plan ' + n(x.plan) : '') + (x.load ? ' · loading ' + n(x.load) : ''));
    });
    t.push('', 'Total output ' + n(out) + ' pcs', 'Total loading ' + n(load) + ' pcs', 'Balance ' + n(load - out) + ' pcs', '', '- ' + (state.user.name || ''));
    return t.join('\n');
  }

  // the list opens only while typing (never on a plain tap in the box)
  $('#tab-mrep').addEventListener('input', function (e) { if (e.target.id === 'rp-srn') showDd(e.target.value.trim()); });
  document.addEventListener('click', function (e) { var dd = $('#rp-dd'); if (dd && !dd.hidden && !e.target.closest('.rp-pick')) dd.hidden = true; });
  $('#tab-mrep').addEventListener('click', function (e) {
    var b = e.target.closest('button'); if (!b) return;
    if (b.dataset.pick) { $('#rp-dd').hidden = true; load(b.dataset.pick); return; }
    if (b.dataset.rmode) { P.mode = b.dataset.rmode; try { localStorage.setItem('sg_rep_mode', P.mode); } catch (er) {} render(); return; }
    if (b.id === 'pdr-go') { loadPdr(); return; }
    if (b.dataset.pdrimg !== undefined && P.pdr) {
      var who = b.dataset.pdrimg;
      S.shareImage('PDR · ' + S.fmtDay(P.pdr.date) + (who ? ' · ' + nm(who) : ''), S.pdrImage(P.pdr, who || null), 'PDR_FAC' + P.pdr.factory + '_' + P.pdr.date + (who ? '_' + nm(who).replace(/[^A-Za-z0-9]+/g, '') : '') + '.png');
      return;
    }
    if (b.id === 'rp-go') { load($('#rp-srn').value); return; }
    if (b.dataset.rpl) { load(P.srn, b.dataset.rpl); return; }
    if (b.id === 'rp-wa' && P.r) S.shareImage('Making Output Report', reportImage(P.r), 'Making_' + S.shortLine(P.r.dept).replace(/[^A-Za-z0-9-]+/g, '') + '_' + P.r.srn + '_' + S.todayStr() + '.png');
  });
  $('#tab-mrep').addEventListener('keydown', function (e) {
    if (e.target.id !== 'rp-srn' || e.key !== 'Enter') return;
    e.preventDefault(); var m = matches(e.target.value.trim()); load(m.length === 1 ? m[0] : e.target.value);
  });
})();
