import { useMemo, useState } from "react";
import { useApp } from "../app/store";
import { query, useMasters, useQuery } from "../db/hooks";
import { Card, EmptyState, PageHeader, cn } from "../ui/components";
import { CHART_INK, CHART_NEUTRAL, ModeChart, useChartMode } from "../ui/charts";
import { isMissedTapping } from "../domain/rotation";
import { EntryDrilldown } from "../ui/EntryDrilldown";
import { PeriodFilters, PeriodHeading, usePeriods } from "../ui/periods";
import { periodTag, vsBase } from "../domain/compare";
import { fmtDate, fmtNum } from "../domain/dates";
import { type FilterRange } from "../domain/periods";

const BEST = "#00A651";
const WORST = "#E31E24";

interface PerfRow {
  tapper_id: number | null;
  date: string;
  block_id: number;
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

interface TapperStat {
  id: number;
  name: string;
  days: number;
  blocks: number;
  missed: number;
  netKg: number;
  wet: number;
  avg: number;
  responsibleTrees: number;
  avgTree: number | null;
}

interface BlockwiseRow {
  blockId: number;
  blockCode: string;
  days: number;
  missed: number;
  wet: number;
  netKg: number;
  avg: number;
}

// Fix list #8 — one tapper's production, block by block, with tick boxes.
// The selection is scoped to this tapper's own table, so ticking a subset
// (say Blocks 2 and 3) totals to that worker's combined figure for only
// those blocks; every count column sums directly and Avg kg / day is
// re-derived from the summed totals (never averaged from the averages).
function BlockwiseTable({ tapperName, rows }: { tapperName: string; rows: BlockwiseRow[] }) {
  const [checked, setChecked] = useState<Set<number>>(() => new Set());
  const allChecked = rows.length > 0 && rows.every((r) => checked.has(r.blockId));
  const toggleBlock = (id: number) =>
    setChecked((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  const toggleAll = () =>
    setChecked(allChecked ? new Set<number>() : new Set(rows.map((r) => r.blockId)));
  const selected = rows.filter((r) => checked.has(r.blockId));
  const totDays = selected.reduce((a, r) => a + r.days, 0);
  const totMissed = selected.reduce((a, r) => a + r.missed, 0);
  const totWet = selected.reduce((a, r) => a + r.wet, 0);
  const totNet = selected.reduce((a, r) => a + r.netKg, 0);
  const label =
    selected.length === rows.length
      ? `${tapperName} — all blocks`
      : `Selected total (${selected.length})`;
  return (
    <table className="register-table">
      <thead>
        <tr>
          <th className="text-center">
            <input
              type="checkbox"
              checked={allChecked}
              onChange={toggleAll}
              aria-label={`Select all blocks for ${tapperName}`}
            />
          </th>
          <th>Block</th>
          <th className="text-right">Days tapped</th>
          <th className="text-right">Missed</th>
          <th className="text-right">Wet sheets</th>
          <th className="text-right">Net latex (kg)</th>
          <th className="text-right">Avg kg / day</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => (
          <tr key={r.blockId}>
            <td className="text-center">
              <input
                type="checkbox"
                checked={checked.has(r.blockId)}
                onChange={() => toggleBlock(r.blockId)}
                aria-label={`Select ${tapperName} block ${r.blockCode}`}
              />
            </td>
            <td className="font-semibold whitespace-nowrap">{r.blockCode}</td>
            <td className="tnum text-right">{fmtNum(r.days, 0)}</td>
            <td className="tnum text-right">{fmtNum(r.missed, 0)}</td>
            <td className="tnum text-right">{fmtNum(r.wet, 0)}</td>
            <td className="tnum text-right">{fmtNum(r.netKg)}</td>
            <td className="tnum text-right">{fmtNum(r.avg)}</td>
          </tr>
        ))}
        {selected.length > 0 && (
          <tr className="border-t-2 border-ink bg-paper-deep font-semibold">
            <td colSpan={2} className="whitespace-nowrap">
              {label}
            </td>
            <td className="tnum text-right">{fmtNum(totDays, 0)}</td>
            <td className="tnum text-right">{fmtNum(totMissed, 0)}</td>
            <td className="tnum text-right">{fmtNum(totWet, 0)}</td>
            <td className="tnum text-right">{fmtNum(totNet)}</td>
            <td className="tnum text-right">
              {totDays > 0 ? fmtNum(totNet / totDays) : "—"}
            </td>
          </tr>
        )}
      </tbody>
    </table>
  );
}

export function TapperPerformancePage() {
  const estate = useApp((s) => s.estate)!;
  const masters = useMasters(estate.id);
  const periods = usePeriods();
  const range: FilterRange = periods.base;
  const span = periods.span;
  const outputChart = useChartMode("bar");
  const [selected, setSelected] = useState<number | null>(null);

  const rowsQ = useQuery<PerfRow>(
    () =>
      query<PerfRow>(
        "SELECT r.tapper_id, d.date, r.block_id, r.product_mode, r.status, r.reason, r.wet_sheets, r.tare_kg, COALESCE((SELECT SUM(b.kg) FROM entry_row_buckets b WHERE b.row_id = r.id), 0) AS bucket_kg FROM entry_rows r JOIN entry_days d ON d.id = r.day_id WHERE d.estate_id = $1 AND d.date >= $2 AND d.date <= $3",
        [estate.id, span.from, span.to]
      ),
    [estate.id, span.from, span.to]
  );

  const invQ = useQuery<InvRow>(
    () =>
      selected == null
        ? Promise.resolve([] as InvRow[])
        : query<InvRow>(
            "SELECT d.date, r.block_id, r.tapper_id, r.status, r.reason, r.product_mode, r.wet_sheets, r.tare_kg, COALESCE((SELECT SUM(b.kg) FROM entry_row_buckets b WHERE b.row_id = r.id), 0) AS bucket_kg FROM entry_rows r JOIN entry_days d ON d.id = r.day_id WHERE d.estate_id = $1 AND r.tapper_id = $2 ORDER BY d.date DESC, r.id DESC",
            [estate.id, selected]
          ),
    [estate.id, selected]
  );

  const stats = useMemo(() => {
    type Agg = TapperStat & { dateSet: Set<string>; blockSet: Set<number> };
    const map = new Map<number, Agg>();
    for (const r of rowsQ.rows) {
      if (r.tapper_id == null) continue;
      if (r.date < range.from || r.date > range.to) continue;
      let s = map.get(r.tapper_id);
      if (!s) {
        s = {
          id: r.tapper_id,
          name: masters.byId.tapper.get(r.tapper_id)?.name ?? `Tapper #${r.tapper_id}`,
          days: 0,
          blocks: 0,
          missed: 0,
          netKg: 0,
          wet: 0,
          avg: 0,
          responsibleTrees: 0,
          avgTree: null,
          dateSet: new Set<string>(),
          blockSet: new Set<number>(),
        };
        map.set(r.tapper_id, s);
      }
      // A block that was not due that day is neither tapped nor missed.
      if (r.status !== "Completed" && !isMissedTapping(r)) continue;
      s.blockSet.add(r.block_id);
      if (r.status === "Completed") {
        s.dateSet.add(r.date);
        if (r.product_mode === "Sheet") s.wet += Number(r.wet_sheets) || 0;
        else s.netKg += Math.max(0, (Number(r.bucket_kg) || 0) - (Number(r.tare_kg) || 0));
      } else {
        s.missed += 1;
      }
    }
    // Fix list #9 — avg latex per tree over the blocks this tapper is
    // responsible for (assigned to them), not the blocks they happened to
    // tap. No assignment → no denominator → a dash, never a fake zero.
    const treesByTapper = new Map<number, number>();
    for (const b of masters.blocks) {
      if (b.tapper_id == null) continue;
      treesByTapper.set(
        b.tapper_id,
        (treesByTapper.get(b.tapper_id) ?? 0) + (Number(b.trees) || 0)
      );
    }
    return [...map.values()].map((s) => {
      const responsibleTrees = treesByTapper.get(s.id) ?? 0;
      const netKg = Math.round(s.netKg * 1000) / 1000;
      return {
        id: s.id,
        name: s.name,
        days: s.dateSet.size,
        blocks: s.blockSet.size,
        missed: s.missed,
        netKg,
        wet: s.wet,
        avg: s.dateSet.size > 0 ? Math.round((netKg / s.dateSet.size) * 1000) / 1000 : 0,
        responsibleTrees,
        avgTree: responsibleTrees > 0 ? netKg / responsibleTrees : null,
      };
    });
  }, [rowsQ.rows, masters.byId.tapper, masters.blocks, range.from, range.to]);

  const useKg = stats.some((s) => s.netKg > 0);

  /** The same output figures again, once per period. */
  const comparison = useMemo(
    () =>
      periods.periods.map((p) => {
        const byTapper = new Map<number, { net: number; wet: number }>();
        let net = 0, wet = 0, missed = 0;
        const days = new Set<string>();
        for (const r of rowsQ.rows) {
          if (r.date < p.from || r.date > p.to) continue;
          if (r.tapper_id == null) continue;
          let t = byTapper.get(r.tapper_id);
          if (!t) { t = { net: 0, wet: 0 }; byTapper.set(r.tapper_id, t); }
          if (r.status === "Completed") {
            days.add(r.date);
            if (r.product_mode === "Sheet") { t.wet += Number(r.wet_sheets) || 0; wet += Number(r.wet_sheets) || 0; }
            else {
              const kg = Math.max(0, (Number(r.bucket_kg) || 0) - (Number(r.tare_kg) || 0));
              t.net += kg; net += kg;
            }
          } else if (isMissedTapping(r)) missed += 1;
        }
        return { period: p, byTapper, total: { net: Math.round(net * 10) / 10, wet, missed, days: days.size } };
      }),
    [rowsQ.rows, periods.periods]
  );

  const tappersInView = useMemo(
    () => masters.tappers.map((t) => ({ id: t.id, name: t.name })),
    [masters.tappers]
  );

  const [zoomToFit, setZoomToFit] = useState(false);
  const periodCharts = useMemo(
    () =>
      comparison.map((c) =>
        tappersInView.map((t) => {
          const v = c.byTapper.get(t.id);
          return { name: t.name, value: Math.round((useKg ? (v?.net ?? 0) : (v?.wet ?? 0)) * 10) / 10, fill: CHART_NEUTRAL };
        })
      ),
    [comparison, tappersInView, useKg]
  );
  const sharedMax = Math.max(1, ...periodCharts.flat().map((r) => r.value));
  const sharedDomain: [number, number] | undefined = zoomToFit
    ? undefined
    : [0, Math.ceil(sharedMax * 1.08)];

  const chartData = useMemo(() => {
    const rows = stats.map((s) => ({
      name: s.name,
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

  const selectedName = selected != null ? masters.byId.tapper.get(selected)?.name ?? "" : "";

  // Fix list #8 — block-by-block production per tapper for the selected
  // range, one section per tapper, each with its own tick-to-total state.
  const blockwiseSections = useMemo(() => {
    type PairAgg = { dates: Set<string>; missed: number; wet: number; netKg: number };
    const byTapper = new Map<number, Map<number, PairAgg>>();
    for (const r of rowsQ.rows) {
      if (r.tapper_id == null) continue;
      if (r.date < range.from || r.date > range.to) continue;
      let byBlock = byTapper.get(r.tapper_id);
      if (!byBlock) {
        byBlock = new Map();
        byTapper.set(r.tapper_id, byBlock);
      }
      let p = byBlock.get(r.block_id);
      if (!p) {
        p = { dates: new Set<string>(), missed: 0, wet: 0, netKg: 0 };
        byBlock.set(r.block_id, p);
      }
      if (r.status === "Completed") {
        p.dates.add(r.date);
        if (r.product_mode === "Sheet") p.wet += Number(r.wet_sheets) || 0;
        else p.netKg += Math.max(0, (Number(r.bucket_kg) || 0) - (Number(r.tare_kg) || 0));
      } else if (isMissedTapping(r)) {
        p.missed += 1;
      }
    }
    return stats
      .map((s) => {
        const byBlock = byTapper.get(s.id);
        if (!byBlock || byBlock.size === 0) return null;
        const rows: BlockwiseRow[] = [...byBlock.entries()]
          .map(([blockId, p]) => {
            const netKg = Math.round(p.netKg * 1000) / 1000;
            return {
              blockId,
              blockCode: masters.byId.block.get(blockId)?.code ?? String(blockId),
              days: p.dates.size,
              missed: p.missed,
              wet: p.wet,
              netKg,
              avg: p.dates.size > 0 ? netKg / p.dates.size : 0,
            };
          })
          .sort((a, b) => a.blockCode.localeCompare(b.blockCode));
        return { tapperId: s.id, tapperName: s.name, rows };
      })
      .filter(
        (x): x is { tapperId: number; tapperName: string; rows: BlockwiseRow[] } => x != null
      );
  }, [rowsQ.rows, stats, masters.byId.block]);

  return (
    <div>
      <PageHeader
        title="Tapper performance"
        subtitle={`${stats.length} tappers in range`}
      />

      <PeriodFilters api={periods} />

      {periods.comparing && (
        <label className="mb-3 flex items-center gap-2 text-[12.5px]">
          <input type="checkbox" checked={zoomToFit} onChange={(e) => setZoomToFit(e.target.checked)} />
          Zoom to fit — show small differences
        </label>
      )}

      {periods.comparing && (
        <div
          className="mb-4 grid gap-4"
          style={{ gridTemplateColumns: `repeat(${comparison.length}, minmax(340px, 1fr))` }}
        >
          {comparison.map((c, i) => (
            <div key={c.period.id}>
              <PeriodHeading period={c.period} index={i} />
              <Card title="Output by tapper">
                <ModeChart
                  mode={outputChart.mode}
                  data={periodCharts[i]}
                  xKey="name"
                  dataKey="value"
                  name={useKg ? "Net latex kg" : "Wet sheets"}
                  color={CHART_INK}
                  height={240}
                  yDomain={sharedDomain}
                />
                <div className="mt-1 text-[11.5px] text-ink-soft">
                  Total {fmtNum(useKg ? c.total.net : c.total.wet, useKg ? 1 : 0)} ·{" "}
                  {c.total.days} days · {c.total.missed} missed
                  {i > 0 && (() => {
                    const base = useKg ? comparison[0].total.net : comparison[0].total.wet;
                    const ch = vsBase(useKg ? c.total.net : c.total.wet, base);
                    return ch === null ? null : (
                      <span className={cn("ml-1.5 font-semibold", ch > 0 ? "text-ok" : ch < 0 ? "text-danger" : "")}>
                        {ch > 0 ? "+" : ""}{ch}% vs {periodTag(0)}
                      </span>
                    );
                  })()}
                </div>
              </Card>
            </div>
          ))}
        </div>
      )}


      {!periods.comparing && (
      <Card className="mb-4" title="Total output by tapper" right={outputChart.toggle}>
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

      <Card title="Per-tapper stats" pad={false}>
        {stats.length === 0 ? (
          <div className="p-4">
            <EmptyState
              title="No tapping data in range"
              hint="Widen the date range or record daily entries."
            />
          </div>
        ) : (
          <>
            <p className="px-4 pt-4 text-[11.5px] text-ink-soft">
              Avg kg / tree divides the tapper's period latex by the trees on the
              blocks assigned to them.
            </p>
            <div className="overflow-x-auto">
              <table className="register-table">
              <thead>
                <tr>
                  <th>Tapper</th>
                  <th className="text-right">Days worked</th>
                  <th className="text-right">Blocks tapped</th>
                  <th className="text-right">Missed</th>
                  <th className="text-right">Net latex (kg)</th>
                  <th className="text-right">Wet sheets</th>
                  <th className="text-right">Avg kg / day</th>
                  <th className="text-right">Avg kg / tree</th>
                </tr>
              </thead>
              <tbody>
                {stats.map((s) => (
                  <tr
                    key={s.id}
                    className={cn("cursor-pointer", selected === s.id && "bg-paper-deep")}
                    onClick={() => setSelected(selected === s.id ? null : s.id)}
                  >
                    <td className="font-semibold whitespace-nowrap">{s.name}</td>
                    <td className="tnum text-right">{fmtNum(s.days, 0)}</td>
                    <td className="tnum text-right">{fmtNum(s.blocks, 0)}</td>
                    <td className="tnum text-right">{fmtNum(s.missed, 0)}</td>
                    <td className="tnum text-right">{fmtNum(s.netKg)}</td>
                    <td className="tnum text-right">{fmtNum(s.wet, 0)}</td>
                    <td className="tnum text-right">{fmtNum(s.avg)}</td>
                    <td className="tnum text-right">
                      {s.avgTree === null ? "—" : fmtNum(s.avgTree, 3)}
                    </td>
                  </tr>
                ))}
              </tbody>
              </table>
            </div>
          </>
        )}

        {selected != null && (
          <EntryDrilldown
            title={selectedName}
            rows={invQ.rows}
            loading={invQ.loading}
            blockLabel={(id) => masters.byId.block.get(id)?.code ?? String(id)}
            onClose={() => setSelected(null)}
          />
        )}
      </Card>

      <Card className="mt-4" title="Block-wise production per tapper">
        <p className="mb-3 text-[11.5px] text-ink-soft">
          Each tapper's production split by the blocks they worked between{" "}
          {fmtDate(range.from)} and {fmtDate(range.to)}. Tick blocks to total them
          for that worker only — a partial selection reads "Selected total (n)",
          every block ticked reads "&lt;name&gt; — all blocks".
        </p>
        {blockwiseSections.length === 0 ? (
          <p className="text-[12.5px] text-ink-soft">No tapping entries in range.</p>
        ) : (
          blockwiseSections.map((sec) => (
            <div
              key={sec.tapperId}
              className="border-t border-paper-line pt-3 first:border-t-0 first:pt-0"
            >
              <div className="mb-2 font-display text-[13px] font-semibold text-ink">
                {sec.tapperName}
              </div>
              <BlockwiseTable tapperName={sec.tapperName} rows={sec.rows} />
            </div>
          ))
        )}
      </Card>
    </div>
  );
}
