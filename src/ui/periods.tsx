import { useMemo, useState } from "react";
import { Plus, RotateCcw } from "lucide-react";
import { Card } from "./components";
import { seasonKey, seasonRange, todayISO } from "../domain/dates";
import type { FilterRange } from "../domain/periods";
import {
  autoLabel,
  newPeriod,
  periodColor,
  periodTag,
  type Period,
} from "../domain/compare";

/**
 * The filter card every analysis screen shares.
 *
 * One period behaves as the old range bar did. Add another and the screen
 * shows the same figures again beside it — April against July, this season
 * against last — rather than making the office hold two screenshots up to
 * the light.
 *
 * The Month / Quarter / Financial year pickers are shortcuts: each one simply
 * writes a From and a To, which stay editable afterwards.
 */

const FULL_MONTHS = ["January","February","March","April","May","June","July",
                     "August","September","October","November","December"];

function pad(n: number) { return String(n).padStart(2, "0"); }
function lastDay(y: number, m1: number) { return new Date(y, m1, 0).getDate(); }

/** Financial years run April to March, the same as the estate's season. */
export function fyOptions(today = todayISO(), back = 4): { key: string; label: string }[] {
  const current = Number(seasonKey(today).slice(0, 4));
  return Array.from({ length: back + 1 }, (_, i) => {
    const y = current - (back - i);
    return { key: `${y}-${y + 1}`, label: `FY ${y}-${String(y + 1).slice(2)}` };
  }).reverse();
}

/** Calendar years to choose from, newest first. */
export function yearOptions(today = todayISO(), back = 5): string[] {
  const cy = Number(today.slice(0, 4));
  return Array.from({ length: back + 1 }, (_, i) => String(cy - i));
}

export function calendarYearRange(year: string): FilterRange {
  return { from: `${year}-01-01`, to: `${year}-12-31` };
}

/** The months of one calendar year; the current year stops at this month. */
export function monthsOfYear(year: string, today = todayISO()): { key: string; label: string }[] {
  const cy = Number(today.slice(0, 4));
  const last = Number(year) === cy ? Number(today.slice(5, 7)) : Number(year) > cy ? 0 : 12;
  return Array.from({ length: last }, (_, i) => ({
    key: `${year}-${pad(i + 1)}`,
    label: FULL_MONTHS[i],
  }));
}

/** Everything on record, for when the office wants no date filter at all. */
export const ALL_DATES = { from: "1970-01-01", to: "2999-12-31" };

export const QUARTERS = [
  { key: "Q1", label: "Q1 — Apr to Jun", startMonth: 4 },
  { key: "Q2", label: "Q2 — Jul to Sep", startMonth: 7 },
  { key: "Q3", label: "Q3 — Oct to Dec", startMonth: 10 },
  { key: "Q4", label: "Q4 — Jan to Mar", startMonth: 1 },
];

export function monthRangeOf(key: string): FilterRange {
  const [y, m] = key.split("-").map(Number);
  return { from: `${y}-${pad(m)}-01`, to: `${y}-${pad(m)}-${pad(lastDay(y, m))}` };
}

export function quarterRangeOf(quarter: string, fy: string): FilterRange {
  const start = Number(fy.slice(0, 4));
  const q = QUARTERS.find((x) => x.key === quarter)!;
  // Q4 (Jan–Mar) falls in the second calendar year of the financial year
  const year = q.startMonth >= 4 ? start : start + 1;
  const endMonth = q.startMonth + 2;
  return {
    from: `${year}-${pad(q.startMonth)}-01`,
    to: `${year}-${pad(endMonth)}-${pad(lastDay(year, endMonth))}`,
  };
}

