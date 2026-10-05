import { describe, it, expect, beforeEach } from "vitest";
import {
  autoLabel,
  monthPeriods,
  overlaps,
  periodTag,
  quarterPeriods,
  resetPeriodIds,
  samePeriodLastYear,
  seasonMonthPeriods,
  seasonPeriods,
  seasonQuarterPeriods,
  vsBase,
  yearPeriods,
} from "./compare";

beforeEach(() => resetPeriodIds());

describe("period tags", () => {
  it("labels periods A, B, C and keeps going past Z", () => {
    expect([0, 1, 2, 25].map(periodTag)).toEqual(["A", "B", "C", "Z"]);
    expect(periodTag(26)).toBe("AA");
  });
});

describe("months", () => {
  it("covers each calendar month end to end", () => {
    const m = monthPeriods(2026);
    expect(m).toHaveLength(12);
    expect(m[0]).toMatchObject({ from: "2026-01-01", to: "2026-01-31", label: "Jan 26" });
    expect(m[11]).toMatchObject({ from: "2026-12-01", to: "2026-12-31", label: "Dec 26" });
  });

  it("gets February right in a leap year and a normal one", () => {
    expect(monthPeriods(2024)[1].to).toBe("2024-02-29");
    expect(monthPeriods(2026)[1].to).toBe("2026-02-28");
  });

  it("runs a season's months from April to the following March", () => {
    const m = seasonMonthPeriods("2025-2026");
    expect(m).toHaveLength(12);
    expect(m[0]).toMatchObject({ from: "2025-04-01", label: "Apr 25" });
    expect(m[8]).toMatchObject({ from: "2025-12-01", label: "Dec 25" });
    // the year rolls over mid-season
    expect(m[9]).toMatchObject({ from: "2026-01-01", label: "Jan 26" });
    expect(m[11]).toMatchObject({ from: "2026-03-01", to: "2026-03-31", label: "Mar 26" });
  });
});

describe("quarters", () => {
  it("splits a calendar year into four", () => {
    const q = quarterPeriods(2026);
    expect(q.map((x) => [x.from, x.to])).toEqual([
      ["2026-01-01", "2026-03-31"],
      ["2026-04-01", "2026-06-30"],
      ["2026-07-01", "2026-09-30"],
      ["2026-10-01", "2026-12-31"],
    ]);
  });

  it("splits a season into four, carrying over the year", () => {
    const q = seasonQuarterPeriods("2025-2026");
    expect(q.map((x) => [x.from, x.to])).toEqual([
      ["2025-04-01", "2025-06-30"],
      ["2025-07-01", "2025-09-30"],
      ["2025-10-01", "2025-12-31"],
      ["2026-01-01", "2026-03-31"],
    ]);
    expect(q[0].label).toBe("Q1 25-26");
  });
});

describe("seasons and years", () => {
  it("gives the last few seasons, oldest first", () => {
    const s = seasonPeriods(3, "2026-10-05");
    expect(s.map((x) => x.label)).toEqual(["2024-25", "2025-26", "2026-27"]);
    expect(s[2]).toMatchObject({ from: "2026-04-01", to: "2027-03-31" });
  });

  it("knows a date in March belongs to the season that began last April", () => {
    const s = seasonPeriods(1, "2026-03-20");
    expect(s[0]).toMatchObject({ from: "2025-04-01", to: "2026-03-31" });
  });

  it("gives the last few calendar years", () => {
    expect(yearPeriods(2, "2026-10-05").map((x) => x.label)).toEqual(["2025", "2026"]);
  });
});

describe("same period last year", () => {
  it("shifts a range back twelve months", () => {
    const p = monthPeriods(2026)[9]; // Oct 26
    const prev = samePeriodLastYear(p);
    expect(prev).toMatchObject({ from: "2025-10-01", to: "2025-10-31" });
  });

  it("does not fall off the end of a shorter February", () => {
    const leapFeb = monthPeriods(2024)[1]; // ends 29 Feb
    expect(samePeriodLastYear(leapFeb).to).toBe("2023-02-28");
  });
});

describe("labels", () => {
  it("names a whole month, year or season rather than printing dates", () => {
    expect(autoLabel("2026-06-01", "2026-06-30")).toBe("Jun 26");
    expect(autoLabel("2026-01-01", "2026-12-31")).toBe("2026");
    expect(autoLabel("2026-04-01", "2027-03-31")).toBe("2026-27");
  });

  it("falls back to the dates for an odd stretch", () => {
    expect(autoLabel("2026-06-10", "2026-07-04")).toBe("10/06 – 04/07");
  });
});

describe("overlap and change", () => {
  it("spots periods that overlap", () => {
    const [jan, feb] = monthPeriods(2026);
    expect(overlaps(jan, feb)).toBe(false);
    expect(overlaps(jan, { ...feb, from: "2026-01-20" })).toBe(true);
    // touching at a single day still counts
    expect(overlaps(jan, { ...feb, from: "2026-01-31" })).toBe(true);
  });

  it("works out the change against the base period", () => {
    expect(vsBase(120, 100)).toBe(20);
    expect(vsBase(80, 100)).toBe(-20);
    expect(vsBase(100, 100)).toBe(0);
    // nothing to compare against
    expect(vsBase(50, 0)).toBeNull();
  });
});
