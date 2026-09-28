import { useMemo, useState } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { CalendarDays, Users } from "lucide-react";
import { useApp } from "../app/store";
import { query, useMasters, useQuery } from "../db/hooks";
import { Card, EmptyState, KPI, PageHeader, Pill } from "../ui/components";
import { fmtDate, fmtNum, parseISO, todayISO } from "../domain/dates";
import { rangeForPreset, type FilterRange } from "../domain/periods";

const INK = "#2E2D2B";
const NEUTRAL = "#CFC9B2";

interface AttRow {
  tapper_id: number | null;
  date: string;
  status: string;
}

interface LabourRowData {
  date: string;
  name: string;
  sex: string;
  men: number;
  women: number;
  work_type: string;
}

const PRESETS: { key: "season" | "month" | "week" | "ytd" | "all"; label: string }[] = [
  { key: "season", label: "Season" },
  { key: "month", label: "Month" },
  { key: "week", label: "Week" },
  { key: "ytd", label: "YTD" },
  { key: "all", label: "All" },
];

export function AttendancePage() {
  const estate = useApp((s) => s.estate)!;
  const profile = estate.profile;
  const masters = useMasters(estate.id);
  const [range, setRange] = useState<FilterRange>(() => rangeForPreset("month", todayISO()));
  const [preset, setPreset] = useState("month");

  const attQ = useQuery<AttRow>(
    () =>
      query<AttRow>(
        "SELECT r.tapper_id, d.date, r.status FROM entry_rows r JOIN entry_days d ON d.id = r.day_id WHERE d.estate_id = $1 AND d.date >= $2 AND d.date <= $3",
        [estate.id, range.from, range.to]
      ),
    [estate.id, range.from, range.to]
  );

  const labourQ = useQuery<LabourRowData>(
    () =>
      query<LabourRowData>(
        "SELECT d.date, l.name, l.sex, l.men, l.women, l.work_type FROM labour_rows l JOIN entry_days d ON d.id = l.day_id WHERE d.estate_id = $1 AND d.date >= $2 AND d.date <= $3 ORDER BY d.date",
        [estate.id, range.from, range.to]
      ),
    [estate.id, range.from, range.to]
  );

  const daysInRange = Math.max(
    0,
    Math.round((parseISO(range.to).getTime() - parseISO(range.from).getTime()) / 86400000) + 1
  );

  const attendance = useMemo(() => {
    const map = new Map<number, Set<string>>();
    for (const r of attQ.rows) {
      if (r.tapper_id == null || r.status !== "Completed") continue;
      const set = map.get(r.tapper_id) ?? new Set<string>();
      set.add(r.date);
      map.set(r.tapper_id, set);
    }
    return masters.tappers.map((t) => {
      const days = map.get(t.id)?.size ?? 0;
      return {
        id: t.id,
        name: t.name,
        days,
        expected: daysInRange,
        rate: daysInRange > 0 ? Math.round((days / daysInRange) * 1000) / 10 : 0,
      };
    });
  }, [attQ.rows, masters.tappers, daysInRange]);

  const perWorker = useMemo(() => {
    return profile.labour === "per-worker" || labourQ.rows.some((r) => r.name.trim() !== "");
  }, [profile.labour, labourQ.rows]);

  const workerStats = useMemo(() => {
    if (!perWorker) return [];
    const map = new Map<
      string,
      { sex: string; dates: Set<string>; workTypes: Map<string, number> }
    >();
    for (const l of labourQ.rows) {
      const name = l.name.trim();
      if (!name) continue;
      const cur =
        map.get(name) ??
        { sex: l.sex, dates: new Set<string>(), workTypes: new Map<string, number>() };
      if (!cur.sex) cur.sex = l.sex;
      cur.dates.add(l.date);
      const wt = l.work_type || "(none)";
      cur.workTypes.set(wt, (cur.workTypes.get(wt) ?? 0) + 1);
      map.set(name, cur);
    }
    return [...map.entries()]
      .map(([name, s]) => {
        let top = "";
        let topN = 0;
        for (const [wt, n] of s.workTypes) {
          if (n > topN) {
            top = wt;
            topN = n;
          }
        }
        return {
          name,
          sex: s.sex,
          days: s.dates.size,
          topTask: top,
          isMale: s.sex === "Male",
          isFemale: s.sex === "Female",
        };
      })
      .sort((a, b) => b.days - a.days);
  }, [labourQ.rows, perWorker]);

  const labourTotals = useMemo(() => {
    if (perWorker) {
      return {
        total: workerStats.reduce((s, w) => s + w.days, 0),
        men: workerStats.filter((w) => w.isMale).reduce((s, w) => s + w.days, 0),
        women: workerStats.filter((w) => w.isFemale).reduce((s, w) => s + w.days, 0),
      };
    }
    let men = 0;
    let women = 0;
    for (const l of labourQ.rows) {
      men += Number(l.men) || 0;
      women += Number(l.women) || 0;
    }
    return { total: men + women, men, women };
  }, [labourQ.rows, perWorker, workerStats]);

  const dayRows = useMemo(() => {
    const map = new Map<string, { names: Set<string>; men: number; women: number }>();
    for (const l of labourQ.rows) {
      const cur = map.get(l.date) ?? { names: new Set<string>(), men: 0, women: 0 };
      if (l.name.trim()) cur.names.add(l.name.trim());
      cur.men += Number(l.men) || 0;
      cur.women += Number(l.women) || 0;
      map.set(l.date, cur);
    }
    return [...map.entries()]
      .map(([date, s]) => ({
        date,
        workers: perWorker ? s.names.size : s.men + s.women,
        names: perWorker ? [...s.names].join(", ") : `M ${s.men} · W ${s.women}`,
      }))
      .sort((a, b) => (a.date < b.date ? 1 : -1));
  }, [labourQ.rows, perWorker]);

  return (
    <div>
      <PageHeader
        title="Attendance"
        subtitle={`${daysInRange} days in range`}
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

      {!profile.attendance ? (
        <EmptyState
          title="Attendance tracking is off"
          hint="Enable attendance in estate settings to track tapper presence and labour worker-days."
        />
      ) : (
        <>
          <Card className="mb-4" title="Labour worker-days" right={<Users size={14} />}>
            <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
              <KPI label="Worker-days" value={fmtNum(labourTotals.total, 0)} />
              <KPI label="Men worker-days" value={fmtNum(labourTotals.men, 0)} />
              <KPI label="Women worker-days" value={fmtNum(labourTotals.women, 0)} />
              <KPI
                label={perWorker ? "Workers seen" : "Labour lines"}
                value={perWorker ? workerStats.length : labourQ.rows.length}
              />
            </div>
          </Card>

          {perWorker && (
            <Card className="mb-4" title="Per-worker days" pad={false}>
              <div className="overflow-x-auto">
                <table className="register-table">
                  <thead>
                    <tr>
                      <th>Worker</th>
                      <th>Sex</th>
                      <th className="text-right">Worker-days</th>
                      <th>Most common task</th>
                    </tr>
                  </thead>
                  <tbody>
                    {workerStats.map((w) => (
                      <tr key={w.name}>
                        <td className="font-semibold whitespace-nowrap">{w.name}</td>
                        <td>{w.sex || "—"}</td>
                        <td className="tnum text-right">{fmtNum(w.days, 0)}</td>
                        <td>{w.topTask || "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Card>
          )}

          <Card className="mb-4" title="Tapper attendance rate" right={<CalendarDays size={14} />}>
            <div className="h-[240px] w-full">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={attendance}>
                  <CartesianGrid strokeDasharray="3 3" stroke={NEUTRAL} />
                  <XAxis dataKey="name" tick={{ fontSize: 11 }} />
                  <YAxis tick={{ fontSize: 11 }} unit="%" />
                  <Tooltip />
                  <Bar dataKey="rate" name="Attendance %" fill={INK} radius={[3, 3, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
            <div className="mt-3 overflow-x-auto">
              <table className="register-table">
                <thead>
                  <tr>
                    <th>Tapper</th>
                    <th className="text-right">Days present</th>
                    <th className="text-right">Expected</th>
                    <th className="text-right">Attendance %</th>
                  </tr>
                </thead>
                <tbody>
                  {attendance.map((a) => (
                    <tr key={a.id}>
                      <td className="font-semibold whitespace-nowrap">{a.name}</td>
                      <td className="tnum text-right">{fmtNum(a.days, 0)}</td>
                      <td className="tnum text-right">{fmtNum(a.expected, 0)}</td>
                      <td
                        className={`tnum text-right ${
                          a.rate >= 80 ? "text-ok" : a.rate >= 50 ? "text-warn" : "text-danger"
                        }`}
                      >
                        {fmtNum(a.rate, 1)}%
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>

          <Card
            title="Day-by-day labour"
            pad={false}
            right={<span className="text-[11px] text-ink-soft">{dayRows.length} days</span>}
          >
            {dayRows.length === 0 ? (
              <div className="p-4">
                <EmptyState
                  title="No labour rows in range"
                  hint="Record labour in the daily register."
                />
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="register-table">
                  <thead>
                    <tr>
                      <th>Date</th>
                      <th className="text-right">Workers</th>
                      <th>Names</th>
                    </tr>
                  </thead>
                  <tbody>
                    {dayRows.map((d) => (
                      <tr key={d.date}>
                        <td className="whitespace-nowrap">{fmtDate(d.date)}</td>
                        <td className="tnum text-right">{fmtNum(d.workers, 0)}</td>
                        <td>{d.names}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>
        </>
      )}
    </div>
  );
}
