import { readFileSync } from "node:fs";
import { resolve } from "node:path";

type SqliteDb = {
  exec(sql: string): void;
  prepare(sql: string): {
    all(...p: unknown[]): unknown[];
    run(...p: unknown[]): { lastInsertRowid: unknown; changes: unknown };
  };
  close(): void;
};

const { DatabaseSync } = process.getBuiltinModule("node:sqlite") as {
  DatabaseSync: new (path: string) => SqliteDb;
};

let db: SqliteDb | null = null;

const MIGRATION = readFileSync(
  resolve(__dirname, "../../../src-tauri/migrations/0001_init.sql"),
  "utf8"
);

export function raw(): SqliteDb {
  if (!db) {
    db = new DatabaseSync(":memory:");
    db.exec(MIGRATION);
  }
  return db;
}

export function resetDb(): void {
  if (db) {
    db.close();
    db = null;
  }
  raw();
}

export function convert(sql: string): string {
  return sql.replace(/\$\d+/g, "?");
}

export function bindList(sql: string, params: unknown[]): unknown[] {
  const used: number[] = [];
  sql.replace(/\$(\d+)/g, (_, n: string) => {
    used.push(Number(n));
    return "?";
  });
  return used.map((i) => (params[i - 1] === undefined ? null : params[i - 1]));
}

export function rows<T = Record<string, unknown>>(
  sql: string,
  params: unknown[] = []
): T[] {
  return raw()
    .prepare(convert(sql))
    .all(...(bindList(sql, params) as never[])) as T[];
}

export function run(
  sql: string,
  params: unknown[] = []
): { lastInsertId: number; rowsAffected: number } {
  const r = raw()
    .prepare(convert(sql))
    .run(...(bindList(sql, params) as never[]));
  return {
    lastInsertId: Number(r.lastInsertRowid),
    rowsAffected: Number(r.changes),
  };
}

export function scalar<T = number>(sql: string, params: unknown[] = []): T {
  const r = rows<Record<string, unknown>>(sql, params)[0];
  if (!r) return 0 as T;
  return Object.values(r)[0] as T;
}
