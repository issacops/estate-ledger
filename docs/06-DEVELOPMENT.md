# 6 · Development Guide

For anyone building, debugging or extending Estate Ledger.

## 6.1 Prerequisites

- **Node.js 20+** and npm
- **Rust** (stable) + platform build tools
  - Windows: MSVC Build Tools + WebView2 runtime (preinstalled on Win10/11)
  - Linux: `webkit2gtk-4.1`, `libayatana-appindicator` (see Tauri prerequisites)
- Optional: an SQLite CLI for poking at the database.

## 6.2 Commands

```bash
npm install                 # dependencies
npm run tauri dev           # desktop app + Vite hot reload
npm run build               # type-check (tsc) + production frontend build
npx vitest run              # domain kernel tests
npx vitest watch            # while developing kernels
npm run tauri build         # release binary + installers per platform
```

| Output | Where |
|---|---|
| Dev app | opens a window, DB at `~/.config/com.estateledger.app/estate.db` (Linux) / `%APPDATA%\com.estateledger.app\estate.db` (Windows) |
| Release binary | `src-tauri/target/release/estate-ledger` |
| Installers | `src-tauri/target/release/bundle/` (`.msi`/`.exe` on Windows, `.deb`/`.rpm`/`.AppImage` on Linux) |

> Windows installers must be built **on Windows** (`npm run tauri build`), since
> the NSIS/MSI bundlers are platform-native.

## 6.3 Where things live

```
src/domain/        pure logic — rotation, latex, valuation, periods, expr
                   domain.test.ts is the test suite; NO React/SQL imports here
src/db/
  client.ts        select/execute/tx/nextSequence/logAudit/restoreDatabase
  hooks.ts         useQuery, useMasters (blocks/tappers/barrels/lists/buyers…)
  auth.ts          PBKDF2 hashing + login
  seed.ts          first-run: users, two estates + presets, master data
src/io/
  daypack.ts       Excel export/import of the Day Pack (ExcelJS)
  photo.ts         canvas JPEG compression (1200px, q0.72)
src/ui/components.tsx   Card, KPI, Field, Pill, Badge, Modal, Confirm, Table…
src/app/           App.tsx (shell + sidebar + router), store.ts (Zustand)
src/pages/         one file per screen
src/i18n/          en + ml string catalogs
src-tauri/
  migrations/0001_init.sql   schema (append-only versioned migrations)
  src/lib.rs                 plugins, exec_tx (atomic writes), restore_database
  capabilities/default.json  Tauri permissions (fs/dialog/sql scopes)
```

## 6.4 Conventions

- **No comments in code** unless explaining a non-obvious business rule; the
  docs are the documentation.
- **SQL**: always parameterised (`$1, $2…`). Never interpolate user values.
- **Writes that span tables** go through `tx([{sql, params}, …])` — it runs in
  one SQLite transaction via the Rust `exec_tx` command.
- **After any write**, call `useApp.getState().bump()` (or the `bump` from the
  hook) so `useMasters`/`useQuery` re-fetch.
- **Money** uses `evalMath` for user-typed arithmetic and 2-dp rounding;
  quantities round to 3 dp in `domain/latex.ts`.
- **Styling** uses the theme tokens in `src/index.css`
  (`--color-ink`, `--color-paper`, `--color-rust`…) and the shared classes
  `input`, `btn btn-*`, `card`, `register-table`, `label`, `pill`, `tnum`.
  Do not inline colours.
- **Dates** are local `YYYY-MM-DD` strings everywhere — never `toISOString()`.
- **Roles**: admin-only pages are gated in `App.tsx` (`PageRouter`).

## 6.5 How to add a feature (worked example)

Adding a new report page:

1. Create `src/pages/MyReport.tsx` exporting `MyReportPage()`. Use `useApp` for
   the estate, `useMasters`/`query` for data, `PageHeader` + `Card` for layout.
2. Register it in `src/app/App.tsx`: import, add a `NAV` entry under the right
   group, add a `switch` case in `PageRouter`.
3. Add labels to `src/i18n/index.ts` (both `en` and `ml`).
4. If it needs new data, add a migration
   (`src-tauri/migrations/0002_my_feature.sql`) and bump the `version` in
   `src-tauri/src/lib.rs`; mirror the shape into `src/domain/types.ts` and
   [docs/02-DATA-MODEL.md](02-DATA-MODEL.md).
