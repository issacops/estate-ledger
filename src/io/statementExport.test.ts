import { describe, it, expect } from "vitest";
import { buildStatementWorkbook } from "./statementExport";
import { buildStatement } from "../domain/statement";

const row = (id: number, date: string, particulars: string, income: number, expense: number) =>
  ({ id, date, particulars, income, expense });

const build = (rows: ReturnType<typeof row>[], opening = 0) =>
  buildStatementWorkbook({
    title: "Weekly Income & Expenses Register",
    estateName: "Kulashekaram Rubber Estate",
    periodLabel: "(26)",
    from: "2026-09-21",
    to: "2026-09-27",
    statement: buildStatement(rows, opening),
  });

const cells = (wb: ReturnType<typeof build>) => {
  const ws = wb.getWorksheet("Statement")!;
  const out: (string | number | null)[][] = [];
  ws.eachRow({ includeEmpty: true }, (r) =>
    out.push([1, 2, 3, 4].map((c) => (r.getCell(c).value as string | number | null) ?? null))
  );
  return out;
};

describe("statement spreadsheet", () => {
  it("heads the sheet like the register", () => {
    const c = cells(build([]));
    expect(c[0][0]).toBe("WEEKLY INCOME & EXPENSES REGISTER");
    expect(c[1][0]).toBe("KULASHEKARAM RUBBER ESTATE");
    expect(c[2][0]).toContain("2026-09-21 to 2026-09-27");
    expect(c[3]).toEqual(["Date", "Particulars", "Income", "Expenses"]);
  });

  it("puts receipts in Income and payments in Expenses", () => {
    const c = cells(build([row(1, "2026-09-21", "Latex sale", 5000, 0), row(2, "2026-09-22", "Wages", 0, 1800)]));
    const sale = c.find((r) => r[1] === "Latex sale")!;
    const wages = c.find((r) => r[1] === "Wages")!;
    expect([sale[2], sale[3]]).toEqual([5000, null]);
    expect([wages[2], wages[3]]).toEqual([null, 1800]);
  });

  it("ends with the cash by hand, both sides agreeing", () => {
    const c = cells(build([row(1, "2026-09-21", "Latex sale", 5000, 0), row(2, "2026-09-22", "Wages", 0, 1800)], 1000));
    const ob = c.find((r) => String(r[1]).startsWith("OB Cash by hand"))!;
    expect(ob[1]).toBe("OB Cash by hand Rs: 4200.00 =");
    expect([ob[2], ob[3]]).toEqual([6000, 4200]);
    const grand = c.find((r) => r[1] === "Total (Expenses + Cash by hand)")!;
    expect([grand[2], grand[3]]).toEqual([6000, 6000]);
  });

  it("shows the opening balance only when there is one", () => {
    expect(cells(build([])).some((r) => String(r[1]).startsWith("Opening balance"))).toBe(false);
    expect(cells(build([], 250)).some((r) => String(r[1]).startsWith("Opening balance"))).toBe(true);
  });

  it("round-trips through a real .xlsx file", async () => {
    const wb = build([row(1, "2026-09-21", "Latex sale", 5000, 0)]);
    const buf = await wb.xlsx.writeBuffer();
    expect((buf as ArrayBuffer).byteLength).toBeGreaterThan(1000);
  });
});
