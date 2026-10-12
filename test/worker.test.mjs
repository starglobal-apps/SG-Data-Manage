// Tests the Cloudflare Worker (cloudflare/src/index.js) with a fake D1 (node:sqlite) and a fake Apps Script.
// Run from the repo root: node test/worker.test.mjs   (expects '0 FAIL')
import { DatabaseSync } from 'node:sqlite';
import worker from '../cloudflare/src/index.js';

const RESULTS = [];
const check = (name, ok, info) => RESULTS.push((ok ? 'PASS ' : 'FAIL ') + name + (!ok && info !== undefined ? ' -> ' + JSON.stringify(info) : ''));

// ---------- fake D1 ----------
function makeD1() {
  const sql = new DatabaseSync(':memory:');
  const stmt = (q, args = []) => ({
    q, args,
    bind: (...a) => stmt(q, a),
    first: async () => sql.prepare(q).get(...args) ?? null,
    all: async () => ({ results: sql.prepare(q).all(...args) }),
    run: async () => { const r = sql.prepare(q).run(...args); return { meta: { changes: Number(r.changes) } }; },
  });
  return {
    sql,
    prepare: (q) => stmt(q),
    batch: async (list) => {
      sql.exec('BEGIN');
      try {
        const out = list.map((s) => /^\s*select/i.test(s.q) ? { results: sql.prepare(s.q).all(...s.args) } : { meta: { changes: Number(sql.prepare(s.q).run(...s.args).changes) } });
        sql.exec('COMMIT');
        return out;
      } catch (e) { sql.exec('ROLLBACK'); throw e; }
    },
  };
}

// ---------- fake Apps Script ----------
const GAS = { n: 0, calls: [], delay: 0, mode: 'ok', big: false, warmImported: false, data: 1 };
const PUSH = { calls: [], status: 201 };
globalThis.fetch = async (url, init) => {
  if (String(url).startsWith('https://push.test/')) { PUSH.calls.push({ url: String(url), headers: init.headers, body: new Uint8Array(init.body) }); return new Response('', { status: PUSH.status }); }
  const body = JSON.parse(init.body);
  GAS.calls.push(body);
  if (GAS.delay) await new Promise((r) => setTimeout(r, GAS.delay));
  if (GAS.mode === 'html') return new Response('<!DOCTYPE html><html>busy</html>', { status: 200 });
  if (body.action === 'm.all') {
    GAS.n++;
    if (body.token === 'bad') return new Response(JSON.stringify({ ok: false, error: 'AUTH', message: 'Session ended' }));
    if (GAS.mode === 'partfail') return new Response(JSON.stringify({ ok: true, date: body.date, att: { ok: false, message: 'x' }, out: { ok: true }, pms: { ok: true }, rev: null }));
    const pad = GAS.big ? 'x'.repeat(1200000) : '';
    return new Response(JSON.stringify({ ok: true, date: body.date, factory: body.factory, user: body.token, data: GAS.data, build: GAS.n, extra: body.fresh, att: { ok: true, items: [] }, out: { ok: true }, pms: { ok: true }, rev: null, pad }));
  }
  if (body.action === 'push.sub' || body.action === 'push.unsub') return new Response(JSON.stringify(body.token === 'bad' ? { ok: false, error: 'AUTH' } : { ok: true, user_id: body.token === 'tokA' ? 'u1' : 'u2' }));
  if (body.action === 'x.save') return new Response(JSON.stringify({ ok: true, saved: 1, notify: GAS.notify }));
  if (body.action === 'm.warm') return new Response(JSON.stringify({ ok: true, ms: 5, imported: GAS.warmImported }));
  if (body.action === 'att.save') { GAS.data++; return new Response(JSON.stringify({ ok: true, saved: 1 })); }
  return new Response(JSON.stringify({ ok: true, action: body.action }));
};

const env = { DB: makeD1(), APPS_SCRIPT_URL: 'https://fake.script/exec', CACHE_MAX_AGE_SEC: '300' };
let pending = [];
const ctx = { waitUntil: (p) => pending.push(p) };
const settle = async () => { while (pending.length) { const p = pending; pending = []; await Promise.all(p); } };
async function post(body, method = 'POST') {
  const r = await worker.fetch(new Request('https://w.test/', { method, body: method === 'POST' ? (typeof body === 'string' ? body : JSON.stringify(body)) : undefined }), env, ctx);
  const text = await r.text();
  let json = null; try { json = JSON.parse(text); } catch (e) {}
  return { status: r.status, cache: r.headers.get('X-Cache'), age: r.headers.get('X-Cache-Age'), cors: r.headers.get('Access-Control-Allow-Origin'), expose: r.headers.get('Access-Control-Expose-Headers'), json, text };
}
const all = (token, extra) => post({ action: 'm.all', token, date: '2026-10-12', factory: '666', lang: 'en', ...(extra || {}) });
const ver = () => env.DB.sql.prepare("SELECT v FROM meta WHERE k='ver'").get().v;

