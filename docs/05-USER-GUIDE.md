# 5 · User Guide

Plain-language guide to every screen. Written for the owner and the office
staff — no technical background needed.

## Contents

1. [Signing in](#51-signing-in)
2. [The first thing you see: Dashboard](#52-dashboard)
3. [Daily entry — the register book](#53-daily-entry--the-register-book)
4. [Day Pack — sending the day to the owner](#54-day-pack--sending-the-day-to-the-owner)
5. [Smokehouse log (Karukachal)](#55-smokehouse-log-karukachal)
6. [Stock screens](#56-stock-screens)
7. [Purchase register](#57-purchase-register)
8. [Income & expenses — the weekly cash book](#58-income--expenses--the-weekly-cash-book)
9. [Analysis screens](#59-analysis-screens)
10. [Reports](#510-reports)
11. [Estate setup (Masters)](#511-estate-setup-masters)
12. [Settings — language, backups](#512-settings--language-backups)
13. [Questions people ask](#513-questions-people-ask)

---

## 5.1 Signing in

Open **Estate Ledger**. Type your email and password and press **Sign in**.
The two seeded accounts:

| Email | Password | Who |
|---|---|---|
| `ninanphilp@rubberestate.com` | `ninan123@4` | Owner (Admin) |
| `dailyentry@rubberestate.com` | `ninan123@4` | Office staff |

> Change these passwords after installing. They are only there to separate
> screens between people sharing a computer.

Top-left dropdown switches between **Karukachal** and **Kulashekaram** — each
estate has its own blocks, tappers, register and stock. Bottom-left switches the
whole app between **English** and **മലയാളം**.

## 5.2 Dashboard

The landing page. Four cards:

- **Today** — how many blocks were tapped, wet sheets produced, net latex, and
  how many rows are recorded for today.
- **Stock right now** — latex in barrels and staged in the warehouse, sheet
  totals per grade, scrap.
- **Alerts** — blocks that have gone untapped longer than usual
  (e.g. *"Block K3 untapped for 6 days"*). The alert clears itself once the
  block is tapped again.
- **Profitability** — this season's sales, expenses, net, profit per kg sold and
  cost per wet sheet, plus the month-by-month comparison with ▲/▼ arrows.

## 5.3 Daily entry — the register book

This screen is laid out like the paper register, column for column.

**Top band:** date (with ‹ › day stepping), page no., supervisor, weather,
remarks — exactly the register's header. Karukachal also lets you attach the
logbook photo.

**The register grid — one row per block:**

| Column group | What to type |
|---|---|
| Block · Tapper | Block is fixed; pick the tapper from the list |
| Mode (Karukachal) | **Sheet** or **Latex** for that row |
| Status | `Completed` or `Not Done` |
| Reason | Shown when Not Done (Heavy Rain, Tapper Absent… ) |
| Trees | scheduled / tapped |
| Collection | **Sheet rows:** wet sheets. **Latex rows:** either bucket weights (Kulashekaram: Bucket 1, Bucket 2, Tare — *Net* is calculated for you) or scrap kg (Karukachal) |
| Barrel allocation | which barrels and how many kg each |
| Rain | tick if they tapped despite rain |

Tips:
- **Green Net cell** is computed live — do not type into it.
- If a barrel cell turns **amber**, the weights do not add up or a barrel would
  overfill — fix before saving.
- **Auto-fill barrels** (Kulashekaram) fills each row's net into the barrels in
  order, to capacity. You can override any row.
- **Show all blocks** (Karukachal) reveals every block when you are catching up
  on missed days; by default only the blocks due in today's rotation appear.
- Rows already recorded for that date are greyed — edit them in **Entry history**
  (Admin).
- **Save day** writes everything at once. The totals row at the top always shows
  the current sums.

**Labour** (below the register) is the same as the paper book's labour section:
Karukachal = counts (men / women / W-code / who / where); Kulashekaram = one row
per worker (name / sex / task / who / where). **Add** creates a row; the ✕
deletes one.

## 5.4 Day Pack — sending the day to the owner

- **Office staff:** finish and save the day, then **Export Day Pack** (from Daily
  entry or the **Day Pack** screen) → send the file on WhatsApp.
- **Owner:** **Day Pack → Import a day pack** → choose the file → read the
  review: each row is marked **New**, **Update** or **Conflict**; anything
  missing (a new block, tapper or barrel mentioned in the file) is listed and
  will be created automatically. Choose **Replace day** or **Skip conflicting
  rows**, then **Commit**.
- The **Import history** table shows every pack ever committed (date, file,
  rows).

## 5.5 Smokehouse log (Karukachal)

Shows the three stages of sheet production: **wet waiting** → **in smokehouse** →
**in storeroom** (all calculated). Every movement has a **Person** field
(default *Estate*) — when the smokehouse is shared, pick the owner of the
sheets and the stages are shown as one set of totals **per person**. Estate
stock and the dashboard keep counting only the estate's own sheets. Add
movements as they happen: date, wet in, dry out, note. Export/import the log to
Excel when needed.

## 5.6 Stock screens

Four hubs — **Barrel stock (Latex)**, **Sheet stock**, **Scrap stock**,
**Other crop stock** — all with the same six tabs:

1. **Stock** — what is where. The latex hub shows every barrel with its fill
   (Empty / Open / Full) and a **Reconciled / Mismatch** pill; if it says
   Mismatch, the list below names the entries that need correcting. **Add
   stock** records a manual addition (with a note).
2. **Dispatch** — move goods to the warehouse. Latex: type a target kg and press
   **Suggest oldest barrels** (FIFO), then confirm. Other hubs: type kg.
3. **Create sale** — date, buyer (add a new one inline), grade, rate, paper
   rate, and for latex the DRC% if you know it. **Two scales:** **Estate
   weight (kg)** is the estate's own reading (for latex it comes from the
   barrels emptied) — stock, dispatch and the reconciliation check keep using
   it; **Buyer's weight (kg)** is what the buyer's own scale read at handover,
   and **Formalin weight (kg)** (latex) the formalin mixed in. The form states
   the gap in plain words — *"Difference: 2 kg short of the estate's 100 kg —
   billed on the buyer's 98 kg"* — the invoice bills on the buyer's weight (or
   estate weight less formalin when no buyer weight was read), and
   **N kg billed** shows beside the live value preview. **Attach invoice
   photo** keeps the bill snapshot with the invoice. If the paper rate and the
   rate differ by more than Rs 15/kg you get an amber warning. Confirm to
   write the invoice (numbered automatically), empty the barrels and post any
   advance.
4. **Invoices** — every invoice with its status, an **Estate / billed (kg)**
   column (the estate weight with `→ N billed` under it whenever the buyer's
   weight changed the bill), and a **Photo** column with the bill snapshot
   (attached on the Create sale form). Latex invoices without a DRC are
   marked **Pending DRC** with an amber badge: type the DRC% and press **Set**
   to finalise. Deleting an invoice reverses its stock movement and clears the
   link from the daily entries.
5. **Buyer ledger** — bank-statement style: sales as debit, payments as credit,
   running balance. **Filter chips** pick the payment type (All types /
   Invoices / Settlement / Sales advance / Estate advance / Bank advance), and
   the statement **groups the rows under each heading with a subtotal** — the
   running balance is always the one computed over the buyer's full history.
   Includes **Export ledger (Excel)**, one sheet per buyer.
6. **Sales summary** — totals by grade, top buyers, paper rate vs realised rate.

Recording a **buyer payment** happens in the ledger tab; it is automatically
added to the cash book too — never enter the same money twice.

## 5.7 Purchase register

Four tabs: **Record** (bill number is automatic `PB-n`, vendor, **category** —
Fertiliser, Weedicide, Tools, Other or one you add — item, qty, rate, value,
and an optional **bill photo**), **Purchases** (searchable list with the
category and photo columns), **Vendor ledger** (what you owe and what you paid
— payments double-post into the cash book), **Summary** (spend **by category**
and by item per month — e.g. the fertiliser trend).

## 5.8 Income & expenses — the weekly cash book

The book number and estate name header match the paper cash book.

- **Week navigation** with ‹ › and a date picker.
- **Add row:** date, particulars, category (E1 Tapper Wages, E2 Weeding…),
  income or expense. The amount boxes accept arithmetic: type `750*3+175` and it
  shows `= 2575` as you type. Optional photo (bill snapshot) and advance flag.
- Rows are editable in place; ✕ deletes (with confirmation).
- **Reconciliation pill:** green *"Reconciled — Income equals Expenses plus Cash
  by hand"* when the week balances (within 50 paise), amber otherwise.
- **Category drill-down** shows where the money went per category.
- **Print week** prints a clean register (or use the browser's Save as PDF);
  **Export week (Excel)** round-trips — export, edit offline, import back.

## 5.9 Analysis screens

- **Trends** — production and tapping charts with Daily / Weekly / Monthly /
  Season granularity (Season = Apr–Mar). The **Rain-cover ROI** card compares
  days tapped despite rain, days lost to rain, and any expense whose
  particulars mention rain/cover/skirt.
- **Tapper performance** — who produced what: days worked, blocks tapped,
  missed days, total and average latex/sheets, and **average kg per tree**
  (the tapper's period latex over the trees on the blocks assigned to them; a
  dash when no blocks are assigned). Best in green, worst in red. Click a name
  to see their last 30 entries. Below it, **Block-wise production per
  tapper** splits each worker's numbers block by block with tick boxes: tick
  any subset to see *that* worker's combined total for just those blocks
  (reads **Selected total (2)**), or the header box for all of their blocks
  (reads **"<name> — all blocks"**). Each tapper's totals are independent.
- **Block performance** — the same by block, plus **average latex per tree** and
  **average gap since last tap**. Tick boxes add a totals row — **Estate
  total** when everything is ticked, **Selected total (n)** for a partial
  selection — with the averages re-derived from the summed totals. Flat-rate
  blocks show the all-time **kg sold** figure used for lease renewal.
- **Missed tapping** — every Not Done row with filters, the top 3 reasons, a
  chart, and a **"beyond normal"** flag when the gap exceeds the tapper's
  cycle.
- **Attendance** — tapper attendance rate % and labour worker-days (men/women,
  most common task), with a day-by-day drill-down.
- **Sales analysis** — every sale across all grades in one list, buyer summary
  with outstanding amounts, and grade totals.

## 5.10 Reports

- **At a glance** — total wet sheets, tapping days, sales value, income, expense.
- **Profit & loss** — revenue, expenses, net, latex per tree, income per tree.
- **Download master sheet** — one Excel workbook for the accountant: Daily
  Entries, Labour, Barrel Stock, Invoices, Payments, Buyer Ledger, Income &
  Expenses, Purchases, Summary.

## 5.11 Estate setup (Masters)

Admin only. Everything about how the estate is organised:

- **Blocks** — code, trees, assigned tapper, arrangement (Direct / Flat-rate
  lease / Revenue share), lease rate. **Add block** picks the next code (K5…).
- **Tappers** — name, type, tapping cycle (D1–D4), active/inactive.
- **Barrels** — code, capacity, tare. "Add 10" for bulk.
- **Coded lists** — expense categories (E1…), work types (W1…), weather, not-done
  reasons, bucket labels, sheet grades, **purchase categories** (Fertiliser,
  Weedicide, Tools, Other). Locked rows (Bucket 1/2) match the paper
  book and cannot be deleted.
- **Buyers / Vendors / Stock items** — removing keeps history; it only hides the
  name from pickers.
- **Profile flags** — the switches that make Karukachal and Kulashekaram behave
  differently (rotation, smokehouse, bucket weighing, barrel checks…). Change
  with care; they are the definition of each estate's workflow.

## 5.12 Settings — language, backups

- **Letterhead** — name, address and note printed on invoices.
- **Language** — English / മലയാളം.
- **Create backup** — saves a single `.db` snapshot anywhere you like (USB,
  Documents). Do this weekly.
- **Export JSON backup** — a text copy of every table (for the truly paranoid).
- **Restore from backup** — picks a `.db` snapshot and swaps it in; restart the
  app afterwards.
- **Users / About** — who has an account, and the version.

## 5.13 Questions people ask

**"It says a row is already recorded for this date."**
One row per block per day is enforced, like the paper register. Edit the existing
row in **Entry history** (Admin), or pick a different date.

**"The Net cell is empty / greyed."**
Only Completed latex rows calculate a net. If the row is *Not Done* or in *Sheet*
mode the weighing columns are inactive.

**"A sale says Pending DRC."**
Normal for latex — the buyer tests the sample later. Enter the DRC% on the
Invoices tab and the invoice finalises. The advance you recorded still shows in
the buyer ledger meanwhile.

**"How do I move everything to a new laptop?"**
Settings → **Create backup** on the old machine, copy the file, Settings →
**Restore from backup** on the new one, restart.

**"Nothing happens when the office staff sends me an Excel."**
Use **Day Pack → Import a day pack** (Admin). The file must be one they exported
after **saving** the day.

**"Can the field workers use the app on their phones?"**
No — by design. The paper register stays their interface; the office staff
transcribes it.
