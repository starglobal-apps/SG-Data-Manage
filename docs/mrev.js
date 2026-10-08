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
        (it.reason ? '<div class="m" style="color:var(--text)">Reason: ' + esc(it.reason) + '</div>' : '') +
        '<div class="m">by ' + esc(it.by) + (it.at ? ' · ' + esc(String(it.at).slice(0, 16)) : '') + '</div>' +
        it.flags.map(function (f) { return '<div class="m rv-flag ' + f.level + '">⚠ ' + esc(f.msg) + '</div>'; }).join('') +
        '<div class="rv-acts"><button class="btn small ghost" data-rv="' + esc(it.id) + '">Review</button><button class="btn small danger" data-rej="' + esc(it.id) + '">Reject</button><button class="btn small ok" data-ok="' + esc(it.id) + '"' + (block ? ' data-block="1"' : '') + '>Approve</button></div></div>';
    });
    $('#mrev-body').innerHTML = html;
  }
  function decide(ids, decision, remark, reasons) {
    if (R.busy) return; R.busy = true;
    api('m.reviewDecide', { ids: ids, decision: decision, remark: remark || '', reasons: reasons || {} }, { busy: true })
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
  // ---- Review: "Making Output Report" of the line + SRN (main sheet days + output waiting here + loading challans).
  // More than one page (15 rows): the first row carries forward the older days. Output below plan: optional reason.
  function n(v) { return v === '' || v === null || v === undefined ? '' : (Math.round(+v * 10) / 10).toLocaleString('en-IN'); }
  function report(id) {
    S.sheet.open('Making Output Report', '<div class="empty">Loading report…</div>');
    api('m.reviewReport', { id: id }, { quiet: true }).then(function (r) { drawReport(r, id); })
      .catch(function (e) { $('#sheet-content').innerHTML = '<div class="empty">' + esc(e.message) + '</div>'; });
  }
  function drawReport(r, id) {
    var h = r.head, mine = {}; R.items.forEach(function (x) { mine[x.id] = x; });
    var cell = function (v, cls) { return '<td' + (cls ? ' class="' + cls + '"' : '') + '>' + v + '</td>'; };
    var html = '<div class="mor"><table class="mor-t"><tr><th colspan="2">Factory</th><td colspan="9">' + esc(h.factory) + '</td><th colspan="3">Incharge</th><td colspan="3">' + esc(h.incharge) + '</td></tr>' +
      '<tr><th colspan="2">SRN</th><td colspan="9">' + esc(h.srn) + '</td><th colspan="3">Supervisor</th><td colspan="3">' + esc(h.supervisor) + '</td></tr>' +
      '<tr><th colspan="2">Line</th><td colspan="9">' + esc(S.shortLine(h.line)) + '</td><th colspan="3">Junior supervisor</th><td colspan="3">' + esc(h.junior) + '</td></tr>' +
      '<tr class="mor-g"><th colspan="7">Output detail</th><th colspan="7">Manpower detail</th><th colspan="3">Loading details</th></tr>' +
      '<tr class="mor-h"><th>Date</th><th>Operation</th><th>Plan output</th><th>Actual output</th><th>Total act output</th><th>Variance (plan − actual)</th><th>Remark / reason</th>' +
      '<th>Operator</th><th>Helper</th><th>Paster</th><th>Endline QC</th><th>Thread cutter</th><th>Hand needle</th><th>Working hour</th><th>Challan no.</th><th>Loading qty</th><th>Total loading qty</th></tr>';
    if (r.carry) html += '<tr class="mor-cf">' + cell('') + cell('Carry forward (' + r.carry.days + ' days)') + cell(n(r.carry.plan)) + cell(n(r.carry.actual)) + cell(n(r.carry.total)) + cell(n(r.carry.variance)) + cell('') +
      cell('') + cell('') + cell('') + cell('') + cell('') + cell('') + cell('') + cell('') + cell(n(r.carry.load)) + cell(n(r.carry.loadTotal)) + '</tr>';
    r.rows.forEach(function (x) {
      var pend = x.id && mine[x.id], low = pend && x.plan !== '' && +x.actual < +x.plan;
      var why = low ? '<input class="mor-why" data-why="' + esc(x.id) + '" placeholder="Reason (optional)" value="' + esc(x.remark || '') + '">' : esc(x.remark || '');
      html += '<tr class="' + (pend ? 'mor-pend' : x.src === 'app' ? 'mor-app' : '') + '">' + cell(esc(x.date ? S.fmtDay(x.date) : '')) + cell(x.shift === 'OT' ? 'OT' : x.shift ? 'Shift' : '') +
        cell(n(x.plan)) + cell(x.src === 'loading' ? '' : n(x.actual)) + cell(n(x.total)) + cell(n(x.variance), x.variance > 0 ? 'bad' : '') + cell(why) +
        cell(n(x.op)) + cell(n(x.r1)) + cell(n(x.r2)) + cell(n(x.r4)) + cell(n(x.r3)) + cell(n(x.r5)) + cell(n(x.hours)) + cell(esc(x.challan || '')) + cell(n(x.load)) + cell(n(x.loadTotal)) + '</tr>';
    });
    html += '</table></div><p class="hint" style="margin:6px 0">Highlighted row = waiting for approval' + (r.rows.some(function (x) { return x.src === 'app' && !(x.id && mine[x.id]); }) ? ' · light rows = in the app, not in the main sheet yet' : '') + '</p>';
    if (mine[id]) html += '<div class="tr-acts"><button class="btn danger" data-rrej="' + esc(id) + '">Reject</button><button class="btn ok" data-rok="' + esc(id) + '">Approve</button></div>';
    $('#sheet-content').innerHTML = html;
    $('#sheet-content').onclick = function (e) {
      var b = e.target.closest('button'); if (!b) return;
      var reasons = {}; S.$$('.mor-why', $('#sheet-content')).forEach(function (i) { if (i.value.trim()) reasons[i.dataset.why] = i.value.trim(); });
      if (b.dataset.rok) {
        var it = mine[b.dataset.rok], block = it && it.flags.some(function (f) { return f.level === 'block'; });
        if (block) { S.askText('This has a loading alert. Why approve it?', { ok: 'Approve' }).then(function (v) { if (v) { S.sheet.close(); decide([b.dataset.rok], 'approve', v, reasons); } }); return; }
        S.sheet.close(); decide([b.dataset.rok], 'approve', '', reasons); return;
      }
      if (b.dataset.rrej) { var rid = b.dataset.rrej; S.askText('Reject reason (the recorder sees it):', { ok: 'Reject' }).then(function (v) { if (v) decide([rid], 'reject', v); }); }
    };
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
    if (b.dataset.rv) { report(b.dataset.rv); return; }
    if (b.dataset.rej) { S.askText('Reject reason (the recorder sees it):', { ok: 'Reject' }).then(function (v) { if (v) decide([b.dataset.rej], 'reject', v); }); }
  });
})();