// 1. CORS + health
{
  const r = await worker.fetch(new Request('https://w.test/', { method: 'OPTIONS' }), env, ctx);
  check('OPTIONS -> 204 + CORS', r.status === 204 && r.headers.get('Access-Control-Allow-Origin') === '*');
  const g = await post(null, 'GET');
  check('GET / -> health', g.json && g.json.ok && g.json.service === 'sg-data-manage-api' && g.cors === '*');
}

// 2. MISS then HIT, per token
{
  const a = await all('tokA'); await settle();
  check('first m.all -> MISS from Apps Script', a.cache === 'MISS' && a.json.ok && a.json.user === 'tokA' && GAS.n === 1, a.cache);
  check('client field "fresh" / extras never reach Apps Script', GAS.calls[GAS.calls.length - 1].fresh === undefined && GAS.calls[GAS.calls.length - 1].lang === 'en');
  const b = await all('tokA'); await settle();
  check('second m.all -> HIT, same text, no Apps Script call', b.cache === 'HIT' && b.text === a.text && GAS.n === 1, b.cache);
  check('X-Cache exposed to the browser (CORS)', /X-Cache/.test(b.expose));
  const c = await all('tokB'); await settle();
  check('other token -> own copy (MISS)', c.cache === 'MISS' && c.json.user === 'tokB' && GAS.n === 2);
  const d = await post({ action: 'm.all', token: 'tokA', date: '2026-10-11', factory: '666', lang: 'en' }); await settle();
  check('other date -> own copy (MISS)', d.cache === 'MISS' && d.json.date === '2026-10-11');
  await all('tokA'); await settle();   // tokA's last view = 12 Oct again
  const raw = JSON.stringify(env.DB.sql.prepare('SELECT * FROM last_view').all()) + JSON.stringify(env.DB.sql.prepare('SELECT k FROM payload_cache').all());
  check('no raw token stored in D1', !/tokA|tokB/.test(raw));
}

// 3. a save: version bumped before the reply, saver refreshed, others STALE then refreshed
{
  const v0 = ver(), n0 = GAS.n;
  const s = await post({ action: 'att.save', token: 'tokA', rid: 'r1', date: '2026-10-12' });
  check('save goes straight to Apps Script (BYPASS)', s.cache === 'BYPASS' && s.json.saved === 1);
  check('version bumped before the reply', ver() === v0 + 1);
  await settle();
  check('saver copy refreshed right away (one m.all build)', GAS.n === n0 + 1, GAS.n - n0);
  const a = await all('tokA'); await settle();
  check('saver then gets HIT with the new data', a.cache === 'HIT' && a.json.data === GAS.data, [a.cache, a.json.data, GAS.data]);
  const b = await all('tokB');
  check('other user: STALE old copy at once', b.cache === 'STALE' && b.json.data === GAS.data - 1, [b.cache, b.json.data]);
  await settle();
  const b2 = await all('tokB'); await settle();
  check('other user: next ask HIT with new data', b2.cache === 'HIT' && b2.json.data === GAS.data, [b2.cache, b2.json.data]);
}

// 3b. phone saves, then at once asks m.all with fresh (PD.dirty) while the saver refresh is still running
{
  GAS.delay = 800;
  const s = await post({ action: 'att.save', token: 'tokA', rid: 'r9' });   // slow Apps Script; saver refresh starts in background
  const n0 = GAS.n;
  const f = await all('tokA', { fresh: true });
  await settle(); GAS.delay = 0;
  check('right after a save, fresh m.all never returns the old data', s.json.saved === 1 && f.json.data === GAS.data && f.cache !== 'STALE', [f.cache, f.json.data, GAS.data]);
  check('...and no second build for the saver (waited for the running one)', GAS.n - n0 === 1, GAS.n - n0);
}

// 4. fresh:true
{
  const n0 = GAS.n;
  const a = await all('tokA', { fresh: true }); await settle();
  check('fresh + current copy -> HIT, no Apps Script call', a.cache === 'HIT' && GAS.n === n0);
  await post({ action: 'm.setFloor', token: 'tokB', dept: 'x' });   // tokB saves: tokA copy is now out of date
  await settle();
  GAS.delay = 1500;
  const slow = (async () => { const r = await all('tokA'); return r; })();   // STALE + starts a slow background refresh
  const s1 = await slow;
  check('stale copy while a refresh runs', s1.cache === 'STALE');
  const n1 = GAS.n;
  const f = await all('tokA', { fresh: true });   // must wait for the running refresh, not start a second one
  await settle(); GAS.delay = 0;
  check('fresh waits for the running refresh and returns new data', (f.cache === 'HIT' || f.cache === 'MISS') && f.json.data === GAS.data, [f.cache, f.json && f.json.data]);
  check('only one Apps Script build for that copy', GAS.n - n1 === 1, GAS.n - n1);
}

