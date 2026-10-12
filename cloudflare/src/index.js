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
  'ping', 'login', 'me', 'masters', 'm.all', 'm.att', 'm.out', 'm.pms', 'm.outDay', 'm.reviewReport', 'm.warm',
  'att.get', 'att.status', 'att.prev', 'att.today', 'orders.active', 'hourly.get', 'hourly.day', 'hourly.rows', 'hour.get',
  'factory.today', 'line.today', 'review.count', 'review.list', 'users.recorders', 'users.list', 'staff.list', 'pms.get',
  'report.check', 'report.line', 'report.packing', 'report.srn', 'report.endline', 'target.get', 'defects.list',
  'manpower.get', 'audit.recent',
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
    db.prepare('CREATE TABLE IF NOT EXISTS last_view (tk TEXT PRIMARY KEY, date TEXT, factory TEXT, lang TEXT, at INTEGER NOT NULL)'),
    db.prepare("INSERT OR IGNORE INTO meta (k, v) VALUES ('ver', 1)"),
  ]);
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
  return JSON.stringify(b);
}
function viewOf(req) {
  return { date: String(req.date || ''), factory: String(req.factory || ''), lang: String(req.lang || '') };
}
async function keyOf(token, v) {
  return sha(JSON.stringify([token, v.date, v.factory, v.lang]));
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
  ctx.waitUntil(db.prepare('INSERT INTO last_view (tk, date, factory, lang, at) VALUES (?1, ?2, ?3, ?4, ?5) ON CONFLICT(tk) DO UPDATE SET date = ?2, factory = ?3, lang = ?4, at = ?5')
    .bind(tk, v.date, v.factory, v.lang, Date.now()).run().catch(() => {}));

  let c = await readCache(db, key);
  const maxAge = Number(env.CACHE_MAX_AGE_SEC || 300);
  const ageOf = (parts) => Math.max(0, Math.round((Date.now() - Number(parts[0].at)) / 1000));
  const isStale = (cc) => Number(cc.parts[0].ver) < cc.gver || ageOf(cc.parts) > maxAge;

  // fresh: the app has just saved something (or the user pressed refresh) and must not see the old copy.
  if (req.fresh === true) {
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
  const v = await db.prepare('SELECT date, factory, lang FROM last_view WHERE tk = ?').bind(await sha(token)).first();
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

      const text = await upstream(env, bodyText);
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
      env.DB.prepare("DELETE FROM meta WHERE k LIKE 'lock:%' AND v < ?").bind(Date.now() - 24 * 3600 * 1000),
    ]);
  },
};
