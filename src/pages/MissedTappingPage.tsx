import { useMemo, useState } from "react";
import { TriangleAlert } from "lucide-react";
import { useApp } from "../app/store";
import { query, useMasters, useQuery } from "../db/hooks";
import { Badge, Card, CollapsibleCard, EmptyState, KPI, PageHeader } from "../ui/components";
import { PeriodFilters, usePeriods } from "../ui/periods";
import { CHART_GREEN, ModeChart, useChartMode } from "../ui/charts";
import { isMissedTapping } from "../domain/rotation";
import { fmtDate, fmtNum, parseISO } from "../domain/dates";
import { type FilterRange } from "../domain/periods";


interface AllRow {
  id: number;
  date: string;
  block_id: number;
  tapper_id: number | null;
  status: string;
  reason: string;
}

interface MissRow {
  id: number;
  date: string;
  block_id: number;
  tapper_id: number | null;
  reason: string;
  gap: number | null;
  beyond: boolean;
}

export function MissedTappingPage() {
  const estate = useApp((s) => s.estate)!;
  const masters = useMasters(estate.id);
  const periods = usePeriods();
  const range: FilterRange = periods.base;
  const [blockId, setBlockId] = useState("all");
  const reasonChart = useChartMode("bar");
  const [tapperId, setTapperId] = useState("all");
  const [reason, setReason] = useState("all");

  const allQ = useQuery<AllRow>(
    () =>
      query<AllRow>(
        "SELECT r.id, d.date, r.block_id, r.tapper_id, r.status, r.reason FROM entry_rows r JOIN entry_days d ON d.id = r.day_id WHERE d.estate_id = $1 ORDER BY d.date ASC, r.id ASC",
        [estate.id]
      ),
    [estate.id]
  );

  const missed = useMemo(() => {
    const lastCompleted = new Map<number, string>();
    const out: MissRow[] = [];
    for (const r of allQ.rows) {
      if (r.status === "Completed") {
        lastCompleted.set(r.block_id, r.date);
        continue;
      }
      // a block that was not due was not missed
      if (!isMissedTapping(r)) continue;
      const prev = lastCompleted.get(r.block_id);
      const gap = prev
        ? Math.round((parseISO(r.date).getTime() - parseISO(prev).getTime()) / 86400000)
        : null;
      const assigned = r.tapper_id ?? masters.byId.block.get(r.block_id)?.tapper_id ?? null;
      const tapDays = assigned ? masters.byId.tapper.get(assigned)?.tap_days ?? 2 : 2;
      out.push({
        id: r.id,
        date: r.date,
        block_id: r.block_id,
        tapper_id: r.tapper_id,
        reason: r.reason,
        gap,
        beyond: gap !== null && gap > tapDays,
      });
    }
    return out.reverse();
  }, [allQ.rows, masters.byId.block, masters.byId.tapper]);

  const reasonOptions = useMemo(() => {
    const set = new Set<string>();
    for (const m of missed) set.add(m.reason || "(no reason)");
    return [...set].sort();
  }, [missed]);

  const filtered = useMemo(
    () =>
      missed.filter((m) => {
        if (m.date < range.from || m.date > range.to) return false;
        if (blockId !== "all" && m.block_id !== Number(blockId)) return false;
        if (tapperId !== "all" && m.tapper_id !== Number(tapperId)) return false;
        if (reason !== "all" && (m.reason || "(no reason)") !== reason) return false;
        return true;
      }),
    [missed, range.from, range.to, blockId, tapperId, reason]
  );

  const reasonStats = useMemo(() => {
    const map = new Map<string, number>();
    for (const f of filtered) {
      const k = f.reason || "(no reason)";
      map.set(k, (map.get(k) ?? 0) + 1);
    }
    return [...map.entries()]
      .map(([label, count]) => ({ label, count }))
      .sort((a, b) => b.count - a.count);
  }, [filtered]);

  const top3 = reasonStats.slice(0, 3);
  const beyondCount = filtered.filter((f) => f.beyond).length;

  return (
    <div>
      <PageHeader
        title="Missed tapping"
        subtitle={`${filtered.length} misses in range`}
      />

      <PeriodFilters api={periods} />


      <Card className="mb-4">
        <div className="grid grid-cols-1 gap-3 md:grid-cols-4">
          <label className="block">
            <div className="label mb-1">Block</div>
            <select className="input" value={blockId} onChange={(e) => setBlockId(e.target.value)}>
              <option value="all">All blocks</option>
              {masters.blocks.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.code}
                </option>
              ))}
            </select>
          </label>
          <label className="block">
            <div className="label mb-1">Tapper</div>
            <select
              className="input"
              value={tapperId}
              onChange={(e) => setTapperId(e.target.value)}
            >
              <option value="all">All tappers</option>
              {masters.tappers.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </select>
          </label>
          <label className="block">
            <div className="label mb-1">Reason</div>
            <select className="input" value={reason} onChange={(e) => setReason(e.target.value)}>
              <option value="all">All reasons</option>
              {reasonOptions.map((r) => (
                <option key={r} value={r}>
                  {r}
                </option>
              ))}
            </select>
          </label>
          <div className="flex items-end">
            <button
              className="btn btn-secondary w-full justify-center"
              onClick={() => {
                setBlockId("all");
                setTapperId("all");
                setReason("all");
                periods.reset();
              }}
            >
              Reset filters
            </button>
          </div>
        </div>
      </Card>

      <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-4">
        <KPI
          label="Misses in range"
          value={filtered.length}
          tone={filtered.length > 0 ? "warn" : "default"}
          icon={<TriangleAlert size={14} />}
        />
        {top3.map((t, i) => (
          <KPI key={t.label} label={`#${i + 1} ${t.label}`} value={t.count} />
        ))}
        {Array.from({ length: Math.max(0, 3 - top3.length) }).map((_, i) => (
          <KPI key={`empty-${i}`} label={`#${top3.length + i + 1} reason`} value={0} />
        ))}
      </div>

      <Card className="mb-4" title="Misses per reason" right={reasonChart.toggle}>
          <ModeChart
            mode={reasonChart.mode}
            data={reasonStats}
            xKey="label"
            dataKey="count"
            name="Misses"
            color={CHART_GREEN}
            height={240}
            allowDecimals={false}
          />
      </Card>

      <CollapsibleCard
        title="Not-done register"
        pad={false}
        summary={`${fmtNum(filtered.length, 0)} missed`}
        forceOpen={filtered.length === 0 && !allQ.loading}
        right={
          <span className="text-[11px] text-ink-soft">
            {fmtNum(beyondCount, 0)} beyond normal gap
          </span>
        }
      >
        {filtered.length === 0 ? (
          <div className="p-4">
            <EmptyState title="No missed tapping in range" hint="Nothing to investigate here." />
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="register-table">
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Block</th>
                  <th>Tapper</th>
                  <th>Reason</th>
                  <th className="text-right">Gap days</th>
                  <th>Flag</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((m) => {
                  const block = masters.byId.block.get(m.block_id);
                  const tapper =
                    masters.byId.tapper.get(
                      m.tapper_id ?? block?.tapper_id ?? -1
                    )?.name ?? "";
                  return (
                    <tr key={m.id}>
                      <td className="whitespace-nowrap">{fmtDate(m.date)}</td>
                      <td className="font-semibold">{block?.code ?? m.block_id}</td>
                      <td>{tapper}</td>
                      <td>{m.reason || "—"}</td>
                      <td className="tnum text-right">{m.gap === null ? "—" : m.gap}</td>
                      <td>
                        {m.beyond ? (
                          <Badge tone="warn">Beyond normal</Badge>
                        ) : (
                          <span className="text-ink-soft">—</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </CollapsibleCard>
    </div>
  );
}
