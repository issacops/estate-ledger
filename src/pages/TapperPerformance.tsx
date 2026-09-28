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
import { Users } from "lucide-react";
import { useApp } from "../app/store";
import { query, useMasters, useQuery } from "../db/hooks";
import { Card, EmptyState, PageHeader, Pill, cn } from "../ui/components";
import { fmtDate, fmtNum, todayISO } from "../domain/dates";
import { rangeForPreset, type FilterRange } from "../domain/periods";

const NEUTRAL = "#CFC9B2";
const BEST = "#E8C22F";
const WORST = "#C25B4E";

interface PerfRow {
  tapper_id: number | null;
  date: string;
  block_id: number;
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

interface TapperStat {
  id: number;
  name: string;
  days: number;
  blocks: number;
  missed: number;
  netKg: number;
  wet: number;
  avg: number;
}

const PRESETS: { key: "season" | "month" | "week" | "ytd" | "all"; label: string }[] = [
  { key: "season", label: "Season" },
  { key: "month", label: "Month" },
  { key: "week", label: "Week" },
  { key: "ytd", label: "YTD" },
  { key: "all", label: "All" },
];

export function TapperPerformancePage() {
  const estate = useApp((s) => s.estate)!;
  const masters = useMasters(estate.id);
  const [range, setRange] = useState<FilterRange>(() => rangeForPreset("season", todayISO()));
  const [preset, setPreset] = useState("season");
  const [selected, setSelected] = useState<number | null>(null);

  const rowsQ = useQuery<PerfRow>(
    () =>
      query<PerfRow>(
        "SELECT r.tapper_id, d.date, r.block_id, r.product_mode, r.status, r.wet_sheets, r.tare_kg, COALESCE((SELECT SUM(b.kg) FROM entry_row_buckets b WHERE b.row_id = r.id), 0) AS bucket_kg FROM entry_rows r JOIN entry_days d ON d.id = r.day_id WHERE d.estate_id = $1 AND d.date >= $2 AND d.date <= $3",
        [estate.id, range.from, range.to]
      ),
    [estate.id, range.from, range.to]
  );

  const invQ = useQuery<InvRow>(
    () =>
      selected == null
        ? Promise.resolve([] as InvRow[])
        : query<InvRow>(
            "SELECT d.date, r.block_id, r.status, r.product_mode, r.wet_sheets, r.tare_kg, COALESCE((SELECT SUM(b.kg) FROM entry_row_buckets b WHERE b.row_id = r.id), 0) AS bucket_kg FROM entry_rows r JOIN entry_days d ON d.id = r.day_id WHERE d.estate_id = $1 AND r.tapper_id = $2 ORDER BY d.date DESC, r.id DESC LIMIT 30",
            [estate.id, selected]
          ),
    [estate.id, selected]
  );

  const stats = useMemo(() => {
    type Agg = TapperStat & { dateSet: Set<string>; blockSet: Set<number> };
    const map = new Map<number, Agg>();
    for (const r of rowsQ.rows) {
      if (r.tapper_id == null) continue;
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
          dateSet: new Set<string>(),
          blockSet: new Set<number>(),
        };
        map.set(r.tapper_id, s);
      }
      s.blockSet.add(r.block_id);
      if (r.status === "Completed") {
        s.dateSet.add(r.date);
        if (r.product_mode === "Sheet") s.wet += Number(r.wet_sheets) || 0;
        else s.netKg += Math.max(0, (Number(r.bucket_kg) || 0) - (Number(r.tare_kg) || 0));
      } else {
        s.missed += 1;
      }
    }
    return [...map.values()].map((s) => ({
      id: s.id,
      name: s.name,
      days: s.dateSet.size,
      blocks: s.blockSet.size,
      missed: s.missed,
      netKg: Math.round(s.netKg * 1000) / 1000,
      wet: s.wet,
      avg: s.dateSet.size > 0 ? Math.round((s.netKg / s.dateSet.size) * 1000) / 1000 : 0,
    }));
  }, [rowsQ.rows, masters.byId.tapper]);

  const useKg = stats.some((s) => s.netKg > 0);

  const chartData = useMemo(() => {
    const rows = stats.map((s) => ({
      name: s.name,
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

  const selectedName = selected != null ? masters.byId.tapper.get(selected)?.name ?? "" : "";

  return (
    <div>
      <PageHeader
        title="Tapper performance"
        subtitle={`${stats.length} tappers in range`}
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

      <Card className="mb-4" title="Total output by tapper" right={<Users size={14} />}>
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

      <Card title="Per-tapper stats" pad={false}>
        {stats.length === 0 ? (
          <div className="p-4">
            <EmptyState
              title="No tapping data in range"
              hint="Widen the date range or record daily entries."
            />
          </div>
        ) : (
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
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {selected != null && (
          <div className="border-t border-paper-line p-4">
            <div className="mb-2 flex items-center justify-between gap-2">
              <div className="font-display text-[14px] font-semibold text-ink">
                {selectedName} — last 30 entries
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
