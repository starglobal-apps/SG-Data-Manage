// SG Data Manage API on Cloudflare Workers (same pattern as the Operation Bulletin Worker, separate Worker + D1).
//
// The phone / web app (docs/) talks to this Worker instead of Apps Script directly:
//  - m.all (the phone's big "load everything" call) is answered from D1 at once and refreshed from Apps Script in
//    the background when it is old or when anybody has saved something since (stale-while-revalidate);
//  - every other call (attendance / output saves, approve, edit, transfer, import, ...) goes straight to Apps Script,
//    so all business rules and the Google Sheet stay exactly where they are.
// Request / response format is the Apps Script doPost API: POST {"action": "...", "token": "...", ...} -> {"ok": ...}.

const CACHED_ACTION = 'm.all';
// Calls that only read. Any other call may change data, so it bumps the global data version.
const READ_ACTIONS = new Set([
  'ping', 'login', 'me', 'masters', 'm.all', 'm.att', 'm.out', 'm.pms', 'm.pmsFind', 'm.outDay', 'm.reviewReport', 'm.srnReport', 'm.pdr', 'm.warm',
  'att.get', 'att.status', 'att.prev', 'att.today', 'orders.active', 'hourly.get', 'hourly.day', 'hourly.rows', 'hour.get',
  'factory.today', 'line.today', 'review.count', 'review.list', 'users.recorders', 'users.list', 'staff.list', 'pms.get',
  'report.check', 'report.line', 'report.packing', 'report.srn', 'report.endline', 'target.get', 'defects.list',
  'manpower.get', 'audit.recent', 'push.sub', 'push.unsub', 'push.key', 'push.status', 'push.test',
]);
// D1 limits a value to ~2 MB, so a payload is stored in parts.
const CHUNK = 500000;
const LOCK_MS = 25000;

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Expose-Headers': 'X-Cache, X-Cache-Age',
  'Access-Control-Max-Age': '86400',
};

function reply(text, extra) {
  return new Response(text, { headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...CORS, ...(extra || {}) } });
}

// Same shape as an Apps Script failure, so the app shows it like any other error.
function errorReply(msg, code) {
  return reply(JSON.stringify({ ok: false, error: code || 'BUSY', message: msg }), { 'X-Cache': 'ERROR' });
}

let schemaReady = false;
async function ensureSchema(db) {
  if (schemaReady) return;
  await db.batch([
    db.prepare('CREATE TABLE IF NOT EXISTS payload_cache (k TEXT NOT NULL, part INTEGER NOT NULL, n INTEGER NOT NULL, data TEXT NOT NULL, ver INTEGER NOT NULL, at INTEGER NOT NULL, PRIMARY KEY (k, part))'),
    db.prepare('CREATE TABLE IF NOT EXISTS meta (k TEXT PRIMARY KEY, v INTEGER NOT NULL)'),
    // the last m.all date / factory of each token (hashed), so a save can refresh that user's copy. No token is stored.
    db.prepare('CREATE TABLE IF NOT EXISTS last_view (tk TEXT PRIMARY KEY, date TEXT, factory TEXT, lang TEXT, b TEXT, at INTEGER NOT NULL)'),
    // phone notification addresses (Web Push): one row per phone, linked to the user Apps Script confirmed
    db.prepare('CREATE TABLE IF NOT EXISTS push_subs (endpoint TEXT PRIMARY KEY, user_id TEXT NOT NULL, p256dh TEXT NOT NULL, auth TEXT NOT NULL, at INTEGER NOT NULL)'),
    db.prepare('CREATE INDEX IF NOT EXISTS push_subs_user ON push_subs (user_id)'),
    db.prepare('CREATE TABLE IF NOT EXISTS kv (k TEXT PRIMARY KEY, v TEXT NOT NULL)'),
    // what happened to each notification (admin: Main -> Notifications): status 0 = that user has no phone registered
    db.prepare('CREATE TABLE IF NOT EXISTS push_log (id INTEGER PRIMARY KEY AUTOINCREMENT, at INTEGER NOT NULL, user_id TEXT, title TEXT, status INTEGER, info TEXT)'),
    db.prepare("INSERT OR IGNORE INTO meta (k, v) VALUES ('ver', 1)"),
  ]);
  // last_view made before the build column existed
  await db.prepare('ALTER TABLE last_view ADD COLUMN b TEXT').run().catch(() => {});
  schemaReady = true;
}

