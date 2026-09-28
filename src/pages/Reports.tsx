import { useState } from "react";
import { toast } from "sonner";
import ExcelJS from "exceljs";
import { Download } from "lucide-react";
import { save } from "@tauri-apps/plugin-dialog";
import { writeFile } from "@tauri-apps/plugin-fs";
import { useApp } from "../app/store";
import { useQuery } from "../db/hooks";
import { select } from "../db/client";
import { Card, KPI, PageHeader, Table } from "../ui/components";
import { fmtMoney, fmtNum, todayISO } from "../domain/dates";

interface Totals {
  wetSheets: number;
  tappingDays: number;
  salesValue: number;
  expenses: number;
  income: number;
  trees: number;
  latexKg: number;
}

interface LedgerRow {
  buyer: string;
  date: string;
  particulars: string;
  debit: number;
  credit: number;
  balance: number;
}

const ZERO: Totals = {
  wetSheets: 0,
  tappingDays: 0,
  salesValue: 0,
  expenses: 0,
  income: 0,
  trees: 0,
  latexKg: 0,
};

function styleHeader(row: ExcelJS.Row) {
  row.eachCell((c) => {
    c.font = { bold: true, color: { argb: "FF1F3D2E" }, size: 10 };
    c.fill = {
      type: "pattern",
      pattern: "solid",
      fgColor: { argb: "FFEDE6D3" },
    };
    c.border = {
      top: { style: "thin", color: { argb: "FFE4DCC8" } },
      left: { style: "thin", color: { argb: "FFE4DCC8" } },
      bottom: { style: "thin", color: { argb: "FFE4DCC8" } },
      right: { style: "thin", color: { argb: "FFE4DCC8" } },
    };
    c.alignment = { vertical: "middle", wrapText: false };
  });
}

