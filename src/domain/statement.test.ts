import { describe, it, expect } from "vitest";
import { buildStatement, weekOfSeason } from "./statement";

const row = (id: number, date: string, income: number, expense: number) => ({
  id, date, particulars: `row ${id}`, income, expense,
});

describe("weekly statement", () => {
  it("lists receipts and payments separately, in date order", () => {
    const s = buildStatement(
      [row(1, "2026-09-23", 0, 500), row(2, "2026-09-21", 1000, 0), row(3, "2026-09-22", 0, 200)],
      0
    );
    expect(s.incomeRows.map((r) => r.id)).toEqual([2]);
    expect(s.expenseRows.map((r) => r.id)).toEqual([3, 1]);
  });

  it("leaves the cash in hand once the week's payments come out", () => {
    const s = buildStatement([row(1, "2026-09-21", 1000, 0), row(2, "2026-09-22", 0, 400)], 0);
    expect(s.totalIncome).toBe(1000);
    expect(s.totalExpense).toBe(400);
    expect(s.cashByHand).toBe(600);
  });

  it("carries the opening balance into the week", () => {
    const s = buildStatement([row(1, "2026-09-21", 1000, 0), row(2, "2026-09-22", 0, 400)], 250);
    expect(s.cashByHand).toBe(850);
    expect(s.leftTotal).toBe(1250);
    expect(s.rightTotal).toBe(1250);
    expect(s.balanced).toBe(true);
  });

  it("balances to the paisa despite floating point", () => {
    const s = buildStatement([row(1, "2026-09-21", 0.1, 0), row(2, "2026-09-21", 0.2, 0), row(3, "2026-09-22", 0, 0.3)], 0);
    expect(s.cashByHand).toBe(0);
    expect(s.balanced).toBe(true);
  });

  it("flags a week that spends more than it had", () => {
    const s = buildStatement([row(1, "2026-09-21", 100, 0), row(2, "2026-09-22", 0, 400)], 0);
    expect(s.cashByHand).toBe(-300);
    expect(s.overspent).toBe(true);
    expect(s.balanced).toBe(true);
  });

  it("copes with an empty week", () => {
    const s = buildStatement([], 0);
    expect(s).toMatchObject({ totalIncome: 0, totalExpense: 0, cashByHand: 0, balanced: true });
  });

  it("counts weeks from the start of the financial year", () => {
    expect(weekOfSeason("2026-04-01")).toBe(1);
    expect(weekOfSeason("2026-04-06")).toBe(2);
    expect(weekOfSeason("2026-09-21")).toBe(26);
  });
});
