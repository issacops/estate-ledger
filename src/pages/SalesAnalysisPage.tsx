import { useMemo, useState } from "react";
import ExcelJS from "exceljs";
import { save } from "@tauri-apps/plugin-dialog";
import { writeFile } from "@tauri-apps/plugin-fs";
import { toast } from "sonner";
import { FileSpreadsheet } from "lucide-react";
import { useApp } from "../app/store";
import { query, useMasters, useQuery } from "../db/hooks";
import { Badge, Card, EmptyState, PageHeader, Pill, cn } from "../ui/components";
import { fmtDate, fmtMoney, fmtNum, todayISO } from "../domain/dates";
import { rangeForPreset, type FilterRange } from "../domain/periods";
import { invoiceBillingQty, latexValue } from "../domain/valuation";

interface InvRow {
  id: number;
  invoice_no: string;
  date: string;
  buyer_id: number | null;
  buyer_name: string | null;
  grade: string;
  qty: number;
  buyer_qty: number | null;
  formalin_kg: number | null;
  rate: number;
  drc: number | null;
  value: number | null;
  status: string;
}

interface BuyerSalesRow {
  buyer_id: number | null;
  sales: number;
}

interface BuyerPaidRow {
  buyer_id: number | null;
  paid: number;
}

const PRESETS: { key: "season" | "month" | "week" | "ytd" | "all"; label: string }[] = [
  { key: "season", label: "Season" },
  { key: "month", label: "Month" },
  { key: "week", label: "Week" },
  { key: "ytd", label: "YTD" },
  { key: "all", label: "All" },
];

