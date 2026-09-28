import Database from "@tauri-apps/plugin-sql";
import { invoke } from "@tauri-apps/api/core";

export type SqlValue = string | number | boolean | null;

let dbPromise: Promise<Database> | null = null;

export function getDb(): Promise<Database> {
  if (!dbPromise) {
    dbPromise = Database.load("sqlite:estate.db");
  }
  return dbPromise;
}

export async function select<T = Record<string, unknown>>(
  sql: string,
  params: SqlValue[] = []
): Promise<T[]> {
  const db = await getDb();
  return db.select<T[]>(sql, params);
}

export async function execute(
  sql: string,
  params: SqlValue[] = []
): Promise<{ lastInsertId: number; rowsAffected: number }> {
  const db = await getDb();
  const res = await db.execute(sql, params);
  return { lastInsertId: res.lastInsertId ?? 0, rowsAffected: res.rowsAffected };
}

export interface TxStmt {
  sql: string;
  params: SqlValue[];
}

/** Runs all statements atomically in a single Rust-side transaction. */
export async function tx(stmts: TxStmt[]): Promise<number> {
  return invoke<number>("exec_tx", {
    stmts: stmts.map((s) => ({ sql: s.sql, params: s.params as unknown[] })),
  });
}

export async function restoreDatabase(src: string): Promise<void> {
  await invoke("restore_database", { src });
}

export async function nextSequence(
  estateId: number,
  name: string,
  prefix: string
): Promise<string> {
  const rows = await select<{ next_val: number }>(
    "SELECT next_val FROM sequences WHERE estate_id = $1 AND name = $2",
    [estateId, name]
  );
  const current = rows[0]?.next_val ?? 1;
  await execute(
    "INSERT INTO sequences (estate_id, name, next_val) VALUES ($1,$2,$3) " +
      "ON CONFLICT (estate_id, name) DO UPDATE SET next_val = $4",
    [estateId, name, current + 1, current + 1]
  );
  return `${prefix}${current}`;
}

export async function logAudit(
  userId: number | null,
  action: string,
  entity = "",
  entityId: number | null = null,
  detail = ""
): Promise<void> {
  await execute(
    "INSERT INTO audit_log (user_id, action, entity, entity_id, detail) VALUES ($1,$2,$3,$4,$5)",
    [userId, action, entity, entityId, detail]
  );
}
