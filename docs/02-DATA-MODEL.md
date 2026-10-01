# 2 · Data Model

Everything the app knows lives in one SQLite file: `estate.db`. This document
explains the tables, the relationships and — most importantly — the **stock
ledger convention**, which is what makes the stock numbers trustworthy.

## 2.1 Map of the schema

```
estates ──┬── blocks ──────────── entry_rows ──┬── entry_row_buckets
          ├── tappers ────────────┘            └── entry_row_barrels ── barrels
          ├── barrels                            entry_days ── labour_rows
          ├── buyers ──┬── invoices ── invoice_barrels
          │            └── payments ──┐
          ├── vendors ─┬── purchases  ├── cashbook   (double-posted)
          │            └── vendor_payments ─┘
          ├── stock_items
          ├── config_lists   (E-codes, W-codes, weather, reasons, grades, buckets,
          │                   purchase categories)
          └── sequences      (invoice / bill numbering)

stock_ledger   (every stock movement, every hub)
smokehouse_log (Karukachal sheet pipeline)
import_batches (Day Pack history) · audit_log · settings · users
```

DDL: `src-tauri/migrations/0001_init.sql`.

## 2.2 Core entities

### Estate
`estates(id, name, code, profile_json, letterhead_json)`
One row per estate (seeded: `Karukachal`/`KAR`, `Kulashekaram`/`KUL`).
`profile_json` holds the feature flags described in
[01-ARCHITECTURE](01-ARCHITECTURE.md#14-the-two-estate-modules--configuration-not-forks).
Everything else in the database hangs off `estate_id`.

### Masters
- **`blocks`** — `code` (K1…/B1…), `trees`, assigned `tapper_id`, `arrangement`
  (`Direct` | `Flat-rate` | `Revenue-share`), optional `lease_rate`.
- **`tappers`** — `name`, `type` (Employee/Contract/Lease), `tap_days` (the
  tapping cycle length D1–D4 used by rotation), `status`.
- **`barrels`** — `code` (BR-n), `capacity` (default 200 kg), `tare_weight`.
- **`config_lists`** — the editable coded lists, one row per item, `kind` is one
  of `expenseCat` (E1…), `workType` (W1…), `weather`, `reason`, `bucket`,
  `sheetGrade`, `purchaseCat` (Fertiliser, Weedicide, Tools, Other — the
  Purchase register's category column). `locked=1` rows cannot be deleted
  (e.g. "Bucket 1/2" match the physical register book).
- **`buyers` / `vendors` / `stock_items`** — parties and other-crop items.
  "Deleting" sets `active=0` so history is preserved.

### Daily register
- **`entry_days`** — one row per estate per date (unique). Header fields exactly
  like the paper register: `date`, `weather`, `supervisor`, `page_no`, `remarks`,
  optional `photo`.
- **`entry_rows`** — one row per block per day (unique `day_id+block_id`, which is
  also the clash-detection rule). Carries `product_mode` (`Sheet`/`Latex`),
  `status` (`Completed`/`Not Done`), `reason`, `tapped_despite_rain`,
  trees scheduled/tapped, `wet_sheets`, `scrap_kg`, `tare_kg`, and `sale_id`
  once the row's barrels are part of a completed sale (then it is locked).
- **`entry_row_buckets`** — the weighing workflow: `label` (Bucket 1…) + `kg`.
- **`entry_row_barrels`** — which barrels the row poured into and how many kg.
- **`labour_rows`** — either aggregate (`men`, `women`, `work_type` code) for
  Karukachal-style registers, or per-worker (`name`, `sex`, `work_type`, `who`,
  `where_`) for Kulashekaram-style.

### Money
- **`invoices`** — `invoice_no` (unique per estate, from `sequences`), `grade`,
  `qty`, `rate`, `paper_rate`, `drc`, `advance`, `value`, `status`, an optional
  `photo` (bill snapshot — a compressed JPEG data URL, same storage as
  `entry_days.photo`), and two more weights: `formalin_kg` (formalin mixed into
  the latex) and `buyer_qty` (the buyer's own scale reading at handover, both
  nullable). **`qty` keeps meaning the estate's recorded weight** — stock,
  dispatch and the ±0.05 kg guard are untouched — while the invoice is billed
  on `billedQty(qty, formalin_kg, buyer_qty)`
  ([03-DOMAIN-LOGIC §3.13](03-DOMAIN-LOGIC.md#313-sale-weights--estate-scale-vs-buyer-scale)).
  **`value` is NULL while `status='Pending DRC'`** — latex is sold before the
  buyer's DRC test comes back, so the invoice only holds an advance until
  finalised.
- **`invoice_barrels`** — which barrels (and kg) the invoice emptied.
- **`payments`** — buyer payments (`Settlement`, `Advance — Latex`, …). Every
  payment is double-posted: it also creates a `cashbook` row and stores that id
  in `cashbook_id`, so the cash book is always complete and the buyer ledger can
  show both sides.
- **`cashbook`** — the weekly income & expense register (`income`, `expense`,
  `category_code`, `sub`, `advance`, `photo`, `source_ref` linking back to the
  payment/purchase that generated it).
- **`purchases` / `vendor_payments`** — the purchase register, each purchase
  carrying a `category_code` (Fertiliser / Weedicide / Tools / Other — a
  `config_lists` `purchaseCat` row, editable in Estate setup) and an optional
  `photo` (bill snapshot); vendor payments double-post to the cash book the
  same way.

### Smokehouse
- **`smokehouse_log`** — one sheet movement per date (`wet_in`, `dry_out`,
  `note`). `person` (default `'Estate'`) records whose sheets the movement is,
  so the three stage totals can be shown **per person** when the smokehouse is
  shared; rows saved before the column existed count as the estate's own
  ([03-DOMAIN-LOGIC §3.7](03-DOMAIN-LOGIC.md#37-smokehouse-pipeline-karukachal)).

## 2.3 The stock ledger — the one source of truth

Every pool of physical goods (latex, each sheet grade, scrap, each other crop) is
**derived** from `stock_ledger`, never maintained as a hand-edited balance. This
is the single most important design decision in the app: it is why there are no
"self-healing" reconciliation effects like in the prototypes.

```
stock_ledger(estate_id, hub, date, qty_delta, reason, ref_table, ref_id)
```

**Hub naming:** `latex` · `scrap` · `sheet:RSS4` · `sheet:RSS5` ·
`sheet:Ungraded` · `crop:<stockItemId>`.

**Reason convention (`qty_delta` is signed):**

| reason | meaning | sign |
|---|---|---|
| `manual` | manual stock add (with `ref_table` = `manual:<note>`) | + |
| `dispatch` | moved from field/barrel pool to the warehouse pool | + to warehouse |
| `sale` | sold (linked `ref_id` = invoice id) | − |
| `sale-reversal` | an invoice was deleted | + |

**Barrel fill** (latex hub) is computed, not stored:

```
fill(barrel) = poured (Σ entry_row_barrels.kg)
             + manual adds
             − dispatched (Σ dispatch kg for that barrel)
             − sold      (Σ invoice_barrels.kg)
```

**Reconciliation pill:** the hub checks
`|collected − sold − (in-barrels + dispatched)| < 0.05 kg` and, on mismatch,
lists the entries whose barrel weights do not reconcile with their net latex —
exactly the "entries needing correction" behaviour the estate asked for.

## 2.4 Numbering without collisions

`sequences(estate_id, name, next_val)` hands out invoice numbers
(`KAR-INV-1`…), purchase bill numbers (`PB-1`…), other-crop invoices (`OC-1`…)
and Day Pack ids. Deleting an invoice therefore never lets the next one reuse its
number — a bug in both prototypes.

## 2.5 Import & audit trail

- **`import_batches`** — every committed Day Pack: filename, row count, summary,
  status. The history table answers "where did this day come from?".
- **`audit_log`** — who changed what and when (`save_day`, edits, deletes).
- **`settings`** — key/value app state (e.g. whether seeding has run).

## 2.6 Schema evolution

Migrations live in `src-tauri/migrations/*.sql` and are registered in
`src-tauri/src/lib.rs` with increasing `version` numbers. They run automatically
and atomically on first launch after an update. **Rules:** never edit a shipped
migration — append a new one; keep each migration idempotent where possible;
mirror every schema change into this document and `src/domain/types.ts`.

Shipped so far:

| migration | what it adds |
|---|---|
| `0001_init.sql` | the schema above |
| `0002_sale_weights.sql` | `invoices.formalin_kg`, `invoices.buyer_qty` (#1, #11) |
| `0003_photos.sql` | `invoices.photo`, `purchases.photo` (#4) |
| `0004_purchase_categories.sql` | `purchases.category_code` (#5) |
| `0005_smokehouse_person.sql` | `smokehouse_log.person` default `'Estate'` (#6) |
