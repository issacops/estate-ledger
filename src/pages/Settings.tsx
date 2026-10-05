import { useEffect, useState } from "react";
import { toast } from "sonner";
import { useTranslation } from "react-i18next";
import {
  Database,
  Download,
  HardDrive,
  Info,
  RefreshCcw,
  RotateCcw,
  ScrollText,
  Upload,
  Users,
} from "lucide-react";
import { save, open } from "@tauri-apps/plugin-dialog";
import { writeFile } from "@tauri-apps/plugin-fs";
import { useApp } from "../app/store";
import { useQuery } from "../db/hooks";
import { execute, select, restoreDatabase } from "../db/client";
import { countAuditEvents, readAuditEvents, type AuditRow } from "../audit";
import { Card, Confirm, Field, PageHeader, Pill, Table, Badge } from "../ui/components";
import { todayISO } from "../domain/dates";
import type { Letterhead, User } from "../domain/types";

const MAIN_TABLES = [
  "estates",
  "users",
  "tappers",
  "blocks",
  "barrels",
  "entry_days",
  "entry_rows",
  "entry_row_buckets",
  "entry_row_barrels",
  "labour_rows",
  "smokehouse_log",
  "stock_ledger",
  "buyers",
  "vendors",
  "invoices",
  "invoice_barrels",
  "payments",
  "cashbook",
  "purchases",
  "vendor_payments",
  "stock_items",
  "config_lists",
  "sequences",
  "import_batches",
  "audit_log",
  "settings",
];

export async function dumpAllTables(): Promise<Record<string, unknown[]>> {
  const out: Record<string, unknown[]> = {};
  for (const table of MAIN_TABLES) {
    // Never write password hashes or salts into a plain-text export.
    out[table] = await select(
      table === "users"
        ? "SELECT id, name, email, role, active FROM users"
        : `SELECT * FROM ${table}`
    );
  }
  return out;
}