/** What the four pickers should read, given the dates the period holds. */
export function pickersFor(p: Period, fys: { key: string }[]) {
  const none = { year: "", month: "", fy: "", quarter: "" };
  if (p.from === ALL_DATES.from && p.to === ALL_DATES.to) return { ...none, fy: "all" };

  // Year and Month: a calendar year, or a whole month within one
  const fromY = p.from.slice(0, 4);
  const sameYear = fromY === p.to.slice(0, 4);
  const year = sameYear ? fromY : "";
  let month = "";
  if (sameYear && p.from === `${fromY}-01-01` && p.to === `${fromY}-12-31`) {
    month = "year";
  } else if (
    sameYear &&
    p.from.slice(8) === "01" &&
    p.from.slice(0, 7) === p.to.slice(0, 7) &&
    Number(p.to.slice(8)) === lastDay(Number(fromY), Number(p.from.slice(5, 7)))
  ) {
    month = p.from.slice(0, 7);
  }

  // Financial year and Quarter: a whole FY, or one quarter of it
  let fy = "";
  let quarter = "";
  for (const f of fys) {
    const r = seasonRange(f.key);
    if (r.from === p.from && r.to === p.to) {
      fy = f.key;
      quarter = "fy";
    }
    for (const q of QUARTERS) {
      const qr = quarterRangeOf(q.key, f.key);
      if (qr.from === p.from && qr.to === p.to) {
        fy = f.key;
        quarter = q.key;
      }
    }
  }
  return { year, month, fy, quarter };
}

export function firstPeriod(today = todayISO()): Period {
  const r = seasonRange(seasonKey(today));
  return newPeriod(r.from, r.to, autoLabel(r.from, r.to));
}

export function usePeriods(today = todayISO()) {
  const [periods, setPeriods] = useState<Period[]>(() => [firstPeriod(today)]);

  const update = (id: string, patch: Partial<Period>) =>
    setPeriods((ps) =>
      ps.map((p) => {
        if (p.id !== id) return p;
        const next = { ...p, ...patch };
        if ((patch.from || patch.to) && !patch.label) next.label = autoLabel(next.from, next.to);
        return next;
      })
    );

  const addPeriod = () =>
    setPeriods((ps) => {
      const last = ps[ps.length - 1];
      return [...ps, newPeriod(last.from, last.to, autoLabel(last.from, last.to))];
    });

  const remove = (id: string) =>
    setPeriods((ps) => (ps.length > 1 ? ps.filter((p) => p.id !== id) : ps));

  const reset = () => setPeriods([firstPeriod(today)]);

  const base = periods[0];
  const comparing = periods.length > 1;
  /** One query can cover every period on screen. */
  const span: FilterRange = {
    from: periods.reduce((a, p) => (p.from < a ? p.from : a), base.from),
    to: periods.reduce((a, p) => (p.to > a ? p.to : a), base.to),
  };

  return { periods, setPeriods, update, addPeriod, remove, reset, base, comparing, span };
}

export type PeriodsApi = ReturnType<typeof usePeriods>;

