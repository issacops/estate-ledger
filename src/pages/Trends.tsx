import { useMemo, useState } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { ChartColumn, CloudRain, TrendingUp } from "lucide-react";
import { useApp } from "../app/store";
import { query, useQuery } from "../db/hooks";
import { Card, KPI, PageHeader, Pill } from "../ui/components";
import { fmtMoney, fmtNum, todayISO } from "../domain/dates";
import {
  bucketDates,
  rangeForPreset,
  type FilterRange,
  type Granularity,
} from "../domain/periods";
import { rainCoverMatches } from "../domain/valuation";

const INK = "#2E2D2B";
const RUST = "#CF8A3C";
const NEUTRAL = "#CFC9B2";

interface ProdRow {
  date: string;
  product_mode: string;
  status: string;
  wet_sheets: number;
  tapped_despite_rain: number;
  reason: string;
  bucket_kg: number;
}

interface CashRow {
  particulars: string;
  expense: number;
}

const PRESETS: { key: "season" | "month" | "week" | "ytd" | "all"; label: string }[] = [
  { key: "season", label: "Season" },
  { key: "month", label: "Month" },
  { key: "week", label: "Week" },
  { key: "ytd", label: "YTD" },
  { key: "all", label: "All" },
];

export function TrendsPage() {
  const estate = useApp((s) => s.estate)!;
  const profile = estate.profile;
  const isWeighing = profile.latexCapture === "weighing";
  const [range, setRange] = useState<FilterRange>(() => rangeForPreset("season", todayISO()));
  const [preset, setPreset] = useState("season");
  const [gran, setGran] = useState<Granularity>("Monthly");
  const [chartMode, setChartMode] = useState<"line" | "bar">("line");

  const granOptions: Granularity[] = profile.seasonGranularity
    ? ["Daily", "Weekly", "Monthly", "Season"]
    : ["Daily", "Weekly", "Monthly"];

  const rowsQ = useQuery<ProdRow>(
    () =>
      query<ProdRow>(
        "SELECT d.date, r.product_mode, r.status, r.wet_sheets, r.tapped_despite_rain, r.reason, COALESCE((SELECT SUM(b.kg) FROM entry_row_buckets b WHERE b.row_id = r.id), 0) AS bucket_kg FROM entry_rows r JOIN entry_days d ON d.id = r.day_id WHERE d.estate_id = $1 AND d.date >= $2 AND d.date <= $3 ORDER BY d.date",
        [estate.id, range.from, range.to]
      ),
    [estate.id, range.from, range.to]
  );

  const cashQ = useQuery<CashRow>(
    () =>
      query<CashRow>(
        "SELECT particulars, expense FROM cashbook WHERE estate_id = $1 AND date >= $2 AND date <= $3 AND expense > 0",
        [estate.id, range.from, range.to]
      ),
    [estate.id, range.from, range.to]
  );

  const series = useMemo(() => {
    const byDate = new Map<string, { kg: number; wet: number; taps: number }>();
    for (const r of rowsQ.rows) {
      const cur = byDate.get(r.date) ?? { kg: 0, wet: 0, taps: 0 };
      cur.kg += Number(r.bucket_kg) || 0;
      if (r.status === "Completed") {
        cur.wet += Number(r.wet_sheets) || 0;
        cur.taps += 1;
      }
      byDate.set(r.date, cur);
    }
    return bucketDates([...byDate.keys()].sort(), gran).map((b) => {
      let kg = 0;
      let wet = 0;
      let taps = 0;
      for (const d of b.dates) {
        const v = byDate.get(d);
        kg += v?.kg ?? 0;
        wet += v?.wet ?? 0;
        taps += v?.taps ?? 0;
      }
      return {
        label: b.label,
        kg: Math.round(kg * 1000) / 1000,
        wet,
        taps,
      };
    });
  }, [rowsQ.rows, gran]);

  const prodData = useMemo(
    () => series.map((s) => ({ label: s.label, value: isWeighing ? s.kg : s.wet })),
    [series, isWeighing]
  );

  const freqData = useMemo(
    () => series.map((s) => ({ label: s.label, value: s.taps })),
    [series]
  );

  const rain = useMemo(() => {
    let despite = 0;
    let lost = 0;
    for (const r of rowsQ.rows) {
      if (Number(r.tapped_despite_rain) === 1) despite += 1;
      if (r.status === "Not Done" && String(r.reason).toLowerCase().includes("rain")) lost += 1;
    }
    const cover = cashQ.rows
      .filter((c) => rainCoverMatches(c.particulars))
      .reduce((s, c) => s + (Number(c.expense) || 0), 0);
    return { despite, lost, cover };
  }, [rowsQ.rows, cashQ.rows]);

  const prodName = isWeighing ? "Latex kg" : "Wet sheets";
  const prodTotal = prodData.reduce((s, p) => s + (Number(p.value) || 0), 0);

  return (
    <div>
      <PageHeader
        title="Trends"
        subtitle={`${fmtNum(rowsQ.rows.length, 0)} entry rows in range`}
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

      <div className="mb-4 flex flex-wrap items-center gap-2">
        {granOptions.map((g) => (
          <Pill key={g} active={gran === g} onClick={() => setGran(g)}>
            {g}
          </Pill>
        ))}
      </div>

      <Card
        className="mb-4"
        title="Production trend"
        right={
          <div className="flex items-center gap-2">
            <Pill active={chartMode === "line"} onClick={() => setChartMode("line")}>
              Line
            </Pill>
            <Pill active={chartMode === "bar"} onClick={() => setChartMode("bar")}>
              Bars
            </Pill>
          </div>
        }
      >
        <div className="h-[280px] w-full">
          {chartMode === "line" ? (
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={prodData}>
                <CartesianGrid strokeDasharray="3 3" stroke={NEUTRAL} />
                <XAxis dataKey="label" tick={{ fontSize: 11 }} />
                <YAxis tick={{ fontSize: 11 }} />
                <Tooltip />
                <Legend />
                <Line
                  type="monotone"
                  dataKey="value"
                  name={prodName}
                  stroke={INK}
                  strokeWidth={2}
                  dot={{ r: 2 }}
                />
              </LineChart>
            </ResponsiveContainer>
          ) : (
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={prodData}>
                <CartesianGrid strokeDasharray="3 3" stroke={NEUTRAL} />
                <XAxis dataKey="label" tick={{ fontSize: 11 }} />
                <YAxis tick={{ fontSize: 11 }} />
                <Tooltip />
                <Legend />
                <Bar dataKey="value" name={prodName} fill={RUST} radius={[3, 3, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          )}
        </div>
      </Card>

      <Card className="mb-4" title="Tapping frequency" right={<ChartColumn size={14} />}>
        <div className="h-[240px] w-full">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={freqData}>
              <CartesianGrid strokeDasharray="3 3" stroke={NEUTRAL} />
              <XAxis dataKey="label" tick={{ fontSize: 11 }} />
              <YAxis tick={{ fontSize: 11 }} allowDecimals={false} />
              <Tooltip />
              <Bar dataKey="value" name="Taps" fill={INK} radius={[3, 3, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </Card>

      <Card title="Rain-cover ROI" right={<CloudRain size={14} />}>
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          <KPI label="Tapped despite rain" value={rain.despite} icon={<TrendingUp size={14} />} />
          <KPI
            label="Still lost to heavy rain"
            value={rain.lost}
            tone={rain.lost > 0 ? "warn" : "default"}
          />
          <KPI label="Cover expense logged" value={fmtMoney(rain.cover)} />
          <KPI
            label="Rows in range"
            value={rowsQ.rows.length}
            sub={`${fmtNum(prodTotal)} ${prodName.toLowerCase()}`}
          />
        </div>
        {rain.cover === 0 && (
          <div className="mt-3 rounded-[10px] border border-paper-line bg-paper-deep px-4 py-2.5 text-[11.5px] text-ink-soft">
            Log rain cover expenses with the words rain, cover or skirt in the particulars
          </div>
        )}
      </Card>
    </div>
  );
}