5. Put any maths in `src/domain/` and write tests for it.

Changing an estate workflow: adjust the preset in `src/domain/profile.ts`
(`KARUKACHAL_PROFILE` / `KULASHEKARAM_PROFILE`) and let the flag drive the UI —
see how `profile.latexCapture`, `profile.rotation` etc. are used in
`src/pages/DailyEntry.tsx`.

## 6.6 Testing

```bash
npx vitest run          # all three suites
npx vitest run src/domain/domain.test.ts        # kernels only
npx vitest run src/db/workflows.test.ts         # SQL/flows integration
npx vitest run src/ui/flows.test.tsx            # UI journeys
```

The UI and integration suites run the **real app code** against a real SQLite
database (`node:sqlite`) with the real schema migration. Only the Tauri
boundary is faked — `src/test/fakes/` stands in for `@tauri-apps/plugin-sql`,
`plugin-dialog`, `plugin-fs` and `invoke` (so `exec_tx` transactions, Excel
save/open and backups all execute for real in tests).

- **`src/domain/domain.test.ts`** — rotation, allocation, valuation, expression
  parser, period keys. Add cases whenever you touch domain maths.
- **`src/db/workflows.test.ts`** — seeding, auth/PBKDF2, transaction atomicity
  (rollback on failure), sequence numbering, Day Pack Excel roundtrip, register
  + stock-ledger invariants.
- **`src/ui/flows.test.tsx`** — drives the actual screens: login (both roles),
  every route × both estates renders, Daily Entry save (weighing + sheet modes,
  row locking on revisit), stock-hub pending-DRC sale with advance double-post,
  cash-book arithmetic (`750*3+175+150` → 2575), Masters add-block, Reports and
  Settings backups, role gating.

Keep `tsc` clean (`npm run build` runs it first) and keep the smoke list below
for anything the suites don't reach (print layouts, native dialogs, installer):

1. log in as both roles;
2. Karukachal: save a day with a Sheet row and a Latex row;
3. Kulashekaram: save a day with bucket weights that trigger an overfill
   warning, then fix it, then Auto-fill;
4. export a Day Pack, delete the day, import the Day Pack (Replace day);
5. create a Pending DRC invoice, finalise it, delete it and check stock
   returns;
6. reconcile a cash book week;
7. create a backup and restore it.

## 6.7 Troubleshooting

| Symptom | Cause / fix |
|---|---|
| `permission not granted` at runtime | A capability is missing in `src-tauri/capabilities/default.json`; add the plugin permission and rebuild |
| Database looks empty after a code change | Migrations only run on app start — restart `tauri dev` |
| `VACUUM INTO` fails | The target path already exists; pick a new file name |
| Restore seems to do nothing | The app must be **restarted** after restore (the SQLite connection is already open) |
| Blank window on Linux | Missing WebKitGTK (`libwebkit2gtk-4.1-dev`) |
| Windows build fails on `webview2` | Install the WebView2 Evergreen runtime |
| Excel import finds 0 rows | The workbook must have `Entries`/`manifest` sheets — re-export from the app rather than hand-building files |

## 6.8 Release checklist

1. `npx tsc --noEmit` clean · `npx vitest run` green.
2. Bump `version` in `package.json` **and** `src-tauri/tauri.conf.json`.
3. `npm run tauri build` on the target OS.
4. Smoke-test the installer on a clean machine: install → launch → login →
   create backup → restore.
5. Hand over with the [User Guide](05-USER-GUIDE.md) and remind the owner to
   change the seeded passwords and set up a weekly backup habit.

## 6.9 Known limitations (be honest with yourself)

- Login is local and cosmetic — it separates screens, it is not real security.
- No automated UI tests; the manual smoke list above stands in for them.
- Excel import is tolerant of the app's own exports and the manifest format; a
  heavily hand-edited workbook may need column names fixed by hand.
- The Day Pack carries one day at a time; bulk history moves should use
  backup/restore.
- Multi-user concurrency on one machine is not handled (the app assumes one
  person at a time per machine) — which matches how the estate works today.
