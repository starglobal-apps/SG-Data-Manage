// defects.js — endline defect picker. Fixed defects (every SRN) + SRN-wise defects from the QMS 'Defect validation' sheet.
// Used wherever endline reject is entered (hour screen, quick entry, Data tab edit). Selection = [{d, n}], total must equal reject.
(function () {
  'use strict';
  var S = window.SG, $ = S.$, $$ = S.$$, esc = S.esc, api = S.api, toast = S.toast;
  var M = { data: null, t: 0 };
  function num(v) { var n = Number(v); return isNaN(n) ? 0 : n; }
  function master(force) {
    if (!force && M.data && Date.now() - M.t < 10 * 60000) return Promise.resolve(M.data);
    return api('defects.list', {}, { quiet: true }).then(function (d) { M.data = d; M.t = Date.now(); return d; });
  }
  S.defectTotal = function (list) { var t = 0; (list || []).forEach(function (x) { t += num(x.n); }); return t; };
  // short label: English part before '/' (the sheet keeps Hindi after it)
  function short(d) { return String(d).split('/')[0].trim(); }

  // o = { srn, reject, value: [{d,n}], onDone: fn(list) }
  S.defectPicker = function (o) {
    var srn = String(o.srn || '').toUpperCase(), need = num(o.reject), sel = {};
    (o.value || []).forEach(function (x) { if (x && x.d && num(x.n) > 0) sel[x.d] = num(x.n); });
    S.sheet.open(esc(srn) + ' · defect chuno', '<div class="empty">Defect list…</div>');
    master().then(render).catch(function (e) { $('#sheet-content').innerHTML = '<div class="empty">' + esc(e.message) + '</div>'; });

    function items(d) {
      var list = (d.fixed || []).map(function (x) { return { d: x, kind: 'fixed' }; });
      ((d.endline || {})[srn] || []).forEach(function (x) { if (!list.some(function (y) { return y.d === x; })) list.push({ d: x, kind: 'srn' }); });
      Object.keys(sel).forEach(function (x) { if (!list.some(function (y) { return y.d === x; })) list.push({ d: x, kind: 'srn' }); });
      return list;
    }
    function total() { var t = 0; Object.keys(sel).forEach(function (k) { t += sel[k]; }); return t; }
    function render(d) {
      var list = items(d), t = total();
      var html = '<div class="def-head"><span>Reject <b>' + need + '</b> · chune <b id="def-tot">' + t + '</b> / ' + need + '</span><span class="muted" style="font-size:12px">tap = +1 · − se hatao</span></div>';
      html += '<div class="def-list">' + list.map(function (x) {
        var n = sel[x.d] || 0;
        return '<div class="def-row' + (n ? ' on' : '') + '" data-d="' + esc(x.d) + '"><span class="n">' + esc(short(x.d)) + (x.kind === 'srn' ? ' <small class="tag">' + esc(srn) + '</small>' : '') + (x.d.indexOf('/') > 0 ? '<small class="hi">' + esc(x.d.split('/').slice(1).join('/')) + '</small>' : '') + '</span>' +
          '<span class="step"><button type="button" data-dec="1">−</button><b>' + n + '</b><button type="button" data-inc="1">+</button></span></div>';
      }).join('') + '</div>';
      html += '<button class="lnk" data-new="1">+ naya defect (sirf ' + esc(srn) + ' ke liye)</button>';
      html += '<button class="btn primary big" id="def-done"' + (t === need ? '' : ' disabled') + '>' + (t === need ? 'Done' : (t < need ? (need - t) + ' aur chuno' : (t - need) + ' zyada — kam karo')) + '</button>';
      $('#sheet-content').innerHTML = html;
      bind(d);
    }
    function bind(d) {
      var c = $('#sheet-content');
      c.onclick = function (e) {
        var b = e.target.closest('button');
        if (b && b.id === 'def-done') { var out = Object.keys(sel).map(function (k) { return { d: k, n: sel[k] }; }); S.sheet.close(); o.onDone && o.onDone(out); return; }
        if (b && b.dataset.new) {
          S.askText('Naya defect (' + srn + ')', { ok: 'Add' }).then(function (name) {
            if (!name) return;
            api('defects.add', { srn: srn, defect: name.trim(), kind: 'endline' }).then(function () { sel[name.trim()] = (sel[name.trim()] || 0) + 1; return master(true); }).then(function () { S.defectPicker({ srn: srn, reject: need, value: Object.keys(sel).map(function (k) { return { d: k, n: sel[k] }; }), onDone: o.onDone }); }).catch(function (er) { toast(er.message, 'bad'); });
          });
          return;
        }
        var row = e.target.closest('.def-row'); if (!row) return;
        var k = row.dataset.d, cur = sel[k] || 0;
        if (b && b.dataset.dec) cur = Math.max(0, cur - 1);
        else if (total() >= need) { toast('Reject ' + need + ' hi hai — pehle kisi aur ko kam karo', ''); return; }
        else cur += 1;
        if (cur) sel[k] = cur; else delete sel[k];
        render(d);
      };
    }
  };
})();
