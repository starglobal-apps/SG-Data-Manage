# SG Data Manage API — Cloudflare Worker

Makes the SG Data phone app fast without moving the data out of Google Sheets. Same pattern as the Operation
Bulletin Worker, but its own Worker (`sg-data-manage-api`) and its own D1 database (`sg-data-manage`).

```
phone / web app (docs/)  ──►  Cloudflare Worker (this folder)  ──►  Apps Script web app (gas/)  ──►  Google Sheets
                                  │
                                  └─ D1 database: last m.all reply of every user / token (opens instantly)
```

- **Loading the phone app** (`m.all`, attendance + output + PMS + approvals in one call) is answered from D1 at once.
  If the copy is older than `CACHE_MAX_AGE_SEC`, or anybody saved something since, the Worker answers with the saved
  copy (`X-Cache: STALE`) and fetches a fresh one from Apps Script in the background; the app asks again 3 s later.
- **Saving** (attendance, output, approve, edit, transfer, users, import, …) goes straight to Apps Script, so all
  rules stay there and the sheets are always up to date. Before the reply the Worker bumps the data version (every
  cached copy becomes STALE) and then refreshes the saver's own copy in the background.
- Right after a save, or when the user presses refresh, the app asks with `fresh: true`: the Worker never returns an
  old copy then (it waits for the running refresh or loads a new one).
- Copies are stored per token + date + factory; the token itself is never stored (only its SHA-256).
  Error answers, "login again" answers and replies with a failed part are never cached.
- `X-Cache` header: `HIT` (fresh copy), `STALE` (old copy, refresh running), `MISS` (loaded from Apps Script now),
  `BYPASS` (passed through), `ERROR` (Google was busy).
- D1 tables are created by the Worker itself on the first request. A daily cron removes copies not used for a week.
- If the Worker cannot be reached or crashes, the app calls the Apps Script `/exec` URL directly and skips the
  Worker for 10 minutes. Reads and saves with a request id (rid) are re-sent there; other saves are never re-sent
  automatically (no double data).

## Setup (one time, Cloudflare dashboard)

1. **D1 database**: Storage & Databases → D1 SQL Database → Create → name `sg-data-manage` → Create.
   Copy its **Database ID**.
2. Put that ID in `wrangler.toml` → `database_id` (replace `PASTE-D1-DATABASE-ID-HERE`) and commit to `main`.
   The ID is not a secret.
3. **Workers & Pages → Create → Import a repository** → GitHub → allow access to `starglobal-apps/SG-Data-Manage`.
   - Project name: `sg-data-manage-api` (must match `name` in `wrangler.toml`)
   - Root directory: `cloudflare`
   - Build command: empty · Deploy command: `npx wrangler deploy` (default)
   - Deploy.
4. Open the Worker URL (`https://sg-data-manage-api.<your-subdomain>.workers.dev/`). It should show
   `{"ok":true,"service":"sg-data-manage-api",...}`.
5. Put that URL in `docs/config.js` → `WORKER_URL`, bump `CACHE` in `docs/sw.js`, push. Empty `WORKER_URL` = the app
   calls Apps Script directly, as before.

Every push to `main` that changes this folder redeploys the Worker automatically.

## Settings (`wrangler.toml` → `[vars]`)

- `APPS_SCRIPT_URL` — the Apps Script `/exec` URL (same as `API_URL` in `docs/config.js`).
- `CACHE_MAX_AGE_SEC` — after this many seconds a copy is refreshed in the background (default 300 = the phone's
  own 5 min refresh).

## Checking the cache

- Desktop Chrome, logged in to the app with the phone view (F12 → device toolbar): Network tab → the `m.all`
  request → Response headers → `X-Cache`. First open `MISS`, then `HIT`; after a save by someone else `STALE`
  followed by a `HIT` a few seconds later.
- Cloudflare dashboard → Workers → `sg-data-manage-api` → Logs: every request with its status.
- D1 → `sg-data-manage` → Console:
  `SELECT k, part, n, ver, datetime(at/1000, 'unixepoch') FROM payload_cache;` and `SELECT * FROM meta;`

## Limits

On the free Workers plan each request gets little CPU time. The Worker never parses the big m.all reply (it only
passes the text through), which should fit. If the Logs show "exceeded CPU" errors, switch to Workers Paid.

## Tests

`node test/worker.test.mjs` (repo root) runs the Worker against a fake D1 (node:sqlite) and a fake Apps Script.
