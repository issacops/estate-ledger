import { useMemo, useState } from "react";
import { useApp } from "../app/store";
import { query, useMasters, useQuery } from "../db/hooks";
import { Card, EmptyState, PageHeader, cn } from "../ui/components";
import { CHART_INK, CHART_NEUTRAL, ModeChart, useChartMode } from "../ui/charts";
import { isMissedTapping } from "../domain/rotation";
import { EntryDrilldown } from "../ui/EntryDrilldown";
import { PeriodFilters, PeriodHeading, usePeriods } from "../ui/periods";
import { periodColor, periodTag, vsBase } from "../domain/compare";
import { fmtNum } from "../domain/dates";
import { type FilterRange } from "../domain/periods";
import { shareByCount } from "../domain/valuation";

const BEST = "#00A651";
const WORST = "#E31E24";

interface PerfRow {
  block_id: number;
  date: string;
  product_mode: string;
  status: string;
  reason: string;
  wet_sheets: number;
  tare_kg: number;
  bucket_kg: number;
}

interface InvRow {
  date: string;
  block_id: number;
  tapper_id: number | null;
  status: string;
  reason: string;
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

export function BlockPerformancePage() {
  const estate = useApp((s) => s.estate)!;
  const masters = useMasters(estate.id);
  const periods = usePeriods();
  const range: FilterRange = periods.base;
  // one query covering every period on screen; the rows are split up below
  const span: FilterRange = {
    from: periods.periods.reduce((a, p) => (p.from < a ? p.from : a), periods.base.from),
    to: periods.periods.reduce((a, p) => (p.to > a ? p.to : a), periods.base.to),
  };
  const outputChart = useChartMode("bar");
  const [selected, setSelected] = useState<number | null>(null);

  const rowsQ = useQuery<PerfRow>(
    () =>
      query<PerfRow>(
        "SELECT r.block_id, d.date, r.product_mode, r.status, r.reason, r.wet_sheets, r.tare_kg, COALESCE((SELECT SUM(b.kg) FROM entry_row_buckets b WHERE b.row_id = r.id), 0) AS bucket_kg FROM entry_rows r JOIN entry_days d ON d.id = r.day_id WHERE d.estate_id = $1 AND d.date >= $2 AND d.date <= $3",
        [estate.id, span.from, span.to]
      ),
    [estate.id, span.from, span.to]
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
            "SELECT d.date, r.block_id, r.tapper_id, r.status, r.reason, r.product_mode, r.wet_sheets, r.tare_kg, COALESCE((SELECT SUM(b.kg) FROM entry_row_buckets b WHERE b.row_id = r.id), 0) AS bucket_kg FROM entry_rows r JOIN entry_days d ON d.id = r.day_id WHERE d.estate_id = $1 AND r.block_id = $2 ORDER BY d.date DESC, r.id DESC",
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
      if (r.date < range.from || r.date > range.to) continue;
      let s = map.get(r.block_id);
      if (!s) {
        s = { dateSet: new Set<string>(), netKg: 0, wet: 0, missed: 0 };
        map.set(r.block_id, s);
      }
      if (r.status === "Completed") {
        s.dateSet.add(r.date);
        if (r.product_mode === "Sheet") s.wet += Number(r.wet_sheets) || 0;
        else s.netKg += Math.max(0, (Number(r.bucket_kg) || 0) - (Number(r.tare_kg) || 0));
      } else if (isMissedTapping(r)) {
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
  }, [rowsQ.rows, masters.blocks, kgSoldByBlock, range.from, range.to]);

  /** The same figures again, once per period, for the comparison table. */
  const comparison = useMemo(() => {
    return periods.periods.map((p) => {
      const byBlock = new Map<number, { net: number; wet: number; days: Set<string>; missed: number }>();
      let net = 0, wet = 0, missed = 0;
      const days = new Set<string>();
      for (const r of rowsQ.rows) {
        if (r.date < p.from || r.date > p.to) continue;
        let b = byBlock.get(r.block_id);
        if (!b) {
          b = { net: 0, wet: 0, days: new Set(), missed: 0 };
          byBlock.set(r.block_id, b);
        }
        if (r.status === "Completed") {
          b.days.add(r.date);
          days.add(r.date);
          if (r.product_mode === "Sheet") {
            const w = Number(r.wet_sheets) || 0;
            b.wet += w; wet += w;
          } else {
            const kg = Math.max(0, (Number(r.bucket_kg) || 0) - (Number(r.tare_kg) || 0));
            b.net += kg; net += kg;
          }
        } else if (isMissedTapping(r)) {
          b.missed += 1; missed += 1;
        }
      }
      return {
        period: p,
        byBlock,
        total: {
          net: Math.round(net * 1000) / 1000,
          wet,
          missed,
          days: days.size,
        },
      };
    });
  }, [rowsQ.rows, periods.periods]);

  const comparing = periods.periods.length > 1;

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

  /** Highlights the best and worst block in a set of bars. */
  const markBestWorst = (rows: { name: string; value: number; fill: string }[]) => {
    if (rows.length === 0) return rows;
    let bestIdx = 0, worstIdx = 0;
    rows.forEach((r, i) => {
      if (r.value > rows[bestIdx].value) bestIdx = i;
      if (r.value < rows[worstIdx].value) worstIdx = i;
    });
    return rows.map((r, i) => ({
      ...r,
      fill: i === bestIdx ? "#1F9D55" : i === worstIdx ? "#E03131" : CHART_NEUTRAL,
    }));
  };

  /** One set of bars per period, so the columns can sit side by side. */
  const periodCharts = useMemo(
    () =>
      comparison.map((c) =>
        markBestWorst(
          masters.blocks.map((b) => {
            const v = c.byBlock.get(b.id);
            return {
              name: b.code,
              value: Math.round((useKg ? (v?.net ?? 0) : (v?.wet ?? 0)) * 10) / 10,
              fill: CHART_NEUTRAL,
            };
          })
        )
      ),
    [comparison, masters.blocks, useKg]
  );

  // same axis on every column, so a difference you can see is a real one
  const [zoomToFit, setZoomToFit] = useState(false);
  const sharedMax = Math.max(1, ...periodCharts.flat().map((r) => r.value));
  const sharedDomain: [number, number] | undefined = zoomToFit
    ? undefined
    : [0, Math.ceil(sharedMax * 1.08)];

  const chartData = useMemo(() => {
    const rows = stats.map((s) => ({
      name: s.code,
      value: useKg ? s.netKg : s.wet,
      fill: CHART_NEUTRAL,
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
      fill: i === bestIdx ? BEST : i === worstIdx && rows.length > 1 ? WORST : CHART_NEUTRAL,
    }));
  }, [stats, useKg]);

  const selectedCode = selected != null ? masters.byId.block.get(selected)?.code ?? "" : "";

  return (
    <div>
      <PageHeader
        title="Block performance"
        subtitle={`${stats.length} blocks in range`}
      />

      <PeriodFilters api={periods} />

      {comparing && (
        <label className="mb-3 flex items-center gap-2 text-[12.5px]">
          <input
            type="checkbox"
            checked={zoomToFit}
            onChange={(e) => setZoomToFit(e.target.checked)}
          />
          Zoom to fit — show small differences
        </label>
      )}

      {comparing && (
        <div
          className="mb-4 grid gap-4"
          style={{ gridTemplateColumns: `repeat(${comparison.length}, minmax(340px, 1fr))` }}
        >
          {comparison.map((c, i) => (
            <div key={c.period.id}>
              <PeriodHeading period={c.period} index={i} />
              <Card title="Block comparison — total latex">
                <ModeChart
                  mode={outputChart.mode}
                  data={periodCharts[i]}
                  xKey="name"
                  dataKey="value"
                  name={useKg ? "Net latex kg" : "Wet sheets"}
                  color={CHART_INK}
                  height={260}
                  perPointFill
                  yDomain={sharedDomain}
                />
                <div className="mt-1 text-[11.5px] text-ink-soft">
                  Total {fmtNum(useKg ? c.total.net : c.total.wet, useKg ? 1 : 0)} ·{" "}
                  {c.total.days} days tapped · {c.total.missed} missed
                  {i > 0 && (() => {
                    const base = useKg ? comparison[0].total.net : comparison[0].total.wet;
                    const val = useKg ? c.total.net : c.total.wet;
                    const ch = vsBase(val, base);
                    return ch === null ? null : (
                      <span
                        className={cn(
                          "ml-1.5 font-semibold",
                          ch > 0 ? "text-ok" : ch < 0 ? "text-danger" : ""
                        )}
                      >
                        {ch > 0 ? "+" : ""}
                        {ch}% vs {periodTag(0)}
                      </span>
                    );
                  })()}
                </div>
              </Card>
            </div>
          ))}
        </div>
      )}

      {comparing && (
        <Card
          className="mb-4"
          title="Period comparison"
          right={
            <span className="text-[11.5px] text-ink-soft">
              change is against period {periodTag(0)}
            </span>
          }
          pad={false}
        >
          <div className="overflow-x-auto">
            <table className="register-table">
              <thead>
                <tr>
                  <th style={{ minWidth: 90 }}>Block</th>
                  {comparison.map((c, i) => (
                    <th key={c.period.id} className="text-right" style={{ minWidth: 118 }}>
                      <span style={{ color: periodColor(i) }}>{periodTag(i)}</span>{" "}
                      {c.period.label}
                      {i > 0 && <span className="ml-1 text-ink-soft">vs {periodTag(0)}</span>}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {masters.blocks.map((b) => {
                  const base = comparison[0].byBlock.get(b.id);
                  const baseVal = useKg ? (base?.net ?? 0) : (base?.wet ?? 0);
                  return (
                    <tr key={b.id}>
                      <td className="font-semibold whitespace-nowrap">{b.code}</td>
                      {comparison.map((c, i) => {
                        const v = c.byBlock.get(b.id);
                        const val = useKg ? (v?.net ?? 0) : (v?.wet ?? 0);
                        const change = i === 0 ? null : vsBase(val, baseVal);
                        return (
                          <td key={c.period.id} className="tnum text-right">
                            {fmtNum(val, useKg ? 1 : 0)}
                            {change !== null && (
                              <span
                                className={cn(
                                  "ml-1.5 text-[10.5px] font-semibold",
                                  change > 0 ? "text-ok" : change < 0 ? "text-danger" : "text-ink-soft"
                                )}
                              >
                                {change > 0 ? "+" : ""}
                                {change}%
                              </span>
                            )}
                          </td>
                        );
                      })}
                    </tr>
                  );
                })}
                <tr style={{ background: "rgba(0,0,0,0.03)" }}>
                  <td className="font-semibold">Estate total</td>
                  {comparison.map((c, i) => {
                    const val = useKg ? c.total.net : c.total.wet;
                    const baseVal = useKg ? comparison[0].total.net : comparison[0].total.wet;
                    const change = i === 0 ? null : vsBase(val, baseVal);
                    return (
                      <td key={c.period.id} className="tnum text-right font-semibold">
                        {fmtNum(val, useKg ? 1 : 0)}
                        {change !== null && (
                          <span
                            className={cn(
                              "ml-1.5 text-[10.5px]",
                              change > 0 ? "text-ok" : change < 0 ? "text-danger" : "text-ink-soft"
                            )}
                          >
                            {change > 0 ? "+" : ""}
                            {change}%
                          </span>
                        )}
                      </td>
                    );
                  })}
                </tr>
                <tr>
                  <td className="text-ink-soft">Days tapped</td>
                  {comparison.map((c) => (
                    <td key={c.period.id} className="tnum text-right text-ink-soft">
                      {c.total.days}
                    </td>
                  ))}
                </tr>
                <tr>
                  <td className="text-ink-soft">Missed</td>
                  {comparison.map((c) => (
                    <td key={c.period.id} className="tnum text-right text-ink-soft">
                      {c.total.missed}
                    </td>
                  ))}
                </tr>
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {!comparing && (
      <Card className="mb-4" title="Total output by block" right={outputChart.toggle}>
          <ModeChart
            mode={outputChart.mode}
            data={chartData}
            xKey="name"
            dataKey="value"
            name={useKg ? "Net latex kg" : "Wet sheets"}
            color={CHART_INK}
            height={260}
            perPointFill
          />
      </Card>
      )}

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
          <EntryDrilldown
            title={`Block ${selectedCode}`}
            rows={invQ.rows}
            loading={invQ.loading}
            blockLabel={(id) => masters.byId.block.get(id)?.code ?? String(id)}
            tapperLabel={(id) => (id == null ? "—" : masters.byId.tapper.get(id)?.name ?? String(id))}
            onClose={() => setSelected(null)}
          />
        )}
      </Card>
    </div>
  );
}
