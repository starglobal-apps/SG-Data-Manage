// users.js — Admin: users & access. List, add, edit (name, PIN, role, factory, lines / packing floors, active).
(function () {
  'use strict';
  var S = window.SG, $ = S.$, $$ = S.$$, esc = S.esc, api = S.api, state = S.state, toast = S.toast, icon = S.icon;
  var U = { users: [], roles: [] };

  S.screens.users = function () {
    S.push('users', 'Users & access');
    $('#users-list').innerHTML = '<div class="empty">Loading…</div>';
    api('users.list').then(function (d) { U.users = d.users; U.roles = d.roles; render(); }).catch(function (e) { $('#users-list').innerHTML = '<div class="empty">' + esc(e.message) + '</div>'; });
  };

  function render() {
    var html = '<button class="btn primary big" id="user-new" style="margin:0 0 10px">+ Naya user</button>';
    var groups = { Admin: [], Manager: [], Supervisor: [], 'Data Collector': [] };
    U.users.forEach(function (u) { (groups[u.role] = groups[u.role] || []).push(u); });
    Object.keys(groups).forEach(function (role) {
      if (!groups[role].length) return;
      html += '<h2>' + esc(role) + ' (' + groups[role].length + ')</h2>';
      groups[role].forEach(function (u) {
        var access = u.role === 'Admin' ? 'Pura access' : (u.factory ? 'FAC' + u.factory : 'Dono factory') + (u.depts.length ? ' · ' + u.depts.length + ' line/floor' : (u.role === 'Manager' ? ' · sab lines' : ' · koi line nahi'));
        html += '<div class="task' + (u.active ? '' : ' lock') + '" data-uid="' + esc(u.user_id) + '"><div class="ic">' + icon('user') + '</div><div class="b"><div class="n">' + esc(u.name) + (u.active ? '' : ' <span class="pill">Inactive</span>') + '</div><div class="s">' + esc(access) + '</div></div><span class="chev">' + icon('chev') + '</span></div>';
      });
    });
    $('#users-list').innerHTML = html;
  }

  function deptChips(selected) {
    var all = S.M('DEPT'), facs = (state.masters.factories || []);
    var html = '';
    facs.forEach(function (f) {
      var lines = all.filter(function (d) { return d.factory === f && d.extra === 'STITCH'; }), floors = all.filter(function (d) { return d.factory === f && d.extra === 'PACKING'; });
      if (!lines.length && !floors.length) return;
      html += '<label>FAC' + esc(f) + ' · Lines</label><div class="chips" style="flex-wrap:wrap">' + lines.map(function (d) { return '<button type="button" data-dept="' + esc(d.key) + '" class="' + (selected.indexOf(d.key) >= 0 ? 'on' : '') + '">' + esc(S.shortLine(d.key)) + '</button>'; }).join('') + '</div>';
      if (floors.length) html += '<label>FAC' + esc(f) + ' · Packing floors</label><div class="chips" style="flex-wrap:wrap">' + floors.map(function (d) { return '<button type="button" data-dept="' + esc(d.key) + '" class="' + (selected.indexOf(d.key) >= 0 ? 'on' : '') + '">' + esc(S.shortLine(d.key)) + '</button>'; }).join('') + '</div>';
    });
    return html;
  }

  function edit(u) {
    u = u || { user_id: '', name: '', pin: '', role: 'Data Collector', factory: '', depts: [], active: true };
    var html = '<label>Naam (data me yahi save hoga)</label><input id="u-name" type="text" value="' + esc(u.name) + '" placeholder="Jaise: Ramesh Kumar">' +
      '<div class="row"><div class="field"><label>PIN (4–8 digit)</label><input id="u-pin" type="tel" inputmode="numeric" value="' + esc(u.pin) + '" placeholder="123456"></div>' +
      '<div class="field"><label>Role</label><select id="u-role">' + U.roles.map(function (r) { return '<option' + (r === u.role ? ' selected' : '') + '>' + esc(r) + '</option>'; }).join('') + '</select></div></div>' +
      '<label>Factory</label><div class="toggle" id="u-fac"><button type="button" data-f="" class="' + (!u.factory ? 'on' : '') + '">Dono</button>' + (state.masters.factories || []).map(function (f) { return '<button type="button" data-f="' + esc(f) + '" class="' + (u.factory === f ? 'on' : '') + '">FAC' + esc(f) + '</button>'; }).join('') + '</div>' +
      '<div id="u-depts">' + deptChips(u.depts) + '</div>' +
      '<p class="hint">Manager / Admin: line na chuno to sab lines. Recorder: sirf chuni hui lines / floors dikhengi.</p>' +
      '<label class="chk" style="margin-top:8px"><input id="u-active" type="checkbox"' + (u.active ? ' checked' : '') + '> Active (login kar sakta hai)</label>' +
      '<button class="btn primary big" id="u-save">Save</button>';
    S.sheet.open(u.user_id ? 'User edit' : 'Naya user', html);
    var c = $('#sheet-content');
    c.onclick = function (e) {
      var b = e.target.closest('button'); if (!b) return;
      if (b.dataset.f !== undefined) { $$('#u-fac button').forEach(function (x) { x.classList.toggle('on', x === b); }); return; }
      if (b.dataset.dept) { b.classList.toggle('on'); return; }
      if (b.id === 'u-save') {
        var payload = { user_id: u.user_id, name: $('#u-name').value.trim(), pin: $('#u-pin').value.trim(), role: $('#u-role').value,
          factory: ($('#u-fac button.on') || { dataset: { f: '' } }).dataset.f, depts: $$('#u-depts button.on').map(function (x) { return x.dataset.dept; }), active: $('#u-active').checked };
        api('users.save', payload).then(function () { toast('Saved: ' + payload.name, 'ok'); S.sheet.close(); S.screens.users(); }).catch(function (er) { toast(er.message, 'bad', 6000); });
      }
    };
  }

  $('#users-list').addEventListener('click', function (e) {
    if (e.target.id === 'user-new') { edit(null); return; }
    var t = e.target.closest('[data-uid]'); if (!t) return;
    edit(U.users.filter(function (u) { return u.user_id === t.dataset.uid; })[0]);
  });
})();
