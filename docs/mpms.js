// mpms.js — phone "PMS" tab: every unshipped SRN of the factory with loading · stitching · endline pass · pack · unloading · shipped,
// so the recorder can see how much is left before filling output. Read-only.
(function () {
  'use strict';
  var S = window.SG, $ = S.$, esc = S.esc, api = S.api, state = S.state;
  var P = { rows: null, q: '', fac: '', found: [], fq: '' };

  // data comes from the phone store (phone.js): drawn at once, fetched only when missing / old / after a save
  function apply(r) {
    var a = document.activeElement, typing = a && a.id === 'pm-q', pos = typing ? a.selectionStart : 0;
    P.rows = r.rows || []; P.err = r.unloadError || ''; S.srnNames = r.names || P.rows.map(function (x) { return x.srn; }); S.srnRows = P.rows; render();
    if (typing) { var i = $('#pm-q'); i.focus(); try { i.setSelectionRange(pos, pos); } catch (e) {} }
  }
  function fail(e) { $('#mpms-body').innerHTML = '<div class="empty">' + esc(e.message) + '<br><button class="btn primary" data-reload="1" style="margin-top:10px">Try again</button></div>'; }
  S.tabs.mpms = function () {
    var d = S.pd.need();
    if (d && d.pms && d.pms.ok !== false) apply(d.pms);
    else if (d && d.pms) fail(new Error(d.pms.message || 'Error'));
    else $('#mpms-body').innerHTML = '<div class="empty">Loading PMS data…</div>';
  };
  S.pdRender.mpms = function () { var d = S.pd.get(); if (d && d.pms && d.pms.ok !== false) apply(d.pms); };
  S.pdFail.mpms = fail;

  function n(v) { return (Math.round(+v || 0)).toLocaleString('en-IN'); }
  function cell(label, v, warn) { return '<span class="pm-c' + (warn ? ' warn' : '') + '"><small>' + label + '</small><b>' + n(v) + '</b></span>'; }
  // share of the loading that reached each step: a thin bar under the numbers
  function bar(r) { var base = Math.max(+r.loading || 0, +r.order || 0); if (!base) return ''; var w = function (v) { return Math.max(0, Math.min(100, Math.round((+v || 0) * 100 / base))); };
    return '<div class="pm-bar"><i style="width:' + w(r.stitched) + '%"></i><i class="pk" style="width:' + w(r.packed) + '%"></i><i class="sh" style="width:' + w(r.shipped) + '%"></i></div>'; }

  function render() {
    var q = P.q.trim().toUpperCase();
    var rows = P.rows.filter(function (r) { return !q || (r.srn + ' ' + r.style + ' ' + r.buyer).toUpperCase().indexOf(q) >= 0; });
    // a search also brings shipped SRNs (from the server), after the open ones
    if (q && P.fq === q) P.found.forEach(function (f) { if (!rows.some(function (r) { return r.srn === f.srn; })) rows.push(f); });
    var html = '<input id="pm-q" class="pm-q" type="search" inputmode="search" placeholder="Search SRN (e.g. 630) / style" value="' + esc(P.q) + '">';
    html += '<div class="pm-sub">' + (q ? rows.length + ' found' + (P.fq !== q && q.length >= 2 ? ' · looking in shipped…' : '') : P.rows.length + ' open SRN (not shipped) · search finds shipped ones too') + (P.err ? ' · <span style="color:var(--bad)">unloading not available</span>' : '') + '</div>';
    if (!rows.length) html += '<div class="empty">' + (q ? (P.fq === q ? 'No SRN found' : 'Searching…') : 'No open SRN') + '</div>';
    // one row per SRN: a plain table (tap a row: its day-wise report)
    var num = function (v, bad) { return '<td class="' + (bad ? 'bad' : '') + (+v ? '' : ' z') + '">' + (+v ? n(v) : '–') + '</td>'; };
    if (rows.length) html += '<div class="pm-tw"><table class="pm-t"><thead><tr><th class="s">SRN</th><th>Load</th><th>Stitch</th><th>End</th><th>Pack</th><th>Unload</th><th>Ship</th></tr></thead><tbody>' +
      rows.slice(0, 400).map(function (r) {
        var sub = [r.buyer, r.style].filter(Boolean).join(' · ');
        return '<tr data-rep="' + esc(r.srn) + '" class="' + (r.isShipped ? 'shipped' : '') + '"><td class="s"><b>' + esc(r.srn.replace(/^SRN/, '')) + '</b>' + (r.isShipped ? '<i class="ok">shipped</i>' : '') +
          (r.order ? '<em>' + n(r.order) + '</em>' : '') + (sub ? '<small>' + esc(sub) + '</small>' : '') +
          (r.contractor ? '<small class="ct">Contractor ' + n(r.contractor) + '</small>' : '') + '</td>' +
          num(r.loading) + num(r.stitched, r.stitched > r.loading - (r.contractor || 0)) + num(r.endPass, r.endPass > r.stitched) +
          num(r.packed, r.packed > r.endPass + (r.contractor || 0)) + num(r.unloaded) + num(r.shipped) + '</tr>';
      }).join('') + '</tbody></table></div>' +
      '<p class="pm-note">Grey number next to the SRN = order qty · red = more than the step before it · contractor stitching / endline is not reported · tap a row for its day-wise report</p>';
    $('#mpms-body').innerHTML = html;
    var inp = $('#pm-q');
    inp.addEventListener('input', function () { P.q = inp.value; var pos = inp.selectionStart; render(); var i2 = $('#pm-q'); i2.focus(); try { i2.setSelectionRange(pos, pos); } catch (e) {} find(); });
  }

  // tap an SRN: its day-wise report (Report tab)
  $('#tab-mpms').addEventListener('click', function (e) { var c = e.target.closest('[data-rep]'); if (c && S.openSrnReport) S.openSrnReport(c.dataset.rep); });
  // shipped SRNs come from the server when searching (2+ characters), a moment after typing stops
  var findT = null;
  function find() {
    clearTimeout(findT); var q = P.q.trim().toUpperCase(); if (q.length < 2) return;
    findT = setTimeout(function () {
      S.api('m.pmsFind', { factory: state.factory, q: q }, { quiet: true, silent: true }).then(function (r) {
        if (P.q.trim().toUpperCase() !== q) return;
        P.found = r.rows || []; P.fq = q;
        var a = document.activeElement, typing = a && a.id === 'pm-q', pos = typing ? a.selectionStart : 0;
        render(); if (typing) { var i = $('#pm-q'); i.focus(); try { i.setSelectionRange(pos, pos); } catch (e) {} }
      }).catch(function () {});
    }, 350);
  }
  $('#tab-mpms').addEventListener('click', function (e) { if (e.target.closest('[data-reload]')) { $('#mpms-body').innerHTML = '<div class="empty">Loading…</div>'; S.pd.load(false, true).catch(fail); } });
})();
