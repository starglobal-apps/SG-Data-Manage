// mrev.js — phone "Approve" tab (admin only): output the recorders saved, waiting for approval. Approve = approved and
// written to the main sheet at once; Reject asks a reason and the line goes back to that recorder's pending list.
// Data comes with the phone store (m.all -> rev), so it opens without loading.
(function () {
  'use strict';
  var S = window.SG, $ = S.$, esc = S.esc, api = S.api, state = S.state, toast = S.toast;
  var R = { items: [], busy: false };

  function apply(r) { R.items = r.items || []; badge(); render(); }
  function badge() {
    var b = $('#nav button[data-tab="mrev"]'); if (!b) return;
    var dot = b.querySelector('.nav-dot'), n = R.items.length;
    if (!n) { if (dot) dot.remove(); return; }
    if (!dot) { dot = document.createElement('i'); dot.className = 'nav-dot'; b.appendChild(dot); }
    dot.textContent = n;
  }
  S.revBadge = function (d) { if (d && d.rev && d.rev.items) { R.items = d.rev.items; badge(); } };
  S.tabs.mrev = function () {
    var d = S.pd.need();
    if (d && d.rev && d.rev.ok !== false) apply(d.rev);
    else if (d && d.rev) $('#mrev-body').innerHTML = '<div class="empty">' + esc(d.rev.message || 'Error') + '</div>';
    else $('#mrev-body').innerHTML = '<div class="empty">Loading…</div>';
  };
  S.pdRender.mrev = function () { var d = S.pd.get(); if (d && d.rev && d.rev.ok !== false) apply(d.rev); };
  S.pdFail.mrev = function (e) { $('#mrev-body').innerHTML = '<div class="empty">' + esc(e.message) + '</div>'; };

  function shLabel(sh) { return sh === 'OT' ? 'OT' : sh === 'Night' ? 'Night' : 'Shift'; }
  function render() {
    if (!R.items.length) { $('#mrev-body').innerHTML = '<div class="empty">✓ Nothing waiting for approval</div>'; return; }
    var html = '<button class="btn ok big" data-all="1" style="margin:0 0 10px">Approve all · ' + R.items.length + '</button>', last = '';
    R.items.forEach(function (it) {
      if (it.date !== last) { last = it.date; html += '<h2 class="mo-date">' + esc(S.fmtDay(it.date)) + '</h2>'; }
      var block = it.flags.filter(function (f) { return f.level === 'block'; }).length;
      html += '<div class="card rv-card">' +
        '<div class="rv-h"><b>' + esc(S.shortLine(it.dept)) + '</b> <em class="ot">' + shLabel(it.shift) + ' ' + esc(it.type === 'STITCH' ? 'output' : it.type.toLowerCase()) + '</em><span class="rv-q">' + it.qty + ' <small>pcs</small></span></div>' +
        '<div class="m">' + esc(it.srn) + (it.manpower ? ' · ' + it.manpower + ' people' : '') + (it.hours ? ' · ' + it.hours + ' hrs' : '') + (it.plan !== '' ? ' · plan ' + it.plan : '') + '</div>' +
        '<div class="m">by ' + esc(it.by) + (it.at ? ' · ' + esc(String(it.at).slice(0, 16)) : '') + '</div>' +
        it.flags.map(function (f) { return '<div class="m rv-flag ' + f.level + '">⚠ ' + esc(f.msg) + '</div>'; }).join('') +
        '<div class="tr-acts"><button class="btn small danger" data-rej="' + esc(it.id) + '">Reject</button><button class="btn small ok" data-ok="' + esc(it.id) + '"' + (block ? ' data-block="1"' : '') + '>Approve</button></div></div>';
    });
    $('#mrev-body').innerHTML = html;
  }
  function decide(ids, decision, remark) {
    if (R.busy) return; R.busy = true;
    api('m.reviewDecide', { ids: ids, decision: decision, remark: remark || '' }, { busy: true })
      .then(function (r) {
        R.busy = false;
        R.items = R.items.filter(function (x) { return ids.indexOf(x.id) < 0; }); badge(); render();
        var msg = decision === 'approve' ? (r.sent || r.approved) + ' approved · in main sheet' : 'Sent back to the recorder';
        if (r.skipped && r.skipped.length) toast(msg + ' · skipped: ' + r.skipped.join('; '), 'bad', 9000);
        else if (r.sendError) toast('Approved, but main sheet not written: ' + r.sendError, 'bad', 9000);
        else toast(msg + ' ✓', 'ok');
        S.pd.dirty = true; S.pd.load(true).catch(function () {});
      })
      .catch(function (e) { R.busy = false; toast(e.message, 'bad', 7000); });
  }
  $('#mrev-body').addEventListener('click', function (e) {
    var b = e.target.closest('button'); if (!b) return;
    if (b.dataset.all) {
      var blocked = R.items.filter(function (x) { return x.flags.some(function (f) { return f.level === 'block'; }); }).length;
      S.ask('Approve all ' + R.items.length + ' and write them to the main sheet?' + (blocked ? ' (' + blocked + ' with a loading alert are approved too)' : ''), { ok: 'Approve all', cancel: 'Cancel' })
        .then(function (ok) { if (ok) decide(R.items.map(function (x) { return x.id; }), 'approve', blocked ? 'Approved all on phone' : ''); });
      return;
    }
    if (b.dataset.ok) {
      if (b.dataset.block) { S.askText('This has a loading alert. Why approve it?', { ok: 'Approve' }).then(function (v) { if (v) decide([b.dataset.ok], 'approve', v); }); return; }
      decide([b.dataset.ok], 'approve'); return;
    }
    if (b.dataset.rej) { S.askText('Reject reason (the recorder sees it):', { ok: 'Reject' }).then(function (v) { if (v) decide([b.dataset.rej], 'reject', v); }); }
  });
})();
