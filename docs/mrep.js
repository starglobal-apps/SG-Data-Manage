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
        html += '<button class="btn big wa" id="rp-wa" style="display:flex;align-items:center;justify-content:center;gap:8px">' + icon('wa') + ' Send on WhatsApp</button>';
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

  // WhatsApp: the same plain style as the output message
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
    if (b.id === 'rp-wa' && P.r) S.shareText('Send report on WhatsApp', waText(P.r));
  });
  $('#tab-mrep').addEventListener('change', function (e) { if (e.target.id === 'rp-srn' && e.target.value) load(e.target.value); });
  $('#tab-mrep').addEventListener('keydown', function (e) { if (e.target.id === 'rp-srn' && e.key === 'Enter') { e.preventDefault(); load(e.target.value); } });
})();
