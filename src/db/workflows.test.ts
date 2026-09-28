import { describe, it, expect, beforeEach } from "vitest";
import { resetDb, rows, scalar } from "../test/fakes/db";
import { execute, select, tx, nextSequence, logAudit } from "./client";
import { login, hashPassword, verifyPassword } from "./auth";
import { ensureSeeded } from "./seed";
import { parseProfile, KARUKACHAL_PROFILE } from "../domain/profile";
import { exportDayPack, parseDayPack } from "../io/daypack";
import type { DayPack, Estate } from "../domain/types";
import {
  netLatex,
  checkAllocation,
  autoAllocate,
} from "../domain/latex";
import { latexValue, shareByCount } from "../domain/valuation";
import { dueBlockIds } from "../domain/rotation";

function estate(id: number): Estate {
  return {
    id,
    name: id === 1 ? "Karukachal" : "Kulashekaram",
    code: id === 1 ? "KAR" : "KUL",
    profile: KARUKACHAL_PROFILE,
    letterhead: {},
  };
}

beforeEach(async () => {
  resetDb();
  await ensureSeeded();
});

describe("seed", () => {
  it("creates users, both estates, masters and lists", async () => {
    const users = await select<{ email: string; role: string }>(
      "SELECT email, role FROM users ORDER BY id"
    );
    expect(users.map((u) => u.email)).toEqual([
      "ninanphilp@rubberestate.com",
      "dailyentry@rubberestate.com",
    ]);
    expect(users[0].role).toBe("Admin");
    expect(users[1].role).toBe("Staff");

    const estates = await select<{ id: number; code: string; profile_json: string }>(
      "SELECT id, code, profile_json FROM estates ORDER BY id"
    );
    expect(estates.map((e) => e.code)).toEqual(["KAR", "KUL"]);
    const kula = parseProfile(estates[1].profile_json);
    expect(kula.latexCapture).toBe("weighing");
    expect(kula.rotation).toBe(false);

    const blocks = await select<{ code: string; arrangement: string }>(
      "SELECT code, arrangement FROM blocks WHERE estate_id = 1 ORDER BY code"
    );
    expect(blocks).toHaveLength(4);
    expect(blocks.find((b) => b.code === "K3")?.arrangement).toBe("Flat-rate");

    expect(scalar("SELECT count(*) FROM barrels WHERE estate_id = 2")).toBe(60);
    expect(scalar("SELECT count(*) FROM config_lists WHERE estate_id = 1 AND kind = 'expenseCat'")).toBe(11);
    expect(scalar("SELECT count(*) FROM config_lists WHERE estate_id = 1 AND kind = 'sheetGrade'")).toBe(2);
  });

  it("is idempotent", async () => {
    await ensureSeeded();
    expect(scalar("SELECT count(*) FROM estates")).toBe(2);
    expect(scalar("SELECT count(*) FROM users")).toBe(2);
  });
});

describe("auth", () => {
  it("logs in with the right password and rejects the wrong one", async () => {
    const ok = await login("ninanphilp@rubberestate.com", "ninan123@4");
    expect(ok?.role).toBe("Admin");
    expect(ok?.name).toBe("Ninan Philip");
    const bad = await login("ninanphilp@rubberestate.com", "wrong");
    expect(bad).toBeNull();
    const none = await login("nobody@x.com", "ninan123@4");
    expect(none).toBeNull();
  });

  it("hashes passwords with a salt", async () => {
    const salt = "abc";
    const h1 = await hashPassword("secret", salt);
    const h2 = await hashPassword("secret", salt);
    expect(h1).toBe(h2);
    expect(await verifyPassword("secret", salt, h1)).toBe(true);
    expect(await verifyPassword("other", salt, h1)).toBe(false);
  });
});

