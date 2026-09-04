# SG Data Manage

Star Global production data system — Google Sheets + Apps Script backend, mobile PWA frontend.

**Live app:** https://starglobal-apps.github.io/SG-Data-Manage/ (own origin — keep it separate from other PWAs on `starmis2-lgtm.github.io`, whose root app has scope `/`).

```
gas/    Apps Script (pushed with clasp)      ->  Sheets me data + JSON API (Web App)
docs/   Mobile app (PWA, GitHub Pages)       ->  phone pe "Add to Home Screen"
```

## Flow

Subah **Attendance** -> din bhar **Hourly Output** (Stitching / Endline / Packing) -> **Manpower** changes -> shaam **Day Close** -> Manager **Review** -> Send to Final (source sheets).

Validation chain (SRN-wise, cumulative): Loading >= Stitching >= Endline checked; Endline pass >= Packing.

## Local setup (fresh clone)

Two files are gitignored because they hold IDs that should not be public — recreate them once:

```bash
cp .clasp.example.json .clasp.json      # fill in your Apps Script scriptId
cp Sources.example.js gas/Sources.js    # fill in the 7 source spreadsheet IDs
```

`gas/Sources.js` is pushed to Apps Script by clasp, so `clasp pull` also brings it back.
As a fallback, `Import.js` reads Script Properties named `SRC_ATT`, `SRC_PACKING`, ... if the file is missing.

## Setup (one time)

1. **Backend push**
   ```bash
   clasp push -f
   ```
2. Apps Script editor me `setupAppSheets()` run karo -> USERS / MASTERS / ATT_DAILY / ... tabs ban jayenge.
   MASTERS me depts, lines, roles MASTER DATA se seed hote hain. USERS me `admin` (PIN `1234`) banta hai — **PIN badlo**.
3. **Deploy > New deployment > Web app** — Execute as: *Me*, Access: *Anyone*. Web app URL copy karo.
4. `docs/config.js` me `API_URL` paste karo.
5. GitHub repo -> Settings -> Pages -> Source: *Deploy from branch*, Branch: `main`, Folder: `/docs`.
6. Phone pe Pages URL kholo -> Chrome menu -> **Add to Home screen**.

## Users

`USERS` tab: `user_id | name | pin | role | factory | depts | active`

- role: `Data Collector` / `Supervisor` / `Manager` / `Admin`
- factory blank = dono factories; depts blank = sab depts (comma-separated list se restrict)
- PIN unique hona chahiye

## Dev

- Backend edit -> `clasp push -f` (Web app deployment ko "Manage deployments > Edit > New version" se update karo)
- Frontend edit -> git push (Pages auto-deploy) — `docs/sw.js` me `CACHE` version badlo taaki phone purana cache chhod de

## Phases

- [x] 1. Setup, login, masters, attendance
- [x] 2. Hourly output (stitching / endline / packing) + loading balance (hard block)
- [x] 3. Manpower events (half day / left / late / absent / extra)
- [x] 4. Day close + manager review + send to final (source sheets)
- [x] 5. Chain validation: Loading >= Stitching >= Endline checked; Endline pass >= Packing
- [x] 6. Offline queue for attendance / hourly / manpower saves
- [ ] 7. Verify FINAL_TARGETS column mapping with `diagFinalTargets()` before first real Send to Final

## Data flow

```
ATT_DAILY  ──┐
HOURLY_LOG ──┼─ day.build ─▶ DAY_SUMMARY (Draft) ─ submit ─▶ Submitted ─ approve ─▶ Approved ─ send ─▶ Sent
MANPOWER   ──┘                                                        └─ reject ─▶ Rejected ─ re-entry ─▶ Draft
```

Send to Final appends only the mapped columns (CFG.FINAL_TARGETS) at the first empty row of each source sheet;
formula columns are never touched. History before CFG.APP_START_DATE is read from MASTER DATA, app-era rows
from HOURLY_LOG, so nothing double counts after runAllImport.
