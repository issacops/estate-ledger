import { isMissedTapping, isNotScheduled } from "./rotation";

/**
 * The entry history behind a tapper or a block: every row ever recorded, which
 * the office can narrow by month, dates, status or reason and read month by
 * month.
 */

export interface EntryLine {
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

export type StatusFilter = "all" | "completed" | "missed" | "notScheduled";

export interface EntryFilter {
  /** `YYYY-MM`, or "" for every month. */
  month: string;
  from: string;
  to: string;
  status: StatusFilter;
  /** Exact reason text, or "" for any. */
  reason: string;
}

export const NO_FILTER: EntryFilter = { month: "", from: "", to: "", status: "all", reason: "" };

const r1 = (n: number) => Math.round((n + Number.EPSILON) * 10) / 10;

export function netKg(e: EntryLine): number {
  if (e.status !== "Completed" || e.product_mode === "Sheet") return 0;
  return Math.max(0, (Number(e.bucket_kg) || 0) - (Number(e.tare_kg) || 0));
}

export function wetSheets(e: EntryLine): number {
  return e.status === "Completed" && e.product_mode === "Sheet" ? Number(e.wet_sheets) || 0 : 0;
}

export function matchesStatus(e: EntryLine, s: StatusFilter): boolean {
  switch (s) {
    case "completed":
      return e.status === "Completed";
    case "missed":
      return isMissedTapping(e);
    case "notScheduled":
      return e.status === "Not Done" && isNotScheduled(e.reason);
    default:
      return true;
  }
}

export function filterEntries(rows: EntryLine[], f: EntryFilter): EntryLine[] {
  return rows.filter((e) => {
    if (f.month && e.date.slice(0, 7) !== f.month) return false;
    if (f.from && e.date < f.from) return false;
    if (f.to && e.date > f.to) return false;
    if (f.reason && (e.reason || "") !== f.reason) return false;
    return matchesStatus(e, f.status);
  });
}

export interface Totals {
  entries: number;
  completed: number;
  missed: number;
  notScheduled: number;
  netKg: number;
  wetSheets: number;
}

export function totalsOf(rows: EntryLine[]): Totals {
  const t: Totals = { entries: rows.length, completed: 0, missed: 0, notScheduled: 0, netKg: 0, wetSheets: 0 };
  for (const e of rows) {
    if (e.status === "Completed") t.completed += 1;
    else if (isNotScheduled(e.reason)) t.notScheduled += 1;
    else t.missed += 1;
    t.netKg += netKg(e);
    t.wetSheets += wetSheets(e);
  }
  t.netKg = r1(t.netKg);
  return t;
}

export interface MonthRow extends Totals {
  month: string;
  /** Distinct days with something tapped. */
  daysTapped: number;
}

/** One row per month present in the data, newest first. */
export function monthSummary(rows: EntryLine[]): MonthRow[] {
  const by = new Map<string, EntryLine[]>();
  for (const e of rows) {
    const k = e.date.slice(0, 7);
    const list = by.get(k);
    if (list) list.push(e);
    else by.set(k, [e]);
  }
  return [...by.entries()]
    .sort((a, b) => (a[0] < b[0] ? 1 : -1))
    .map(([month, list]) => ({
      month,
      ...totalsOf(list),
      daysTapped: new Set(list.filter((e) => e.status === "Completed").map((e) => e.date)).size,
    }));
}

export function monthsPresent(rows: EntryLine[]): string[] {
  return [...new Set(rows.map((e) => e.date.slice(0, 7)))].sort().reverse();
}

export function reasonsPresent(rows: EntryLine[]): string[] {
  return [...new Set(rows.filter((e) => e.status !== "Completed").map((e) => e.reason || ""))]
    .filter((r) => r !== "")
    .sort();
}

export function paginate<T>(rows: T[], page: number, size: number) {
  const pages = Math.max(1, Math.ceil(rows.length / size));
  const p = Math.min(Math.max(1, page), pages);
  const start = (p - 1) * size;
  return {
    page: p,
    pages,
    from: rows.length ? start + 1 : 0,
    to: Math.min(rows.length, start + size),
    slice: rows.slice(start, start + size),
  };
}

const MONTHS = ["January","February","March","April","May","June","July","August","September","October","November","December"];

export function monthLabel(key: string): string {
  const [y, m] = key.split("-").map(Number);
  return `${MONTHS[m - 1] ?? key} ${y}`;
}