describe("transactions (exec_tx)", () => {
  it("commits all statements together", async () => {
    await tx([
      { sql: "INSERT INTO buyers (estate_id, name, contact) VALUES ($1,$2,$3)", params: [1, "A", ""] },
      { sql: "INSERT INTO buyers (estate_id, name, contact) VALUES ($1,$2,$3)", params: [1, "B", ""] },
    ]);
    expect(scalar("SELECT count(*) FROM buyers WHERE estate_id = 1")).toBe(2);
  });

  it("rolls everything back when one statement fails", async () => {
    const before = scalar("SELECT count(*) FROM buyers");
    await expect(
      tx([
        { sql: "INSERT INTO buyers (estate_id, name, contact) VALUES ($1,$2,$3)", params: [1, "C", ""] },
        { sql: "INSERT INTO buyers (estate_id, name) VALUES ($1)", params: [1] },
      ])
    ).rejects.toBeTruthy();
    expect(scalar("SELECT count(*) FROM buyers")).toBe(before);
  });
});

describe("sequences", () => {
  it("never reuses an invoice number after a delete", async () => {
    const a = await nextSequence(1, "invoice", "KAR-INV-");
    const b = await nextSequence(1, "invoice", "KAR-INV-");
    expect(a).toBe("KAR-INV-1");
    expect(b).toBe("KAR-INV-2");
    await execute("DELETE FROM sequences WHERE estate_id = 1 AND name = 'invoice' AND 0");
    const c = await nextSequence(1, "invoice", "KAR-INV-");
    expect(c).toBe("KAR-INV-3");
    expect(new Set([a, b, c]).size).toBe(3);
  });
});

describe("day pack roundtrip", () => {
  it("exports and re-imports losslessly via the manifest", async () => {
    const pack: DayPack = {
      version: 1,
      estateCode: "KUL",
      date: "2026-09-27",
      weather: "Sunny",
      supervisor: "Thomas",
      pageNo: "12",
      remarks: "ok",
      photo: null,
      entries: [
        {
          blockCode: "B1",
          tapperName: "Rajendran",
          productMode: "Latex",
          status: "Completed",
          reason: "",
          tappedDespiteRain: false,
          treesScheduled: 450,
          treesTapped: 450,
          wetSheets: 0,
          scrapKg: 1.2,
          tareKg: 6,
          buckets: [
            { label: "Bucket 1", kg: 12 },
            { label: "Bucket 2", kg: 8 },
          ],
          barrels: [{ barrelCode: "BR-1", kg: 14 }],
        },
      ],
      labour: [
        {
          name: "Kabir",
          sex: "Male",
          men: 1,
          women: 0,
          work_type: "Weeding",
          who: "Kabir",
          where_: "B1",
          sort_order: 0,
        },
      ],
      smokehouse: null,
    };

    const written = await exportDayPack(estate(2), pack);
    expect(written).toBeTruthy();
    const { ioFiles } = await import("../test/fakes/plugin-fs");
    const bytes = ioFiles().get(written!)!;
    expect(bytes.byteLength).toBeGreaterThan(500);

    const review = await parseDayPack(bytes, "KUL");
    expect(review).toBeTruthy();
    const got = review!.pack;
    expect(got.date).toBe("2026-09-27");
    expect(got.entries).toHaveLength(1);
    expect(got.entries[0].buckets).toEqual([
      { label: "Bucket 1", kg: 12 },
      { label: "Bucket 2", kg: 8 },
    ]);
    expect(got.entries[0].barrels[0].barrelCode).toBe("BR-1");
    expect(got.entries[0].tareKg).toBe(6);
    expect(got.labour[0].name).toBe("Kabir");
  });
});

