import ExcelJS from "exceljs";
import type { Statement } from "../domain/statement";

/**
 * The weekly or monthly income & expenses register as a spreadsheet, laid out
 * the way the paper book is: receipts, then payments, then the cash in hand
 * that makes the two sides agree.
 */
export function buildStatementWorkbook(opts: {
  title: string;
  estateName: string;
  periodLabel: string;
  from: string;
  to: string;
  statement: Statement;
}): ExcelJS.Workbook {
  const s = opts.statement;
  const wb = new ExcelJS.Workbook();
  wb.creator = "Estate Ledger";
  wb.created = new Date();
  const ws = wb.addWorksheet("Statement");
  ws.columns = [{ width: 14 }, { width: 44 }, { width: 16 }, { width: 16 }];

  const NUM = "#,##0.00";
  const centre = (row: ExcelJS.Row) => {
    row.alignment = { horizontal: "center" };
  };

  ws.mergeCells("A1:D1");
  ws.getCell("A1").value = opts.title.toUpperCase();
  ws.getCell("A1").font = { bold: true, size: 14 };
  centre(ws.getRow(1));
  ws.mergeCells("A2:D2");
  ws.getCell("A2").value = opts.estateName.toUpperCase();
  ws.getCell("A2").font = { bold: true, size: 11 };
  centre(ws.getRow(2));
  ws.mergeCells("A3:D3");
  ws.getCell("A3").value = `${opts.periodLabel}   ${opts.from} to ${opts.to}`;
  centre(ws.getRow(3));

  const head = ws.addRow(["Date", "Particulars", "Income", "Expenses"]);
  head.font = { bold: true };
  head.getCell(3).alignment = { horizontal: "right" };
  head.getCell(4).alignment = { horizontal: "right" };

  const money = (row: ExcelJS.Row, col: number, v: number) => {
    row.getCell(col).value = v;
    row.getCell(col).numFmt = NUM;
  };

  if (s.opening !== 0) {
    const r = ws.addRow(["", "Opening balance (cash by hand b/f)"]);
    r.getCell(2).font = { italic: true };
    money(r, 3, s.opening);
  }
  if (s.incomeRows.length === 0) {
    ws.addRow(["", "No income recorded for this period."]).font = { italic: true };
  }
  for (const r of s.incomeRows) {
    const row = ws.addRow([r.date, r.particulars]);
    money(row, 3, r.income);
  }
  const total = ws.addRow(["", "Total"]);
  total.font = { bold: true, italic: true };
  total.getCell(2).alignment = { horizontal: "center" };
  money(total, 3, s.leftTotal);
  for (const c of [1, 2, 3, 4]) {
    total.getCell(c).border = { top: { style: "medium" }, bottom: { style: "medium" } };
  }

  if (s.expenseRows.length === 0) {
    ws.addRow(["", "No expenses recorded for this period."]).font = { italic: true };
  }
  for (const r of s.expenseRows) {
    const row = ws.addRow([r.date, r.particulars]);
    money(row, 4, r.expense);
  }

  ws.addRow([]);
  const ob = ws.addRow(["", `OB Cash by hand Rs: ${s.cashByHand.toFixed(2)} =`]);
  ob.getCell(2).font = { italic: true };
  money(ob, 3, s.leftTotal);
  money(ob, 4, s.cashByHand);
  for (const c of [1, 2, 3, 4]) ob.getCell(c).border = { top: { style: "medium" } };
  ob.getCell(3).font = { bold: true };
  ob.getCell(4).font = { bold: true };

  const grand = ws.addRow(["", "Total (Expenses + Cash by hand)"]);
  grand.getCell(2).font = { italic: true };
  grand.getCell(2).alignment = { horizontal: "center" };
  money(grand, 3, s.leftTotal);
  money(grand, 4, s.rightTotal);
  grand.getCell(3).font = { bold: true };
  grand.getCell(4).font = { bold: true };

  if (s.overspent) {
    ws.addRow([]);
    ws.addRow(["", "More was paid out than was in hand — check for a missing receipt or opening balance."]).font = {
      color: { argb: "FFB00020" },
    };
  }
  return wb;
}
