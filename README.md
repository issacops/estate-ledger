# Estate Ledger

Offline desktop app for the **Karukachal** and **Kulashekaram** rubber estates —
one app, two estate modules, **no server**. It runs on the owner's laptop and the
estate office computers; all data lives in a single local SQLite file and moves
between machines as Excel **Day Packs** over WhatsApp.

The Daily Entry screen is laid out exactly like the paper register book the field
workers fill in, so the office staff can transcribe it straight into the app.

---

## Start here

| I am… | Read |
|---|---|
| The owner / office staff, using the app | [docs/05-USER-GUIDE.md](docs/05-USER-GUIDE.md) |
| Curious how the two estate workflows differ | [docs/04-WORKFLOWS.md](docs/04-WORKFLOWS.md) |
| A developer building or changing features | [docs/06-DEVELOPMENT.md](docs/06-DEVELOPMENT.md) |
| Reviewing the design / data model | [docs/01-ARCHITECTURE.md](docs/01-ARCHITECTURE.md) · [docs/02-DATA-MODEL.md](docs/02-DATA-MODEL.md) |
| Checking the business maths (DRC, rotation, barrels…) | [docs/03-DOMAIN-LOGIC.md](docs/03-DOMAIN-LOGIC.md) |

---

## Quick start

```bash
npm install
npm run tauri dev            # desktop app with hot reload (development)
./src-tauri/target/release/estate-ledger   # run the built app
npx vitest run               # domain kernel tests
npm run tauri build          # installers in src-tauri/target/release/bundle
```

**Login (seeded):**

| Email | Password | Role |
|---|---|---|
| `ninanphilp@rubberestate.com` | `ninan123@4` | Admin — everything |
| `dailyentry@rubberestate.com` | `ninan123@4` | Staff — Daily Entry + Day Pack export |

Passwords are PBKDF2-hashed locally. On Windows 10/11 (WebView2 preinstalled),
`npm run tauri build` produces `.msi` / `.exe` installers.

**Data lives in** `%APPDATA%\com.estateledger.app\estate.db` (Windows) or
`~/.config/com.estateledger.app/estate.db` (Linux). Back it up from
**Settings → Create backup**.

---

## What the app contains

- **Daily Entry** — register-book grid, both workflows (Sheet/Latex mode switch or
  bucket weighing), live totals, barrel validation, labour rows, save/export.
- **Day Pack sync** — export the saved day to styled Excel → WhatsApp → owner
  imports with a review screen (New / Update / Conflict) before committing.
- **Stock & money** — barrel/latex hub (FIFO dispatch, DRC-pending sales,
  reconciliation pill), sheet + scrap + other-crop hubs, purchase register with
  vendor ledgers, weekly cash book (arithmetic amount fields, photos, print).
- **Analysis** — dashboard with live gap alerts, trends (Daily / Weekly / Monthly /
  Season Apr–Mar), tapper & block performance, missed tapping, attendance,
  sales analysis, rain-cover ROI.
- **Reports & admin** — 9-sheet master export, profit & loss, per-tree metrics,
  Masters (blocks, tappers, barrels, coded lists, profile flags), Entry History
  with clash detection, backups / restore, English + മലയാളം UI.

## Project layout

```
estate-platform/
├─ src/
│  ├─ domain/     pure business kernels + unit tests (no React)
│  ├─ db/         SQLite client, auth, seeding, query hooks
│  ├─ io/         Day Pack Excel roundtrip, photo compression
│  ├─ ui/         design-system components (paper-ledger theme)
│  ├─ app/        shell, sidebar, routing, stores
│  ├─ pages/      feature screens
│  └─ i18n/       English + Malayalam strings
├─ src-tauri/     Rust shell, schema migration, atomic transactions, restore
└─ docs/          the documentation you are reading
```
