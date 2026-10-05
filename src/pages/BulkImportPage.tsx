import { useState } from "react";
import { toast } from "sonner";
import { Download, Upload, TriangleAlert, History, Trash2 } from "lucide-react";
import { useApp } from "../app/store";
import { useMasters, useQuery } from "../db/hooks";
import { select, tx, type SqlValue, type TxStmt } from "../db/client";
import {
  countRows,
  loadBatches,
  makeUndoPlan,
  parseUndoPlan,
  undoImport,
  type BatchRow,
} from "../db/imports";
import { Badge, Card, Confirm, EmptyState, Field, PageHeader, Table } from "../ui/components";
import { fmtDate, fmtNum } from "../domain/dates";
import {
  chunkInsert,
  exportBulkTemplate,
  pickAndReadBulkWorkbook,
  type BulkParsed,
  type KnownMasters,
} from "../io/bulkimport";

function nextBarrelNumber(codes: string[]): number {
  let max = 0;
  for (const c of codes) {
    const m = /^BR-(\d+)$/.exec(c);
    if (m) max = Math.max(max, Number(m[1]));
  }
  return max + 1;
}

export function BulkImportPage() {
  const estate = useApp((s) => s.estate)!;
  const user = useApp((s) => s.user);
  const bump = useApp((s) => s.bump);
  const masters = useMasters(estate.id);

  const [parsed, setParsed] = useState<BulkParsed | null>(null);
  const [policy, setPolicy] = useState<"skip" | "replace">("skip");
  const [existingDays, setExistingDays] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);

  const history = useQuery<BatchRow>(() => loadBatches(estate.id, "bulk"), [estate.id]);
  const [undoing, setUndoing] = useState<BatchRow | null>(null);

  const known = (): KnownMasters => ({
    blocks: masters.blocks.map((b) => b.code),
    tappers: masters.tappers.map((t) => t.name),
    barrels: masters.barrels.map((b) => b.code),
    buyers: masters.buyers.map((b) => b.name),
    vendors: masters.vendors.map((v) => v.name),
    purchaseCats: masters.list("purchaseCat").map((c) => ({ code: c.code, label: c.label })),
    expenseCats: masters.list("expenseCat").map((c) => ({ code: c.code, label: c.label })),
  });

  const downloadTemplate = async () => {
    try {
      const ok = await exportBulkTemplate(estate, known());
      if (ok) toast.success("Template saved — fill it in and import it here");
    } catch (err) {
      console.error(err);
      toast.error("Could not write the template");
    }
  };

  const choose = async () => {
    setBusy(true);
    try {
      const res = await pickAndReadBulkWorkbook(known());
      if (!res) return;
      // A file whose every row failed validation is not an empty file. Show
      // the review so the errors are visible, rather than claiming it is blank.
      const nothing =
        !res.days.length && !res.sales.length && !res.purchases.length &&
        !res.cash.length && !res.payments.length && !res.vendorPayments.length;
      if (nothing && !res.errors.length) {
        toast.error("Nothing to import — the sheets are empty");
        setParsed(null);
        return;
      }
      // which of these dates already have a register saved?
      const dates = res.days.map((d) => d.date);
      let clash: string[] = [];
      if (dates.length) {
        const rows = await select<{ date: string }>(
          `SELECT date FROM entry_days WHERE estate_id=$1 AND date >= $2 AND date <= $3`,
          [estate.id, res.dateRange!.from, res.dateRange!.to]
        );
        const have = new Set(rows.map((r) => r.date));
        clash = dates.filter((d) => have.has(d));
      }
      setExistingDays(clash);
      setParsed(res);
    } catch (err) {
      console.error(err);
      toast.error("Could not read that file — check it is an .xlsx workbook");
    } finally {
      setBusy(false);
    }
  };

  const commit = async () => {
    if (!parsed) return;
    setBusy(true);
    try {
      const maxes = await select<Record<string, number>>(
        `SELECT
           (SELECT COALESCE(MAX(id),0) FROM blocks)            AS blk,
           (SELECT COALESCE(MAX(id),0) FROM tappers)           AS tap,
           (SELECT COALESCE(MAX(id),0) FROM barrels)           AS bar,
           (SELECT COALESCE(MAX(id),0) FROM buyers)            AS buy,
           (SELECT COALESCE(MAX(id),0) FROM vendors)           AS ven,
           (SELECT COALESCE(MAX(id),0) FROM entry_days)        AS day,
           (SELECT COALESCE(MAX(id),0) FROM entry_rows)        AS row,
           (SELECT COALESCE(MAX(id),0) FROM entry_row_buckets) AS bkt,
           (SELECT COALESCE(MAX(id),0) FROM entry_row_barrels) AS brl,
           (SELECT COALESCE(MAX(id),0) FROM labour_rows)       AS lab,
           (SELECT COALESCE(MAX(id),0) FROM smokehouse_log)    AS smk,
           (SELECT COALESCE(MAX(id),0) FROM invoices)          AS inv,
           (SELECT COALESCE(MAX(id),0) FROM purchases)         AS pur,
           (SELECT COALESCE(MAX(id),0) FROM cashbook)          AS csh,
           (SELECT COALESCE(MAX(id),0) FROM invoice_barrels)   AS ivb,
           (SELECT COALESCE(MAX(id),0) FROM stock_ledger)      AS stk,
           (SELECT COALESCE(MAX(id),0) FROM payments)          AS pay,
           (SELECT COALESCE(MAX(id),0) FROM vendor_payments)   AS vpy`,
        []
      );
      const m = maxes[0];
      const stmts: TxStmt[] = [];
      const lower = (s: string) => s.trim().toLowerCase();

      /* ---- 1. create the masters the file referred to but we do not have */
      const blockId = new Map<string, number>();
      for (const b of masters.blocks) blockId.set(lower(b.code), b.id);
      let blkSeq = m.blk;
      const newBlocks: SqlValue[][] = [];
      for (const code of parsed.unknown.blocks) {
        if (blockId.has(lower(code))) continue;
        blkSeq += 1;
        blockId.set(lower(code), blkSeq);
        newBlocks.push([blkSeq, estate.id, code, code, 0, null, "Direct", 1]);
      }
      stmts.push(
        ...chunkInsert(
          "blocks",
          ["id", "estate_id", "code", "name", "trees", "tapper_id", "arrangement", "active"],
          newBlocks
        )
      );

      const tapperId = new Map<string, number>();
      for (const t of masters.tappers) tapperId.set(lower(t.name), t.id);
      let tapSeq = m.tap;
      const newTappers: SqlValue[][] = [];
      for (const name of parsed.unknown.tappers) {
        if (tapperId.has(lower(name))) continue;
        tapSeq += 1;
        tapperId.set(lower(name), tapSeq);
        newTappers.push([tapSeq, estate.id, name, "Employee", 2, "Active", 0]);
      }
      stmts.push(
        ...chunkInsert(
          "tappers",
          ["id", "estate_id", "name", "type", "tap_days", "status", "sort_order"],
          newTappers
        )
      );

      const barrelId = new Map<string, number>();
      for (const b of masters.barrels) barrelId.set(lower(b.code), b.id);
      let barSeq = m.bar;
      let barNo = nextBarrelNumber(masters.barrels.map((b) => b.code));
      const newBarrels: SqlValue[][] = [];
      for (const code of parsed.unknown.barrels) {
        if (barrelId.has(lower(code))) continue;
        barSeq += 1;
        const finalCode = code || `BR-${barNo++}`;
        barrelId.set(lower(code), barSeq);
        newBarrels.push([barSeq, estate.id, finalCode, 200, null, 1]);
      }
      stmts.push(
        ...chunkInsert(
          "barrels",
          ["id", "estate_id", "code", "capacity", "tare_weight", "active"],
          newBarrels
        )
      );

      const buyerId = new Map<string, number>();
      for (const b of masters.buyers) buyerId.set(lower(b.name), b.id);
      let buySeq = m.buy;
      const newBuyers: SqlValue[][] = [];
      for (const name of parsed.unknown.buyers) {
        if (buyerId.has(lower(name))) continue;
        buySeq += 1;
        buyerId.set(lower(name), buySeq);
        newBuyers.push([buySeq, estate.id, name, "", 1]);
      }
      stmts.push(
        ...chunkInsert("buyers", ["id", "estate_id", "name", "contact", "active"], newBuyers)
      );

      const vendorId = new Map<string, number>();
      for (const v of masters.vendors) vendorId.set(lower(v.name), v.id);
      let venSeq = m.ven;
      const newVendors: SqlValue[][] = [];
      for (const name of parsed.unknown.vendors) {
        if (vendorId.has(lower(name))) continue;
        venSeq += 1;
        vendorId.set(lower(name), venSeq);
        newVendors.push([venSeq, estate.id, name, "", 1]);
      }
      stmts.push(
        ...chunkInsert("vendors", ["id", "estate_id", "name", "contact", "active"], newVendors)
      );

      /* ---- 2. days */
      const clash = new Set(existingDays);
      const importDays = parsed.days.filter((d) => policy === "replace" || !clash.has(d.date));
      const skippedDays = parsed.days.length - importDays.length;

      // a labour or register date that has no day record yet needs one
      const allDates = new Set<string>([
        ...importDays.map((d) => d.date),
        ...parsed.labour.map((l) => l.date),
      ]);
      const sortedDates = [...allDates].sort();
      const existingDayId = new Map<string, number>();
      if (sortedDates.length) {
        const rows = await select<{ id: number; date: string }>(
          `SELECT id, date FROM entry_days WHERE estate_id=$1 AND date >= $2 AND date <= $3`,
          [estate.id, sortedDates[0], sortedDates[sortedDates.length - 1]]
        );
        for (const r of rows) existingDayId.set(r.date, r.id);
      }

      const dayId = new Map<string, number>();
      let daySeq = m.day;
      const newDays: SqlValue[][] = [];
      const replacedIds: number[] = [];
      // days that exist and are only in the Labour sheet: their register stays
      const labourOnlyIds: number[] = [];
      for (const date of sortedDates) {
        const existing = existingDayId.get(date);
        if (existing !== undefined) {
          if (clash.has(date)) {
            // the file carries this day's register
            if (policy === "skip") continue;
            dayId.set(date, existing);
            replacedIds.push(existing);
          } else {
            // Labour-only date on a day that is already recorded: never touch
            // its register. Skip leaves it alone; Replace swaps only the labour.
            if (policy === "skip") continue;
            dayId.set(date, existing);
            labourOnlyIds.push(existing);
          }
          continue;
        }
        const d = importDays.find((x) => x.date === date);
        daySeq += 1;
        dayId.set(date, daySeq);
        newDays.push([
          daySeq,
          estate.id,
          date,
          d?.weather ?? "",
          d?.supervisor ?? "",
          "",
          d?.remarks ?? "",
          user?.id ?? null,
        ]);
      }
      // replacing a day clears what was there before
      for (const id of replacedIds) {
        stmts.push({ sql: "DELETE FROM entry_rows WHERE day_id=$1", params: [id] });
        stmts.push({ sql: "DELETE FROM labour_rows WHERE day_id=$1", params: [id] });
      }
      for (const id of labourOnlyIds) {
        stmts.push({ sql: "DELETE FROM labour_rows WHERE day_id=$1", params: [id] });
      }
      stmts.push(
        ...chunkInsert(
          "entry_days",
          ["id", "estate_id", "date", "weather", "supervisor", "page_no", "remarks", "created_by"],
          newDays
        )
      );

      /* ---- 3. entry rows, buckets, barrels */
      let rowSeq = m.row;
      let bktSeq = m.bkt;
      let brlSeq = m.brl;
      const entryRows: SqlValue[][] = [];
      const bucketRows: SqlValue[][] = [];
      const barrelRows: SqlValue[][] = [];
      for (const d of importDays) {
        const did = dayId.get(d.date);
        if (did === undefined) continue;
        for (const e of d.rows) {
          const bid = blockId.get(lower(e.blockCode));
          if (bid === undefined) continue;
          rowSeq += 1;
          entryRows.push([
            rowSeq,
            did,
            bid,
            e.tapperName ? (tapperId.get(lower(e.tapperName)) ?? null) : null,
            e.productMode,
            e.status,
            e.reason,
            e.tappedDespiteRain ? 1 : 0,
            e.treesScheduled,
            e.treesTapped,
            e.wetSheets,
            e.scrapKg,
            e.tareKg,
          ]);
          e.buckets.forEach((b, i) => {
            if (b.kg <= 0) return;
            bktSeq += 1;
            bucketRows.push([bktSeq, rowSeq, b.label, b.kg, i]);
          });
          e.barrels.forEach((b, i) => {
            const barId = barrelId.get(lower(b.barrelCode));
            if (barId === undefined || b.kg <= 0) return;
            brlSeq += 1;
            barrelRows.push([brlSeq, rowSeq, barId, b.kg, i]);
          });
        }
      }
      stmts.push(
        ...chunkInsert(
          "entry_rows",
          ["id", "day_id", "block_id", "tapper_id", "product_mode", "status", "reason",
           "tapped_despite_rain", "trees_scheduled", "trees_tapped", "wet_sheets",
           "scrap_kg", "tare_kg"],
          entryRows
        )
      );
      stmts.push(
        ...chunkInsert(
          "entry_row_buckets",
          ["id", "row_id", "label", "kg", "sort_order"],
          bucketRows
        )
      );
      stmts.push(
        ...chunkInsert(
          "entry_row_barrels",
          ["id", "row_id", "barrel_id", "kg", "sort_order"],
          barrelRows
        )
      );

      /* ---- 4. labour */
      let labSeq = m.lab;
      const labourRows: SqlValue[][] = [];
      parsed.labour.forEach((l, i) => {
        const did = dayId.get(l.date);
        if (did === undefined) return;
        labSeq += 1;
        labourRows.push([
          labSeq, did, l.name, l.sex, l.men, l.women, l.work_type, l.who, l.where_, i,
        ]);
      });
      stmts.push(
        ...chunkInsert(
          "labour_rows",
          ["id", "day_id", "name", "sex", "men", "women", "work_type", "who", "where_", "sort_order"],
          labourRows
        )
      );

      /* ---- 5. smokehouse */
      let smkSeq = m.smk;
      const smokeRows: SqlValue[][] = parsed.smokehouse.map((s) => {
        smkSeq += 1;
        return [smkSeq, estate.id, s.date, s.wetIn, s.dryOut, s.note, s.person];
      });
      stmts.push(
        ...chunkInsert(
          "smokehouse_log",
          ["id", "estate_id", "date", "wet_in", "dry_out", "note", "person"],
          smokeRows
        )
      );

      /* ---- 6. sales */
      let invSeq = m.inv;
      const invRows: SqlValue[][] = parsed.sales.map((s) => {
        invSeq += 1;
        const value =
          s.drc !== null ? s.qty * (s.drc / 100) * s.rate : s.qty * s.rate;
        return [
          invSeq, estate.id, s.invoiceNo, s.date,
          s.buyer ? (buyerId.get(lower(s.buyer)) ?? null) : null,
          s.grade, s.qty, s.rate, s.drc, 0,
          s.status === "Pending DRC" && s.drc === null ? null : Math.round(value * 100) / 100,
          s.status, s.note,
        ];
      });
      stmts.push(
        ...chunkInsert(
          "invoices",
          ["id", "estate_id", "invoice_no", "date", "buyer_id", "grade", "qty", "rate",
           "drc", "advance", "value", "status", "note"],
          invRows
        )
      );

      /* ---- 6b. the barrels each sale went out in. Writing these is what
         empties a barrel, so the same sixty barrels can be filled again. */
      let ivbSeq = m.ivb;
      let stkSeq = m.stk;
      const invBarrelRows: SqlValue[][] = [];
      const stockRows: SqlValue[][] = [];
      parsed.sales.forEach((s, i) => {
        const invId = m.inv + i + 1;
        for (const b of s.barrels) {
          const barId = barrelId.get(lower(b.barrelCode));
          if (barId === undefined || b.kg <= 0) continue;
          ivbSeq += 1;
          invBarrelRows.push([ivbSeq, invId, barId, b.kg]);
        }
        stkSeq += 1;
        stockRows.push([
          stkSeq, estate.id, /latex/i.test(s.grade) ? "latex" : /scrap/i.test(s.grade) ? "scrap" : "sheet",
          s.date, -s.qty, "sale", "invoices", invId,
        ]);
      });
      stmts.push(
        ...chunkInsert(
          "invoice_barrels",
          ["id", "invoice_id", "barrel_id", "kg"],
          invBarrelRows
        )
      );
      stmts.push(
        ...chunkInsert(
          "stock_ledger",
          ["id", "estate_id", "hub", "date", "qty_delta", "reason", "ref_table", "ref_id"],
          stockRows
        )
      );

      /* ---- 6c. buyer and vendor payments, so the ledgers balance */
      const invIdByNo = new Map<string, number>();
      parsed.sales.forEach((s, i) => invIdByNo.set(lower(s.invoiceNo), m.inv + i + 1));
      let paySeq = m.pay;
      const payRows: SqlValue[][] = parsed.payments.map((p) => {
        paySeq += 1;
        return [
          paySeq, estate.id, buyerId.get(lower(p.buyer)) ?? null, p.date, p.amount,
          p.type, p.note, null,
          p.invoiceNo ? (invIdByNo.get(lower(p.invoiceNo)) ?? null) : null,
        ];
      });
      stmts.push(
        ...chunkInsert(
          "payments",
          ["id", "estate_id", "buyer_id", "date", "amount", "type", "note",
           "cashbook_id", "invoice_id"],
          payRows
        )
      );
      let vpySeq = m.vpy;
      const vpayRows: SqlValue[][] = parsed.vendorPayments.map((v) => {
        vpySeq += 1;
        return [vpySeq, estate.id, vendorId.get(lower(v.vendor)) ?? null, v.date, v.amount, v.note, null];
      });
      stmts.push(
        ...chunkInsert(
          "vendor_payments",
          ["id", "estate_id", "vendor_id", "date", "amount", "note", "cashbook_id"],
          vpayRows
        )
      );

      /* ---- 7. purchases */
      let purSeq = m.pur;
      const purRows: SqlValue[][] = parsed.purchases.map((p) => {
        purSeq += 1;
        return [
          purSeq, estate.id, p.billNo, p.date,
          p.vendor ? (vendorId.get(lower(p.vendor)) ?? null) : null,
          p.item, p.qty, p.unit, p.rate, Math.round(p.qty * p.rate * 100) / 100,
          p.note, p.categoryCode,
        ];
      });
      stmts.push(
        ...chunkInsert(
          "purchases",
          ["id", "estate_id", "bill_no", "date", "vendor_id", "item", "qty", "unit",
           "rate", "value", "note", "category_code"],
          purRows
        )
      );

      /* ---- 8. cash book */
      let cshSeq = m.csh;
      const cashRows: SqlValue[][] = parsed.cash.map((c) => {
        cshSeq += 1;
        return [
          cshSeq, estate.id, c.date, c.particulars, c.categoryCode, c.sub,
          c.income, c.expense, "No", "bulk import",
        ];
      });
      stmts.push(
        ...chunkInsert(
          "cashbook",
          ["id", "estate_id", "date", "particulars", "category_code", "sub",
           "income", "expense", "advance", "source_ref"],
          cashRows
        )
      );

      /* ---- 9. keep invoice and bill numbering ahead of what we inserted */
      if (invRows.length)
        stmts.push({
          sql: "UPDATE sequences SET next_val = next_val + $1 WHERE estate_id=$2 AND name='invoice'",
          params: [invRows.length, estate.id],
        });
      if (purRows.length)
        stmts.push({
          sql: "UPDATE sequences SET next_val = next_val + $1 WHERE estate_id=$2 AND name='purchase'",
          params: [purRows.length, estate.id],
        });

      const summary =
        `${parsed.dateRange?.from} to ${parsed.dateRange?.to} · ` +
        `${newDays.length + replacedIds.length} days, ${entryRows.length} entry rows, ` +
        `${labourRows.length} labour, ${smokeRows.length} smokehouse, ${invRows.length} sales, ` +
        `${purRows.length} purchases, ${cashRows.length} cash rows, ` +
        `${invBarrelRows.length} barrel links, ${payRows.length} buyer payments, ` +
        `${vpayRows.length} vendor payments` +
        (skippedDays ? ` · ${skippedDays} existing day(s) skipped` : "") +
        (newBlocks.length + newTappers.length + newBarrels.length + newBuyers.length + newVendors.length
          ? ` · created ${newBlocks.length} blocks, ${newTappers.length} tappers, ${newBarrels.length} barrels, ${newBuyers.length} buyers, ${newVendors.length} vendors`
          : "");
      // record exactly what this batch wrote, so it can be taken out again
      const undo = makeUndoPlan({
        entry_days:        { first: m.day + 1, count: newDays.length },
        entry_rows:        { first: m.row + 1, count: entryRows.length },
        entry_row_buckets: { first: m.bkt + 1, count: bucketRows.length },
        entry_row_barrels: { first: m.brl + 1, count: barrelRows.length },
        labour_rows:       { first: m.lab + 1, count: labourRows.length },
        smokehouse_log:    { first: m.smk + 1, count: smokeRows.length },
        invoices:          { first: m.inv + 1, count: invRows.length },
        invoice_barrels:   { first: m.ivb + 1, count: invBarrelRows.length },
        stock_ledger:      { first: m.stk + 1, count: stockRows.length },
        payments:          { first: m.pay + 1, count: payRows.length },
        vendor_payments:   { first: m.vpy + 1, count: vpayRows.length },
        purchases:         { first: m.pur + 1, count: purRows.length },
        cashbook:          { first: m.csh + 1, count: cashRows.length },
      });
      // the batch record commits with the data, so an import is never saved
      // without the means to undo it (or reported as failed after it saved)
      stmts.push({
        sql: "INSERT INTO import_batches (estate_id, kind, filename, row_count, status, summary, undo_json) VALUES ($1,'bulk',$2,$3,'Committed',$4,$5)",
        params: [estate.id, parsed.filename, entryRows.length, summary, JSON.stringify(undo)],
      });
      await tx(stmts);

      toast.success(
        `Imported ${entryRows.length} entry rows across ${newDays.length + replacedIds.length} days`
      );
      setParsed(null);
      setExistingDays([]);
      bump();
    } catch (err) {
      console.error(err);
      toast.error("Import failed — nothing was saved. Check the file and try again.");
    } finally {
      setBusy(false);
    }
  };

  const runUndo = async () => {
    if (!undoing) return;
    setBusy(true);
    try {
      const n = await undoImport(undoing);
      toast.success(`Import removed — ${fmtNum(n, 0)} row(s) deleted`);
      setUndoing(null);
      bump();
      history.reload();
    } catch (err) {
      console.error(err);
      toast.error(
        err instanceof Error ? err.message : "Could not remove that import"
      );
    } finally {
      setBusy(false);
    }
  };

  const blocked = !!parsed && parsed.errors.length > 0;
  const totalRows = parsed
    ? parsed.entryRowCount +
      parsed.labour.length +
      parsed.smokehouse.length +
      parsed.sales.length +
      parsed.purchases.length +
      parsed.cash.length +
      parsed.payments.length +
      parsed.vendorPayments.length
    : 0;

  return (
    <div>
      <PageHeader
        title="Bulk import"
        subtitle={`Load years of history into ${estate.name} from one workbook`}
      />

      <div className="mb-4 grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card title="1 — Get the template" icon={<Download size={14} />}>
          <p className="mb-3 text-[12px] text-ink-soft">
            A workbook with the six sheets, your own block and tapper names, and one
            example row in each. Only <b>Daily Register</b> is required — leave the rest
            empty if you have nothing for them.
          </p>
          <button className="btn" onClick={downloadTemplate} disabled={busy}>
            <Download size={14} /> Download template
          </button>
        </Card>

        <Card title="2 — Import the filled workbook" icon={<Upload size={14} />}>
          <p className="mb-3 text-[12px] text-ink-soft">
            Nothing is written until you confirm the review below. The whole import is
            one transaction — if any part fails, none of it is saved.
          </p>
          <button className="btn btn-primary" onClick={choose} disabled={busy}>
            <Upload size={14} /> Choose workbook…
          </button>
        </Card>
      </div>

      {parsed && (
        <Card
          title={`Review — ${parsed.filename}`}
          icon={<TriangleAlert size={14} />}
          right={
            <div className="flex items-center gap-2">
              <button className="btn" onClick={() => setParsed(null)} disabled={busy}>
                Cancel
              </button>
              <button
                className="btn btn-primary"
                onClick={commit}
                disabled={busy || blocked}
                title={blocked ? "Fix the errors below first" : undefined}
              >
                {busy ? "Importing…" : `Import ${fmtNum(totalRows, 0)} rows`}
              </button>
            </div>
          }
        >
          <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-9">
            {[
              ["Period", parsed.dateRange
                ? `${fmtDate(parsed.dateRange.from)} – ${fmtDate(parsed.dateRange.to)}`
                : "—"],
              ["Days", fmtNum(parsed.days.length, 0)],
              ["Entry rows", fmtNum(parsed.entryRowCount, 0)],
              ["Labour", fmtNum(parsed.labour.length, 0)],
              ["Smokehouse", fmtNum(parsed.smokehouse.length, 0)],
              ["Sales", fmtNum(parsed.sales.length, 0)],
              ["Purchases / cash", `${parsed.purchases.length} / ${parsed.cash.length}`],
              ["Payments (buyer / vendor)",
                `${parsed.payments.length} / ${parsed.vendorPayments.length}`],
              ["Barrels emptied by sales",
                fmtNum(parsed.sales.reduce((n, s) => n + s.barrels.length, 0), 0)],
            ].map(([k, v]) => (
              <div key={k} className="rounded-lg border border-paper-line bg-paper-deep p-2.5">
                <div className="label">{k}</div>
                <div className="tnum mt-0.5 text-[13px] font-semibold">{v}</div>
              </div>
            ))}
          </div>

          {existingDays.length > 0 && (
            <div className="mb-4 flex flex-wrap items-end gap-3 rounded-lg border border-paper-line bg-paper-deep p-3">
              <Field label="Days already recorded">
                <select
                  className="input w-[260px]"
                  value={policy}
                  onChange={(e) => setPolicy(e.target.value as "skip" | "replace")}
                >
                  <option value="skip">Skip them — keep what is saved</option>
                  <option value="replace">Replace them with the file</option>
                </select>
              </Field>
              <div className="text-[11.5px] text-ink-soft">
                <b>{existingDays.length}</b> of the {parsed.days.length} days in this file already
                have a register.{" "}
                {policy === "skip"
                  ? "They will be left exactly as they are."
                  : "Their existing rows and labour will be deleted and replaced."}
              </div>
            </div>
          )}

          {parsed.errors.length > 0 && (
            <div className="mb-4">
              <div className="mb-1.5 flex items-center gap-2">
                <Badge tone="bad">{parsed.errors.length} error(s)</Badge>
                <span className="text-[12px] text-ink-soft">
                  Import is blocked until these are fixed in the workbook.
                </span>
              </div>
              <Table headers={["Sheet", "Row", "Problem"]}>
                {parsed.errors.slice(0, 40).map((e, i) => (
                  <tr key={i}>
                    <td>{e.sheet}</td>
                    <td className="tnum">{e.row || "—"}</td>
                    <td>{e.message}</td>
                  </tr>
                ))}
              </Table>
              {parsed.errors.length > 40 && (
                <div className="mt-1.5 text-[11.5px] text-ink-soft">
                  …and {parsed.errors.length - 40} more.
                </div>
              )}
            </div>
          )}

          {parsed.warnings.length > 0 && (
            <div className="mb-4">
              <div className="mb-1.5 flex items-center gap-2">
                <Badge tone="warn">{parsed.warnings.length} warning(s)</Badge>
                <span className="text-[12px] text-ink-soft">
                  These import anyway — check they are what you meant.
                </span>
              </div>
              <Table headers={["Sheet", "Row", "Note"]}>
                {parsed.warnings.slice(0, 20).map((w, i) => (
                  <tr key={i}>
                    <td>{w.sheet}</td>
                    <td className="tnum">{w.row || "—"}</td>
                    <td>{w.message}</td>
                  </tr>
                ))}
              </Table>
            </div>
          )}

          {(parsed.unknown.blocks.length > 0 ||
            parsed.unknown.tappers.length > 0 ||
            parsed.unknown.barrels.length > 0 ||
            parsed.unknown.buyers.length > 0 ||
            parsed.unknown.vendors.length > 0) && (
            <div className="rounded-lg border border-paper-line bg-paper-deep p-3">
              <div className="label mb-1.5">Will be created when you import</div>
              <div className="flex flex-col gap-1 text-[12px]">
                {([
                  ["Blocks", parsed.unknown.blocks],
                  ["Tappers", parsed.unknown.tappers],
                  ["Barrels", parsed.unknown.barrels],
                  ["Buyers", parsed.unknown.buyers],
                  ["Vendors", parsed.unknown.vendors],
                ] as [string, string[]][])
                  .filter(([, list]) => list.length)
                  .map(([k, list]) => (
                    <div key={k}>
                      <b>{k} ({list.length}):</b>{" "}
                      <span className="text-ink-soft">{list.slice(0, 25).join(", ")}</span>
                      {list.length > 25 && (
                        <span className="text-ink-soft"> …and {list.length - 25} more</span>
                      )}
                    </div>
                  ))}
              </div>
              <div className="mt-2 text-[11.5px] text-ink-soft">
                New blocks are created with 0 trees and no tapper — set those in Masters
                afterwards so block and tapper analysis is right.
              </div>
            </div>
          )}
        </Card>
      )}

      <div className="mt-4">
        <Card title="Recent bulk imports" icon={<History size={14} />}>
          {history.rows.length === 0 ? (
            <EmptyState title="No bulk imports yet" hint="Imported files are listed here." />
          ) : (
            <Table headers={["When", "File", "Rows", "Status", "Summary", ""]}>
              {history.rows.map((b) => {
                const plan = parseUndoPlan(b.undo_json);
                return (
                  <tr key={b.id}>
                    <td className="whitespace-nowrap">{b.created_at}</td>
                    <td>{b.filename}</td>
                    <td className="tnum">{b.row_count}</td>
                    <td>
                      <Badge tone="ok">{b.status}</Badge>
                    </td>
                    <td className="text-[11.5px] text-ink-soft">{b.summary}</td>
                    <td className="whitespace-nowrap text-right">
                      {plan ? (
                        <button
                          className="btn btn-danger"
                          onClick={() => setUndoing(b)}
                          disabled={busy}
                          title="Remove everything this import added"
                        >
                          <Trash2 size={13} /> Delete
                        </button>
                      ) : (
                        <span className="text-[11px] text-ink-soft">
                          imported before undo was recorded
                        </span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </Table>
          )}
        </Card>
      </div>
      <Confirm
        open={!!undoing}
        danger
        title="Delete this import?"
        confirmLabel="Delete import"
        message={
          undoing
            ? `This removes the ${fmtNum(
                countRows(parseUndoPlan(undoing.undo_json) ?? {}),
                0
              )} row(s) that "${undoing.filename}" added — days, entries, sales, purchases and cash rows. ` +
              `Anything typed in by hand afterwards is left alone. ` +
              `If this import replaced days that were already in the book, those old rows were deleted at the time and will not come back.`
            : ""
        }
        onConfirm={runUndo}
        onCancel={() => setUndoing(null)}
      />
    </div>
  );
}
