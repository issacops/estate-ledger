import { useMemo, useState } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { Boxes } from "lucide-react";
import { useApp } from "../app/store";
import { query, useMasters, useQuery } from "../db/hooks";
import { Card, EmptyState, PageHeader, Pill, cn } from "../ui/components";
import { fmtDate, fmtNum, todayISO } from "../domain/dates";
import { rangeForPreset, type FilterRange } from "../domain/periods";
import { shareByCount } from "../domain/valuation";

const NEUTRAL = "#D4D4D4";
const BEST = "#00A651";
const WORST = "#E31E24";

interface PerfRow {
  block_id: number;
  date: string;
  product_mode: string;
  status: string;
  wet_sheets: number;
  tare_kg: number;
  bucket_kg: number;
}

interface InvRow {
  date: string;
  block_id: number;
  status: string;
  product_mode: string;
  wet_sheets: number;
  tare_kg: number;
  bucket_kg: number;
}

interface PourRow {
  barrel_id: number;
  block_id: number;
  pours: number;
}

interface InvBarrelRow {
  invoice_id: number;
  barrel_id: number;
  qty: number;
}

const PRESETS: { key: "season" | "month" | "week" | "ytd" | "all"; label: string }[] = [
  { key: "season", label: "Season" },
  { key: "month", label: "Month" },
  { key: "week", label: "Week" },
  { key: "ytd", label: "YTD" },
  { key: "all", label: "All" },
];