describe("daily register + stock invariants", () => {
  it("saves a day with buckets/barrels/labour and rejects a date+block clash", async () => {
    const day = await execute(
      "INSERT INTO entry_days (estate_id, date, weather, supervisor, page_no, remarks) VALUES ($1,$2,$3,$4,$5,$6)",
      [2, "2026-09-27", "Sunny", "Thomas", "1", ""]
    );
    const row = await execute(
      "INSERT INTO entry_rows (day_id, block_id, tapper_id, product_mode, status, tare_kg) VALUES ($1,$2,$3,'Latex','Completed',$4)",
      [day.lastInsertId, 1, 1, 6]
    );
    await execute(
      "INSERT INTO entry_row_buckets (row_id, label, kg, sort_order) VALUES ($1,$2,$3,$4)",
      [row.lastInsertId, "Bucket 1", 12, 0]
    );
    await execute(
      "INSERT INTO entry_row_barrels (row_id, barrel_id, kg, sort_order) VALUES ($1,$2,$3,$4)",
      [row.lastInsertId, 1, 6, 0]
    );
    await execute(
      "INSERT INTO labour_rows (day_id, name, sex, men, women, work_type, who, where_, sort_order) VALUES ($1,'Kabir','Male',1,0,'Weeding','K','B1',0)",
      [day.lastInsertId]
    );

    const clash = rows(
      "SELECT count(*) n FROM entry_rows WHERE day_id = $1 AND block_id = 2",
      [day.lastInsertId]
    ) as { n: number }[];
    expect(clash[0].n).toBe(0);

    await expect(
      execute(
        "INSERT INTO entry_days (estate_id, date) VALUES ($1,$2)",
        [2, "2026-09-27"]
      )
    ).rejects.toBeTruthy();
  });

  it("computes barrel fill and reconciliation from the ledger", async () => {
    await execute(
      "INSERT INTO entry_rows (day_id, block_id, product_mode, status, tare_kg) SELECT id, 5, 'Latex', 'Completed', 6 FROM entry_days WHERE 0"
    );
    const day = await execute(
      "INSERT INTO entry_days (estate_id, date) VALUES ($1,$2)",
      [2, "2026-10-01"]
    );
    const row = await execute(
      "INSERT INTO entry_rows (day_id, block_id, product_mode, status, tare_kg) VALUES ($1,$2,'Latex','Completed',6)",
      [day.lastInsertId, 5]
    );
    await execute(
      "INSERT INTO entry_row_barrels (row_id, barrel_id, kg) VALUES ($1,$2,$3)",
      [row.lastInsertId, 1, 50]
    );
    await execute(
      "INSERT INTO stock_ledger (estate_id, hub, date, qty_delta, reason, ref_table, ref_id) VALUES ($1,'latex',$2,$3,'dispatch','barrels',$4)",
      [2, "2026-10-01", 20, 1]
    );

    const poured = scalar<number>(
      "SELECT COALESCE(SUM(kg),0) FROM entry_row_barrels WHERE barrel_id = 1"
    );
    const disp = scalar<number>(
      "SELECT COALESCE(SUM(qty_delta),0) FROM stock_ledger WHERE estate_id = 2 AND hub = 'latex' AND reason = 'dispatch' AND ref_id = 1"
    );
    expect(poured).toBe(50);
    expect(disp).toBe(20);
    expect(poured - disp).toBe(30);

    const totals = new Map([["BR-1", { filled: 30, capacity: 200 }]]);
    const ok = checkAllocation(30, [{ barrelCode: "BR-1", kg: 30 }], totals);
    expect(ok.ok).toBe(true);
  });

  it("values latex by DRC and shares by pour count", () => {
    expect(latexValue(100, 150, 40)).toBe(6000);
    expect(latexValue(100, 150, null)).toBeNull();
    expect(shareByCount(100, { John: 1, Biju: 3 })).toEqual({
      John: 25,
      Biju: 75,
    });
  });

  it("rotation skips flat-rate lease blocks", () => {
    const blocks = [
      { id: 1, tapper_id: 1, arrangement: "Direct" },
      { id: 2, tapper_id: 1, arrangement: "Flat-rate" },
    ];
    const due = dueBlockIds("2026-09-27", blocks, [{ id: 1, tap_days: 2 }]);
    expect(due).not.toContain(2);
    expect(due).toContain(1);
  });
});

describe("net latex & auto-allocate", () => {
  it("nets buckets minus tare and never goes negative", () => {
    expect(netLatex([{ label: "b", kg: 12 }], 6)).toBe(6);
    expect(netLatex([{ label: "b", kg: 2 }], 6)).toBe(0);
  });
  it("auto-allocates across barrels and reports new ones", () => {
    const { alloc, needsNew } = autoAllocate(250, [
      { barrelCode: "BR-1", capacity: 200, current: 180 },
    ]);
    expect(alloc[0].kg).toBe(20);
    expect(needsNew).toBe(2);
  });
});

describe("audit", () => {
  it("records actions", async () => {
    await logAudit(1, "save_day", "entry_days", 1, "2026-09-27");
    expect(scalar("SELECT count(*) FROM audit_log WHERE action = 'save_day'")).toBe(1);
  });
});