// 5. what is never cached
{
  GAS.mode = 'partfail';
  const a = await all('tokC'); await settle();
  const b = await all('tokC'); await settle();
  check('a payload with a failed part is not cached', a.cache === 'MISS' && b.cache === 'MISS');
  GAS.mode = 'ok';
  const c = await all('bad'); await settle();
  const d = await all('bad'); await settle();
  check('login-expired answer passed through, not cached', c.json.error === 'AUTH' && d.cache === 'MISS');
  GAS.mode = 'html';
  const e = await post({ action: 'att.save', token: 'tokA', rid: 'r2' });
  check('Google HTML page -> JSON ok:false BUSY with X-Cache ERROR', e.cache === 'ERROR' && e.json && e.json.ok === false && e.json.error === 'BUSY');
  const e2 = await all('tokZ');
  check('m.all with Google busy and no copy -> ERROR', e2.cache === 'ERROR' && e2.json.ok === false);
  GAS.mode = 'ok';
  const bad = await post('not json');
  check('non-JSON body -> BAD_JSON', bad.json && bad.json.error === 'BAD_JSON');
}

// 6. reads do not bump, m.warm only when it imported
{
  const v0 = ver();
  await post({ action: 'm.out', token: 'tokA' }); await post({ action: 'login', pin: '1234' }); await settle();
  check('read calls do not bump the version', ver() === v0);
  GAS.warmImported = false; await post({ action: 'm.warm', token: 'tokA' }); await settle();
  check('m.warm without import: no bump', ver() === v0);
  GAS.warmImported = true; await post({ action: 'm.warm', token: 'tokA' }); await settle();
  check('m.warm that imported: bump', ver() === v0 + 1);
  const v1 = ver();
  await post({ action: 'm.reviewDecide', token: 'tokA', id: 'x', decision: 'approve' }); await settle();
  check('unknown / write action bumps', ver() === v1 + 1);
}