export function BlockPerformancePage() {
  const estate = useApp((s) => s.estate)!;
  const masters = useMasters(estate.id);
  const [range, setRange] = useState<FilterRange>(() => rangeForPreset("season", todayISO()));
  const [preset, setPreset] = useState("season");
  const [selected, setSelected] = useState<number | null>(null);

  const rowsQ = useQuery<PerfRow>(
    () =>
      query<PerfRow>(
        "SELECT r.block_id, d.date, r.product_mode, r.status, r.wet_sheets, r.tare_kg, COALESCE((SELECT SUM(b.kg) FROM entry_row_buckets b WHERE b.row_id = r.id), 0) AS bucket_kg FROM entry_rows r JOIN entry_days d ON d.id = r.day_id WHERE d.estate_id = $1 AND d.date >= $2 AND d.date <= $3",
        [estate.id, range.from, range.to]
      ),
    [estate.id, range.from, range.to]
  );

  const poursQ = useQuery<PourRow>(
    () =>
      query<PourRow>(
        "SELECT rb.barrel_id, r.block_id, COUNT(*) AS pours FROM entry_row_barrels rb JOIN entry_rows r ON r.id = rb.row_id JOIN entry_days d ON d.id = r.day_id WHERE d.estate_id = $1 GROUP BY rb.barrel_id, r.block_id",
        [estate.id]
      ),
    [estate.id]
  );

  const invBarrelsQ = useQuery<InvBarrelRow>(
    () =>
      query<InvBarrelRow>(
        "SELECT ib.invoice_id, ib.barrel_id, i.qty FROM invoice_barrels ib JOIN invoices i ON i.id = ib.invoice_id WHERE i.estate_id = $1",
        [estate.id]
      ),
    [estate.id]
  );

  const invQ = useQuery<InvRow>(
    () =>
      selected == null
        ? Promise.resolve([] as InvRow[])
        : query<InvRow>(
            "SELECT d.date, r.block_id, r.status, r.product_mode, r.wet_sheets, r.tare_kg, COALESCE((SELECT SUM(b.kg) FROM entry_row_buckets b WHERE b.row_id = r.id), 0) AS bucket_kg FROM entry_rows r JOIN entry_days d ON d.id = r.day_id WHERE d.estate_id = $1 AND r.block_id = $2 ORDER BY d.date DESC, r.id DESC LIMIT 30",
            [estate.id, selected]
          ),
    [estate.id, selected]
  );

  const kgSoldByBlock = useMemo(() => {
    const poursByBarrel = new Map<number, Map<number, number>>();
    for (const p of poursQ.rows) {
      const perBlock = poursByBarrel.get(p.barrel_id) ?? new Map<number, number>();
      perBlock.set(p.block_id, (perBlock.get(p.block_id) ?? 0) + (Number(p.pours) || 0));
      poursByBarrel.set(p.barrel_id, perBlock);
    }
    const byInvoice = new Map<number, { qty: number; barrels: number[] }>();
    for (const ib of invBarrelsQ.rows) {
      const cur = byInvoice.get(ib.invoice_id) ?? { qty: 0, barrels: [] };
      cur.qty = Number(ib.qty) || 0;
      cur.barrels.push(ib.barrel_id);
      byInvoice.set(ib.invoice_id, cur);
    }
    const out = new Map<number, number>();
    for (const inv of byInvoice.values()) {
      const counts: Record<string, number> = {};
      for (const barrelId of inv.barrels) {
        const perBlock = poursByBarrel.get(barrelId);
        if (!perBlock) continue;
        for (const [blockId, c] of perBlock) {
          const k = String(blockId);
          counts[k] = (counts[k] ?? 0) + c;
        }
      }
      const shares = shareByCount(inv.qty, counts);
      for (const [k, v] of Object.entries(shares)) {
        const blockId = Number(k);
        out.set(blockId, (out.get(blockId) ?? 0) + v);
      }
    }
    return out;
  }, [poursQ.rows, invBarrelsQ.rows]);

  const stats = useMemo(() => {
    const map = new Map<
      number,
      { dateSet: Set<string>; netKg: number; wet: number; missed: number }
    >();
    for (const r of rowsQ.rows) {
      let s = map.get(r.block_id);
      if (!s) {
        s = { dateSet: new Set<string>(), netKg: 0, wet: 0, missed: 0 };
        map.set(r.block_id, s);
      }
      if (r.status === "Completed") {
        s.dateSet.add(r.date);
        if (r.product_mode === "Sheet") s.wet += Number(r.wet_sheets) || 0;
        else s.netKg += Math.max(0, (Number(r.bucket_kg) || 0) - (Number(r.tare_kg) || 0));
      } else if (r.status === "Not Done") {
        s.missed += 1;
      }
    }
    return masters.blocks.map((b) => {
      const s = map.get(b.id) ?? { dateSet: new Set<string>(), netKg: 0, wet: 0, missed: 0 };
      const dates = [...s.dateSet].sort();
      let gapSum = 0;
      for (let i = 1; i < dates.length; i++) {
        const a = new Date(dates[i - 1]).getTime();
        const c = new Date(dates[i]).getTime();
        gapSum += (c - a) / 86400000;
      }
      const netKg = Math.round(s.netKg * 1000) / 1000;
      return {
        id: b.id,
        code: b.code,
        trees: b.trees,
        arrangement: b.arrangement,
        days: dates.length,
        missed: s.missed,
        netKg,
        wet: s.wet,
        perTree: b.trees > 0 ? netKg / b.trees : null,
        avgGap: dates.length > 1 ? gapSum / (dates.length - 1) : null,
        kgSold: kgSoldByBlock.get(b.id) ?? 0,
      };
    });
  }, [rowsQ.rows, masters.blocks, kgSoldByBlock]);

  const useKg = stats.some((s) => s.netKg > 0);
  const anyFlat = stats.some((s) => s.arrangement === "Flat-rate");

  // Fix list #7 — tick blocks to total them together. The totals row shows
  // once anything is ticked: the count columns sum directly, and avg
  // kg / tree is re-derived from the summed values (never averaged from
  // the averages). Avg gap and Sold all-time have no summed equivalent in
  // a period selection, so they stay empty there.
  const [checked, setChecked] = useState<Set<number>>(() => new Set());
  const allChecked = stats.length > 0 && stats.every((s) => checked.has(s.id));
  const toggleBlock = (id: number) =>
    setChecked((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  const toggleAll = () =>
    setChecked(allChecked ? new Set<number>() : new Set(stats.map((s) => s.id)));
  const selectedStats = stats.filter((s) => checked.has(s.id));
  const totTrees = selectedStats.reduce((a, s) => a + s.trees, 0);
  const totDays = selectedStats.reduce((a, s) => a + s.days, 0);
  const totMissed = selectedStats.reduce((a, s) => a + s.missed, 0);
  const totNet = selectedStats.reduce((a, s) => a + s.netKg, 0);
  const totalsLabel =
    selectedStats.length === stats.length
      ? "Estate total"
      : `Selected total (${selectedStats.length})`;

  const chartData = useMemo(() => {
    const rows = stats.map((s) => ({
      name: s.code,
      value: useKg ? s.netKg : s.wet,
      fill: NEUTRAL,
    }));
    if (rows.length === 0) return rows;
    let bestIdx = 0;
    let worstIdx = 0;
    rows.forEach((r, i) => {
      if (r.value > rows[bestIdx].value) bestIdx = i;
      if (r.value < rows[worstIdx].value) worstIdx = i;
    });
    return rows.map((r, i) => ({
      ...r,
      fill: i === bestIdx ? BEST : i === worstIdx && rows.length > 1 ? WORST : NEUTRAL,
    }));
  }, [stats, useKg]);

  const selectedCode = selected != null ? masters.byId.block.get(selected)?.code ?? "" : "";

  return (
    <div>
      <PageHeader
        title="Block performance"
        subtitle={`${stats.length} blocks in range`}
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
          </div>
        }
      />

      <Card className="mb-4" title="Total output by block" right={<Boxes size={14} />}>
        <div className="h-[260px] w-full">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={chartData}>
              <CartesianGrid strokeDasharray="3 3" stroke={NEUTRAL} />
              <XAxis dataKey="name" tick={{ fontSize: 11 }} />
              <YAxis tick={{ fontSize: 11 }} />
              <Tooltip />
              <Bar dataKey="value" name={useKg ? "Net latex kg" : "Wet sheets"}>
                {chartData.map((d, i) => (
                  <Cell key={i} fill={d.fill} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      </Card>

      <Card title="Per-block stats" pad={false}>
        {stats.length === 0 ? (
          <div className="p-4">
            <EmptyState title="No blocks configured" hint="Add blocks in Masters first." />
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="register-table">
              <thead>
                <tr>
                  <th className="text-center">
                    <input
                      type="checkbox"
                      checked={allChecked}
                      onChange={toggleAll}
                      aria-label="Select all blocks"
                    />
                  </th>
                  <th>Block</th>
                  <th className="text-right">Trees</th>
                  <th>Arrangement</th>
                  <th className="text-right">Days tapped</th>
                  <th className="text-right">Missed</th>
                  <th className="text-right">Net latex (kg)</th>
                  <th className="text-right">Avg kg / tree</th>
                  <th className="text-right">Avg gap (days)</th>
                  {anyFlat && <th className="text-right">Sold all-time (kg)</th>}
                </tr>
              </thead>
              <tbody>
                {stats.map((s) => (
                  <tr
                    key={s.id}
                    className={cn("cursor-pointer", selected === s.id && "bg-paper-deep")}
                    onClick={() => setSelected(selected === s.id ? null : s.id)}
                  >
                    <td
                      className="text-center"
                      onClick={(e) => e.stopPropagation()}
                    >
                      <input
                        type="checkbox"
                        checked={checked.has(s.id)}
                        onChange={() => toggleBlock(s.id)}
                        aria-label={`Select ${s.code}`}
                      />
                    </td>
                    <td className="font-semibold whitespace-nowrap">{s.code}</td>
                    <td className="tnum text-right">{fmtNum(s.trees, 0)}</td>
                    <td>
                      {s.arrangement}
                      {s.arrangement !== "Direct" && (
                        <span className="ml-1 text-[9px] text-rust">lease</span>
                      )}
                    </td>
                    <td className="tnum text-right">{fmtNum(s.days, 0)}</td>
                    <td className="tnum text-right">{fmtNum(s.missed, 0)}</td>
                    <td className="tnum text-right">{fmtNum(s.netKg)}</td>
                    <td className="tnum text-right">
                      {s.perTree === null ? "—" : fmtNum(s.perTree, 3)}
                    </td>
                    <td className="tnum text-right">
                      {s.avgGap === null ? "—" : fmtNum(s.avgGap, 1)}
                    </td>
                    {anyFlat && (
                      <td className="tnum text-right">
                        {s.arrangement === "Flat-rate" ? fmtNum(s.kgSold) : "—"}
                      </td>
                    )}
                  </tr>
                ))}
                {selectedStats.length > 0 && (
                  <tr className="border-t-2 border-ink bg-paper-deep font-semibold">
                    <td colSpan={2} className="whitespace-nowrap">
                      {totalsLabel}
                    </td>
                    <td className="tnum text-right">{fmtNum(totTrees, 0)}</td>
                    <td>—</td>
                    <td className="tnum text-right">{fmtNum(totDays, 0)}</td>
                    <td className="tnum text-right">{fmtNum(totMissed, 0)}</td>
                    <td className="tnum text-right">{fmtNum(totNet)}</td>
                    <td className="tnum text-right">
                      {totTrees > 0 ? fmtNum(totNet / totTrees, 3) : "—"}
                    </td>
                    <td className="tnum text-right">—</td>
                    {anyFlat && <td className="tnum text-right">—</td>}
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        )}

        {selected != null && (
          <div className="border-t border-paper-line p-4">
            <div className="mb-2 flex items-center justify-between gap-2">
              <div className="font-display text-[14px] font-semibold text-ink">
                Block {selectedCode} — last 30 entries
              </div>
              <button className="btn btn-ghost" onClick={() => setSelected(null)}>
                Close
              </button>
            </div>
            <div className="overflow-x-auto">
              <table className="register-table">
                <thead>
                  <tr>
                    <th>Date</th>
                    <th>Block</th>
                    <th>Status</th>
                    <th className="text-right">Net kg</th>
                  </tr>
                </thead>
                <tbody>
                  {invQ.rows.map((r, i) => {
                    const net =
                      r.status === "Completed"
                        ? Math.max(0, (Number(r.bucket_kg) || 0) - (Number(r.tare_kg) || 0))
                        : 0;
                    return (
                      <tr key={i}>
                        <td className="whitespace-nowrap">{fmtDate(r.date)}</td>
                        <td>{masters.byId.block.get(r.block_id)?.code ?? r.block_id}</td>
                        <td>{r.status}</td>
                        <td className="tnum text-right">{fmtNum(net)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </Card>
    </div>
  );
}