async function sha(text) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Sends the request body to Apps Script and returns its JSON text. */
async function upstream(env, bodyText) {
  const r = await fetch(env.APPS_SCRIPT_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain;charset=utf-8' },
    body: bodyText,
    redirect: 'follow',
  });
  const t = await r.text();
  if (!r.ok || t.charAt(0) !== '{') throw new Error('Google server is busy (' + r.status + '). Please try again.');
  return t;
}

/** Only complete payloads are kept: ok, and none of its parts (att / out / pms / rev) failed. */
function cacheable(text) {
  return text.startsWith('{"ok":true') && !/"(att|out|pms|rev)":\{"ok":false/.test(text);
}

/** The m.all request the Worker sends to Apps Script for a token + view (never the client's extra fields). */
function allBody(token, v) {
  const b = { action: CACHED_ACTION, token, date: v.date || '', factory: v.factory || '' };
  if (v.lang) b.lang = v.lang;
  if (v.b) b.b = v.b;
  return JSON.stringify(b);
}
function viewOf(req) {
  return { date: String(req.date || ''), factory: String(req.factory || ''), lang: String(req.lang || ''), b: String(req.b || '') };   // b: app build
}
async function keyOf(token, v) {
  return sha(JSON.stringify([token, v.date, v.factory, v.lang, v.b || '']));
}

/** Takes the refresh lock for a key; false when another refresh started less than LOCK_MS ago. */
async function takeLock(db, key) {
  const now = Date.now();
  const r = await db.prepare('INSERT INTO meta (k, v) VALUES (?1, ?2) ON CONFLICT(k) DO UPDATE SET v = excluded.v WHERE meta.v < ?3')
    .bind('lock:' + key, now, now - LOCK_MS).run();
  return !!(r.meta && r.meta.changes > 0);
}
async function dropLock(db, key) {
  await db.prepare('DELETE FROM meta WHERE k = ?').bind('lock:' + key).run();
}

async function readCache(db, key) {
  const [verRes, rowsRes] = await db.batch([
    db.prepare("SELECT v FROM meta WHERE k = 'ver'"),
    db.prepare('SELECT part, n, data, ver, at FROM payload_cache WHERE k = ? ORDER BY part').bind(key),
  ]);
  const gver = verRes.results.length ? Number(verRes.results[0].v) : 1;
  const parts = rowsRes.results || [];
  const complete = parts.length > 0 && parts.length === Number(parts[0].n);
  return { gver, parts, complete };
}

/** Loads a fresh payload from Apps Script and stores it (lock already taken). Returns the Apps Script text. */
async function refresh(env, key, token, v, ver) {
  const db = env.DB;
  try {
    const text = await upstream(env, allBody(token, v));
    if (!cacheable(text)) {
      await db.prepare('DELETE FROM payload_cache WHERE k = ?').bind(key).run();
      return text;
    }
    const n = Math.ceil(text.length / CHUNK);
    const at = Date.now();
    const stmts = [db.prepare('DELETE FROM payload_cache WHERE k = ?').bind(key)];
    for (let i = 0; i < n; i++) {
      stmts.push(db.prepare('INSERT INTO payload_cache (k, part, n, data, ver, at) VALUES (?, ?, ?, ?, ?, ?)')
        .bind(key, i, n, text.slice(i * CHUNK, (i + 1) * CHUNK), ver, at));
    }
    await db.batch(stmts);
    return text;
  } finally {
    await dropLock(db, key).catch(() => {});
  }
}

async function cachedAll(env, ctx, req) {
  const token = String(req.token || '');
  if (!token) return reply(await upstream(env, JSON.stringify(req)), { 'X-Cache': 'BYPASS' });
  const v = viewOf(req);
  const key = await keyOf(token, v);
  const db = env.DB;
  const tk = await sha(token);
  ctx.waitUntil(db.prepare('INSERT INTO last_view (tk, date, factory, lang, b, at) VALUES (?1, ?2, ?3, ?4, ?5, ?6) ON CONFLICT(tk) DO UPDATE SET date = ?2, factory = ?3, lang = ?4, b = ?5, at = ?6')
    .bind(tk, v.date, v.factory, v.lang, v.b, Date.now()).run().catch(() => {}));

  let c = await readCache(db, key);
  const maxAge = Number(env.CACHE_MAX_AGE_SEC || 300);
  const ageOf = (parts) => Math.max(0, Math.round((Date.now() - Number(parts[0].at)) / 1000));
  const isStale = (cc) => Number(cc.parts[0].ver) < cc.gver || ageOf(cc.parts) > maxAge;

  // fresh: the app has just saved something (or the user pressed refresh) and must not see the old copy; and when anybody
  // saved since this copy was made, nobody gets it either (a transfer request must show at once) — only age alone is served stale.
  if (req.fresh === true || (c.complete && Number(c.parts[0].ver) < c.gver)) {
    if (c.complete && !isStale(c)) return reply(c.parts.map((p) => p.data).join(''), { 'X-Cache': 'HIT', 'X-Cache-Age': String(ageOf(c.parts)) });
    if (!(await takeLock(db, key))) {
      // another refresh of this copy is running (e.g. the one started by the save): wait for it instead of a second one
      const until = Date.now() + LOCK_MS;
      while (Date.now() < until) {
        await sleep(700);
        c = await readCache(db, key);
        if (c.complete && Number(c.parts[0].ver) >= c.gver) return reply(c.parts.map((p) => p.data).join(''), { 'X-Cache': 'HIT', 'X-Cache-Age': String(ageOf(c.parts)) });
        const lock = await db.prepare('SELECT v FROM meta WHERE k = ?').bind('lock:' + key).first();
        if (!lock) break;
      }
      await takeLock(db, key);
    }
    const text = await refresh(env, key, token, v, c.gver);
    return reply(text, { 'X-Cache': 'MISS', 'X-Cache-Age': '0' });
  }

  if (c.complete) {
    const stale = isStale(c);
    if (stale) {
      ctx.waitUntil((async () => {
        if (await takeLock(db, key)) await refresh(env, key, token, v, c.gver);
      })().catch(() => {}));
    }
    return reply(c.parts.map((p) => p.data).join(''), { 'X-Cache': stale ? 'STALE' : 'HIT', 'X-Cache-Age': String(ageOf(c.parts)) });
  }

  await takeLock(db, key);   // a background refresh started meanwhile simply finds the lock and skips
  const text = await refresh(env, key, token, v, c.gver);
  return reply(text, { 'X-Cache': 'MISS', 'X-Cache-Age': '0' });
}

/** After a save: refresh the saver's own last view right away (version was already bumped). */
async function refreshSaver(env, token) {
  if (!token) return;
  const db = env.DB;
  const v = await db.prepare('SELECT date, factory, lang, b FROM last_view WHERE tk = ?').bind(await sha(token)).first();
  if (!v) return;
  const key = await keyOf(token, v);
  if (!(await takeLock(db, key))) return;
  const gver = (await db.prepare("SELECT v FROM meta WHERE k = 'ver'").first()).v;
  await refresh(env, key, token, v, Number(gver));
}

async function bumpVersion(db) {
  await db.prepare("UPDATE meta SET v = v + 1 WHERE k = 'ver'").run();
}

/** The token of a request: parsed for normal bodies, found by pattern in very big ones. */
function tokenOf(bodyText, req) {
  if (req && typeof req.token === 'string') return req.token;
  const m = /"token"\s*:\s*"([^"]{10,400})"/.exec(bodyText);
  return m ? m[1] : '';
}


