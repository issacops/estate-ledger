import { select, tx, type TxStmt } from "./client";

/**
 * Undoing an import.
 *
 * Both importers record the id range they wrote into each table, so an undo
 * removes exactly those rows and nothing else — not a row the office typed by
 * hand that happens to sit on the same date.
 *
 * What an undo cannot do is bring back rows the import replaced. A Day Pack
 * committed with "replace day", or a bulk import that overwrote days already
 * in the book, deleted the old rows at the time. Undoing removes what was put
 * in; it does not restore what was taken out. Both screens say so before
 * asking the user to confirm.
 */

/** table -> [first id written, last id written] */
export type UndoPlan = Record<string, [number, number]>;

/** Children first, so nothing is orphaned on the way out. */
export const DELETE_ORDER = [
  "entry_row_buckets",
  "entry_row_barrels",
  "invoice_barrels",
  "entry_rows",
  "labour_rows",
  "payments",
  "vendor_payments",
  "stock_ledger",
  "entry_days",
  "invoices",
  "purchases",
  "cashbook",
  "smokehouse_log",
] as const;

const KNOWN = new Set<string>(DELETE_ORDER);

export function makeUndoPlan(
  entries: Record<string, { first: number; count: number }>
): UndoPlan {
  const plan: UndoPlan = {};
  for (const [table, { first, count }] of Object.entries(entries)) {
    if (count > 0) plan[table] = [first, first + count - 1];
  }
  return plan;
}

export function parseUndoPlan(json: string | null | undefined): UndoPlan | null {
  if (!json) return null;
  try {
    const raw = JSON.parse(json) as Record<string, unknown>;
    const plan: UndoPlan = {};
    for (const [table, range] of Object.entries(raw)) {
      if (!KNOWN.has(table)) continue;
      if (!Array.isArray(range) || range.length !== 2) continue;
      const [a, b] = range.map(Number);
      if (!Number.isFinite(a) || !Number.isFinite(b) || b < a) continue;
      plan[table] = [a, b];
    }
    return Object.keys(plan).length ? plan : null;
  } catch {
    return null;
  }
}

export function undoStatements(plan: UndoPlan): TxStmt[] {
  const stmts: TxStmt[] = [];
  for (const table of DELETE_ORDER) {
    const range = plan[table];
    if (!range) continue;
    stmts.push({
      sql: `DELETE FROM ${table} WHERE id >= $1 AND id <= $2`,
      params: [range[0], range[1]],
    });
  }
  return stmts;
}

export function countRows(plan: UndoPlan): number {
  return Object.values(plan).reduce((n, [a, b]) => n + (b - a + 1), 0);
}

export interface BatchRow {
  id: number;
  kind: string;
  filename: string;
  row_count: number;
  status: string;
  summary: string;
  created_at: string;
  undo_json: string | null;
}

export async function loadBatches(estateId: number, kind: string, limit = 10) {
  return select<BatchRow>(
    "SELECT id, kind, filename, row_count, status, summary, created_at, undo_json " +
      "FROM import_batches WHERE estate_id=$1 AND kind=$2 " +
      "ORDER BY created_at DESC, id DESC LIMIT $3",
    [estateId, kind, limit]
  );
}

/** Removes the rows a batch wrote, then the batch itself, in one transaction. */
export async function undoImport(batch: BatchRow): Promise<number> {
  const plan = parseUndoPlan(batch.undo_json);
  if (!plan) throw new Error("This import did not record what it wrote, so it cannot be undone.");
  const stmts = undoStatements(plan);
  stmts.push({ sql: "DELETE FROM import_batches WHERE id=$1", params: [batch.id] });
  await tx(stmts);
  return countRows(plan);
}
