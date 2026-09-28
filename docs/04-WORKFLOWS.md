# 4 · Workflows

How work actually flows through the app — the two estate workflows, the Day Pack
sync over WhatsApp, and a typical day/season.

## 4.1 The people and the paper

```
  Field workers (Tamil, keypad phones)
        │  write the paper register book (unchanged)
        ▼
  Office staff (2 people) — their computer
        │  transcribe the register into Daily Entry → Save day
        │  Export Day Pack (.xlsx) → WhatsApp
        ▼
  Owner (Ninan) — his laptop
        │  Import Day Pack → review → Commit
        │  sells, pays, analyses
        ▼
  Buyers / vendors (money moves; invoices & ledgers in the app)
```

Nothing here needs the internet. The only "sync" is a file on WhatsApp.

## 4.2 Estate workflows side by side

### Karukachal — the sheet workflow
1. Tappers work on a **rotation**: each tapper has a cycle (D1–D4) and only the
   blocks due today appear in Daily Entry ("Show all blocks" for catch-up).
   Flat-rate lease blocks (K3) do **not** rotate in.
2. Each due row records either **Sheet** (wet sheets + scrap) or **Latex**
   (which barrel it was poured into) via the per-row mode switch.
3. Wet sheets go to the **Smokehouse log**: record wet-in / dry-out. This drives
   the three stock stages (waiting → in smokehouse → in storeroom).
4. Sheets are graded **at sale** (RSS4 / RSS5 / Ungraded) in **Sheet stock**.
5. Latex and scrap sell from their own hubs. Lease block K3 also has a direct
   "record lease production" path, and its all-time kg-sold figure feeds the
   lease-renewal decision.
6. Labour is recorded in **aggregate** rows (men / women / W-code task).

### Kulashekaram — the latex workflow
1. **Every block, every day** — no rotation; nine blocks × 450 trees.
2. Latex is **weighed**: Bucket 1 + Bucket 2 (+ extra) − Tare = net latex.
3. The net is split across up to **two barrels** with live capacity checks
   (200 kg); "Auto-fill suggested barrels" fills to capacity and mints new
   barrels when everything is full. Save is blocked on mismatch or overfill.
4. Barrels are **dispatched** to the warehouse FIFO (oldest first), then sold.
   Latex sales are usually **Pending DRC** — advance today, finalise when the
   buyer reports the DRC%.
5. Labour is recorded **per worker** (name / sex / task / where).
6. Optional **logbook photo** per date (compressed to 1200 px JPEG).

Both workflows share everything after production: purchase register, weekly cash
book, ledgers, analysis, reports. Which screens and validations apply is decided
by the estate profile — see [01-ARCHITECTURE §1.4](01-ARCHITECTURE.md#14-the-two-estate-modules--configuration-not-forks).

## 4.3 The Day Pack — syncing without a server

The Day Pack is a styled Excel workbook that is the *contract* between the
office computer and the owner's laptop.

**On the office computer (Staff account):**
1. Finish the day in **Daily entry** and **Save day** (a Day Pack can only be
   exported for a saved day).
2. Open **Day Pack → Export a day**, pick the date → a file like
   `Karukachal_DayPack_2026-09-27.xlsx` is saved.
3. Send it to the owner on WhatsApp.

**On the owner's laptop (Admin account):**
1. Open **Day Pack → Import a day pack** and choose the file.
2. **Review** before anything is written:
   - day header summary (date, supervisor, weather, remarks);
   - every entry row with a badge — **New** (no such row yet), **Update** (row
     exists, will be refreshed), **Conflict** (a row already exists for the same
     date + block);
   - entities that will be auto-created (unknown blocks/tappers/barrels);
   - pick the conflict policy: **Replace day** (whole day is rewritten) or
     **Skip conflicting rows**.
3. **Commit** — everything is written in one SQLite transaction. Either the whole
   day lands or nothing does. An `import_batches` record is kept for the history.

**What is inside the workbook**

| Sheet | Contents |
|---|---|
| `DayInfo` | Estate, date, day name, page no, supervisor, weather, remarks |
| `Entries` | Block, tapper, mode, status, reason, rain flag, trees, wet sheets, scrap, tare, buckets (`Label:kg`), barrels (`CODE:kg`), net kg |
| `Labour` | Name, sex, men, women, work type, who, where |
| `Smokehouse` | Wet in / dry out / note (sheet estates only) |
| `manifest` | Hidden sheet holding the exact JSON payload + format version, so the import is lossless even if someone edits columns by hand |

The import also accepts a hand-typed workbook without the manifest sheet (it
falls back to parsing the columns), which makes ad-hoc corrections possible.

**Full-fidelity movement between machines** (e.g. changing laptops) is not a Day
Pack — use **Settings → Create backup / Restore from backup** to move the whole
database.

## 4.4 A typical day

1. **6–10 am** — field workers tap and write the paper register.
2. **Morning** — office staff opens the app, goes to **Daily entry**, picks the
   date, transcribes the register (Tab/Enter flow, one block per row), checks the
   totals footer, **Save day**.
3. **Export Day Pack** → WhatsApp to the owner.
4. **Owner** imports it during the day, then works through **Barrel stock** /
   **Sheet stock**: dispatch what is full, record sales as they happen.
5. Money movements (buyer payments, vendor payments, wages, purchases) go into
   **Income & expenses** — the weekly cash book. The reconciliation pill tells
   you whether income equals expenses plus cash in hand.
6. Glance at **Dashboard** for today's KPIs and gap alerts.

## 4.5 A typical season (Apr–Mar)

- **Weekly** — cash book reconciliation, buyer settlements, purchase bills.
- **Monthly** — Trends (Monthly granularity) to see production and price
  movement; Tapper/Block performance for wages and bonuses.
- **Seasonally** — Season granularity on Trends; the **kg-sold-by-block** figure
  on Block performance for the Flat-rate lease decision; Rain-cover ROI card to
  decide whether to buy more covers; **Reports → master sheet** export as the
  accountant's pack.

## 4.6 Roles

| | Admin (owner) | Staff (office) |
|---|---|---|
| Daily entry & Day Pack export | ✔ | ✔ |
| Day Pack **import** & Entry history | ✔ | — |
| Stock, cash book, purchases | ✔ | ✔ |
| Estate setup (Masters), Settings backup/restore | ✔ | — |
| Reports | ✔ | ✔ |

Login is local to the machine (PBKDF2-hashed). It separates screens and
attributes edits — it is not a defence against someone with the laptop. Change
the seeded passwords in Settings after install.