// ---------------------------------------------------------------------------------------------------------------------
// Phone notifications (Web Push, RFC 8291 aes128gcm + VAPID RFC 8292). Apps Script puts { notify: [{ to: [user_id],
// title, body, tag, url }] } on a save's reply; the Worker sends one push per phone of those users. The VAPID key pair is
// made by the Worker on first use and kept in D1 (nothing to configure). A phone address the push service no longer
// knows (404 / 410) is removed.
const enc = new TextEncoder();
const b64u = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const unb64u = (s) => Uint8Array.from(atob(String(s).replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((String(s).length + 3) % 4)), (c) => c.charCodeAt(0));
const cat = (...a) => { const out = new Uint8Array(a.reduce((n, x) => n + x.length, 0)); let o = 0; for (const x of a) { out.set(x, o); o += x.length; } return out; };
async function hmac(key, data) {
  const k = await crypto.subtle.importKey('raw', key, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return new Uint8Array(await crypto.subtle.sign('HMAC', k, data));
}

let VAPID = null;
async function vapidKeys(db) {
  if (VAPID) return VAPID;
  let row = await db.prepare("SELECT v FROM kv WHERE k = 'vapid'").first();
  if (!row) {
    const kp = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
    const jwk = await crypto.subtle.exportKey('jwk', kp.privateKey);
    const pub = b64u(await crypto.subtle.exportKey('raw', kp.publicKey));
    await db.prepare("INSERT OR IGNORE INTO kv (k, v) VALUES ('vapid', ?)").bind(JSON.stringify({ jwk, pub })).run();
    row = await db.prepare("SELECT v FROM kv WHERE k = 'vapid'").first();   // two first requests at once: both use the stored one
  }
  const v = JSON.parse(row.v);
  const priv = await crypto.subtle.importKey('jwk', v.jwk, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']);
  VAPID = { priv, pub: v.pub };
  return VAPID;
}
async function vapidAuth(v, endpoint) {
  const head = b64u(enc.encode(JSON.stringify({ typ: 'JWT', alg: 'ES256' })));
  const claims = b64u(enc.encode(JSON.stringify({ aud: new URL(endpoint).origin, exp: Math.floor(Date.now() / 1000) + 12 * 3600, sub: 'https://starglobal-apps.github.io/SG-Data-Manage/' })));
  const sig = await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, v.priv, enc.encode(head + '.' + claims));
  return 'vapid t=' + head + '.' + claims + '.' + b64u(sig) + ', k=' + v.pub;
}
/** RFC 8291: the payload encrypted for one phone (its p256dh public key + auth secret). */
async function encryptPush(sub, text) {
  const uaPub = unb64u(sub.p256dh), auth = unb64u(sub.auth);
  const as = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']);
  const asPub = new Uint8Array(await crypto.subtle.exportKey('raw', as.publicKey));
  const uaKey = await crypto.subtle.importKey('raw', uaPub, { name: 'ECDH', namedCurve: 'P-256' }, false, []);
  const ecdh = new Uint8Array(await crypto.subtle.deriveBits({ name: 'ECDH', public: uaKey }, as.privateKey, 256));
  const prkKey = await hmac(auth, ecdh);
  const ikm = await hmac(prkKey, cat(enc.encode('WebPush: info\0'), uaPub, asPub, new Uint8Array([1])));
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const prk = await hmac(salt, ikm);
  const cek = (await hmac(prk, cat(enc.encode('Content-Encoding: aes128gcm\0'), new Uint8Array([1])))).slice(0, 16);
  const nonce = (await hmac(prk, cat(enc.encode('Content-Encoding: nonce\0'), new Uint8Array([1])))).slice(0, 12);
  const key = await crypto.subtle.importKey('raw', cek, 'AES-GCM', false, ['encrypt']);
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv: nonce }, key, cat(enc.encode(text), new Uint8Array([2]))));
  const rs = new Uint8Array([0, 0, 16, 0]);   // record size 4096
  return cat(salt, rs, new Uint8Array([asPub.length]), asPub, ct);
}
async function pushOne(env, v, sub, msg) {
  const body = await encryptPush(sub, JSON.stringify(msg));
  const headers = { 'Content-Encoding': 'aes128gcm', 'Content-Type': 'application/octet-stream', TTL: '86400', Urgency: 'high', Authorization: await vapidAuth(v, sub.endpoint) };
  if (msg.tag) headers.Topic = b64u(await crypto.subtle.digest('SHA-256', enc.encode(msg.tag))).slice(0, 32);   // a newer push with the same tag replaces an undelivered one
  const r = await fetch(sub.endpoint, { method: 'POST', headers, body });
  if (r.status === 404 || r.status === 410) await env.DB.prepare('DELETE FROM push_subs WHERE endpoint = ?').bind(sub.endpoint).run();
  const info = r.ok ? new URL(sub.endpoint).host : (new URL(sub.endpoint).host + ' ' + (await r.text().catch(() => '')).slice(0, 160));
  await pushLog(env, sub.user_id, msg.title, r.status, info);
  return { user_id: sub.user_id, status: r.status, info };
}
async function pushLog(env, userId, title, status, info) {
  await env.DB.prepare('INSERT INTO push_log (at, user_id, title, status, info) VALUES (?, ?, ?, ?, ?)').bind(Date.now(), String(userId || ''), String(title || '').slice(0, 120), status, String(info || '').slice(0, 200)).run().catch(() => {});
}
/** Sends the notify list of a reply. Returns the push statuses (for tests / logs). */
async function sendNotify(env, list) {
  if (!Array.isArray(list) || !list.length) return [];
  const ids = [...new Set(list.flatMap((n) => (Array.isArray(n.to) ? n.to : []).map(String)))].slice(0, 200);
  if (!ids.length) return [];
  const rows = (await env.DB.prepare('SELECT endpoint, user_id, p256dh, auth FROM push_subs WHERE user_id IN (' + ids.map(() => '?').join(',') + ')').bind(...ids).all()).results || [];
  const v = rows.length ? await vapidKeys(env.DB) : null;
  const jobs = [];
  for (const n of list) {
    const msg = { title: String(n.title || 'SG Data').slice(0, 120), body: String(n.body || '').slice(0, 300), tag: String(n.tag || '').slice(0, 120), url: String(n.url || '').slice(0, 40) };
    for (const id of [...new Set((n.to || []).map(String))]) {
      const subs = rows.filter((r) => r.user_id === id);
      if (!subs.length) { jobs.push(pushLog(env, id, msg.title, 0, 'no phone registered').then(() => ({ user_id: id, status: 0, info: 'no phone registered' }))); continue; }
      for (const sub of subs) jobs.push(pushOne(env, v, sub, msg).catch((e) => ({ user_id: id, status: -1, info: String(e && e.message || e) })));
    }
  }
  return Promise.all(jobs);
}
/** push.sub / push.unsub replies (Apps Script confirmed the user): keep or drop the phone's address. */
async function savePushSub(env, req, text) {
  let r; try { r = JSON.parse(text); } catch (e) { return; }
  if (!r || !r.ok) return false;
  if (req.action === 'push.sub') {
    const s = req.sub || {}, k = s.keys || {};
    if (!s.endpoint || !/^https:\/\//.test(s.endpoint) || !k.p256dh || !k.auth || !r.user_id) return false;
    await env.DB.prepare('INSERT INTO push_subs (endpoint, user_id, p256dh, auth, at) VALUES (?1, ?2, ?3, ?4, ?5) ON CONFLICT(endpoint) DO UPDATE SET user_id = ?2, p256dh = ?3, auth = ?4, at = ?5')
      .bind(String(s.endpoint), String(r.user_id), String(k.p256dh), String(k.auth), Date.now()).run();
    return true;
  } else if (req.action === 'push.unsub' && req.endpoint) {
    await env.DB.prepare('DELETE FROM push_subs WHERE endpoint = ?').bind(String(req.endpoint)).run();
    return true;
  }
  return false;
}
/** push.status (admin, confirmed by Apps Script): who has a phone registered + the last notifications and their result. */
async function pushStatus(env, text) {
  const r = JSON.parse(text);
  if (!r.ok) return r;
  const subs = (await env.DB.prepare('SELECT user_id, COUNT(*) AS n, MAX(at) AS at FROM push_subs GROUP BY user_id').all()).results || [];
  const log = (await env.DB.prepare('SELECT at, user_id, title, status, info FROM push_log ORDER BY id DESC LIMIT 60').all()).results || [];
  return Object.assign(r, { phones: subs, log });
}

export default {
  async fetch(request, env, ctx) {
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });

    let bodyText = '';
    if (request.method === 'GET') {
      const u = new URL(request.url);
      if (!u.searchParams.get('action')) return reply(JSON.stringify({ ok: true, service: 'sg-data-manage-api', time: new Date().toISOString() }));
      bodyText = JSON.stringify({ action: 'ping' });
    } else if (request.method === 'POST') {
      bodyText = await request.text();
    } else {
      return errorReply('Method not allowed', 'BAD_METHOD');
    }

    let req = null;
    if (bodyText.length < 300000) { try { req = JSON.parse(bodyText); } catch (e) { return errorReply('Request body is not JSON', 'BAD_JSON'); } }
    const action = req ? String(req.action || '') : ((/"action"\s*:\s*"([A-Za-z0-9_.]+)"/.exec(bodyText) || [])[1] || '');
    if (!action) return errorReply('Bad request', 'BAD_JSON');

    try {
      await ensureSchema(env.DB);
      if (action === CACHED_ACTION && req) return await cachedAll(env, ctx, req);

      if (action === 'ping') return reply(JSON.stringify({ ok: true, app: 'SG Data API', via: 'worker', time: new Date().toISOString() }), { 'X-Cache': 'BYPASS' });
      if (action === 'push.key') return reply(JSON.stringify({ ok: true, key: (await vapidKeys(env.DB)).pub }), { 'X-Cache': 'BYPASS' });

      const text = await upstream(env, bodyText);
      if (req && (action === 'push.sub' || action === 'push.unsub')) {
        // the app counts a phone as registered only when the Worker really stored it
        const stored = await savePushSub(env, req, text).catch(() => false);
        let r = null; try { r = JSON.parse(text); } catch (e) {}
        if (r) return reply(JSON.stringify(Object.assign(r, { stored })), { 'X-Cache': 'BYPASS' });
      }
      if (action === 'push.status') return reply(JSON.stringify(await pushStatus(env, text)), { 'X-Cache': 'BYPASS' });
      if (action === 'push.test') {
        let r = null; try { r = JSON.parse(text); } catch (e) {}
        if (r && r.ok && r.user_id) {
          const results = await sendNotify(env, [{ to: [r.user_id], title: 'Test notification', body: 'Notifications work on this phone ✓', tag: 'test', url: '#main' }]);
          return reply(JSON.stringify(Object.assign(r, { results })), { 'X-Cache': 'BYPASS' });
        }
        return reply(text, { 'X-Cache': 'BYPASS' });
      }
      // notifications of this save: sent after the reply (Apps Script decided who gets what)
      if (text.indexOf('"notify":[') > 0) {
        let n = null; try { n = JSON.parse(text).notify; } catch (e) {}
        if (n) ctx.waitUntil(sendNotify(env, n).catch((e) => pushLog(env, '', 'notification not sent', -1, String(e && e.message || e))));
      }
      // m.warm only reads, unless it ran the due import into MASTER DATA
      const wrote = !READ_ACTIONS.has(action) || (action === 'm.warm' && /"imported":true/.test(text));
      if (wrote) {
        // before answering: the app asks for m.all right after a save and must not get a copy marked current
        await bumpVersion(env.DB).catch(() => {});
        ctx.waitUntil(refreshSaver(env, tokenOf(bodyText, req)).catch(() => {}));
      }
      return reply(text, { 'X-Cache': 'BYPASS' });
    } catch (e) {
      return errorReply((e && e.message) || String(e));
    }
  },

  async scheduled(event, env, ctx) {
    await ensureSchema(env.DB);
    const weekAgo = Date.now() - 7 * 24 * 3600 * 1000;
    await env.DB.batch([
      env.DB.prepare('DELETE FROM payload_cache WHERE at < ?').bind(weekAgo),
      env.DB.prepare('DELETE FROM last_view WHERE at < ?').bind(weekAgo),
      env.DB.prepare('DELETE FROM push_subs WHERE at < ?').bind(Date.now() - 60 * 24 * 3600 * 1000),
      env.DB.prepare('DELETE FROM push_log WHERE at < ?').bind(weekAgo),
      env.DB.prepare("DELETE FROM meta WHERE k LIKE 'lock:%' AND v < ?").bind(Date.now() - 24 * 3600 * 1000),
    ]);
  },
};
