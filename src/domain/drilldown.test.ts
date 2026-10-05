import { describe, it, expect } from "vitest";
import {
  NO_FILTER,
  filterEntries,
  monthLabel,
  monthSummary,
  monthsPresent,
  netKg,
  paginate,
  reasonsPresent,
  totalsOf,
  wetSheets,
  type EntryLine,
} from "./drilldown";

const e = (over: Partial<EntryLine>): EntryLine => ({
  date: "2026-09-10", block_id: 1, tapper_id: 1, status: "Completed", reason: "",
  product_mode: "Latex", wet_sheets: 0, tare_kg: 0, bucket_kg: 0, ...over,
});

const SAMPLE: EntryLine[] = [
  e({ date: "2026-10-02", bucket_kg: 62, tare_kg: 2 }),
  e({ date: "2026-10-01", status: "Not Done", reason: "Heavy Rain" }),
  e({ date: "2026-09-30", status: "Not Done", reason: "Not scheduled" }),
  e({ date: "2026-09-12", product_mode: "Sheet", wet_sheets: 40 }),
  e({ date: "2026-08-20", bucket_kg: 50, tare_kg: 1 }),
];

describe("weights", () => {
  it("takes the tare off a latex row", () => {
    expect(netKg(e({ bucket_kg: 62, tare_kg: 2 }))).toBe(60);
  });
  it("never goes below zero", () => {
    expect(netKg(e({ bucket_kg: 1, tare_kg: 5 }))).toBe(0);
  });
  it("counts nothing for a block that was not tapped", () => {
    expect(netKg(e({ status: "Not Done", bucket_kg: 99 }))).toBe(0);
  });
  it("reports wet sheets for a sheet row and latex kg for a latex row, not both", () => {
    const sheet = e({ product_mode: "Sheet", wet_sheets: 40, bucket_kg: 10 });
    expect(wetSheets(sheet)).toBe(40);
    expect(netKg(sheet)).toBe(0);
    expect(wetSheets(e({ wet_sheets: 40 }))).toBe(0);
  });
});

describe("filtering", () => {
  it("returns everything when nothing is set", () => {
    expect(filterEntries(SAMPLE, NO_FILTER)).toHaveLength(5);
  });
  it("narrows to one month", () => {
    expect(filterEntries(SAMPLE, { ...NO_FILTER, month: "2026-09" }).map((r) => r.date)).toEqual([
      "2026-09-30", "2026-09-12",
    ]);
  });
  it("narrows to a date range, inclusive at both ends", () => {
    const r = filterEntries(SAMPLE, { ...NO_FILTER, from: "2026-09-12", to: "2026-10-01" });
    expect(r.map((x) => x.date)).toEqual(["2026-10-01", "2026-09-30", "2026-09-12"]);
  });
  it("tells a real miss from a block that was not due", () => {
    expect(filterEntries(SAMPLE, { ...NO_FILTER, status: "missed" })).toHaveLength(1);
    expect(filterEntries(SAMPLE, { ...NO_FILTER, status: "notScheduled" })).toHaveLength(1);
    expect(filterEntries(SAMPLE, { ...NO_FILTER, status: "completed" })).toHaveLength(3);
  });
  it("narrows to one reason", () => {
    expect(filterEntries(SAMPLE, { ...NO_FILTER, reason: "Heavy Rain" })).toHaveLength(1);
  });
  it("combines filters", () => {
    expect(
      filterEntries(SAMPLE, { ...NO_FILTER, month: "2026-10", status: "missed" })
    ).toHaveLength(1);
    expect(
      filterEntries(SAMPLE, { ...NO_FILTER, month: "2026-08", status: "missed" })
    ).toHaveLength(0);
  });
});

describe("totals", () => {
  it("counts completed, missed and not scheduled separately", () => {
    expect(totalsOf(SAMPLE)).toMatchObject({
      entries: 5, completed: 3, missed: 1, notScheduled: 1, netKg: 109, wetSheets: 40,
    });
  });
  it("copes with nothing", () => {
    expect(totalsOf([])).toMatchObject({ entries: 0, netKg: 0, wetSheets: 0 });
  });
});

describe("month by month", () => {
  const months = monthSummary(SAMPLE);
  it("lists each month present, newest first", () => {
    expect(months.map((m) => m.month)).toEqual(["2026-10", "2026-09", "2026-08"]);
    expect(monthsPresent(SAMPLE)).toEqual(["2026-10", "2026-09", "2026-08"]);
  });
  it("totals each month on its own", () => {
    expect(months[0]).toMatchObject({ entries: 2, completed: 1, missed: 1, netKg: 60 });
    expect(months[1]).toMatchObject({ entries: 2, notScheduled: 1, wetSheets: 40 });
    expect(months[2]).toMatchObject({ entries: 1, netKg: 49 });
  });
  it("counts distinct days tapped, not rows", () => {
    const two = monthSummary([e({ date: "2026-09-01" }), e({ date: "2026-09-01", block_id: 2 })]);
    expect(two[0].daysTapped).toBe(1);
    expect(two[0].entries).toBe(2);
  });
  it("labels a month for reading", () => {
    expect(monthLabel("2026-03")).toBe("March 2026");
  });
});

describe("reasons and pages", () => {
  it("offers only the reasons that occur", () => {
    expect(reasonsPresent(SAMPLE)).toEqual(["Heavy Rain", "Not scheduled"]);
  });
  it("pages a long list and never runs off the end", () => {
    const rows = Array.from({ length: 120 }, (_, i) => i);
    const p1 = paginate(rows, 1, 50);
    expect([p1.from, p1.to, p1.pages]).toEqual([1, 50, 3]);
    const p3 = paginate(rows, 3, 50);
    expect([p3.from, p3.to, p3.slice.length]).toEqual([101, 120, 20]);
    expect(paginate(rows, 99, 50).page).toBe(3);
    expect(paginate(rows, -4, 50).page).toBe(1);
  });
  it("handles an empty list", () => {
    expect(paginate([], 1, 50)).toMatchObject({ from: 0, to: 0, pages: 1 });
  });
});
