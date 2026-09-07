// defects.js — endline defect picker. Fixed defects (every SRN) + SRN-wise defects from the QMS 'Defect validation' sheet.
// Used wherever endline reject is entered (hour screen, quick entry, Data tab edit). Selection = [{d, n}], total must equal reject.
// Counts change in place (no re-render), so the list never jumps back to the top while tapping + / −; the count can also be typed.
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
  function short(d) { return String(d).split('/')[0].trim(); }   // English part; Hindi after '/'

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
    function selList() { return Object.keys(sel).map(function (k) { return { d: k, n: sel[k] }; }); }
    function render(d) {
      var list = items(d);
      var html = '<div class="def-head"><span>Reject <b>' + need + '</b> · chune <b id="def-tot">0</b> / ' + need + '</span><span class="muted" style="font-size:12px">+ / − ya number likho</span></div>';
      html += '<div class="def-list">' + list.map(function (x) {
        return '<div class="def-row" data-d="' + esc(x.d) + '"><span class="n">' + esc(short(x.d)) + (x.kind === 'srn' ? ' <small class="tag">' + esc(srn) + '</small>' : '') + (x.d.indexOf('/') > 0 ? '<small class="hi">' + esc(x.d.split('/').slice(1).join('/')) + '</small>' : '') + '</span>' +
          '<span class="step"><button type="button" data-dec="1">−</button><input class="def-n" type="number" inputmode="numeric" min="0" placeholder="0"><button type="button" data-inc="1">+</button></span></div>';
      }).join('') + '</div>';
      html += '<button class="lnk" data-new="1">+ naya defect (sirf ' + esc(srn) + ' ke liye)</button>';
      html += '<button class="btn primary big" id="def-done">Done</button>';
      $('#sheet-content').innerHTML = html;
      Object.keys(sel).forEach(function (k) { setRow(k, sel[k]); });
      sync();
      bind(d);
    }
    function rowOf(k) { return $$('#sheet-content .def-row').filter(function (r) { return r.dataset.d === k; })[0]; }
    function setRow(k, n) {
      var row = rowOf(k); if (!row) return;
      var inp = $('.def-n', row); if (inp && document.activeElement !== inp) inp.value = n || '';
      row.classList.toggle('on', n > 0);
    }
    function sync() {
      var t = total(), done = $('#def-done');
      $('#def-tot').textContent = t;
      done.disabled = t !== need;
      done.textContent = t === need ? 'Done' : (t < need ? (need - t) + ' aur chuno' : (t - need) + ' zyada — kam karo');
    }
    function setCount(k, n) { n = Math.max(0, Math.round(n)); if (n) sel[k] = n; else delete sel[k]; setRow(k, n); sync(); }
    function bind(d) {
      var c = $('#sheet-content');
      c.onclick = function (e) {
        var b = e.target.closest('button'); if (!b) return;
        if (b.id === 'def-done') { var out = selList(); S.sheet.close(); o.onDone && o.onDone(out); return; }
        if (b.dataset.new) {
          S.askText('Naya defect (' + srn + ')', { ok: 'Add' }).then(function (name) {
            if (!name) return; name = name.trim();
            api('defects.add', { srn: srn, defect: name, kind: 'endline' }).then(function () { sel[name] = (sel[name] || 0) + 1; return master(true); })
              .then(function () { S.defectPicker({ srn: srn, reject: need, value: selList(), onDone: o.onDone }); })
              .catch(function (er) { toast(er.message, 'bad'); });
          });
          return;
        }
        var row = e.target.closest('.def-row'); if (!row) return;
        var k = row.dataset.d, cur = sel[k] || 0;
        if (b.dataset.dec) setCount(k, cur - 1);
        else if (b.dataset.inc) { if (total() >= need) { toast('Reject ' + need + ' hi hai — pehle kisi aur ko kam karo', ''); return; } setCount(k, cur + 1); }
      };
      c.oninput = function (e) {
        var inp = e.target.closest('.def-n'); if (!inp) return;
        var row = inp.closest('.def-row'); setCount(row.dataset.d, num(inp.value));
      };
    }
  };
})();
