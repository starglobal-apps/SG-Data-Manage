// wizard.js — "Ghanta bharo": one slot, one line at a time. Big line name, SRN already chosen, a number pad, Next.
// Stitching lines first, then endline (one step per QC), then packing floors. One Save at the end (hour.save);
// a blocked line comes back red with the reason and a one-tap fix. Used from Aaj (home) and the hours grid.
(function () {
  'use strict';
  var S = window.SG, $ = S.$, $$ = S.$$, esc = S.esc, api = S.api, state = S.state, toast = S.toast, icon = S.icon;
  var W = { slot: '', data: null, steps: [], i: 0, fld: 'qty', startDept: '', saving: false };
  function num(v) { var n = Number(v); return isNaN(n) ? 0 : n; }
  function sum(list) { return S.defectTotal(list); }

  S.screens.wiz = function (slot, startDept) {
    W.slot = slot || W.slot || S.slots('Final')[0].key; W.startDept = startDept || ''; W.i = 0; W.steps = []; W.data = null;
    S.push('wiz', 'Ghanta bharo');
    $('#wiz-body').innerHTML = '<div class="empty">Lines aa rahi hain…</div>';
    api('hour.get', { date: state.date, factory: state.factory, slot: W.slot }, { quiet: true })
      .then(function (d) { W.data = d; build(); if (!W.steps.length) { $('#wiz-body').innerHTML = '<div class="empty">Is ghante ke liye koi line nahi — pehle attendance bharo<br><button class="btn primary" data-go="attlist" style="margin-top:10px">Attendance</button></div>'; return; } render(); })
      .catch(function (e) { $('#wiz-body').innerHTML = '<div class="empty">' + esc(e.message) + '</div>'; });
  };

  function defSrn(d, type, rows) {
    var opts = d.srns[type] || [];
    return (rows[0] && rows[0].srn) || d.lastSrn[type] || d.attSrn || (type !== 'PACKING' && opts[0] ? opts[0].srn : '');
  }
  function build() {
    var steps = [], depts = W.data.depts;
    depts.forEach(function (d) {
      if (d.cat !== 'STITCH' || d.locked.STITCH || d.closed) return;
      var rows = d.rows.STITCH || [];
      if (!rows.length) steps.push({ type: 'STITCH', d: d, srn: defSrn(d, 'STITCH', rows), qty: '', orig: null });
      else rows.forEach(function (r, j) { steps.push({ type: 'STITCH', d: d, srn: r.srn, qty: r.qty ? String(r.qty) : '', orig: r, extra: j > 0 }); });
    });
    depts.forEach(function (d) {
      if (d.cat !== 'STITCH' || d.locked.ENDLINE || d.closed) return;
      var rows = d.rows.ENDLINE || [], qcs = d.qcNames || [];
      if (!qcs.length) { rows.forEach(function (r) { steps.push(endStep(d, r, r.checker)); }); return; }
      var used = {};
      qcs.forEach(function (q) { var r = rows.filter(function (x) { return x.checker === q && !used[x.srn + '|' + x.checker]; })[0]; if (r) used[r.srn + '|' + r.checker] = 1; steps.push(endStep(d, r, q)); });
      rows.forEach(function (r) { if (!used[r.srn + '|' + r.checker]) steps.push(endStep(d, r, r.checker)); });
    });
    depts.forEach(function (d) {
      if (d.cat !== 'PACKING' || d.locked.PACKING || d.closed) return;
      var rows = d.rows.PACKING || [];
      if (!rows.length) steps.push({ type: 'PACKING', d: d, srn: defSrn(d, 'PACKING', rows), qty: '', ctn: '', orig: null });
      else rows.forEach(function (r, j) { steps.push({ type: 'PACKING', d: d, srn: r.srn, qty: r.qty ? String(r.qty) : '', ctn: r.cartons ? String(r.cartons) : '', orig: r, extra: j > 0 }); });
    });
    W.steps = steps;
    if (W.startDept) { var k = steps.findIndex(function (s) { return s.d.dept === W.startDept; }); if (k >= 0) W.i = k; }
    // otherwise start at the first line that has nothing yet
    else { var f = steps.findIndex(function (s) { return !s.orig; }); W.i = f >= 0 ? f : 0; }
    W.fld = W.steps[W.i] && W.steps[W.i].type === 'ENDLINE' ? 'chk' : 'qty';
  }
  function endStep(d, r, checker) {
    r = r || {};
    return { type: 'ENDLINE', d: d, srn: r.srn || defSrn(d, 'ENDLINE', []), chk: r.checked ? String(r.checked) : '', rej: r.reject ? String(r.reject) : '', pass: r.pass || 0, passTouched: false,
             checker: checker || '', defects: r.defects || [], orig: r.srn ? r : null };
  }

  function typeLabel(t) { return t === 'ENDLINE' ? 'Endline' : t === 'PACKING' ? 'Packing' : 'Stitching'; }
  function prevOf(st) { var m = (st.d.prev && st.d.prev[st.type]) || {}; return m[st.srn] || 0; }
  function limitOf(st) { var o = (st.d.srns[st.type] || []).filter(function (x) { return x.srn === st.srn; })[0]; return o ? o : null; }
  function valOf(st) { return st.type === 'ENDLINE' ? (W.fld === 'rej' ? st.rej : st.chk) : (W.fld === 'ctn' ? st.ctn : st.qty); }
  function setVal(st, v) { if (st.type === 'ENDLINE') { if (W.fld === 'rej') st.rej = v; else st.chk = v; if (!st.passTouched) st.pass = Math.max(0, num(st.chk) - num(st.rej)); } else if (W.fld === 'ctn') st.ctn = v; else st.qty = v; }

  function render() {
    var st = W.steps[W.i], n = W.steps.length, sd = S.slotDef(W.slot) || { label: W.slot };
    var typeCount = W.steps.filter(function (s) { return s.type === st.type; }).length, typeIdx = W.steps.slice(0, W.i + 1).filter(function (s) { return s.type === st.type; }).length;
    var html = '<div class="wz-head"><button class="hdr-btn dark" data-wnav="-1" ' + (W.i === 0 ? 'disabled' : '') + '>‹</button><div class="hour-title"><b>' + esc(sd.label) + ' · ' + typeLabel(st.type) + '</b><span>' + esc(S.fmtDay(state.date)) + ' · ' + typeIdx + ' / ' + typeCount + (st.type === 'STITCH' ? ' · phir endline' : '') + '</span></div><button class="hdr-btn dark" data-wnav="1" ' + (W.i >= n - 1 ? 'disabled' : '') + '>›</button></div>';
    html += '<div class="dots">' + W.steps.map(function (s, j) { return '<i class="' + (j === W.i ? 'now' : (s.orig || s.done) ? 'on' : '') + (s.err ? ' bad' : '') + '"></i>'; }).join('') + '</div>';
    var lim = limitOf(st), balTxt = lim && lim.balance !== null && lim.balance !== undefined && lim.balance !== '' ? ' · ' + lim.balance + ' baaki' : '';
    html += '<div class="linebig' + (st.err ? ' bad' : '') + '"><div class="name">' + esc(S.shortLine(st.d.dept)) + (st.extra ? ' <small>dusra SRN</small>' : '') + '</div>' +
      '<button type="button" class="srnchip" data-srn="1">' + (st.srn ? esc(st.srn) + '<small>' + esc(balTxt) + '</small>' : 'SRN chuno') + '</button>' +
      (st.type === 'ENDLINE' ? '<div class="qcname">' + icon('qc') + ' ' + esc(st.checker || 'checker?') + '</div>' : '') +
      '<div class="mpline">' + st.d.mp + ' log is ghante' + (st.d.mp !== st.d.mpBase ? ' <small>(subah ' + st.d.mpBase + ')</small>' : '') + '</div>';
    if (st.type === 'ENDLINE') {
      html += '<div class="two"><div class="fld' + (W.fld === 'chk' ? ' on' : '') + '" data-fld="chk"><div class="k">Checked</div><div class="v">' + (st.chk || '<span class="ph">0</span>') + '</div></div><div class="fld' + (W.fld === 'rej' ? ' on' : '') + '" data-fld="rej"><div class="k">Reject</div><div class="v">' + (st.rej || '<span class="ph">0</span>') + '</div></div></div>' +
        '<div class="fld auto"><div class="k">Pass · apne aap</div><div class="v">' + (num(st.chk) - num(st.rej) >= 0 ? num(st.chk) - num(st.rej) : 0) + '</div></div>';
      if (num(st.rej) > 0) { var dt = sum(st.defects); html += '<button type="button" class="dbtn big' + (dt !== num(st.rej) ? ' need' : '') + '" data-def="1">' + (dt === num(st.rej) ? '✓ Defect ' + dt + '/' + st.rej : 'Defect chuno ' + dt + '/' + st.rej) + '</button>'; }
    } else if (st.type === 'PACKING') {
      html += '<div class="two"><div class="fld' + (W.fld === 'qty' ? ' on' : '') + '" data-fld="qty"><div class="k">Pieces</div><div class="v">' + (st.qty || '<span class="ph">0</span>') + '</div></div><div class="fld' + (W.fld === 'ctn' ? ' on' : '') + '" data-fld="ctn"><div class="k">Cartons</div><div class="v">' + (st.ctn || '<span class="ph">0</span>') + '</div></div></div>';
    } else {
      html += '<div class="num' + (st.qty ? '' : ' empty') + '">' + (st.qty || '0') + '</div><div class="hint">is ghante ka output (pcs)</div>';
    }
    if (st.err) html += '<div class="wz-err">' + esc(st.err) + (st.fix ? '<button type="button" class="lnk" data-fix="' + st.fix + '">' + st.fix + ' kar do</button>' : '') + '</div>';
    html += '</div>';
    var pv = prevOf(st);
    html += '<div class="quick">' + (pv ? '<button type="button" data-q="' + pv + '">Pichhle ghante jaisa · ' + pv + '</button>' : '') + '<button type="button" data-q="0">' + (st.orig ? 'Hatao (0)' : 'Is ghante nahi hua') + '</button></div>';
    html += '<div class="pad">' + [1, 2, 3, 4, 5, 6, 7, 8, 9].map(function (k) { return '<button type="button" data-k="' + k + '">' + k + '</button>'; }).join('') + '<button type="button" class="act" data-k="c">⌫</button><button type="button" data-k="0">0</button><button type="button" class="act go" data-next="1">' + (W.i >= n - 1 ? 'Save ✓' : 'Next ›') + '</button></div>';
    html += '<div class="wz-links"><button class="lnk" data-more="srn">+ dusra SRN is line me</button><button class="lnk" data-more="mp">Koi gaya / aaya</button><button class="lnk" data-more="tr">Transfer</button><button class="lnk" data-more="save">Abhi tak ka save karo</button></div>';
    $('#wiz-body').innerHTML = html;
    window.scrollTo(0, 0);
  }

  function validate(st) {
    if (st.type === 'ENDLINE') {
      if (num(st.chk) > 0 && !st.checker) return 'Checker ka naam nahi — attendance me QC daalo';
      if (num(st.rej) > num(st.chk)) return 'Reject checked se zyada nahi ho sakta';
      if (num(st.rej) > 0 && sum(st.defects) !== num(st.rej)) return st.rej + ' reject → ' + st.rej + ' defect chuno (abhi ' + sum(st.defects) + ')';
    }
    if ((st.type === 'STITCH' && num(st.qty) > 0 || st.type === 'PACKING' && num(st.qty) > 0 || st.type === 'ENDLINE' && num(st.chk) > 0) && !st.srn) return 'SRN chuno';
    if (st.type === 'STITCH') { var lim = limitOf(st); if (lim && lim.limit && num(st.qty) - num(st.orig ? st.orig.qty : 0) > lim.balance) { st.fix = String(Math.max(0, lim.balance + num(st.orig ? st.orig.qty : 0))); return st.srn + ' ki loading me sirf ' + Math.max(0, lim.balance + num(st.orig ? st.orig.qty : 0)) + ' aur ho sakta hai'; } }
    return '';
  }
  function next() {
    var st = W.steps[W.i], err = validate(st);
    if (err) { st.err = err; render(); toast(err, 'bad'); return; }
    st.err = ''; st.fix = ''; st.done = true;
    if (W.i < W.steps.length - 1) { W.i++; W.fld = W.steps[W.i].type === 'ENDLINE' ? 'chk' : 'qty'; render(); }
    else save();
  }
  function itemOf(st) {
    var it = { type: st.type, dept: st.d.dept, srn: st.srn, floor: st.d.floor };
    if (st.type === 'ENDLINE') { it.checked = num(st.chk); it.reject = num(st.rej); it.pass = Math.max(0, it.checked - it.reject); it.checker = st.checker; it.defects = st.defects || []; }
    else { it.qty = num(st.qty); if (st.type === 'PACKING') it.cartons = num(st.ctn); }
    return it;
  }
  function amount(st) { return st.type === 'ENDLINE' ? num(st.chk) : num(st.qty); }
  function changed(st) {
    var o = st.orig;
    if (!o) return amount(st) > 0;
    if (st.srn !== o.srn) return true;
    if (st.type === 'ENDLINE') return num(st.chk) !== num(o.checked) || num(st.rej) !== num(o.reject) || JSON.stringify(st.defects || []) !== JSON.stringify(o.defects || []);
    return num(st.qty) !== num(o.qty) || (st.type === 'PACKING' && num(st.ctn) !== num(o.cartons));
  }
  function save() {
    if (W.saving) return;
    var items = [], bad = null;
    W.steps.forEach(function (st) {
      if (!bad) { var e = validate(st); if (e) { st.err = e; bad = st; } }
      if (!changed(st)) return;
      if (st.orig && st.srn !== st.orig.srn) items.push({ type: st.type, dept: st.d.dept, srn: st.orig.srn, qty: 0, checked: 0, checker: st.type === 'ENDLINE' ? (st.orig.checker || '') : 'x', floor: st.d.floor });
      if (amount(st) > 0) items.push(itemOf(st));
      else if (st.orig) items.push({ type: st.type, dept: st.d.dept, srn: st.orig.srn, qty: 0, checked: 0, checker: st.type === 'ENDLINE' ? (st.orig.checker || '') : 'x', floor: st.d.floor });
    });
    if (bad) { W.i = W.steps.indexOf(bad); render(); toast(bad.err, 'bad'); return; }
    if (!items.length) { toast('Kuch badla nahi — sab pehle se saved', ''); S.invalidateAll(); S.back(); return; }
    W.saving = true; S.busy(true);
    api('hour.save', { date: state.date, factory: state.factory, slot: W.slot, items: items })
      .then(function (d) {
        W.saving = false; S.busy(false); S.invalidateAll(); S.clearLocalCaches();
        var fails = d.results.filter(function (r) { return !r.ok; });
        if (fails.length) {
          fails.forEach(function (f) {
            var st = W.steps.filter(function (s) { return s.d.dept === f.dept && s.type === f.type && s.srn === f.srn; })[0];
            if (!st) return; st.err = f.message; st.done = false;
            if (f.error === 'CHAIN' && f.limit !== undefined && f.used !== undefined) st.fix = String(Math.max(0, num(f.limit) - num(f.used) + num(st.orig ? st.orig.qty : 0)));
          });
          var first = W.steps.filter(function (s) { return s.err; })[0]; W.i = W.steps.indexOf(first); render();
          toast(S.shortLine(fails[0].dept) + ': ' + fails[0].message + (d.saved ? ' · baaki ' + d.saved + ' saved' : ''), 'bad', 8000);
          return;
        }
        var warns = d.results.filter(function (r) { return r.ok && r.warn; });
        toast((d.saved ? 'Saved · ' + d.saved + ' line' + (d.saved > 1 ? 's' : '') : 'Kuch badla nahi') + ' ✓', 'ok');
        if (warns.length) setTimeout(function () { toast('⚠ ' + S.shortLine(warns[0].dept) + ': ' + warns[0].warn, '', 6000); }, 1200);
        S.back();
      })
      .catch(function (e) { W.saving = false; S.busy(false); toast(e.message, 'bad', 6000); });
  }

  function srnSheet(st) {
    var opts = st.d.srns[st.type] || [];
    if (st.type === 'PACKING') {
      S.sheet.open(S.shortLine(st.d.dept) + ' · SRN', '<div id="wz-srnp"></div><p class="hint">Number likho (jaise 611) → SRN chuno</p>');
      S.srnPicker($('#wz-srnp'), { list: opts, value: '', autofocus: true, placeholder: 'SRN number likho…', onPick: function (v) { st.srn = v; S.sheet.close(); render(); } });
      return;
    }
    if (!opts.length) { toast(st.type === 'ENDLINE' ? 'Pehle is line ka stitching output bharo' : 'Is line par loading nahi mili', 'bad'); return; }
    S.sheet.open(S.shortLine(st.d.dept) + ' · SRN chuno', '<div class="chips" style="flex-wrap:wrap">' + opts.map(function (o) { return '<button data-pick="' + esc(o.srn) + '" class="' + (o.srn === st.srn ? 'on' : '') + '">' + esc(o.srn) + '<small>' + (o.balance !== '' && o.balance !== null && o.balance !== undefined ? 'bal ' + o.balance : '') + '</small></button>'; }).join('') + '</div>');
    $('#sheet-content').onclick = function (e) { var b = e.target.closest('[data-pick]'); if (!b) return; st.srn = b.dataset.pick; S.sheet.close(); render(); };
  }

  $('#wiz-body').addEventListener('click', function (e) {
    var st = W.steps[W.i]; if (!st) { var g0 = e.target.closest('[data-go]'); if (g0) S.go(g0.dataset.go); return; }
    var b = e.target.closest('button'); if (!b) { var f0 = e.target.closest('[data-fld]'); if (f0) { W.fld = f0.dataset.fld; render(); } return; }
    if (b.dataset.wnav) { var j = W.i + Number(b.dataset.wnav); if (j >= 0 && j < W.steps.length) { W.i = j; W.fld = W.steps[j].type === 'ENDLINE' ? 'chk' : 'qty'; render(); } return; }
    if (b.dataset.k !== undefined) {
      var v = String(valOf(st) || ''); if (b.dataset.k === 'c') v = v.slice(0, -1); else if (v.length < 6) v = v + b.dataset.k;
      v = v.replace(/^0+(?=\d)/, ''); setVal(st, v); st.err = ''; render(); return;
    }
    if (b.dataset.q !== undefined) { if (st.type === 'ENDLINE') { st.chk = b.dataset.q === '0' ? '' : b.dataset.q; st.rej = ''; st.defects = []; } else st.qty = b.dataset.q === '0' ? '' : b.dataset.q; st.err = ''; render(); return; }
    if (b.dataset.fix) { if (st.type === 'ENDLINE') st.chk = b.dataset.fix; else st.qty = b.dataset.fix; st.err = ''; st.fix = ''; render(); return; }
    if (b.dataset.next) { next(); return; }
    if (b.dataset.srn) { srnSheet(st); return; }
    if (b.dataset.def) { if (!st.srn) { toast('Pehle SRN chuno', 'bad'); return; } S.defectPicker({ srn: st.srn, reject: num(st.rej), value: st.defects, onDone: function (list) { st.defects = list; st.err = ''; render(); } }); return; }
    if (b.dataset.more === 'srn') { var clone = st.type === 'ENDLINE' ? endStep(st.d, null, st.checker) : { type: st.type, d: st.d, srn: '', qty: '', ctn: '', orig: null, extra: true }; clone.extra = true; W.steps.splice(W.i + 1, 0, clone); W.i++; W.fld = clone.type === 'ENDLINE' ? 'chk' : 'qty'; render(); return; }
    if (b.dataset.more === 'mp') { if (S.mpSheet) S.mpSheet(st.d, W.data.depts, function () { S.screens.wiz(W.slot, st.d.dept); }); return; }
    if (b.dataset.more === 'tr') { if (S.trSheet) S.trSheet(st.d, function () { S.screens.wiz(W.slot, st.d.dept); }); return; }
    if (b.dataset.more === 'save') { save(); return; }
  });
})();