// 8. phone notifications (Web Push)
{
  const sc = globalThis.crypto.subtle, te = new TextEncoder();
  const b64u = (b) => Buffer.from(b).toString('base64url'), unb = (t) => new Uint8Array(Buffer.from(t, 'base64url'));
  const hm = async (k, d) => new Uint8Array(await sc.sign('HMAC', await sc.importKey('raw', k, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']), d));
  const cat = (...a) => { const o = new Uint8Array(a.reduce((n, x) => n + x.length, 0)); let i = 0; for (const x of a) { o.set(x, i); i += x.length; } return o; };
  // a phone: its key pair + auth secret
  const ua = await sc.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']);
  const uaPub = new Uint8Array(await sc.exportKey('raw', ua.publicKey)), auth = crypto.getRandomValues(new Uint8Array(16));
  const sub = { endpoint: 'https://push.test/phone1', keys: { p256dh: b64u(uaPub), auth: b64u(auth) } };
  async function decrypt(body) {   // what the phone does (RFC 8291)
    const salt = body.slice(0, 16), idlen = body[20], asPub = body.slice(21, 21 + idlen), ct = body.slice(21 + idlen);
    const asKey = await sc.importKey('raw', asPub, { name: 'ECDH', namedCurve: 'P-256' }, false, []);
    const ecdh = new Uint8Array(await sc.deriveBits({ name: 'ECDH', public: asKey }, ua.privateKey, 256));
    const ikm = await hm(await hm(auth, ecdh), cat(te.encode('WebPush: info\0'), uaPub, asPub, new Uint8Array([1])));
    const prk = await hm(salt, ikm);
    const cek = (await hm(prk, cat(te.encode('Content-Encoding: aes128gcm\0'), new Uint8Array([1])))).slice(0, 16);
    const nonce = (await hm(prk, cat(te.encode('Content-Encoding: nonce\0'), new Uint8Array([1])))).slice(0, 12);
    const pt = new Uint8Array(await sc.decrypt({ name: 'AES-GCM', iv: nonce }, await sc.importKey('raw', cek, 'AES-GCM', false, ['decrypt']), ct));
    return JSON.parse(new TextDecoder().decode(pt.slice(0, pt.length - 1)));
  }
  const k1 = await post({ action: 'push.key' }), k2 = await post({ action: 'push.key' });
  check('push.key: public key made once and kept', k1.json.ok && unb(k1.json.key).length === 65 && k1.json.key === k2.json.key);
  const v0 = ver();
  const ps = await post({ action: 'push.sub', token: 'tokA', sub });
  const row = env.DB.sql.prepare('SELECT user_id FROM push_subs WHERE endpoint = ?').get(sub.endpoint);
  check('push.sub: stored for the user Apps Script confirmed, no data version bump', ps.json.ok && row && row.user_id === 'u1' && ver() === v0, row);
  await post({ action: 'push.sub', token: 'bad', sub: { endpoint: 'https://push.test/evil', keys: sub.keys } });
  check('push.sub with a bad login: not stored', !env.DB.sql.prepare('SELECT 1 FROM push_subs WHERE endpoint = ?').get('https://push.test/evil'));
  GAS.notify = [{ to: ['u1'], title: 'Output for approval · Line 1-SL030', body: '650 pcs · by Jeetu', tag: 'out|2026-10-12|L1|Final', url: '#mrev' }, { to: ['nobody'], title: 'x', body: 'y' }];
  PUSH.calls = [];
  const sv = await post({ action: 'x.save', token: 'tokB' }); await settle();
  check('save reply passed through unchanged', sv.json.saved === 1 && sv.cache === 'BYPASS');
  check('one push to the one phone of u1 (none for users without a phone)', PUSH.calls.length === 1 && PUSH.calls[0].url === sub.endpoint, PUSH.calls.length);
  const pc = PUSH.calls[0], h = pc.headers;
  const msg = await decrypt(pc.body);
  check('push payload decrypts on the phone: title, body, url, tag', msg.title === GAS.notify[0].title && msg.body === GAS.notify[0].body && msg.url === '#mrev' && msg.tag === GAS.notify[0].tag, msg);
  const m = /^vapid t=([^.]+)\.([^.]+)\.([^,]+), k=(.+)$/.exec(h.Authorization);
  const claims = m && JSON.parse(Buffer.from(m[2], 'base64url').toString());
  const vk = m && await sc.importKey('raw', unb(m[4]), { name: 'ECDSA', namedCurve: 'P-256' }, false, ['verify']);
  const sigOk = m && await sc.verify({ name: 'ECDSA', hash: 'SHA-256' }, vk, unb(m[3]), te.encode(m[1] + '.' + m[2]));
  check('VAPID: signed JWT for the push service origin, key = push.key', !!sigOk && claims.aud === 'https://push.test' && claims.exp > Date.now() / 1000 && m[4] === k1.json.key, claims);
  check('push headers: aes128gcm, TTL, urgency, topic', h['Content-Encoding'] === 'aes128gcm' && h.TTL === '86400' && h.Urgency === 'high' && /^[A-Za-z0-9_-]{1,32}$/.test(h.Topic));
  PUSH.status = 410; PUSH.calls = [];
  await post({ action: 'x.save', token: 'tokB' }); await settle(); PUSH.status = 201;
  check('phone address gone (410) -> removed', PUSH.calls.length === 1 && !env.DB.sql.prepare('SELECT 1 FROM push_subs WHERE endpoint = ?').get(sub.endpoint));
  await post({ action: 'push.sub', token: 'tokA', sub }); await post({ action: 'push.unsub', token: 'tokA', endpoint: sub.endpoint });
  check('push.unsub (logout) removes the phone', !env.DB.sql.prepare('SELECT 1 FROM push_subs WHERE endpoint = ?').get(sub.endpoint));
  PUSH.calls = []; GAS.notify = undefined;
  await post({ action: 'x.save', token: 'tokB' }); await settle();
  check('a save without notify sends nothing', PUSH.calls.length === 0);
}

// 7. big payload in parts, age limit, cron cleanup
{
  GAS.big = true;
  const a = await all('tokBig'); await settle();
  const parts = env.DB.sql.prepare('SELECT COUNT(*) c FROM payload_cache WHERE n > 1').get().c;
  const b = await all('tokBig'); await settle();
  check('1.2 MB payload stored in 3 parts and read back whole', parts === 3 && b.cache === 'HIT' && b.text === a.text, parts);
  GAS.big = false;
  env.DB.sql.prepare('UPDATE payload_cache SET at = at - 400000').run();
  const c = await all('tokBig'); await settle();
  check('copy older than CACHE_MAX_AGE_SEC -> STALE', c.cache === 'STALE' && Number(c.age) >= 400);
  env.DB.sql.prepare('UPDATE payload_cache SET at = at - 8*24*3600*1000').run();
  env.DB.sql.prepare('UPDATE last_view SET at = at - 8*24*3600*1000').run();
  await worker.scheduled({}, env, ctx);
  check('daily cron removes copies older than a week', env.DB.sql.prepare('SELECT COUNT(*) c FROM payload_cache').get().c === 0 && env.DB.sql.prepare('SELECT COUNT(*) c FROM last_view').get().c === 0);
}

console.log(RESULTS.join('\n'));
const fails = RESULTS.filter((r) => r.startsWith('FAIL')).length;
console.log('\n' + fails + ' FAIL / ' + RESULTS.length);
process.exit(fails ? 1 : 0);