function PeriodRow(props: {
  api: PeriodsApi;
  period: Period;
  index: number;
  today: string;
}) {
  const { api, period: p, index: i, today } = props;
  const fys = useMemo(() => fyOptions(today), [today]);
  const years = useMemo(() => yearOptions(today), [today]);
  const picked = pickersFor(p, fys);

  return (
    <div className={i > 0 ? "mt-4 border-t border-paper-line pt-4" : ""}>
      {i > 0 && (
        <div className="mb-3 flex items-center justify-between">
          <div className="font-display text-[14px] font-semibold" style={{ color: periodColor(i) }}>
            Compare against — Period {periodTag(i)}
          </div>
          <button className="btn" onClick={() => api.remove(p.id)}>
            <RotateCcw size={13} /> Remove this period
          </button>
        </div>
      )}

      <div className="flex flex-wrap items-end gap-4">
        <label className="flex flex-col gap-1">
          <span className="label">Period</span>
          <input
            type="date"
            className="input w-[160px]"
            value={p.from}
            onChange={(e) => api.update(p.id, { from: e.target.value })}
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className="label">To</span>
          <input
            type="date"
            className="input w-[160px]"
            value={p.to}
            onChange={(e) => api.update(p.id, { to: e.target.value })}
          />
        </label>

        <div className="ml-2 h-9 w-px bg-paper-line" />

        <label className="flex flex-col gap-1">
          <span className="label">Year</span>
          <select
            className="input w-[130px]"
            value={picked.year}
            onChange={(e) => e.target.value && api.update(p.id, calendarYearRange(e.target.value))}
          >
            <option value="">Select a year…</option>
            {years.map((y) => (
              <option key={y} value={y}>{y}</option>
            ))}
          </select>
        </label>

        <label className="flex flex-col gap-1">
          <span className="label">Month</span>
          <select
            className="input w-[150px]"
            value={picked.month}
            disabled={!picked.year}
            title={picked.year ? undefined : "Choose a year first"}
            onChange={(e) => {
              if (!e.target.value || !picked.year) return;
              api.update(
                p.id,
                e.target.value === "year" ? calendarYearRange(picked.year) : monthRangeOf(e.target.value)
              );
            }}
          >
            <option value="year">{picked.year ? "Whole year" : "Select a month…"}</option>
            {monthsOfYear(picked.year || "0", today).map((m) => (
              <option key={m.key} value={m.key}>{m.label}</option>
            ))}
          </select>
        </label>

        <div className="ml-2 h-9 w-px bg-paper-line" />

        <label className="flex flex-col gap-1">
          <span className="label">Financial year</span>
          <select
            className="input w-[150px]"
            value={picked.fy}
            onChange={(e) => {
              if (!e.target.value) return;
              api.update(
                p.id,
                e.target.value === "all" ? ALL_DATES : seasonRange(e.target.value)
              );
            }}
          >
            <option value="">Select an FY…</option>
            <option value="all">All dates</option>
            {fys.map((f) => (
              <option key={f.key} value={f.key}>{f.label}</option>
            ))}
          </select>
        </label>

        <label className="flex flex-col gap-1">
          <span className="label">Quarter</span>
          <select
            className="input w-[190px]"
            value={picked.quarter}
            disabled={!picked.fy || picked.fy === "all"}
            title={picked.fy && picked.fy !== "all" ? undefined : "Choose a financial year first"}
            onChange={(e) => {
              if (!e.target.value || !picked.fy || picked.fy === "all") return;
              api.update(
                p.id,
                e.target.value === "fy" ? seasonRange(picked.fy) : quarterRangeOf(e.target.value, picked.fy)
              );
            }}
          >
            <option value="fy">
              {picked.fy && picked.fy !== "all" ? "Whole financial year" : "Select a quarter…"}
            </option>
            {QUARTERS.map((q) => (
              <option key={q.key} value={q.key}>{q.label}</option>
            ))}
          </select>
        </label>
      </div>

      <div className="mt-2 text-[11.5px] text-ink-soft">
        Showing {p.from} to {p.to}
      </div>
    </div>
  );
}

export function PeriodFilters(props: { api: PeriodsApi; today?: string }) {
  const today = props.today ?? todayISO();
  const { api } = props;
  return (
    <Card
      className="mb-4"
      title="Filters"
      right={
        <div className="flex items-center gap-2">
          <button className="btn" onClick={api.addPeriod}>
            <Plus size={13} /> Add another period
          </button>
          <button className="btn btn-secondary" onClick={api.reset}>
            <RotateCcw size={13} /> Clear all filters
          </button>
        </div>
      }
    >
      {api.periods.map((p, i) => (
        <PeriodRow key={p.id} api={api} period={p} index={i} today={today} />
      ))}
    </Card>
  );
}

/** Column heading above each period's copy of the screen. */
export function PeriodHeading(props: { period: Period; index: number }) {
  return (
    <div
      className="mb-2 text-[12.5px] font-semibold"
      style={{ color: periodColor(props.index) }}
    >
      Period {periodTag(props.index)} ({props.period.from} to {props.period.to})
    </div>
  );
}
