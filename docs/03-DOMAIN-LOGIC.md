# 3 · Domain Logic

The business maths of a rubber estate, and where each piece lives in code. All of
it is in `src/domain/` as pure functions with unit tests
(`src/domain/domain.test.ts`, run with `npx vitest run`).

## 3.1 Tapping rotation (Karukachal)

Rubber trees are not tapped every day — each tapper works on a rotating cycle
(the common system is d/3, i.e. once every three days) so the tapping panel can
recover (over-tapping causes *Tapping Panel Dryness*).

`domain/rotation.ts`:

- `dayIndex(date)` — days since 2020-01-01, so the cycle is deterministic.
- `tappingDayIndexFor(date, cycle)` — `dayIndex % cycle`: which position in the
  cycle "falls due" today.
- `dueBlockIds(date, blocks, tappers)` — blocks are grouped per assigned tapper;
  each day exactly **one** block per tapper is due (the one at today's cycle
  index). **Flat-rate lease blocks never rotate in** (they are recorded via the
  lease-production entry instead). Unassigned blocks are always due.
- "Show all blocks" in Daily Entry passes `showAll`, which returns every
  non-lease block for catch-up entry.

Kulashekaram has `rotation: false` — every block gets a row every day.

## 3.2 Latex weighing (Kulashekaram)

`domain/latex.ts`:

```
gross  = Bucket 1 + Bucket 2 + (extra buckets)
net    = max(0, gross − tare)          // only when the row is Completed
```

Tare is the empty-can weight. The prototype weighed latex only in Kulashekaram;
Karukachal rows record *which barrel* a tapper poured into and get their weight
only at sale time via DRC.

## 3.3 Barrel capacity & allocation

Barrels have a capacity (200 kg by default). When `barrelCapacityCheck` is on:

- `checkAllocation(net, alloc, barrelTotals)` fails if
  `Σ allocated kg ≠ net` (tolerance **0.05 kg**) or if any barrel would exceed
  `capacity + 0.05` across the whole page — the same amber-highlight + blocked
  save behaviour as the prototype.
- `autoAllocate(net, openBarrels)` fills barrels in order up to capacity,
  splitting overflow into the next barrel and reporting how many **new** barrels
  are needed. "Auto-fill suggested barrels" uses it; every row stays overridable.
- `fillStatus(filled, capacity)` → `Empty` / `Open` / `Full` for the stock table.

Barrel *fill* itself is derived from the stock ledger — see
[02-DATA-MODEL §2.3](02-DATA-MODEL.md#23-the-stock-ledger--the-one-source-of-truth).

## 3.4 Dispatch (FIFO)

When latex goes to the warehouse, the **Dispatch** tab suggests the *oldest*
filled barrels first ("Suggest oldest barrels") and can split the last barrel to
hit the exact target kg. Dispatch is recorded as a `stock_ledger` row
(`reason='dispatch'`); it moves the quantity from the barrel pool to the
warehouse pool without inventing or losing kg.

## 3.5 Valuation & DRC

`domain/valuation.ts`. Field latex is about 30–45% dry rubber; the buyer tests a
sample and reports **DRC%** (Dry Rubber Content). Concentrate trades at ~60% DRC.

```
latex value  = qty × (drc / 100) × rate        // NULL until DRC is known
other value  = qty × rate                       // sheets, scrap, other crops
```

- A latex sale without a DRC is stored as **`Pending DRC`** with `value NULL`;
  only the pickup advance is posted (a `payments` row typed `Advance — Latex`
  plus its double-posted cash book line). Enter the DRC later in **Invoices →
  Set DRC%** and the invoice finalises.
- The buyer ledger deliberately leaves pending invoices out of debits — only the
  advance shows as credit until the invoice is finalised.
- **Paper-rate gap:** estates track the "paper rate" (board/market rate). If
  `|paperRate − rate| > Rs 15/kg` the sale shows an amber "wider than the usual
  ~Rs 12 gap" warning worth checking.

## 3.6 Tapper shares & kg-sold-by-block

When a sale empties barrels, kg is apportioned across contributing tappers (and,
for lease judgement, across blocks) **proportional to pour count**
(`shareByCount`) — the same method both prototypes used. For Karukachal's
Flat-rate lease block this yields the all-time **kg sold by block** figure the
owner uses to judge lease renewal (Rs 305/tree/season for K3).

## 3.7 Smokehouse pipeline (Karukachal)

Three computed stages, all in sheet units:

```
wet waiting   = wet sheets produced (daily entries) − wet moved in
in smokehouse = wet in − dry out
in storeroom  = dry out − sheets sold
```

Sheets come out of the smokehouse **ungraded**; grading (RSS4/RSS5/Ungraded)
happens at the buyer's sort, at sale time. RSS is the Indian/international
standard (IS-15361 / Green Book): RSS4/RSS5 are the tyre/retreading grades a
small estate actually produces.

**Per person.** The smokehouse can be shared (e.g. with John), so every movement
records whose sheets it is (`smokehouse_log.person`, default `Estate`) and the
three stages are shown as one KPI trio **per person** instead of one merged
total. Estate stock, the dashboard and the stock ledger only ever count the
estate's own movements — someone else's sheets pass through the shared
smokehouse without disturbing the estate books. Rows saved before the column
existed count as `Estate`.

## 3.8 Periods

`domain/periods.ts` / `domain/dates.ts`:

- **Week** starts **Monday** (`weekKey`).
- **Month** = calendar `YYYY-MM`.
- **Season** = tapping season **1 Apr → 31 Mar**, labelled `2025-2026`
  (`seasonKey`/`seasonRange`). Everything respects **local** dates — the
  prototype's UTC "today" bug (yesterday's date showing between midnight and
  5:30 am IST) is fixed.
