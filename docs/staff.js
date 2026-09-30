// staff.js — Staff names: Supervisor / Incharge / Endline QC. Anyone can add; a name can be hidden (✕).
(function () {
  'use strict';
  var S = window.SG, $ = S.$, esc = S.esc, api = S.api, toast = S.toast;
  var D = { data: null };
  var KINDS = [{ k: 'Supervisor', key: 'supervisors', hint: 'Line ka supervisor', en: 'Supervisor of the line' }, { k: 'Incharge', key: 'incharges', hint: 'Line / floor ka incharge', en: 'Incharge of the line / floor' }, { k: 'Endline QC', key: 'qcs', hint: 'Endline checker (QC)', en: 'Endline checker (QC)' }];

  S.screens.staff = function () {
    S.push('staff', 'Staff names');
    $('#staff-body').innerHTML = '<div class="empty">Loading…</div>';
    load();
  };
  function load() {
    api('staff.list', {}, { quiet: true }).then(function (d) { D.data = d; render(); }).catch(function (e) { $('#staff-body').innerHTML = '<div class="empty">' + esc(e.message) + '</div>'; });
  }
  function render() {
    var d = D.data, html = '<p class="hint" style="margin:0 0 6px">' + S.tx('Ye naam attendance (Supervisor / Incharge / Endline QC) aur reports me aate hain. Ek naam kai lines par chal sakta hai.', 'These names are used in attendance (Supervisor / Incharge / Endline QC) and reports. One name can be on many lines.') + '</p>';
    KINDS.forEach(function (kd) {
      var list = d[kd.key] || [];
      html += '<div class="card"><h2 style="margin:0 0 4px">' + esc(kd.k) + ' <span class="muted" style="font-weight:500;text-transform:none;letter-spacing:0">· ' + list.length + '</span></h2><div class="hint" style="margin:0 0 6px">' + esc(S.tx(kd.hint, kd.en)) + '</div>' +
        '<div class="chips" style="flex-wrap:wrap">' + list.map(function (n) { return '<button type="button" class="qc" data-rm="' + esc(kd.k) + '|' + esc(n) + '">' + esc(n) + '<span class="x">✕</span></button>'; }).join('') + (list.length ? '' : '<span class="muted" style="font-size:12px">' + S.tx('Koi naam nahi', 'No names') + '</span>') + '</div>' +
        '<div class="staff-add"><input type="text" placeholder="' + S.tx('Naya ' + esc(kd.k) + ' naam', 'New ' + esc(kd.k) + ' name') + '" data-kind="' + esc(kd.k) + '"><button class="btn primary" data-add="' + esc(kd.k) + '">Add</button></div></div>';
    });
    $('#staff-body').innerHTML = html;
  }
  $('#staff-body').addEventListener('click', function (e) {
    var b = e.target.closest('button'); if (!b) return;
    if (b.dataset.add) {
      var inp = $('#staff-body input[data-kind="' + b.dataset.add + '"]'), n = (inp.value || '').trim();
      if (!n) { toast(S.tx('Naam likho', 'Enter a name'), 'bad'); return; }
      api('staff.save', { name: n, kind: b.dataset.add }).then(function () { toast('Add: ' + n, 'ok'); S.invalidateStaff(); load(); }).catch(function (er) { toast(er.message, 'bad'); });
    } else if (b.dataset.rm) {
      var p = b.dataset.rm.split('|');
      S.ask(S.tx(p[1] + ' ko ' + p[0] + ' list se hatayein?', 'Remove ' + p[1] + ' from the ' + p[0] + ' list?'), { danger: true, ok: S.tx('Hatao', 'Remove') }).then(function (ok) { if (ok) api('staff.remove', { name: p[1], kind: p[0] }).then(function () { S.invalidateStaff(); load(); }).catch(function (er) { toast(er.message, 'bad'); }); });
    }
  });
  $('#staff-body').addEventListener('keydown', function (e) { if (e.key === 'Enter' && e.target.dataset.kind) { e.preventDefault(); $('#staff-body button[data-add="' + e.target.dataset.kind + '"]').click(); } });
})();
