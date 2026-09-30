// mpms.js — phone "PMS" tab: every unshipped SRN of the factory with loading · stitching · endline pass · pack · unloading · shipped,
// so the recorder can see how much is left before filling output. Read-only.
(function () {
  'use strict';
  var S = window.SG, $ = S.$, esc = S.esc, api = S.api, state = S.state;
  var P = { rows: null, q: '', fac: '' };

  S.tabs.mpms = function () {
    if (P.fac !== state.factory) { P.rows = null; P.fac = state.factory; }
    if (P.rows) render(); else $('#mpms-body').innerHTML = '<div class="empty">PMS data aa raha hai…</div>';
    api('m.pms', { factory: state.factory }, { quiet: true })
      .then(function (r) { P.rows = r.rows || []; P.err = r.unloadError || ''; render(); })
      .catch(function (e) { if (!P.rows) $('#mpms-body').innerHTML = '<div class="empty">' + esc(e.message) + '<br><button class="btn primary" data-reload="1" style="margin-top:10px">Dobara try</button></div>'; });
  };

  function n(v) { return (Math.round(+v || 0)).toLocaleString('en-IN'); }
  function cell(label, v, warn) { return '<span class="pm-c' + (warn ? ' warn' : '') + '"><small>' + label + '</small><b>' + n(v) + '</b></span>'; }

  function render() {
    var q = P.q.trim().toUpperCase();
    var rows = P.rows.filter(function (r) { return !q || (r.srn + ' ' + r.style + ' ' + r.buyer).toUpperCase().indexOf(q) >= 0; });
    var html = '<input id="pm-q" class="pm-q" type="search" inputmode="search" placeholder="SRN / style dhoondo" value="' + esc(P.q) + '">';
    html += '<div class="pm-sub">' + rows.length + ' SRN · sirf jo ship nahi hue' + (P.err ? ' · <span style="color:var(--bad)">unloading nahi mila</span>' : '') + '</div>';
    if (!rows.length) html += '<div class="empty">' + (q ? 'Koi SRN nahi mila' : 'Koi unshipped SRN nahi') + '</div>';
    html += rows.slice(0, 300).map(function (r) {
      return '<div class="pm-card"><div class="pm-h"><b>' + esc(r.srn) + '</b>' + (r.order ? '<span>order ' + n(r.order) + '</span>' : '') + '</div>' +
        (r.style || r.buyer ? '<div class="pm-s">' + esc([r.buyer, r.style].filter(Boolean).join(' · ')) + '</div>' : '') +
        '<div class="pm-g">' + cell('Loading', r.loading) + cell('Stitching', r.stitched, r.stitched > r.loading - (r.contractor || 0)) + cell('Endline pass', r.endPass, r.endPass > r.stitched) +
        cell('Pack', r.packed, r.packed > r.endPass + (r.contractor || 0)) + cell('Unloading', r.unloaded) + cell('Shipped', r.shipped) + '</div>' +
        (r.contractor ? '<div class="pm-ct"><span>Contractor par load' + (r.contractors ? ' · ' + esc(r.contractors) : '') + '</span><b>' + n(r.contractor) + '</b></div>' +
          '<div class="pm-s" style="white-space:normal">Contractor ka stitching / endline nahi aata — sirf pack aur unloading</div>' : '') + '</div>';
    }).join('');
    $('#mpms-body').innerHTML = html;
    var inp = $('#pm-q');
    inp.addEventListener('input', function () { P.q = inp.value; var pos = inp.selectionStart; render(); var i2 = $('#pm-q'); i2.focus(); try { i2.setSelectionRange(pos, pos); } catch (e) {} });
  }

  $('#tab-mpms').addEventListener('click', function (e) { if (e.target.closest('[data-reload]')) S.tabs.mpms(); });
})();
