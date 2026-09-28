# 1 · Architecture

How Estate Ledger is put together and why it is built this way.

## 1.1 The problem it solves

Two rubber estates owned by the same owner (Ninan Philip) with genuinely
different ways of working:

- **Karukachal** collects **sheets** — wet sheets go to the smokehouse, come out
  dry, get graded RSS4/RSS5 and sold. Latex is only poured into barrels, never
  weighed day to day.
- **Kulashekaram** collects **latex** — it is weighed every morning
  (buckets − tare) and split into 200 kg barrels before sale.

The field workers write everything in a **paper register book** (they use keypad
phones, not apps). Office staff transcribe the register into a computer. The
owner wants everything on **his own laptop, with no server**.

The result is a single offline desktop app with two *estate modules*, a
register-book-shaped Daily Entry screen, and an Excel-based sync (the "Day Pack")
that rides on WhatsApp.

## 1.2 The stack

| Layer | Choice | Why |
|---|---|---|
| Desktop shell | **Tauri 2** (Rust) | Tiny installer (~10 MB), uses the OS webview, no bundled browser, real file-system access, fully offline |
| Database | **SQLite (WAL)** via `tauri-plugin-sql` | One portable `.db` file per machine, transactional, no service to run |
| Frontend | React 19 + TypeScript + Vite | Type safety across a large feature surface |
| Styling | Tailwind CSS v4 + design tokens | One design system instead of thousands of inline styles |
| State | Zustand (session/estate/route) + SQL-backed queries | Simple, testable |
| Excel | ExcelJS | Styled, human-readable workbooks (Day Pack, reports) |
| Charts | Recharts | Already proven in the prototype apps |
| i18n | react-i18next + Noto Sans Malayalam | English default, മലയാളം toggle, fonts bundled (offline) |

## 1.3 Layering

```
┌────────────────────────────────────────────────────────────┐
│ pages/       screens (Daily Entry, StockHub, Dashboard…)    │
├────────────────────────────────────────────────────────────┤
│ ui/          design-system components (Card, KPI, Table…)   │
├────────────────────────────────────────────────────────────┤
│ app/         shell, sidebar, routing, auth gate, stores     │
├────────────────────────────────────────────────────────────┤
│ db/          query hooks (useMasters, useQuery) + client    │
│ io/          Excel Day Pack + photo compression             │
├────────────────────────────────────────────────────────────┤
│ domain/      pure functions: rotation, latex, valuation,    │
│              periods, expression parser  ← all unit-tested  │
├────────────────────────────────────────────────────────────┤
│ src-tauri/   Rust: schema migration, exec_tx (atomic),      │
│              restore_database, plugin permissions           │
├────────────────────────────────────────────────────────────┤
│ SQLite       estate.db (WAL) in the OS app-config folder    │
└────────────────────────────────────────────────────────────┘
```

Rules of the road:

- **`domain/` never imports React or SQL.** All business maths lives there so it
  can be unit-tested and reused (see `src/domain/domain.test.ts`).
- **`pages/` never write raw ad-hoc SQL strings with string interpolation.**
  Parameters always go through `$1, $2…` placeholders.
- **Multi-table writes go through `tx()`** (`src/db/client.ts`), which calls the
  Rust `exec_tx` command and runs every statement in one SQLite transaction —
  either the whole Day Pack commits or none of it does.

## 1.4 The two estate modules = configuration, not forks

The prototypes were two separate 8,000-line apps that were 95% identical. Here
each estate is a row in `estates` with a **profile** JSON
(`src/domain/profile.ts`) whose flags drive the UI and validation:

| Flag | Karukachal | Kulashekaram |
|---|---|---|
| `productionModes` | Sheet + Latex (per-row switch) | Latex |
| `latexCapture` | `barrel-only` | `weighing` (buckets − tare) |
| `rotation` | ✔ day-index due blocks | ✘ all blocks daily |
| `arrangements` | ✔ Direct / Flat-rate / Revenue-share | ✘ |
| `smokehouse` | ✔ wet→dry pipeline | ✘ |
| `barrelCapacityCheck` / `autoFillBarrels` | ✘ | ✔ (200 kg) |
| `labour` | aggregate (men/Women/W-codes) | per-worker rows |
| `fixedSheetGrades` | RSS4, RSS5 | — (custom grades instead) |
| `photos`, `attendance`, `gapAlerts`, `seasonGranularity` | ✔ | ✔ |

Every flag is editable in **Estate setup → profile flags**, so a future estate is
a new row plus toggles, not new code. Two presets are seeded at first launch.

## 1.5 Screen map

```
Daily Work      Dashboard · Daily entry · Entry history* · Smokehouse log
Analysis        Trends · Tapper performance · Block performance · Missed tapping
                Attendance · Sales analysis
Stock & Money   Barrel stock (Latex) · Sheet stock · Scrap stock · Other crop stock
                Purchase register · Income & expenses
Reports & Setup Day Pack · Reports · Estate setup* · Settings
                (* = Admin only)
```

Every stock hub uses the same six sub-tabs: **Stock → Dispatch → Create sale →
Invoices → Buyer ledger → Sales summary**.

## 1.6 Persistence, sync, backup

- **Persistence:** one SQLite database per machine, saved immediately on write.
  Schema changes are versioned Rust migrations (`src-tauri/migrations/`) that run
  automatically on first launch after an upgrade — shipped migrations are never
  edited, only appended.
- **Sync (no server):** the **Day Pack** `.xlsx` (see [04-WORKFLOWS](04-WORKFLOWS.md)).
  Staff machine → WhatsApp → owner machine. The import screen shows a diff and
  commits atomically.
- **Backups:** *Create backup* runs `VACUUM INTO` (a consistent single-file
  snapshot even while the app is open); *Export JSON backup* dumps every table;
  *Restore from backup* swaps the database file (then restart the app).

## 1.7 Security posture

This is a local, offline tool. Login and roles exist to keep the office staff out
of admin screens and to attribute edits in the audit log — **not** to defend
against an attacker with the laptop. Passwords are PBKDF2-SHA256 (100k
iterations) with a per-user salt. All data is only as safe as the machine and the
backup routine — which is why backups are a first-class screen.

## 1.8 What was fixed versus the prototypes

The two prototype apps work but carry known defects. This build deliberately
fixes: invoice numbers re-used after deletion (now `sequences`), the UTC
"today" bug (local dates everywhere), the `category`/`categoryCode` mismatch,
the always-"First entry" gap column, exports that could not be re-imported
(master export/import contracts are now symmetric), delete-all leaving purchases
behind, invoice deletion orphaning its advance payment (now reversed), and the
`Function()`-based arithmetic eval (replaced by a real parser in
`domain/expr.ts`).
