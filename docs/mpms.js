// mpms.js — phone "PMS" tab: every unshipped SRN of the factory with loading · stitching · endline pass · pack · unloading · shipped,
// so the recorder can see how much is left before filling output. Read-only.
(function () {
  'use strict';
  var S = window.SG, $ = S.$, esc = S.esc, api = S.api, state = S.state;
  var P = { rows: null, q: '', fac: '' };

  // data comes from the phone store (phone.js): drawn at once, fetched only when missing / old / after a save
  function apply(r) {
    var a = document.activeElement, typing = a && a.id === 'pm-q', pos = typing ? a.selectionStart : 0;
    P.rows = r.rows || []; P.err = r.unloadError || ''; render();
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
    var html = '<input id="pm-q" class="pm-q" type="search" inputmode="search" placeholder="Search SRN / style" value="' + esc(P.q) + '">';
    html += '<div class="pm-sub">' + rows.length + ' SRN · only unshipped' + (P.err ? ' · <span style="color:var(--bad)">unloading not available</span>' : '') + '</div>';
    if (!rows.length) html += '<div class="empty">' + (q ? 'No SRN found' : 'No unshipped SRN') + '</div>';
    html += rows.slice(0, 300).map(function (r) {
      return '<div class="pm-card"><div class="pm-h"><b>' + esc(r.srn) + '</b>' + (r.style || r.buyer ? '<span class="pm-s">' + esc([r.buyer, r.style].filter(Boolean).join(' · ')) + '</span>' : '<span class="pm-s"></span>') + (r.order ? '<span class="pm-o">Order <b>' + n(r.order) + '</b></span>' : '') + '</div>' +
        '<div class="pm-g">' + cell('Load', r.loading) + cell('Stitch', r.stitched, r.stitched > r.loading - (r.contractor || 0)) + cell('Endline', r.endPass, r.endPass > r.stitched) +
        cell('Pack', r.packed, r.packed > r.endPass + (r.contractor || 0)) + cell('Unload', r.unloaded) + cell('Ship', r.shipped) + '</div>' + bar(r) +
        (r.contractor ? '<div class="pm-ct"><span>Contractor' + (r.contractors ? ' · ' + esc(r.contractors) : '') + ' <i>(stitch / endline not reported)</i></span><b>' + n(r.contractor) + '</b></div>' : '') + '</div>';
    }).join('');
    $('#mpms-body').innerHTML = html;
    var inp = $('#pm-q');
    inp.addEventListener('input', function () { P.q = inp.value; var pos = inp.selectionStart; render(); var i2 = $('#pm-q'); i2.focus(); try { i2.setSelectionRange(pos, pos); } catch (e) {} });
  }

  $('#tab-mpms').addEventListener('click', function (e) { if (e.target.closest('[data-reload]')) { $('#mpms-body').innerHTML = '<div class="empty">Loading…</div>'; S.pd.load(false, true).catch(fail); } });
})();
