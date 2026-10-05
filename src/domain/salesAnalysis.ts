import { invoiceBillingQty } from "./valuation";
import { monthKey, weekKey } from "./dates";

/**
 * The figures behind the Sales analysis charts. Everything is worked out from
 * the same invoice rows the tables beneath use, so a bar can always be checked
 * against a line of a table.
 */

export interface SaleLine {
  date: string;
  buyer_id: number | null;
  buyer_name: string | null;
  grade: string;
  qty: number;
  buyer_qty?: number | null;
  formalin_kg?: number | null;
  rate: number;
  value: number | null;
  status: string;
}

/** Cancelled invoices are not sales; a latex sale with no DRC yet has no value. */
export function countable(rows: SaleLine[]): SaleLine[] {
  return rows.filter((r) => r.status !== "Cancelled");
}

const r2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

export interface SalesSummary {
  invoices: number;
  /** Listed in the table but not counted: cancelled. */
  cancelled: number;
  pending: number;
  value: number;
  qty: number;
  /** Value over billed quantity, only across invoices that have a value. */
  avgRate: number | null;
}

export function summarise(rows: SaleLine[]): SalesSummary {
  const live = countable(rows);
  let value = 0;
  let valuedQty = 0;
  let pending = 0;
  let qty = 0;
  for (const r of live) {
    const q = invoiceBillingQty(r);
    qty += q;
    if (r.value === null) {
      pending += 1;
    } else {
      value += Number(r.value) || 0;
      valuedQty += q;
    }
  }
  return {
    invoices: live.length,
    cancelled: rows.length - live.length,
    pending,
    value: r2(value),
    qty: r2(qty),
    avgRate: valuedQty > 0 ? r2(value / valuedQty) : null,
  };
}

export type Granularity = "day" | "week" | "month";

/** Short ranges read by the day, a season by the month. */
export function granularityFor(from: string, to: string): Granularity {
  const days = Math.round((new Date(to).getTime() - new Date(from).getTime()) / 86400000) + 1;
  if (days <= 45) return "day";
  if (days <= 200) return "week";
  return "month";
}

const MON = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];

function labelFor(key: string, g: Granularity): string {
  if (g === "month") {
    const [y, m] = key.split("-").map(Number);
    return `${MON[m - 1]} ${String(y).slice(2)}`;
  }
  const [, m, d] = key.split("-").map(Number);
  return `${d} ${MON[m - 1]}`;
}

function bucketKey(date: string, g: Granularity): string {
  return g === "day" ? date : g === "week" ? weekKey(date) : monthKey(date);
}

export type TimePoint = {
  key: string;
  label: string;
  value: number;
  qty: number;
  rate: number | null;
  invoices: number;
};

/** Sales per day, week or month, oldest first, with empty periods left out. */
export function salesOverTime(rows: SaleLine[], g: Granularity): TimePoint[] {
  const by = new Map<string, { value: number; qty: number; valuedQty: number; n: number }>();
  for (const r of countable(rows)) {
    const k = bucketKey(r.date, g);
    const b = by.get(k) ?? { value: 0, qty: 0, valuedQty: 0, n: 0 };
    const q = invoiceBillingQty(r);
    b.n += 1;
    b.qty += q;
    if (r.value !== null) {
      b.value += Number(r.value) || 0;
      b.valuedQty += q;
    }
    by.set(k, b);
  }
  return [...by.entries()]
    .sort((a, b) => (a[0] < b[0] ? -1 : 1))
    .map(([key, b]) => ({
      key,
      label: labelFor(key, g),
      value: r2(b.value),
      qty: r2(b.qty),
      rate: b.valuedQty > 0 ? r2(b.value / b.valuedQty) : null,
      invoices: b.n,
    }));
}

export type Slice = {
  name: string;
  value: number;
  qty: number;
  invoices: number;
};

function group(rows: SaleLine[], key: (r: SaleLine) => string): Slice[] {
  const by = new Map<string, Slice>();
  for (const r of countable(rows)) {
    const k = key(r);
    const s = by.get(k) ?? { name: k, value: 0, qty: 0, invoices: 0 };
    s.value += Number(r.value) || 0;
    s.qty += invoiceBillingQty(r);
    s.invoices += 1;
    by.set(k, s);
  }
  return [...by.values()]
    .map((s) => ({ ...s, value: r2(s.value), qty: r2(s.qty) }))
    .sort((a, b) => b.value - a.value);
}

export const byGrade = (rows: SaleLine[]) => group(rows, (r) => r.grade || "(no grade)");

/** The biggest buyers, with the rest folded into one bar rather than dropped. */
export function byBuyer(rows: SaleLine[], top = 8): Slice[] {
  const all = group(rows, (r) => r.buyer_name || "(no buyer)");
  if (all.length <= top) return all;
  const head = all.slice(0, top);
  const rest = all.slice(top);
  return [
    ...head,
    {
      name: `Other (${rest.length})`,
      value: r2(rest.reduce((s, x) => s + x.value, 0)),
      qty: r2(rest.reduce((s, x) => s + x.qty, 0)),
      invoices: rest.reduce((s, x) => s + x.invoices, 0),
    },
  ];
}

/** Rs 1,25,000 -> "1.3L"; short enough for an axis. */
export function compactMoney(n: number): string {
  const a = Math.abs(n);
  if (a >= 1e7) return `${r2(n / 1e7)}Cr`;
  if (a >= 1e5) return `${r2(n / 1e5)}L`;
  if (a >= 1e3) return `${r2(n / 1e3)}k`;
  return String(Math.round(n));
}
