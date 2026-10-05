import { describe, it, expect } from "vitest";
import {
  byBuyer, byGrade, compactMoney, countable, granularityFor, salesOverTime, summarise, type SaleLine,
} from "./salesAnalysis";

const sale = (over: Partial<SaleLine>): SaleLine => ({
  date: "2026-10-01", buyer_id: 1, buyer_name: "Pala Traders", grade: "Latex",
  qty: 100, rate: 180, value: 18000, status: "Final", ...over,
});

describe("summary", () => {
  it("adds up value and quantity and works out the rate achieved", () => {
    const s = summarise([sale({}), sale({ qty: 50, value: 10000 })]);
    expect(s).toMatchObject({ invoices: 2, value: 28000, qty: 150, avgRate: 186.67 });
  });
  it("leaves cancelled invoices out entirely", () => {
    const s = summarise([sale({}), sale({ status: "Cancelled", value: 99999 })]);
    expect(s).toMatchObject({ invoices: 1, cancelled: 1, value: 18000 });
  });
  it("counts a pending-DRC invoice but not its (missing) value, and keeps it out of the rate", () => {
    const s = summarise([sale({}), sale({ qty: 400, value: null, status: "Pending DRC" })]);
    expect(s).toMatchObject({ invoices: 2, pending: 1, value: 18000, qty: 500, avgRate: 180 });
  });
  it("bills the buyer's weight when one was recorded", () => {
    const s = summarise([sale({ qty: 100, buyer_qty: 96, value: 17280 })]);
    expect(s.qty).toBe(96);
    expect(s.avgRate).toBe(180);
  });
  it("copes with nothing", () => {
    expect(summarise([])).toMatchObject({ invoices: 0, value: 0, avgRate: null });
  });
});

describe("over time", () => {
  it("chooses a granularity that suits the range", () => {
    expect(granularityFor("2026-10-01", "2026-10-31")).toBe("day");
    expect(granularityFor("2026-07-01", "2026-09-30")).toBe("week");
    expect(granularityFor("2026-04-01", "2027-03-31")).toBe("month");
  });
  it("totals each month and keeps them in order", () => {
    const p = salesOverTime(
      [sale({ date: "2026-09-12" }), sale({ date: "2026-08-03" }), sale({ date: "2026-09-30", value: 2000 })],
      "month"
    );
    expect(p.map((x) => x.label)).toEqual(["Aug 26", "Sep 26"]);
    expect(p[1]).toMatchObject({ value: 20000, invoices: 2 });
  });
  it("groups a week under its Monday", () => {
    const p = salesOverTime([sale({ date: "2026-10-07" }), sale({ date: "2026-10-09" })], "week");
    expect(p).toHaveLength(1);
    expect(p[0].key).toBe("2026-10-05");
  });
  it("gives a rate per period, or none when nothing there has a value yet", () => {
    const p = salesOverTime(
      [sale({ date: "2026-08-03" }), sale({ date: "2026-09-03", value: null, status: "Pending DRC" })],
      "month"
    );
    expect(p[0].rate).toBe(180);
    expect(p[1].rate).toBeNull();
  });
});

describe("by grade and buyer", () => {
  it("ranks grades by value, biggest first", () => {
    // Latex 18,000 against RSS4 5,000 + 6,000
    const g = byGrade([sale({ grade: "RSS4", value: 5000 }), sale({}), sale({ grade: "RSS4", value: 6000 })]);
    expect(g.map((x) => x.name)).toEqual(["Latex", "RSS4"]);
    expect(g[1]).toMatchObject({ name: "RSS4", value: 11000, invoices: 2 });
  });
  it("folds the smallest buyers into one bar so nothing disappears", () => {
    const rows = Array.from({ length: 12 }, (_, i) =>
      sale({ buyer_name: `Buyer ${i}`, value: (12 - i) * 1000 })
    );
    const b = byBuyer(rows, 5);
    expect(b).toHaveLength(6);
    expect(b[5].name).toBe("Other (7)");
    expect(b.reduce((s, x) => s + x.value, 0)).toBe(rows.reduce((s, r) => s + (r.value ?? 0), 0));
  });
  it("names a sale with no buyer", () => {
    expect(byBuyer([sale({ buyer_name: null })])[0].name).toBe("(no buyer)");
  });
  it("ignores cancelled invoices", () => {
    expect(countable([sale({}), sale({ status: "Cancelled" })])).toHaveLength(1);
  });
});

describe("axis labels", () => {
  it("shortens money the way it is spoken here", () => {
    expect(compactMoney(950)).toBe("950");
    expect(compactMoney(12500)).toBe("12.5k");
    expect(compactMoney(125000)).toBe("1.25L");
    expect(compactMoney(25000000)).toBe("2.5Cr");
  });
});