function fmtTs(ts: string): string {
  const d = new Date(ts);
  if (Number.isNaN(d.getTime())) return ts;
  return d.toLocaleString("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function AuditTrailCard() {
  const user = useApp((s) => s.user);
  const [events, setEvents] = useState<AuditRow[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);

  const load = async () => {
    setLoading(true);
    try {
      const [list, n] = await Promise.all([readAuditEvents(50), countAuditEvents()]);
      setEvents(list);
      setTotal(n);
    } catch {
      toast.error("Could not read the audit trail");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, []);

  if (user?.role !== "Admin") return null;

  return (
    <Card
      title={
        <span className="flex items-center gap-2">
          <ScrollText size={14} /> Audit trail
        </span>
      }
      pad={false}
      right={
        <button
          className="btn-icon"
          title="Refresh"
          disabled={loading}
          onClick={() => void load()}
        >
          <RefreshCcw size={13} className={loading ? "animate-spin" : ""} />
        </button>
      }
    >
      <div className="border-b border-paper-line px-4 py-2 text-[11px] text-ink-soft">
        Append-only · {total.toLocaleString("en-IN")} events · stored separately
        as audit.db (survives database restores)
      </div>
      <Table headers={["Time", "User", "Action", "Detail"]}>
        {events.map((ev) => (
          <tr key={ev.id}>
            <td className="whitespace-nowrap text-[11.5px]">{fmtTs(ev.ts)}</td>
            <td className="text-[11.5px] whitespace-nowrap">
              {ev.user_name ?? "—"}
            </td>
            <td className="font-mono text-[11px] whitespace-nowrap">
              {ev.action}
              <span className="text-ink-soft/70"> · {ev.source}</span>
            </td>
            <td className="text-[11.5px] text-ink-soft">
              {[ev.entity, ev.detail].filter(Boolean).join(" — ") || "—"}
            </td>
          </tr>
        ))}
        {!events.length && (
          <tr>
            <td colSpan={4} className="py-4 text-center text-[12px] text-ink-soft">
              No audit events yet.
            </td>
          </tr>
        )}
      </Table>
    </Card>
  );
}

export function SettingsPage() {
  const { i18n } = useTranslation();
  const estate = useApp((s) => s.estate)!;
  const setEstate = useApp((s) => s.setEstate);
  const bump = useApp((s) => s.bump);
  const users = useQuery<User>(
    () => select<User>("SELECT id, name, email, role, active FROM users ORDER BY name"),
    [estate.id]
  );
  const [letterhead, setLetterhead] = useState<Letterhead>({
    name: estate.letterhead.name ?? "",
    address: estate.letterhead.address ?? "",
    note: estate.letterhead.note ?? "",
    showBarrelList: estate.letterhead.showBarrelList ?? false,
  });

  const saveLetterhead = async () => {
    await execute("UPDATE estates SET letterhead_json=$1 WHERE id=$2", [
      JSON.stringify(letterhead),
      estate.id,
    ]);
    setEstate({ ...estate, letterhead });
    bump();
    toast.success("Letterhead saved");
  };

  const createBackup = async () => {
    try {
      const path = await save({
        title: "Create backup",
        defaultPath: `estate_backup_${todayISO()}.db`,
        filters: [{ name: "SQLite database", extensions: ["db"] }],
      });
      if (!path) return;
      await execute(`VACUUM INTO '${path.replace(/'/g, "''")}'`);
      toast.success("Backup created");
    } catch (err) {
      console.error(err);
      toast.error(
        "Could not create the backup. If you picked an existing file, choose a new file name instead."
      );
    }
  };

  const exportJson = async () => {
    try {
      const dumps = await dumpAllTables();
      const payload = {
        app: "Estate Ledger",
        version: "0.2.3",
        exportedAt: new Date().toISOString(),
        tables: dumps,
      };
      const path = await save({
        title: "Export JSON backup",
        defaultPath: `estate_backup_${todayISO()}.json`,
        filters: [{ name: "JSON", extensions: ["json"] }],
      });
      if (!path) return;
      await writeFile(path, new TextEncoder().encode(JSON.stringify(payload, null, 2)));
      toast.success("JSON backup exported");
    } catch (err) {
      console.error(err);
      toast.error("Could not export the JSON backup");
    }
  };

  // Restore replaces the whole database, so the file is chosen first and the
  // user confirms it by name before anything is touched.
  const [restorePath, setRestorePath] = useState<string | null>(null);
  const pickRestore = async () => {
    try {
      const path = await open({
        title: "Restore from backup",
        multiple: false,
        filters: [{ name: "SQLite database", extensions: ["db"] }],
      });
      if (!path || Array.isArray(path)) return;
      setRestorePath(path);
    } catch (err) {
      console.error(err);
      toast.error("Could not open the file picker");
    }
  };
  const restore = async () => {
    const path = restorePath;
    setRestorePath(null);
    if (!path) return;
    try {
      await restoreDatabase(path);
      toast.success("Backup restored — close and reopen the app now to load it", {
        duration: 15000,
      });
    } catch (err) {
      console.error(err);
      toast.error(err instanceof Error ? err.message : String(err));
    }
  };

  return (
    <div>
      <PageHeader title="Settings" subtitle="Estate letterhead, backup and app information" />

      <div className="mb-4 grid gap-4 md:grid-cols-2">
        <Card
          title="Estate letterhead"
          right={
            <button className="btn btn-primary" onClick={() => void saveLetterhead()}>
              Save
            </button>
          }
        >
          <div className="space-y-3">
            <Field label="Name">
              <input
                className="input"
                value={letterhead.name ?? ""}
                onChange={(e) => setLetterhead((l) => ({ ...l, name: e.target.value }))}
              />
            </Field>
            <Field label="Address">
              <textarea
                className="input min-h-[72px]"
                value={letterhead.address ?? ""}
                onChange={(e) => setLetterhead((l) => ({ ...l, address: e.target.value }))}
              />
            </Field>
            <Field label="Note">
              <input
                className="input"
                value={letterhead.note ?? ""}
                onChange={(e) => setLetterhead((l) => ({ ...l, note: e.target.value }))}
              />
            </Field>
            <label className="flex items-center gap-2 text-[12.5px] text-ink-light">
              <input
                type="checkbox"
                checked={Boolean(letterhead.showBarrelList)}
                onChange={(e) => setLetterhead((l) => ({ ...l, showBarrelList: e.target.checked }))}
              />
              <span>Show barrel list on printouts</span>
            </label>
          </div>
        </Card>

        <Card title="Language">
          <div className="flex items-center gap-2">
            <Pill active={i18n.language === "en"} onClick={() => void i18n.changeLanguage("en")}>
              English
            </Pill>
            <Pill active={i18n.language === "ml"} onClick={() => void i18n.changeLanguage("ml")}>
              മലയാളം
            </Pill>
          </div>
          <div className="mt-3 text-[11.5px] text-ink-soft">
            The interface language applies immediately across the app.
          </div>
        </Card>
      </div>

      <div className="mb-4 grid gap-4 md:grid-cols-2">
        <Card title="Backup">
          <div className="space-y-3">
            <div className="flex flex-wrap items-center gap-2">
              <button className="btn btn-primary" onClick={() => void createBackup()}>
                <Database size={14} /> Create backup
              </button>
              <button className="btn btn-secondary" onClick={() => void exportJson()}>
                <Download size={14} /> Export JSON backup
              </button>
            </div>
            <div className="text-[11.5px] text-ink-soft">
              "Create backup" writes a compact copy of the live database via SQLite VACUUM. The JSON
              export dumps every table as plain text for inspection or migration.
            </div>
          </div>
        </Card>

        <Card title="Restore">
          <div className="space-y-3">
            <button className="btn btn-accent" onClick={() => void pickRestore()}>
              <RotateCcw size={14} /> Restore from backup
            </button>
            <div className="text-[11.5px] text-ink-soft">
              Pick a previously created .db backup. It replaces the current database — the app must be
              restarted afterwards to load the restored data. The audit trail lives in its own file
              and is kept.
            </div>
          </div>
        </Card>
      </div>

      <div className="mb-4 grid gap-4 md:grid-cols-2">
        <Card title={<span className="flex items-center gap-2"><Users size={14} /> Users</span>} pad={false}>
          <Table headers={["Name", "Email", "Role", "Status"]}>
            {users.rows.map((u) => (
              <tr key={u.id}>
                <td className="whitespace-nowrap">{u.name}</td>
                <td>{u.email}</td>
                <td>
                  <Badge tone={u.role === "Admin" ? "ok" : "neutral"}>{u.role}</Badge>
                </td>
                <td>
                  <Badge tone={u.active ? "ok" : "warn"}>{u.active ? "Active" : "Inactive"}</Badge>
                </td>
              </tr>
            ))}
          </Table>
          <div className="border-t border-paper-line px-4 py-2 text-[11px] text-ink-soft">
            User accounts are managed at install time in this offline build.
          </div>
        </Card>

        <Card title={<span className="flex items-center gap-2"><Info size={14} /> About</span>}>
          <div className="flex items-start gap-3">
            <HardDrive size={20} className="mt-0.5 text-ink-soft" />
            <div>
              <div className="font-display text-[15px] font-semibold text-ink">Estate Ledger</div>
              <div className="mt-0.5 text-[12px] text-ink-soft">Version 0.2.3</div>
              <div className="mt-2 max-w-md text-[11.5px] text-ink-light">
                A fully offline estate management app. All data stays on this computer — no internet
                connection, account, or cloud service is required. Day-to-day sync between the field and
                the office happens through Day Pack Excel files.
              </div>
            </div>
          </div>
        </Card>
      </div>

      <Confirm
        open={restorePath !== null}
        danger
        title="Replace all data with this backup?"
        message={`Everything currently in the app will be replaced by ${restorePath ?? "the backup"}. A copy of the current database is kept next to it as estate.db.pre-restore.bak. Close and reopen the app afterwards.`}
        confirmLabel="Restore"
        onConfirm={restore}
        onCancel={() => setRestorePath(null)}
      />

      <div className="mb-4">
        <AuditTrailCard />
      </div>

      <Card title="Storage" pad={false}>
        <div className="flex flex-wrap items-center gap-2 px-4 py-3 text-[11.5px] text-ink-soft">
          <Upload size={14} />
          <span>
            Local database: estate.db · estates, blocks, tappers, barrels, entry days, invoices,
            cashbook and {MAIN_TABLES.length} tables in total. Audit trail: audit.db (append-only,
            hash-chained, stored alongside estate.db).
          </span>
        </div>
      </Card>
    </div>
  );
}
