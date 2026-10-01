import Database from "@tauri-apps/plugin-sql";
import { useApp } from "../app/store";

/**
 * Append-only audit trail, stored in its own SQLite file (audit.db) next to
 * estate.db — independent of the main database, so backups/restores of
 * estate.db never touch it. Every row carries a SHA-256 hash chained to the
 * previous row's hash, so deleting or rewriting history breaks the chain.
 */

export type AuditSource = "ui" | "sql" | "app" | "console" | "system";

export interface AuditInput {
  action: string;
  detail?: string;
  entity?: string;
  entityId?: number | null;
  source?: AuditSource;
  userId?: number | null;
  userName?: string | null;
}

export interface AuditRow {
  id: number;
  ts: string;
  session: string;
  user_id: number | null;
  user_name: string | null;
  route: string;
  action: string;
  entity: string;
  entity_id: number | null;
  detail: string;
  source: string;
  prev_hash: string;
  row_hash: string;
}

interface Snapshot {
  ts: string;
  session: string;
  user_id: number | null;
  user_name: string | null;
  route: string;
  action: string;
  entity: string;
  entity_id: number | null;
  detail: string;
  source: string;
}

const GENESIS = "0".repeat(64);
const SESSION =
  typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(16).slice(2)}`;

let dbPromise: Promise<Database> | null = null;
let initialized = false;
let lastHash = GENESIS;
let chain: Promise<void> = Promise.resolve();

function getAuditDb(): Promise<Database> {
  if (!dbPromise) dbPromise = Database.load("sqlite:audit.db");
  return dbPromise;
}

function currentRoute(): string {
  return window.location.hash.replace(/^#\/?/, "") || "dashboard";
}

async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(text)
  );
  return [...new Uint8Array(digest)]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function hashPayload(prev: string, r: Snapshot): string {
  return [
    prev,
    r.ts,
    r.session,
    r.user_id ?? "",
    r.user_name ?? "",
    r.route,
    r.action,
    r.entity,
    r.entity_id ?? "",
    r.detail,
    r.source,
  ].join("\u0000");
}

async function ensureInit(db: Database): Promise<void> {
  if (initialized) return;
  await db.execute(
    "CREATE TABLE IF NOT EXISTS audit_events (" +
      "id INTEGER PRIMARY KEY AUTOINCREMENT, " +
      "ts TEXT NOT NULL, session TEXT NOT NULL, " +
      "user_id INTEGER, user_name TEXT, route TEXT NOT NULL DEFAULT '', " +
      "action TEXT NOT NULL, entity TEXT NOT NULL DEFAULT '', entity_id INTEGER, " +
      "detail TEXT NOT NULL DEFAULT '', source TEXT NOT NULL DEFAULT '', " +
      "prev_hash TEXT NOT NULL, row_hash TEXT NOT NULL)"
  );
  await db.execute(
    "CREATE INDEX IF NOT EXISTS idx_audit_ts ON audit_events (ts)"
  );
  await db.execute(
    "CREATE TRIGGER IF NOT EXISTS audit_events_no_update " +
      "BEFORE UPDATE ON audit_events " +
      "BEGIN SELECT RAISE(ABORT, 'audit trail is append-only'); END"
  );
  await db.execute(
    "CREATE TRIGGER IF NOT EXISTS audit_events_no_delete " +
      "BEFORE DELETE ON audit_events " +
      "BEGIN SELECT RAISE(ABORT, 'audit trail is append-only'); END"
  );
  const rows = await db.select<{ row_hash: string }[]>(
    "SELECT row_hash FROM audit_events ORDER BY id DESC LIMIT 1"
  );
  lastHash = rows[0]?.row_hash ?? GENESIS;
  initialized = true;
}

/** Captures user/route synchronously so queued writes keep their context. */
function snapshot(entry: AuditInput): Snapshot {
  const s = useApp.getState();
  let detail = entry.detail ?? "";
  if (detail.length > 500) detail = detail.slice(0, 500) + "…";
  return {
    ts: new Date().toISOString(),
    session: SESSION,
    user_id: entry.userId !== undefined ? entry.userId : (s.user?.id ?? null),
    user_name:
      entry.userName !== undefined ? entry.userName : (s.user?.name ?? null),
    route: currentRoute(),
    action: entry.action,
    entity: entry.entity ?? "",
    entity_id: entry.entityId ?? null,
    detail,
    source: entry.source ?? "app",
  };
}

async function write(snap: Snapshot, attempt: number): Promise<void> {
  const db = await getAuditDb();
  await ensureInit(db);
  const prev = lastHash;
  const rowHash = await sha256Hex(hashPayload(prev, snap));
  try {
    await db.execute(
      "INSERT INTO audit_events (ts, session, user_id, user_name, route, " +
        "action, entity, entity_id, detail, source, prev_hash, row_hash) " +
        "VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)",
      [
        snap.ts,
        snap.session,
        snap.user_id,
        snap.user_name,
        snap.route,
        snap.action,
        snap.entity,
        snap.entity_id,
        snap.detail,
        snap.source,
        prev,
        rowHash,
      ]
    );
  } catch (err) {
    // The table can vanish underneath us (test db reset) — rebuild once.
    if (attempt === 0) {
      initialized = false;
      lastHash = GENESIS;
      return write(snap, 1);
    }
    throw err;
  }
  lastHash = rowHash;
}

/**
 * Queues one audit event. Never rejects: audit failures must not break the
 * app, and the write queue keeps rows (and their hash chain) ordered.
 */
export function record(entry: AuditInput): Promise<void> {
  const snap = snapshot(entry);
  const next = chain.then(() => write(snap, 0).catch(() => undefined));
  chain = next;
  return next;
}

/** Semantic audit event for app code (login, logout, restore…). */
export function audit(
  action: string,
  detail = "",
  entity = "",
  entityId: number | null = null,
  source: AuditSource = "app"
): Promise<void> {
  return record({ action, detail, entity, entityId, source });
}

const DML =
  /^\s*(INSERT|UPDATE|DELETE|REPLACE)\s+(?:OR\s+\w+\s+)?(?:INTO\s+|FROM\s+)?([A-Za-z_][A-Za-z0-9_]*)/i;

/**
 * Derives an audit row from a data-touching statement so every mutation in
 * the platform (INSERT/UPDATE/DELETE/REPLACE) is captured mechanically.
 */
export function auditSql(
  sql: string,
  params: readonly unknown[] = []
): Promise<void> {
  const m = DML.exec(sql);
  if (!m) return Promise.resolve();
  let detail: string;
  if (/password/i.test(sql)) {
    detail = `[redacted ${params.length} values]`;
  } else {
    const safe = params.map((p) =>
      typeof p === "string" && p.length > 200
        ? p.slice(0, 200) + "…"
        : p instanceof Uint8Array
          ? `[bytes ${p.length}]`
          : p
    );
    try {
      detail = JSON.stringify(safe) ?? "";
    } catch {
      detail = `[${params.length} values]`;
    }
    if (detail.length > 300) detail = detail.slice(0, 300) + "…";
  }
  return record({
    action: `sql_${m[1].toLowerCase()}`,
    entity: m[2],
    detail,
    source: "sql",
  });
}

export async function readAuditEvents(limit = 50): Promise<AuditRow[]> {
  await flushAudit();
  const db = await getAuditDb();
  await ensureInit(db);
  return db.select<AuditRow[]>(
    "SELECT * FROM audit_events ORDER BY id DESC LIMIT $1",
    [limit]
  );
}

export async function countAuditEvents(): Promise<number> {
  await flushAudit();
  const db = await getAuditDb();
  await ensureInit(db);
  const rows = await db.select<{ n: number }[]>(
    "SELECT COUNT(*) AS n FROM audit_events"
  );
  return Number(rows[0]?.n ?? 0);
}

/** Recomputes every row hash; false means history was altered. */
export async function verifyChain(list: AuditRow[]): Promise<boolean> {
  let prev = GENESIS;
  for (const r of list) {
    if (r.prev_hash !== prev) return false;
    const expected = await sha256Hex(
      hashPayload(prev, {
        ts: r.ts,
        session: r.session,
        user_id: r.user_id,
        user_name: r.user_name,
        route: r.route,
        action: r.action,
        entity: r.entity,
        entity_id: r.entity_id,
        detail: r.detail,
        source: r.source,
      })
    );
    if (expected !== r.row_hash) return false;
    prev = r.row_hash;
  }
  return true;
}

export function flushAudit(): Promise<void> {
  return chain;
}

export function resetAuditForTests(): void {
  dbPromise = null;
  initialized = false;
  lastHash = GENESIS;
  chain = Promise.resolve();
}
