// Buyer-ledger statement shaping — fix list #3 (filter by payment type) and
// #10 (group the statement by type with a subtotal per group).
//
// Both are strictly display changes. Balances are computed once, chronologically,
// by StockHub.buildLedger over the buyer's full history; filtering or re-ordering
// into groups only decides which rows are shown and under which heading. Nothing
// here ever re-derives a balance from a filtered subset.

export type LedgerGroup = "invoice" | "settlement" | "sales" | "estate" | "bank";

export interface LedgerGroupDef {
  id: LedgerGroup;
  label: string;
  heading: string;
}

// Order is the display order of groups in the statement and the order the
// filter chips appear in.
export const LEDGER_GROUPS: LedgerGroupDef[] = [
  { id: "invoice", label: "Invoices", heading: "Invoices" },
  { id: "settlement", label: "Settlement", heading: "Settlement" },
  { id: "sales", label: "Sales advance", heading: "Sales advance (Advance — Latex)" },
  { id: "estate", label: "Estate advance", heading: "Estate advance" },
  { id: "bank", label: "Bank advance", heading: "Bank advance / deposit" },
];

export const LEDGER_FILTERS: { id: "All" | LedgerGroup; label: string }[] = [
  { id: "All", label: "All types" },
  ...LEDGER_GROUPS.map((g) => ({ id: g.id, label: g.label })),
];

// One place decides what a row's type means, for both the filter and the
// grouping. An exact-string match would not be enough: the same estate also
// runs on the prototype apps, and Estate Ledger writes "Advance — <grade>"
// for custom grades while older rows can carry no type at all.
export function paymentGroup(type: string): LedgerGroup {
  const t = String(type ?? "");
  if (t === "Invoice") return "invoice";
  if (t === "Settlement") return "settlement";
  if (t.startsWith("Advance") && /estate/i.test(t)) return "estate";
  if (t.startsWith("Advance") && /(bank|deposit)/i.test(t)) return "bank";
  return "sales";
}

export interface LedgerLine {
  date: string;
  type: string;
  ref: string;
  debit: number;
  credit: number;
}

export interface LedgerBlock<T extends LedgerLine = LedgerLine> {
  group: LedgerGroup | null;
  heading: string | null;
  rows: T[];
}

// `rows` must already be in chronological order — grouping only buckets them,
// it never re-sorts, so each row keeps the balance computed over full history.
export function groupLedgerRows<T extends LedgerLine>(
  rows: T[],
  grouped: boolean
): LedgerBlock<T>[] {
  if (!grouped) return [{ group: null, heading: null, rows }];
  return LEDGER_GROUPS.map((g) => ({
    group: g.id,
    heading: g.heading,
    rows: rows.filter((r) => paymentGroup(r.type) === g.id),
  })).filter((b) => b.rows.length > 0);
}

export function ledgerTotals(rows: LedgerLine[]): { debit: number; credit: number } {
  return rows.reduce(
    (acc, r) => ({ debit: acc.debit + r.debit, credit: acc.credit + r.credit }),
    { debit: 0, credit: 0 }
  );
}
