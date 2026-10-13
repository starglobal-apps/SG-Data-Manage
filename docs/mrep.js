// mrep.js — phone "Report" tab: pick an SRN (and its line) -> the day-wise Making Output Report (same table as Approve ->
// Review) + a WhatsApp message of it. Read-only, every user. Data: m.srnReport (main stitching sheet + app output waiting
// for approval + loading challans of that SRN).
(function () {
  'use strict';
  var S = window.SG, $ = S.$, esc = S.esc, state = S.state, icon = S.icon;
  var P = { srn: '', dept: '', r: null, busy: false, err: '' };

  function srnList() { var d = S.pd && S.pd.get(); return ((d && d.pms && d.pms.rows) || []).map(function (r) { return r.srn; }); }
  function n(v) { return (Math.round(+v || 0)).toLocaleString('en-IN'); }

  S.tabs.mrep = function () { render(); };

  function render() {
    var r = P.r, html = '<div class="card rp-top"><div class="row"><div class="field"><label>SRN</label>' +
      '<input id="rp-srn" type="text" list="rp-srns" autocomplete="off" inputmode="text" placeholder="Type or pick SRN" value="' + esc(P.srn) + '">' +
      '<datalist id="rp-srns">' + srnList().map(function (s) { return '<option value="' + esc(s) + '">'; }).join('') + '</datalist></div>' +
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
                v(x.op), v(x.r1), v(x.r2), v(x.r4), v(x.r3), v(x.r5), v(x.hours), x.challan || '', v(x.load), v(x.loadTotal)] });
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

  $('#tab-mrep').addEventListener('click', function (e) {
    var b = e.target.closest('button'); if (!b) return;
    if (b.id === 'rp-go') { load($('#rp-srn').value); return; }
    if (b.dataset.rpl) { load(P.srn, b.dataset.rpl); return; }
    if (b.id === 'rp-wa' && P.r) S.shareImage('Making Output Report', reportImage(P.r), 'Making_' + S.shortLine(P.r.dept).replace(/[^A-Za-z0-9-]+/g, '') + '_' + P.r.srn + '_' + S.todayStr() + '.png');
  });
  $('#tab-mrep').addEventListener('change', function (e) { if (e.target.id === 'rp-srn' && e.target.value) load(e.target.value); });
  $('#tab-mrep').addEventListener('keydown', function (e) { if (e.target.id === 'rp-srn' && e.key === 'Enter') { e.preventDefault(); load(e.target.value); } });
})();