export function ReportsPage() {
  const estate = useApp((s) => s.estate)!;
  const [busy, setBusy] = useState(false);

  const stats = useQuery<Totals>(async () => {
    const wet = await select<{ n: number }>(
      "SELECT COALESCE(SUM(r.wet_sheets),0) AS n FROM entry_rows r JOIN entry_days d ON d.id=r.day_id WHERE d.estate_id=$1 AND r.product_mode='Sheet' AND r.status='Completed'",
      [estate.id]
    );
    const days = await select<{ n: number }>(
      "SELECT COUNT(*) AS n FROM entry_days WHERE estate_id=$1",
      [estate.id]
    );
    const sales = await select<{ n: number }>(
      "SELECT COALESCE(SUM(value),0) AS n FROM invoices WHERE estate_id=$1 AND value IS NOT NULL",
      [estate.id]
    );
    const exp = await select<{ n: number }>(
      "SELECT COALESCE(SUM(expense),0) AS n FROM cashbook WHERE estate_id=$1",
      [estate.id]
    );
    const inc = await select<{ n: number }>(
      "SELECT COALESCE(SUM(income),0) AS n FROM cashbook WHERE estate_id=$1",
      [estate.id]
    );
    const trees = await select<{ n: number }>(
      "SELECT COALESCE(SUM(trees),0) AS n FROM blocks WHERE estate_id=$1",
      [estate.id]
    );
    const gross = await select<{ n: number }>(
      "SELECT COALESCE(SUM(b.kg),0) AS n FROM entry_row_buckets b JOIN entry_rows r ON r.id=b.row_id JOIN entry_days d ON d.id=r.day_id WHERE d.estate_id=$1",
      [estate.id]
    );
    const tare = await select<{ n: number }>(
      "SELECT COALESCE(SUM(r.tare_kg),0) AS n FROM entry_rows r JOIN entry_days d ON d.id=r.day_id WHERE d.estate_id=$1",
      [estate.id]
    );
    return [
      {
        wetSheets: wet[0]?.n ?? 0,
        tappingDays: days[0]?.n ?? 0,
        salesValue: sales[0]?.n ?? 0,
        expenses: exp[0]?.n ?? 0,
        income: inc[0]?.n ?? 0,
        trees: trees[0]?.n ?? 0,
        latexKg: Math.max(0, (gross[0]?.n ?? 0) - (tare[0]?.n ?? 0)),
      },
    ];
  }, [estate.id]);

  const totals = stats.rows[0] ?? ZERO;
  const net = totals.salesValue - totals.expenses;
  const latexPerTree = totals.trees ? totals.latexKg / totals.trees : 0;
  const incomePerTree = totals.trees ? totals.income / totals.trees : 0;

  const downloadMasterSheet = async () => {
    setBusy(true);
    try {
      const dailyEntries = await select<{
        date: string;
        weather: string;
        supervisor: string;
        block_code: string;
        block_name: string;
        tapper_name: string | null;
        product_mode: string;
        status: string;
        reason: string;
        trees_scheduled: number;
        trees_tapped: number;
        wet_sheets: number;
        scrap_kg: number;
        tare_kg: number;
        tapped_despite_rain: number;
      }>(
        "SELECT d.date, d.weather, d.supervisor, b.code AS block_code, b.name AS block_name, t.name AS tapper_name, r.product_mode, r.status, r.reason, r.trees_scheduled, r.trees_tapped, r.wet_sheets, r.scrap_kg, r.tare_kg, r.tapped_despite_rain FROM entry_rows r JOIN entry_days d ON d.id=r.day_id JOIN blocks b ON b.id=r.block_id LEFT JOIN tappers t ON t.id=r.tapper_id WHERE d.estate_id=$1 ORDER BY d.date, b.code",
        [estate.id]
      );

      const labour = await select<{
        date: string;
        name: string;
        sex: string;
        men: number;
        women: number;
        work_type: string;
        who: string;
        where_: string;
      }>(
        "SELECT d.date, l.name, l.sex, l.men, l.women, l.work_type, l.who, l.where_ FROM labour_rows l JOIN entry_days d ON d.id=l.day_id WHERE d.estate_id=$1 ORDER BY d.date, l.sort_order",
        [estate.id]
      );

      const barrelStock = await select<{
        code: string;
        capacity: number;
        poured: number;
        dispatched: number;
      }>(
        "SELECT br.code, br.capacity, COALESCE((SELECT SUM(eb.kg) FROM entry_row_barrels eb JOIN entry_rows r ON r.id=eb.row_id WHERE eb.barrel_id=br.id),0) AS poured, COALESCE((SELECT SUM(ib.kg) FROM invoice_barrels ib WHERE ib.barrel_id=br.id),0) AS dispatched FROM barrels br WHERE br.estate_id=$1 ORDER BY br.code",
        [estate.id]
      );

      const invoices = await select<{
        invoice_no: string;
        date: string;
        buyer: string | null;
        grade: string;
        qty: number;
        rate: number;
        paper_rate: number | null;
        drc: number | null;
        advance: number;
        value: number | null;
        status: string;
        note: string;
      }>(
        "SELECT i.invoice_no, i.date, b.name AS buyer, i.grade, i.qty, i.rate, i.paper_rate, i.drc, i.advance, i.value, i.status, i.note FROM invoices i LEFT JOIN buyers b ON b.id=i.buyer_id WHERE i.estate_id=$1 ORDER BY i.date, i.invoice_no",
        [estate.id]
      );

      const payments = await select<{
        date: string;
        buyer: string | null;
        amount: number;
        type: string;
        note: string;
      }>(
        "SELECT p.date, b.name AS buyer, p.amount, p.type, p.note FROM payments p LEFT JOIN buyers b ON b.id=p.buyer_id WHERE p.estate_id=$1 ORDER BY p.date",
        [estate.id]
      );

      const cashbook = await select<{
        date: string;
        particulars: string;
        category_code: string;
        sub: string;
        income: number;
        expense: number;
        advance: string;
      }>(
        "SELECT date, particulars, category_code, sub, income, expense, advance FROM cashbook WHERE estate_id=$1 ORDER BY date",
        [estate.id]
      );

      const purchases = await select<{
        bill_no: string;
        date: string;
        vendor: string | null;
        item: string;
        qty: number;
        unit: string;
        rate: number;
        value: number;
        note: string;
      }>(
        "SELECT p.bill_no, p.date, v.name AS vendor, p.item, p.qty, p.unit, p.rate, p.value, p.note FROM purchases p LEFT JOIN vendors v ON v.id=p.vendor_id WHERE p.estate_id=$1 ORDER BY p.date",
        [estate.id]
      );

      const ledgerEvents = new Map<
        string,
        { date: string; particulars: string; debit: number; credit: number }[]
      >();
      const pushEvent = (
        buyer: string,
        ev: { date: string; particulars: string; debit: number; credit: number }
      ) => {
        const list = ledgerEvents.get(buyer) ?? [];
        list.push(ev);
        ledgerEvents.set(buyer, list);
      };
      for (const r of invoices) {
        pushEvent(r.buyer ?? "(no buyer)", {
          date: r.date,
          particulars: `Invoice ${r.invoice_no} · ${r.grade}`,
          debit: r.value ?? 0,
          credit: 0,
        });
      }
      for (const r of payments) {
        pushEvent(r.buyer ?? "(no buyer)", {
          date: r.date,
          particulars: `Payment · ${r.type}`,
          debit: 0,
          credit: r.amount,
        });
      }
      const ledger: LedgerRow[] = [];
      for (const [buyer, list] of [...ledgerEvents.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
        list.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
        let balance = 0;
        for (const ev of list) {
          balance += ev.debit - ev.credit;
          ledger.push({ buyer, ...ev, balance });
        }
      }

      const wb = new ExcelJS.Workbook();
      wb.creator = "Estate Ledger";
      wb.created = new Date();

      const wsDaily = wb.addWorksheet("Daily Entries");
      wsDaily.columns = [
        { header: "Date", key: "date", width: 12 },
        { header: "Weather", key: "weather", width: 14 },
        { header: "Supervisor", key: "supervisor", width: 14 },
        { header: "Block", key: "block", width: 9 },
        { header: "Block name", key: "blockName", width: 16 },
        { header: "Tapper", key: "tapper", width: 16 },
        { header: "Mode", key: "mode", width: 8 },
        { header: "Status", key: "status", width: 11 },
        { header: "Reason", key: "reason", width: 16 },
        { header: "TreesSched", key: "treesSched", width: 11 },
        { header: "TreesTapped", key: "treesTapped", width: 11 },
        { header: "WetSheets", key: "wet", width: 10 },
        { header: "ScrapKg", key: "scrap", width: 9 },
        { header: "TareKg", key: "tare", width: 9 },
        { header: "Rain", key: "rain", width: 8 },
      ];
      for (const r of dailyEntries) {
        wsDaily.addRow({
          date: r.date,
          weather: r.weather,
          supervisor: r.supervisor,
          block: r.block_code,
          blockName: r.block_name,
          tapper: r.tapper_name ?? "",
          mode: r.product_mode,
          status: r.status,
          reason: r.reason,
          treesSched: r.trees_scheduled,
          treesTapped: r.trees_tapped,
          wet: r.wet_sheets,
          scrap: r.scrap_kg,
          tare: r.tare_kg,
          rain: r.tapped_despite_rain ? "Yes" : "No",
        });
      }
      styleHeader(wsDaily.getRow(1));

      const wsLabour = wb.addWorksheet("Labour");
      wsLabour.columns = [
        { header: "Date", key: "date", width: 12 },
        { header: "Name", key: "name", width: 18 },
        { header: "Sex", key: "sex", width: 8 },
        { header: "Men", key: "men", width: 7 },
        { header: "Women", key: "women", width: 8 },
        { header: "WorkType", key: "workType", width: 22 },
        { header: "Who", key: "who", width: 16 },
        { header: "Where", key: "where", width: 16 },
      ];
      for (const r of labour) {
        wsLabour.addRow({
          date: r.date,
          name: r.name,
          sex: r.sex,
          men: r.men,
          women: r.women,
          workType: r.work_type,
          who: r.who,
          where: r.where_,
        });
      }
      styleHeader(wsLabour.getRow(1));

      const wsBarrels = wb.addWorksheet("Barrel Stock");
      wsBarrels.columns = [
        { header: "Barrel", key: "code", width: 12 },
        { header: "Capacity", key: "capacity", width: 12 },
        { header: "PouredKg", key: "poured", width: 12 },
        { header: "DispatchedKg", key: "dispatched", width: 14 },
        { header: "BalanceKg", key: "balance", width: 12 },
      ];
      for (const r of barrelStock) {
        wsBarrels.addRow({
          code: r.code,
          capacity: r.capacity,
          poured: r.poured,
          dispatched: r.dispatched,
          balance: (r.poured ?? 0) - (r.dispatched ?? 0),
        });
      }
      styleHeader(wsBarrels.getRow(1));

      const wsInv = wb.addWorksheet("Invoices");
      wsInv.columns = [
        { header: "Invoice no", key: "invoiceNo", width: 14 },
        { header: "Date", key: "date", width: 12 },
        { header: "Buyer", key: "buyer", width: 18 },
        { header: "Grade", key: "grade", width: 12 },
        { header: "Qty", key: "qty", width: 10 },
        { header: "Rate", key: "rate", width: 10 },
        { header: "Paper rate", key: "paperRate", width: 11 },
        { header: "DRC", key: "drc", width: 8 },
        { header: "Advance", key: "advance", width: 10 },
        { header: "Value", key: "value", width: 12 },
        { header: "Status", key: "status", width: 12 },
        { header: "Note", key: "note", width: 24 },
      ];
      for (const r of invoices) {
        wsInv.addRow({
          invoiceNo: r.invoice_no,
          date: r.date,
          buyer: r.buyer ?? "",
          grade: r.grade,
          qty: r.qty,
          rate: r.rate,
          paperRate: r.paper_rate ?? "",
          drc: r.drc ?? "",
          advance: r.advance,
          value: r.value ?? "",
          status: r.status,
          note: r.note,
        });
      }
      styleHeader(wsInv.getRow(1));

      const wsPay = wb.addWorksheet("Payments");
      wsPay.columns = [
        { header: "Date", key: "date", width: 12 },
        { header: "Buyer", key: "buyer", width: 18 },
        { header: "Amount", key: "amount", width: 12 },
        { header: "Type", key: "type", width: 14 },
        { header: "Note", key: "note", width: 28 },
      ];
      for (const r of payments) {
        wsPay.addRow({
          date: r.date,
          buyer: r.buyer ?? "",
          amount: r.amount,
          type: r.type,
          note: r.note,
        });
      }
      styleHeader(wsPay.getRow(1));

      const wsLedger = wb.addWorksheet("Buyer Ledger");
      wsLedger.columns = [
        { header: "Buyer", key: "buyer", width: 18 },
        { header: "Date", key: "date", width: 12 },
        { header: "Particulars", key: "particulars", width: 30 },
        { header: "Debit", key: "debit", width: 12 },
        { header: "Credit", key: "credit", width: 12 },
        { header: "Balance", key: "balance", width: 12 },
      ];
      for (const r of ledger) {
        wsLedger.addRow({
          buyer: r.buyer,
          date: r.date,
          particulars: r.particulars,
          debit: r.debit,
          credit: r.credit,
          balance: r.balance,
        });
      }
      styleHeader(wsLedger.getRow(1));

      const wsCash = wb.addWorksheet("Income & Expenses");
      wsCash.columns = [
        { header: "Date", key: "date", width: 12 },
        { header: "Particulars", key: "particulars", width: 28 },
        { header: "Category", key: "category", width: 12 },
        { header: "Sub", key: "sub", width: 16 },
        { header: "Income", key: "income", width: 12 },
        { header: "Expense", key: "expense", width: 12 },
        { header: "Advance", key: "advance", width: 10 },
      ];
      for (const r of cashbook) {
        wsCash.addRow({
          date: r.date,
          particulars: r.particulars,
          category: r.category_code,
          sub: r.sub,
          income: r.income,
          expense: r.expense,
          advance: r.advance,
        });
      }
      styleHeader(wsCash.getRow(1));

      const wsPur = wb.addWorksheet("Purchases");
      wsPur.columns = [
        { header: "Bill no", key: "billNo", width: 12 },
        { header: "Date", key: "date", width: 12 },
        { header: "Vendor", key: "vendor", width: 18 },
        { header: "Item", key: "item", width: 18 },
        { header: "Qty", key: "qty", width: 10 },
        { header: "Unit", key: "unit", width: 8 },
        { header: "Rate", key: "rate", width: 10 },
        { header: "Value", key: "value", width: 12 },
        { header: "Note", key: "note", width: 24 },
      ];
      for (const r of purchases) {
        wsPur.addRow({
          billNo: r.bill_no,
          date: r.date,
          vendor: r.vendor ?? "",
          item: r.item,
          qty: r.qty,
          unit: r.unit,
          rate: r.rate,
          value: r.value,
          note: r.note,
        });
      }
      styleHeader(wsPur.getRow(1));

      const wsSummary = wb.addWorksheet("Summary");
      wsSummary.columns = [{ width: 32 }, { width: 22 }];
      wsSummary.addRows([
        ["Metric", "Value"],
        ["Estate", estate.name],
        ["Total wet sheets", totals.wetSheets],
        ["Tapping days", totals.tappingDays],
        ["Total sales value", totals.salesValue],
        ["Total expenses", totals.expenses],
        ["Total income", totals.income],
        ["Net (sales - expenses)", net],
        ["Total trees", totals.trees],
        ["Net latex (kg)", Math.round(totals.latexKg * 1000) / 1000],
        ["Latex per tree (kg)", Math.round(latexPerTree * 1000) / 1000],
        ["Income per tree", Math.round(incomePerTree * 100) / 100],
      ]);
      styleHeader(wsSummary.getRow(1));

      const buffer = await wb.xlsx.writeBuffer();
      const path = await save({
        title: "Save master sheet",
        defaultPath: `${estate.name}_Master_${todayISO()}.xlsx`,
        filters: [{ name: "Excel", extensions: ["xlsx"] }],
      });
      if (!path) return;
      await writeFile(path, new Uint8Array(buffer as ArrayBuffer));
      toast.success("Master sheet downloaded");
    } catch (err) {
      console.error(err);
      toast.error("Could not build the master sheet");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div>
      <PageHeader
        title="Reports"
        subtitle="Totals at a glance and the master Excel export"
        right={
          <button className="btn btn-primary" onClick={() => void downloadMasterSheet()} disabled={busy}>
            <Download size={14} /> Download master sheet
          </button>
        }
      />

      <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-5">
        <KPI label="Total wet sheets" value={fmtNum(totals.wetSheets, 0)} />
        <KPI label="Tapping days" value={fmtNum(totals.tappingDays, 0)} />
        <KPI label="Total sales value" value={fmtMoney(totals.salesValue)} />
        <KPI label="Total expenses" value={fmtMoney(totals.expenses)} tone="warn" />
        <KPI label="Total income" value={fmtMoney(totals.income)} tone="good" />
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <Card title="Profit & loss" pad={false}>
          <Table headers={["Item", "Value"]}>
            <tr>
              <td>Revenue (invoices)</td>
              <td className="tnum text-right">{fmtMoney(totals.salesValue)}</td>
            </tr>
            <tr>
              <td>Expenses (cashbook)</td>
              <td className="tnum text-right">{fmtMoney(totals.expenses)}</td>
            </tr>
            <tr>
              <td className="font-semibold">Net</td>
              <td className="tnum text-right font-semibold">{fmtMoney(net)}</td>
            </tr>
            <tr>
              <td>Latex per tree</td>
              <td className="tnum text-right">{fmtNum(latexPerTree)} kg</td>
            </tr>
            <tr>
              <td>Income per tree</td>
              <td className="tnum text-right">{fmtMoney(incomePerTree)}</td>
            </tr>
          </Table>
          <div className="border-t border-paper-line px-4 py-2 text-[11px] text-ink-soft">
            Per-tree figures divide by the {fmtNum(totals.trees, 0)} trees configured in blocks.
          </div>
        </Card>

        <Card title="Master sheet contents">
          <div className="space-y-1.5 text-[12px] text-ink-light">
            <div>Daily Entries — every register row joined with blocks and tappers.</div>
            <div>Labour — worker counts per day and work type.</div>
            <div>Barrel Stock — poured, dispatched and balance per barrel.</div>
            <div>Invoices &amp; Payments — sales and buyer settlements.</div>
            <div>Buyer Ledger — running balance per buyer.</div>
            <div>Income &amp; Expenses, Purchases — cashbook and purchase register.</div>
            <div>Summary — wet sheets, tapping days, sales, expenses and income totals.</div>
          </div>
        </Card>
      </div>
    </div>
  );
}
