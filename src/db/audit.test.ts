import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { resetDb, rows } from "../test/fakes/db";
import {
  audit,
  auditSql,
  record,
  flushAudit,
  verifyChain,
  resetAuditForTests,
  countAuditEvents,
  type AuditRow,
} from "../audit";
import { installAuditCapture } from "../audit/capture";
import { execute, select, logAudit } from "./client";
import { useApp } from "../app/store";

function allEvents(): AuditRow[] {
  return rows<AuditRow>("SELECT * FROM audit_events ORDER BY id");
}

function last<T>(a: T[]): T {
  if (!a.length) throw new Error("empty list");
  return a[a.length - 1];
}

beforeEach(() => {
  resetDb();
  resetAuditForTests();
  useApp.setState({
    user: null,
    estate: null,
    estates: [],
    route: "dashboard",
    dataVersion: 0,
  });
  window.location.hash = "#/dashboard";
});

afterAll(async () => {
  await flushAudit();
});

describe("audit trail storage", () => {
  it("captures every data touch from execute() with entity and params", async () => {
    await execute("INSERT INTO settings (key, value) VALUES ($1,$2)", [
      "audit_probe",
      "on",
    ]);
    await execute("UPDATE settings SET value = $1 WHERE key = $2", [
      "off",
      "audit_probe",
    ]);
    await execute("DELETE FROM settings WHERE key = $1", ["audit_probe"]);
    await flushAudit();

    const events = allEvents();
    const inserts = events.filter((e) => e.action === "sql_insert");
    const updates = events.filter((e) => e.action === "sql_update");
    const deletes = events.filter((e) => e.action === "sql_delete");
    expect(last(inserts).entity).toBe("settings");
    expect(last(inserts).detail).toContain("audit_probe");
    expect(last(updates).entity).toBe("settings");
    expect(last(deletes).entity).toBe("settings");
    expect(events.every((e) => e.source === "sql")).toBe(true);
  });

  it("does not audit plain SELECTs", async () => {
    await countAuditEvents(); // materialises the trail table without events
    await select("SELECT key FROM settings");
    expect(allEvents()).toHaveLength(0);
  });

  it("is append-only: UPDATE and DELETE on the trail are rejected", async () => {
    await audit("probe", "x");
    await flushAudit();
    const before = allEvents().length;
    expect(before).toBeGreaterThan(0);

    await expect(
      execute("UPDATE audit_events SET detail = 'tampered'", [])
    ).rejects.toThrow(/append-only/);
    await expect(
      execute("DELETE FROM audit_events", [])
    ).rejects.toThrow(/append-only/);
    expect(allEvents()).toHaveLength(before);
    expect(allEvents()[0].detail).toBe("x");
  });

  it("stores events in its own table, separate from estate.db audit_log", async () => {
    await logAudit(1, "save_day", "entry_days", 7, "2026-10-01");
    await flushAudit();
    const mainLedger = rows("SELECT * FROM audit_log WHERE action = 'save_day'");
    const trail = allEvents().filter((e) => e.action === "save_day");
    expect(mainLedger).toHaveLength(1);
    expect(trail).toHaveLength(1);
    expect(trail[0].source).toBe("app");
    expect(trail[0].entity).toBe("entry_days");
    expect(trail[0].entity_id).toBe(7);
  });
});

describe("hash chain", () => {
  it("chains every event and verifies end-to-end", async () => {
    await audit("login", "admin@estate.com", "users", 1);
    await execute("INSERT INTO settings (key, value) VALUES ($1,$2)", [
      "chain_probe",
      "1",
    ]);
    await audit("logout", "Admin");
    await flushAudit();

    const list = allEvents();
    expect(list.length).toBeGreaterThanOrEqual(3);
    expect(list[0].prev_hash).toBe("0".repeat(64));
    expect(await verifyChain(list)).toBe(true);
  });

  it("detects history rewritten behind the triggers", async () => {
    await audit("one");
    await audit("two");
    await flushAudit();
    const list = allEvents();
    expect(await verifyChain(list)).toBe(true);

    const forged = [
      { ...list[0], detail: "rewritten" },
      ...list.slice(1),
    ];
    expect(await verifyChain(forged)).toBe(false);
  });

  it("captures user and route at call time, not write time", async () => {
    useApp.setState({ user: { id: 4, name: "Ninan", role: "Admin" } as never });
    const pending = record({ action: "mid_flight" });
    useApp.setState({ user: null });
    window.location.hash = "#/settings";
    await pending;

    const row = last(allEvents());
    expect(row.user_id).toBe(4);
    expect(row.user_name).toBe("Ninan");
    expect(row.route).toBe("dashboard");
  });
});

