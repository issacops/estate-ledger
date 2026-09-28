import { raw, convert, bindList } from "./db";

export interface FakeStmt {
  sql: string;
  params?: unknown[];
}

const files = new Map<string, Uint8Array>();
const restored: string[] = [];

export function fakeFiles(): Map<string, Uint8Array> {
  return files;
}

export function restoredPaths(): string[] {
  return restored;
}

export function resetFakes(): void {
  files.clear();
  restored.length = 0;
}

export async function invoke<T>(
  cmd: string,
  args?: Record<string, unknown>
): Promise<T> {
  if (cmd === "exec_tx") {
    const stmts = (args?.stmts as FakeStmt[]) ?? [];
    const db = raw();
    db.exec("BEGIN");
    try {
      for (const s of stmts) {
        db.prepare(convert(s.sql)).run(
          ...(bindList(s.sql, s.params ?? []) as never[])
        );
      }
      db.exec("COMMIT");
    } catch (e) {
      db.exec("ROLLBACK");
      throw e;
    }
    return stmts.length as T;
  }
  if (cmd === "restore_database") {
    restored.push(String(args?.src ?? ""));
    return undefined as T;
  }
  throw new Error(`unmocked invoke: ${cmd}`);
}