- `bucketDates()` groups a set of dates into Daily/Weekly/Monthly/Season buckets
  for the charts; `pctChange` produces the ▲/▼ comparison arrows.

## 3.9 Gap & missed-tapping analysis

- A row's **gap** = days since that block's previous *Completed* tap. A gap
  larger than the tapper's `tap_days` cycle is flagged **"beyond normal"**.
- The dashboard's **live gap alert** is computed on the fly (self-resolving):
  any block untapped longer than its threshold shows as an amber card until it is
  tapped again.
- **Rain-cover ROI:** tapped-despite-rain days vs. days still lost to heavy rain,
  against expenses whose particulars match `/rain|cover|skirt/i` — the owner
  judges whether rain covers pay for themselves.

## 3.10 Arithmetic in amount fields

`domain/expr.ts` replaces the prototypes' `Function()`-based eval with a small
recursive-descent parser. You can type `750*3+175+150` into any money field; it
accepts digits and `+ - * / ( )` only, evaluates to 2 dp, and refuses anything
else (no identifiers, no function calls). The cash book shows a live
`= 2575` preview or "Can't work that out".

## 3.11 Attendance

- **Tapper attendance** = completed rows ÷ expected days in the period.
- **Labour worker-days** = de-duplicated worker-days (one worker counted once per
  date even if copied across block rows), split men/women, with the most common
  task shown per period.

## 3.12 Reconciliation rules

| Check | Rule |
|---|---|
| Row allocation | `Σ barrel kg = net latex` within 0.05 kg |
| Barrel | projected fill ≤ capacity + 0.05 kg |
| Hub | `|collected − sold − (in-barrels + dispatched)| < 0.05 kg` |
| Cash book week | `income = expenses + cash in hand` within Rs 0.50 |
| Entry uniqueness | one row per date + block (clash detection on save) |

## 3.13 Sale weights — estate scale vs buyer scale

A sale now carries two readings, and each keeps its job (`domain/valuation.ts`):

```
qty        the estate's own scale — stock, dispatch and the ±0.05 kg
           reconciliation guard keep using it, untouched
billedQty  = buyer_qty                         when the buyer's scale was read
           = max(0, qty − formalin_kg)         when only formalin was recorded
           = qty                               otherwise (older invoices)
```

The buyer's own weight wins for **money**; the estate's weight stays the source
of **stock**. So when the buyer's scale differs (or formalin was mixed in), only
the invoice value changes — barrels, hub balances and dispatch history never
move. Rows saved before these fields existed bill exactly as they did before.
The same split drives the dashboard's "kg sold" and Sales analysis.

## 3.14 Buyer ledger — payment types & grouping

`domain/ledger.ts` (fix list #2, #3, #10) — both strictly **display** changes:

- `paymentGroup(type)` is the single classifier behind the filter chips *and*
  the grouped statement: **Invoices**, **Settlement**, **Sales advance**
  (plain `Advance — …`), **Estate advance** (custom grades mentioning estate),
  **Bank advance** (bank/deposit). Unknown, custom or typeless rows fall into
  Sales advance so nothing silently disappears.
- The statement renders group by group with a **subtotal under each heading**,
  in that order.
- **Balances are computed once, chronologically, over the buyer's full
  history.** Filtering or re-ordering into groups only decides which rows are
  shown and under which heading — nothing here ever re-derives a balance from a
  filtered subset.

## 3.15 Purchase categories

A purchase carries a `category_code`, exactly the idea of a cashbook category
(fix list #5). Seeded options: **Fertiliser / Weedicide / Tools / Other**; the
Purchase register shows the category as a column and its Summary tab spends
"by category". New categories are edited in Estate setup → coded lists
(`config_lists` kind `purchaseCat`), mirroring the prototype's editor.

## 3.16 Photo attachments

Invoices and purchase bills accept their own **photo** (fix list #4) — a
compressed JPEG data URL stored exactly like `entry_days.photo` and
`cashbook.photo`. The photo is per-record: attaching one never gates any other
field, and each list (Invoices, Purchases) carries a Photo column/attachment
control.

## 3.17 Tick-to-total totals & average per tree

Three analysis fixes share one arithmetic rule (fix list #7, #8, #9):

- **Checkbox + totals row** — stats tables gain a leading checkbox column with
  a select-all header. The totals row appears only when something is ticked:
  **Estate total** (everything ticked) or **Selected total (n)** (partial).
  Count columns sum directly; averages are **re-derived from the summed totals**
  (never averaged from the averages); non-summable columns (Avg gap, an
  arrangement name) show `—`.
- **Block-wise production per tapper (#8)** — one card, one section per tapper,
  each section its own block table **with its own tick state**, so workers are
  never mixed into one total. Ticking a subset (say Blocks 2 and 3) totals that
  worker's combined figure for only those blocks; a fully ticked section reads
  `"<tapper> — all blocks"`.
- **Average kg per tree (#9)** — on the tapper stats table:
  `avg / tree = the tapper's period latex ÷ the trees on the blocks assigned to
  them` (`blocks.tapper_id`). No assigned blocks → `—`, never a fake zero.

(The Kulashekaram prototype has no per-block assignment, so it falls back to
the blocks the tapper actually worked in the period — flagged for Ninan.)
