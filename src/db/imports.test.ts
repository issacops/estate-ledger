import { describe, it, expect } from "vitest";
import {
  DELETE_ORDER,
  countRows,
  makeUndoPlan,
  parseUndoPlan,
  undoStatements,
  type UndoPlan,
} from "./imports";

describe("undo plan — recording what an import wrote", () => {
  it("turns first id and count into an inclusive range", () => {
    expect(makeUndoPlan({ entry_rows: { first: 101, count: 3 } })).toEqual({
      entry_rows: [101, 103],
    });
  });

  it("leaves out tables nothing was written to", () => {
    const plan = makeUndoPlan({
      entry_days: { first: 5, count: 2 },
      entry_rows: { first: 0, count: 0 },
      cashbook: { first: 9, count: 0 },
    });
    expect(plan).toEqual({ entry_days: [5, 6] });
    expect("entry_rows" in plan).toBe(false);
  });

  it("counts a single row correctly", () => {
    const plan = makeUndoPlan({ entry_days: { first: 42, count: 1 } });
    expect(plan).toEqual({ entry_days: [42, 42] });
    expect(countRows(plan)).toBe(1);
  });
});

describe("undo plan — reading it back", () => {
  it("round-trips through JSON", () => {
    const plan = makeUndoPlan({
      entry_days: { first: 1, count: 10 },
      entry_rows: { first: 1, count: 90 },
    });
    expect(parseUndoPlan(JSON.stringify(plan))).toEqual(plan);
  });

  it("returns null for a batch that recorded nothing", () => {
    expect(parseUndoPlan(null)).toBeNull();
    expect(parseUndoPlan("")).toBeNull();
    expect(parseUndoPlan("not json")).toBeNull();
    expect(parseUndoPlan("{}")).toBeNull();
  });

  it("ignores table names it does not know, so a crafted file cannot delete elsewhere", () => {
    const parsed = parseUndoPlan(
      JSON.stringify({ users: [1, 99], estates: [1, 2], entry_rows: [5, 9] })
    );
    expect(parsed).toEqual({ entry_rows: [5, 9] });
  });

  it("drops malformed ranges", () => {
    const parsed = parseUndoPlan(
      JSON.stringify({
        entry_rows: [9, 5],        // backwards
        cashbook: [1],             // too short
        invoices: ["a", "b"],      // not numbers
        purchases: [3, 4],         // fine
      })
    );
    expect(parsed).toEqual({ purchases: [3, 4] });
  });
});

describe("undo statements", () => {
  const plan: UndoPlan = {
    entry_days: [10, 12],
    entry_rows: [100, 180],
    entry_row_buckets: [200, 260],
    invoices: [7, 9],
    invoice_barrels: [4, 11],
  };

  it("deletes children before their parents", () => {
    const sql = undoStatements(plan).map((s) => s.sql);
    const at = (t: string) => sql.findIndex((q) => q.includes(`FROM ${t} `));
    expect(at("entry_row_buckets")).toBeLessThan(at("entry_rows"));
    expect(at("entry_rows")).toBeLessThan(at("entry_days"));
    expect(at("invoice_barrels")).toBeLessThan(at("invoices"));
  });

  it("bounds every delete to the recorded range", () => {
    for (const s of undoStatements(plan)) {
      expect(s.sql).toMatch(/WHERE id >= \$1 AND id <= \$2$/);
      expect(s.params).toHaveLength(2);
      expect(Number(s.params[0])).toBeLessThanOrEqual(Number(s.params[1]));
    }
  });

  it("never writes an unbounded delete", () => {
    for (const s of undoStatements(plan)) {
      expect(s.sql).toContain("WHERE");
      expect(s.sql).not.toMatch(/DELETE FROM \w+\s*$/);
    }
  });

  it("only touches tables in the known delete order", () => {
    for (const s of undoStatements(plan)) {
      const table = /DELETE FROM (\w+) /.exec(s.sql)?.[1] ?? "";
      expect(DELETE_ORDER).toContain(table);
    }
  });

  it("counts the rows it will remove", () => {
    expect(countRows(plan)).toBe(3 + 81 + 61 + 3 + 8);
  });

  it("produces nothing for an empty plan", () => {
    expect(undoStatements({})).toEqual([]);
    expect(countRows({})).toBe(0);
  });
});