describe("redaction", () => {
  it("never writes password material from SQL params", async () => {
    await execute(
      "INSERT INTO users (name, email, password_hash, password_salt, role) VALUES ($1,$2,$3,$4,$5)",
      ["X", "x@y.z", "SUPERSECRETHASH", "salt123", "Staff"]
    ).catch(() => undefined);
    await flushAudit();
    const detail = allEvents()
      .map((e) => e.detail)
      .join(" ");
    expect(detail).not.toContain("SUPERSECRETHASH");
    expect(detail).not.toContain("salt123");
    const lastRow = last(allEvents());
    if (lastRow.action === "sql_insert") {
      expect(lastRow.detail).toContain("[redacted");
    }
  });
});

describe("touch capture", () => {
  it("records clicks with the control's accessible label", async () => {
    installAuditCapture();
    const btn = document.createElement("button");
    btn.textContent = "Create backup";
    document.body.appendChild(btn);
    btn.click();
    await flushAudit();

    const clicks = rows<AuditRow>(
      "SELECT * FROM audit_events WHERE action = 'ui_click'"
    );
    expect(clicks.some((c) => c.detail.includes("Create backup"))).toBe(true);
    expect(clicks.every((c) => c.source === "ui")).toBe(true);
    document.body.removeChild(btn);
  });

  it("masks password field values on change", async () => {
    installAuditCapture();
    const input = document.createElement("input");
    input.type = "password";
    input.value = "ninan123@4";
    document.body.appendChild(input);
    input.dispatchEvent(new Event("change", { bubbles: true }));
    await flushAudit();

    const changes = rows<AuditRow>(
      "SELECT * FROM audit_events WHERE action = 'ui_change'"
    );
    expect(changes.length).toBeGreaterThan(0);
    const joined = changes.map((c) => c.detail).join(" | ");
    expect(joined).toContain("[hidden]");
    expect(joined).not.toContain("ninan123@4");
    document.body.removeChild(input);
  });

  it("records route changes on hash navigation", async () => {
    installAuditCapture();
    window.location.hash = "#/latex";
    window.dispatchEvent(new Event("hashchange"));
    window.location.hash = "#/dashboard";
    window.dispatchEvent(new Event("hashchange"));
    await new Promise((r) => setTimeout(r, 0)); // drain jsdom's queued events
    await flushAudit();

    const nav = rows<AuditRow>(
      "SELECT * FROM audit_events WHERE action = 'ui_navigate'"
    );
    expect(nav.some((n) => n.detail.includes("latex"))).toBe(true);
  });

  it("records console.error output as an audit event", async () => {
    console.error("audit-console-probe", { code: 42 });
    await flushAudit();

    const errs = rows<AuditRow>(
      "SELECT * FROM audit_events WHERE action = 'console_error'"
    );
    expect(last(errs).detail).toContain("audit-console-probe");
    expect(last(errs).source).toBe("console");
  });
});

describe("resilience", () => {
  it("self-heals when the audit table disappears", async () => {
    await audit("before_reset");
    await flushAudit();
    expect(
      allEvents().filter((e) => e.action === "before_reset")
    ).toHaveLength(1);

    resetDb(); // table gone, module still believes it is initialised
    await audit("after_reset");
    await flushAudit();
    expect(allEvents().length).toBe(1);
    expect(allEvents()[0].action).toBe("after_reset");
    expect(await verifyChain(allEvents())).toBe(true);
  });

  it("never lets an audit failure reject the caller", async () => {
    await expect(
      Promise.all([
        auditSql("INSERT INTO settings (key, value) VALUES ($1,$2)", ["a", "b"]),
        record({ action: "x" }),
      ])
    ).resolves.toBeDefined();
  });
});