export function SalesAnalysisPage() {
  const estate = useApp((s) => s.estate)!;
  const masters = useMasters(estate.id);
  const [range, setRange] = useState<FilterRange>(() => rangeForPreset("season", todayISO()));
  const [preset, setPreset] = useState("season");
  const [grade, setGrade] = useState("All");

  const invQ = useQuery<InvRow>(
    () =>
      query<InvRow>(
        "SELECT i.id, i.invoice_no, i.date, i.buyer_id, b.name AS buyer_name, i.grade, i.qty, i.buyer_qty, i.formalin_kg, i.rate, i.drc, i.value, i.status FROM invoices i LEFT JOIN buyers b ON b.id = i.buyer_id WHERE i.estate_id = $1 AND i.date >= $2 AND i.date <= $3 ORDER BY i.date DESC, i.id DESC",
        [estate.id, range.from, range.to]
      ),
    [estate.id, range.from, range.to]
  );

  const buyerSalesQ = useQuery<BuyerSalesRow>(
    () =>
      query<BuyerSalesRow>(
        "SELECT buyer_id, COALESCE(SUM(CASE WHEN value IS NOT NULL AND status <> 'Cancelled' THEN value ELSE 0 END), 0) AS sales FROM invoices WHERE estate_id = $1 GROUP BY buyer_id",
        [estate.id]
      ),
    [estate.id]
  );

  const buyerPaidQ = useQuery<BuyerPaidRow>(
    () =>
      query<BuyerPaidRow>(
        "SELECT buyer_id, COALESCE(SUM(amount), 0) AS paid FROM payments WHERE estate_id = $1 GROUP BY buyer_id",
        [estate.id]
      ),
    [estate.id]
  );

  const grades = useMemo(() => {
    const set = new Set<string>();
    for (const i of invQ.rows) set.add(i.grade);
    return ["All", ...[...set].sort()];
  }, [invQ.rows]);

  const filtered = useMemo(
    () => (grade === "All" ? invQ.rows : invQ.rows.filter((i) => i.grade === grade)),
    [invQ.rows, grade]
  );

  const gradeTotals = useMemo(() => {
    const map = new Map<string, { qty: number; value: number }>();
    for (const i of invQ.rows) {
      const cur = map.get(i.grade) ?? { qty: 0, value: 0 };
      // Fix list #11 — kg sold and the average rate are billed weight, so
      // `value / qty` still reconciles with the invoice next to it.
      cur.qty += invoiceBillingQty(i);
      cur.value += Number(i.value) || 0;
      map.set(i.grade, cur);
    }
    return [...map.entries()]
      .map(([g, t]) => ({
        grade: g,
        qty: t.qty,
        value: t.value,
        avgRate: t.qty > 0 ? t.value / t.qty : null,
      }))
      .sort((a, b) => (a.grade < b.grade ? -1 : 1));
  }, [invQ.rows]);

  const buyerRows = useMemo(() => {
    const sales = new Map(buyerSalesQ.rows.map((r) => [r.buyer_id, Number(r.sales) || 0]));
    const paid = new Map(buyerPaidQ.rows.map((r) => [r.buyer_id, Number(r.paid) || 0]));
    const ids = new Set<number | null>([...sales.keys(), ...paid.keys()]);
    return [...ids]
      .map((id) => {
        const s = sales.get(id) ?? 0;
        const p = paid.get(id) ?? 0;
        return {
          id,
          name: id != null ? masters.byId.buyer.get(id)?.name ?? `Buyer #${id}` : "(no buyer)",
          sales: s,
          paid: p,
          outstanding: s - p,
        };
      })
      .sort((a, b) => b.sales - a.sales);
  }, [buyerSalesQ.rows, buyerPaidQ.rows, masters.byId.buyer]);

  const exportSales = async () => {
    try {
      const wb = new ExcelJS.Workbook();
      wb.creator = "Estate Ledger";
      wb.created = new Date();
      const ws = wb.addWorksheet("Sales");
      ws.columns = [
        { header: "Invoice No", key: "no", width: 14 },
        { header: "Date", key: "date", width: 12 },
        { header: "Buyer", key: "buyer", width: 22 },
        { header: "Grade", key: "grade", width: 12 },
        { header: "Qty", key: "qty", width: 10 },
        { header: "Rate", key: "rate", width: 10 },
        { header: "DRC", key: "drc", width: 8 },
        { header: "Value", key: "value", width: 12 },
        { header: "Status", key: "status", width: 12 },
      ];
      for (const inv of filtered) {
        ws.addRow({
          no: inv.invoice_no,
          date: inv.date,
          buyer: inv.buyer_name ?? "",
          grade: inv.grade,
          qty: invoiceBillingQty(inv),
          rate: inv.rate,
          drc: inv.drc ?? "",
          value: inv.value ?? "",
          status: inv.value === null ? "Pending DRC" : inv.status,
        });
      }
      ws.getRow(1).font = { bold: true, color: { argb: "FF1F3D2E" }, size: 10 };
      ws.getRow(1).fill = {
        type: "pattern",
        pattern: "solid",
        fgColor: { argb: "FFEDE6D3" },
      };
      const buffer = await wb.xlsx.writeBuffer();
      const path = await save({
        title: "Export sales",
        defaultPath: `${estate.name}_Sales_${range.from}_${range.to}.xlsx`,
        filters: [{ name: "Excel", extensions: ["xlsx"] }],
      });
      if (!path) return;
      await writeFile(path, new Uint8Array(buffer as ArrayBuffer));
      toast.success("Sales exported");
    } catch {
      toast.error("Export failed");
    }
  };

  return (
    <div>
      <PageHeader
        title="Sales analysis"
        subtitle={`${filtered.length} invoices in range`}
        right={
          <div className="flex flex-wrap items-center gap-2">
            {PRESETS.map((p) => (
              <Pill
                key={p.key}
                active={preset === p.key}
                onClick={() => {
                  setPreset(p.key);
                  setRange(rangeForPreset(p.key, todayISO()));
                }}
              >
                {p.label}
              </Pill>
            ))}
            <span className="flex items-center gap-1 text-[11px] text-ink-soft">
              From
              <input
                type="date"
                className="input w-[140px]"
                value={range.from}
                onChange={(e) => {
                  setPreset("custom");
                  setRange((r) => ({ ...r, from: e.target.value }));
                }}
              />
              To
              <input
                type="date"
                className="input w-[140px]"
                value={range.to}
                onChange={(e) => {
                  setPreset("custom");
                  setRange((r) => ({ ...r, to: e.target.value }));
                }}
              />
            </span>
            <button className="btn btn-primary" onClick={() => void exportSales()}>
              <FileSpreadsheet size={14} /> Export sales (Excel)
            </button>
          </div>
        }
      />

      <div className="mb-4 flex flex-wrap items-center gap-2">
        {grades.map((g) => (
          <Pill key={g} active={grade === g} onClick={() => setGrade(g)}>
            {g}
          </Pill>
        ))}
      </div>

      <Card title="Invoices" pad={false}>
        {filtered.length === 0 ? (
          <div className="p-4">
            <EmptyState title="No invoices in range" hint="Record sales or widen the date range." />
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="register-table">
              <thead>
                <tr>
                  <th>Invoice no</th>
                  <th>Date</th>
                  <th>Buyer</th>
                  <th>Grade</th>
                  <th className="text-right">Estate / billed</th>
                  <th className="text-right">Rate</th>
                  <th className="text-right">DRC</th>
                  <th className="text-right">Value</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((inv) => {
                  const shown =
                    inv.value ?? latexValue(invoiceBillingQty(inv), inv.rate, inv.drc);
                  const billed = invoiceBillingQty(inv);
                  const twoWeights = Math.abs(billed - inv.qty) > 0.004;
                  return (
                    <tr key={inv.id}>
                      <td className="font-semibold whitespace-nowrap">{inv.invoice_no}</td>
                      <td className="whitespace-nowrap">{fmtDate(inv.date)}</td>
                      <td>{inv.buyer_name ?? "—"}</td>
                      <td>{inv.grade}</td>
                      <td className="tnum text-right">
                        {twoWeights ? (
                          <span>
                            {fmtNum(inv.qty)}
                            <span className="block text-[11px] font-bold text-rust">
                              → {fmtNum(billed)} billed
                            </span>
                          </span>
                        ) : (
                          fmtNum(inv.qty)
                        )}
                      </td>
                      <td className="tnum text-right">{fmtMoney(inv.rate)}</td>
                      <td className="tnum text-right">
                        {inv.drc === null ? "—" : fmtNum(inv.drc, 1)}
                      </td>
                      <td className="tnum text-right font-semibold">
                        {shown === null ? "—" : fmtMoney(shown)}
                      </td>
                      <td>
                        {inv.value === null ? (
                          <Badge tone="warn">Pending DRC</Badge>
                        ) : inv.status === "Cancelled" ? (
                          <Badge tone="neutral">Cancelled</Badge>
                        ) : (
                          <Badge tone="ok">Final</Badge>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card title="Buyer summary (all-time)" pad={false}>
          <div className="overflow-x-auto">
            <table className="register-table">
              <thead>
                <tr>
                  <th>Buyer</th>
                  <th className="text-right">Sales value</th>
                  <th className="text-right">Paid</th>
                  <th className="text-right">Outstanding</th>
                </tr>
              </thead>
              <tbody>
                {buyerRows.map((b) => (
                  <tr key={b.id ?? "none"}>
                    <td className="font-semibold whitespace-nowrap">{b.name}</td>
                    <td className="tnum text-right">{fmtMoney(b.sales)}</td>
                    <td className="tnum text-right">{fmtMoney(b.paid)}</td>
                    <td
                      className={cn(
                        "tnum text-right font-semibold",
                        b.outstanding > 0 ? "text-danger" : "text-ok"
                      )}
                    >
                      {fmtMoney(b.outstanding)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>

        <Card title="Grade totals (in range)" pad={false}>
          <div className="overflow-x-auto">
            <table className="register-table">
              <thead>
                <tr>
                  <th>Grade</th>
                  <th className="text-right">Qty</th>
                  <th className="text-right">Value</th>
                  <th className="text-right">Avg rate</th>
                </tr>
              </thead>
              <tbody>
                {gradeTotals.map((g) => (
                  <tr key={g.grade}>
                    <td className="font-semibold">{g.grade}</td>
                    <td className="tnum text-right">{fmtNum(g.qty)}</td>
                    <td className="tnum text-right">{fmtMoney(g.value)}</td>
                    <td className="tnum text-right">
                      {g.avgRate === null ? "—" : fmtMoney(g.avgRate)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      </div>
    </div>
  );
}
