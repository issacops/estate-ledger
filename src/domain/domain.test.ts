import { describe, it, expect } from "vitest";
import { evalMath } from "./expr";
import { weekKey, seasonKey, seasonRange, monthKey, addDaysISO } from "./dates";
import { tappingDayIndexFor, dueBlockIds } from "./rotation";
import { netLatex, checkAllocation, autoAllocate, grossLatex } from "./latex";
import {
  latexValue,
  simpleValue,
  shareByCount,
  rainCoverMatches,
  paperRateGap,
  isPaperRateGapWorseThanUsual,
} from "./valuation";

describe("evalMath", () => {
  it("passes plain numbers", () => {
    expect(evalMath("750")).toBe(750);
    expect(evalMath(12.5)).toBe(12.5);
  });
  it("evaluates arithmetic strings", () => {
    expect(evalMath("750*3+175+150")).toBe(2575);
    expect(evalMath("100/4")).toBe(25);
    expect(evalMath("(10+5)*2")).toBe(30);
    expect(evalMath("10 - 4 - 3")).toBe(3);
  });
  it("rejects unsafe or invalid input", () => {
    expect(evalMath("alert(1)")).toBeNull();
    expect(evalMath("10; DROP TABLE")).toBeNull();
    expect(evalMath("")).toBeNull();
    expect(evalMath(null)).toBeNull();
    expect(evalMath("5/0")).toBeNull();
  });
});

describe("dates", () => {
  it("weeks start on Monday", () => {
    expect(weekKey("2026-09-27")).toBe("2026-09-21");
    expect(weekKey("2026-09-21")).toBe("2026-09-21");
    expect(weekKey("2026-09-22")).toBe("2026-09-21");
  });
  it("seasons run Apr 1 to Mar 31", () => {
    expect(seasonKey("2026-09-27")).toBe("2026-2027");
    expect(seasonKey("2026-04-01")).toBe("2026-2027");
    expect(seasonKey("2026-03-31")).toBe("2025-2026");
    expect(seasonRange("2025-2026")).toEqual({
      from: "2025-04-01",
      to: "2026-03-31",
    });
  });
  it("month keys and addDays", () => {
    expect(monthKey("2026-09-27")).toBe("2026-09");
    expect(addDaysISO("2026-09-30", 1)).toBe("2026-10-01");
  });
});

describe("rotation", () => {
  it("is deterministic and wraps within the cycle", () => {
    const a = tappingDayIndexFor("2026-09-27", 2);
    expect(a).toBe(tappingDayIndexFor("2026-09-27", 2));
    expect(a).toBeLessThan(2);
    expect(tappingDayIndexFor("2026-09-27", 4)).toBeLessThan(4);
  });
  it("picks one due block per tapper and skips flat-rate", () => {
    const blocks = [
      { id: 1, tapper_id: 10, arrangement: "Direct" },
      { id: 2, tapper_id: 10, arrangement: "Direct" },
      { id: 3, tapper_id: 11, arrangement: "Flat-rate" },
      { id: 4, tapper_id: 11, arrangement: "Direct" },
    ];
    const tappers = [
      { id: 10, tap_days: 2 },
      { id: 11, tap_days: 1 },
    ];
    const due = dueBlockIds("2026-09-27", blocks, tappers);
    expect(due).toContain(4);
    expect(due).not.toContain(3);
    expect(due.filter((d) => d <= 2).length).toBe(1);
    const all = dueBlockIds("2026-09-27", blocks, tappers, { showAll: true });
    expect(all).toContain(1);
    expect(all).toContain(2);
    expect(all).toContain(4);
  });
});

describe("latex", () => {
  it("computes gross and net with tare", () => {
    expect(grossLatex([{ label: "b1", kg: 12 }, { label: "b2", kg: 8 }])).toBe(20);
    expect(netLatex([{ label: "b1", kg: 12 }, { label: "b2", kg: 8 }], 6)).toBe(14);
    expect(netLatex([{ label: "b1", kg: 2 }], 6)).toBe(0);
    expect(netLatex([{ label: "b1", kg: 12 }], 0, false)).toBe(0);
  });
  it("validates allocation vs net and overfill", () => {
    const totals = new Map([
      ["BR-1", { filled: 195, capacity: 200 }],
      ["BR-2", { filled: 10, capacity: 200 }],
    ]);
    const bad = checkAllocation(14, [{ barrelCode: "BR-1", kg: 10 }], totals);
    expect(bad.mismatch).toBe(true);
    const over = checkAllocation(10, [{ barrelCode: "BR-1", kg: 10 }], totals);
    expect(over.overfill).toBe(true);
    const ok = checkAllocation(10, [{ barrelCode: "BR-2", kg: 10 }], totals);
    expect(ok.ok).toBe(true);
  });
  it("auto-allocates to capacity and reports new barrels", () => {
    const { alloc, needsNew } = autoAllocate(250, [
      { barrelCode: "BR-1", capacity: 200, current: 180 },
      { barrelCode: "BR-2", capacity: 200, current: 0 },
    ]);
    expect(alloc[0]).toEqual({ barrelCode: "BR-1", kg: 20 });
    expect(alloc[1].kg).toBe(200);
    expect(needsNew).toBe(1);
  });
});

describe("valuation", () => {
  it("values latex by DRC and others simply", () => {
    expect(latexValue(100, 150, 40)).toBe(6000);
    expect(latexValue(100, 150, null)).toBeNull();
    expect(simpleValue(12.5, 160)).toBe(2000);
  });
  it("splits shares by pour count", () => {
    expect(shareByCount(100, { A: 1, B: 3 })).toEqual({ A: 25, B: 75 });
  });
  it("flags paper-rate gaps and rain-cover expenses", () => {
    expect(isPaperRateGapWorseThanUsual(paperRateGap(170, 150))).toBe(true);
    expect(isPaperRateGapWorseThanUsual(paperRateGap(155, 150))).toBe(false);
    expect(rainCoverMatches("Bought rain cover sheets")).toBe(true);
    expect(rainCoverMatches("Wages")).toBe(false);
  });
});
