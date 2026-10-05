import { monthKey, seasonKey, seasonRange, todayISO } from "./dates";
import type { FilterRange } from "./periods";

/**
 * Comparing stretches of time.
 *
 * Every analysis screen can hold several periods at once — A against B against
 * C — so the office can put this monsoon beside last monsoon, or December
 * beside December, instead of reading two screenshots side by side.
 *
 * A period is just a labelled range. The presets build sets of them; the
 * screens read `from`/`to` exactly as they already read a single range.
 */

export interface Period extends FilterRange {
  /** Stable across edits, so React keys and colours do not jump about. */
  id: string;
  label: string;
}

export const PERIOD_COLORS = [
  "#137A43", // estate green
  "#B3541E", // rust
  "#2F6F9F", // slate blue
  "#8A6D1F", // ochre
  "#6B4E8F", // plum
  "#357F7A", // teal
];

export function periodColor(index: number): string {
  return PERIOD_COLORS[index % PERIOD_COLORS.length];
}

/** A, B, C … so the screens can refer to them the way people do. */
export function periodTag(index: number): string {
  let n = index;
  let out = "";
  do {
    out = String.fromCharCode(65 + (n % 26)) + out;
    n = Math.floor(n / 26) - 1;
  } while (n >= 0);
  return out;
}

let seq = 0;
export function newPeriod(from: string, to: string, label: string): Period {
  seq += 1;
  return { id: `p${seq}`, label, from, to };
}

export function resetPeriodIds(): void {
  seq = 0;
}

const MONTHS = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];

function lastDayOf(year: number, month1: number): number {
  return new Date(year, month1, 0).getDate();
}

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

/** The twelve calendar months of a year. */
export function monthPeriods(year: number): Period[] {
  return MONTHS.map((m, i) =>
    newPeriod(
      `${year}-${pad(i + 1)}-01`,
      `${year}-${pad(i + 1)}-${pad(lastDayOf(year, i + 1))}`,
      `${m} ${String(year).slice(2)}`
    )
  );
}

/**
 * The twelve months of a season, which runs April to March — so a season
 * labelled 2025-2026 starts in April 2025 and ends in March 2026.
 */
export function seasonMonthPeriods(season: string): Period[] {
  const start = Number(season.slice(0, 4));
  return Array.from({ length: 12 }, (_, i) => {
    const month0 = (3 + i) % 12;
    const year = month0 >= 3 ? start : start + 1;
    return newPeriod(
      `${year}-${pad(month0 + 1)}-01`,
      `${year}-${pad(month0 + 1)}-${pad(lastDayOf(year, month0 + 1))}`,
      `${MONTHS[month0]} ${String(year).slice(2)}`
    );
  });
}

/** Calendar quarters. */
export function quarterPeriods(year: number): Period[] {
  return [0, 1, 2, 3].map((q) => {
    const first = q * 3 + 1;
    const last = first + 2;
    return newPeriod(
      `${year}-${pad(first)}-01`,
      `${year}-${pad(last)}-${pad(lastDayOf(year, last))}`,
      `Q${q + 1} ${String(year).slice(2)}`
    );
  });
}

/** Quarters of a season: Apr–Jun, Jul–Sep, Oct–Dec, Jan–Mar. */
export function seasonQuarterPeriods(season: string): Period[] {
  const start = Number(season.slice(0, 4));
  return [0, 1, 2, 3].map((q) => {
    const m0 = (3 + q * 3) % 12;
    const year = m0 >= 3 ? start : start + 1;
    const lastM0 = (m0 + 2) % 12;
    const lastYear = lastM0 >= m0 ? year : year + 1;
    return newPeriod(
      `${year}-${pad(m0 + 1)}-01`,
      `${lastYear}-${pad(lastM0 + 1)}-${pad(lastDayOf(lastYear, lastM0 + 1))}`,
      `Q${q + 1} ${String(start).slice(2)}-${String(start + 1).slice(2)}`
    );
  });
}

/** The last `count` seasons, oldest first, ending with the one `today` is in. */
export function seasonPeriods(count: number, today = todayISO()): Period[] {
  const current = Number(seasonKey(today).slice(0, 4));
  return Array.from({ length: count }, (_, i) => {
    const start = current - (count - 1 - i);
    const r = seasonRange(`${start}-${start + 1}`);
    return newPeriod(r.from, r.to, `${start}-${String(start + 1).slice(2)}`);
  });
}

/** The last `count` calendar years, oldest first. */
export function yearPeriods(count: number, today = todayISO()): Period[] {
  const current = Number(today.slice(0, 4));
  return Array.from({ length: count }, (_, i) => {
    const y = current - (count - 1 - i);
    return newPeriod(`${y}-01-01`, `${y}-12-31`, String(y));
  });
}

/** The same month a year earlier, for a like-for-like comparison. */
export function samePeriodLastYear(p: Period): Period {
  const shift = (iso: string) => {
    const [y, m, d] = iso.split("-").map(Number);
    const yy = y - 1;
    return `${yy}-${pad(m)}-${pad(Math.min(d, lastDayOf(yy, m)))}`;
  };
  return newPeriod(shift(p.from), shift(p.to), `${p.label} (prev yr)`);
}

export function describePeriod(p: Period): string {
  return p.from === p.to ? p.from : `${p.from} → ${p.to}`;
}

/** Whole months get a tidy label; anything else shows its dates. */
export function autoLabel(from: string, to: string): string {
  if (!from || !to) return "Period";
  const sameMonth = monthKey(from) === monthKey(to);
  const firstOfMonth = from.endsWith("-01");
  const [y, m] = from.split("-").map(Number);
  const endsMonth = Number(to.slice(8)) === lastDayOf(y, m);
  if (sameMonth && firstOfMonth && endsMonth) {
    return `${MONTHS[m - 1]} ${String(y).slice(2)}`;
  }
  if (from.endsWith("-01-01") && to.endsWith("-12-31") && from.slice(0, 4) === to.slice(0, 4)) {
    return from.slice(0, 4);
  }
  const r = seasonRange(seasonKey(from));
  if (r.from === from && r.to === to) {
    return `${from.slice(0, 4)}-${String(Number(from.slice(0, 4)) + 1).slice(2)}`;
  }
  return `${from.slice(8)}/${from.slice(5, 7)} – ${to.slice(8)}/${to.slice(5, 7)}`;
}

export function overlaps(a: Period, b: Period): boolean {
  return a.from <= b.to && b.from <= a.to;
}

/** Percentage change against the first period, for the comparison table. */
export function vsBase(value: number, base: number): number | null {
  if (!base) return null;
  return Math.round(((value - base) / base) * 1000) / 10;
}
