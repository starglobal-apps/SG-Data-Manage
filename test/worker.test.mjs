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
globalThis.fetch = async (url, init) => {
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
