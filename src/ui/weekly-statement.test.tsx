import { describe, it, expect, afterEach } from "vitest";
import { render, cleanup } from "@testing-library/react";
import { WeeklyStatement } from "./WeeklyStatement";
import { buildStatement } from "../domain/statement";

afterEach(cleanup);

const row = (id: number, date: string, particulars: string, income: number, expense: number) => ({
  id, date, particulars, income, expense,
});

const show = (rows: ReturnType<typeof row>[], opening = 0) =>
  render(
    <WeeklyStatement
      title="Weekly Income & Expenses Register"
      estateName="Kulashekaram Rubber Estate"
      weekNo={26}
      from="2026-09-21"
      to="2026-09-27"
      statement={buildStatement(rows, opening)}
    />
  );

describe("weekly income & expenses statement", () => {
  it("carries the register's heading and column order", () => {
    const { container } = show([]);
    const text = container.textContent ?? "";
    expect(text).toContain("Weekly Income & Expenses Register");
    expect(text).toContain("Kulashekaram Rubber Estate");
    expect(text).toContain("(26)");
    expect(text).toContain("2026-09-21 to 2026-09-27");
    const heads = [...container.querySelectorAll("thead th")].map((h) => h.textContent);
    expect(heads).toEqual(["Date", "Particulars", "Income", "Expenses"]);
  });

  it("says so when a side is empty", () => {
    const { container } = show([]);
    expect(container.textContent).toContain("No income recorded for this week yet.");
    expect(container.textContent).toContain("No expenses recorded for this week yet.");
  });

  it("puts receipts under Income and payments under Expenses", () => {
    const { container } = show([
      row(1, "2026-09-21", "Latex sale", 5000, 0),
      row(2, "2026-09-22", "Tapper wages", 0, 1800),
    ]);
    const body = [...container.querySelectorAll("tbody tr")];
    const sale = body.find((r) => r.textContent?.includes("Latex sale"))!;
    const wages = body.find((r) => r.textContent?.includes("Tapper wages"))!;
    expect((sale.children[2] as HTMLElement).textContent).toContain("5,000");
    expect((sale.children[3] as HTMLElement).textContent).toBe("");
    expect((wages.children[2] as HTMLElement).textContent).toBe("");
    expect((wages.children[3] as HTMLElement).textContent).toContain("1,800");
  });

  it("ends with the cash by hand that makes both sides agree", () => {
    const { container } = show(
      [row(1, "2026-09-21", "Latex sale", 5000, 0), row(2, "2026-09-22", "Tapper wages", 0, 1800)],
      1000
    );
    const text = container.textContent ?? "";
    expect(text).toContain("OB Cash by hand Rs: 4,200.00 =");
    expect(text).toContain("Total (Expenses + Cash by hand)");
    const total = [...container.querySelectorAll("tfoot tr")][1];
    expect((total.children[2] as HTMLElement).textContent).toBe("6,000.00");
    expect((total.children[3] as HTMLElement).textContent).toBe("6,000.00");
  });

  it("warns when more was paid out than was in hand", () => {
    const { container } = show([row(1, "2026-09-22", "Wages", 0, 900)]);
    expect(container.textContent).toContain("More was paid out this week");
  });
});
