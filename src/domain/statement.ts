import { seasonKey, seasonRange, weekKey } from "./dates";

/**
 * The weekly income & expenses register, as the paper book lays it out:
 * every receipt, then every payment, then the cash left in hand — so the
 * income side and the expenses-plus-cash side come to the same figure.
 */

export interface StatementRow {
  id: number;
  date: string;
  particulars: string;
  income: number;
  expense: number;
}

export interface Statement {
  incomeRows: StatementRow[];
  expenseRows: StatementRow[];
  opening: number;
  totalIncome: number;
  totalExpense: number;
  /** Cash in hand at the end of the week. */
  cashByHand: number;
  /** Opening balance plus the week's income. */
  leftTotal: number;
  /** The week's expenses plus the cash left in hand. */
  rightTotal: number;
  balanced: boolean;
  overspent: boolean;
}

const r2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

export function buildStatement(rows: StatementRow[], opening: number): Statement {
  const byDate = (a: StatementRow, b: StatementRow) =>
    a.date < b.date ? -1 : a.date > b.date ? 1 : a.id - b.id;
  const incomeRows = rows.filter((r) => r.income > 0).sort(byDate);
  const expenseRows = rows.filter((r) => r.expense > 0).sort(byDate);
  const totalIncome = r2(incomeRows.reduce((s, r) => s + r.income, 0));
  const totalExpense = r2(expenseRows.reduce((s, r) => s + r.expense, 0));
  const open = r2(opening);
  const cashByHand = r2(open + totalIncome - totalExpense);
  const leftTotal = r2(open + totalIncome);
  const rightTotal = r2(totalExpense + cashByHand);
  return {
    incomeRows,
    expenseRows,
    opening: open,
    totalIncome,
    totalExpense,
    cashByHand,
    leftTotal,
    rightTotal,
    balanced: Math.abs(leftTotal - rightTotal) < 0.005,
    overspent: cashByHand < 0,
  };
}

/** Week of the financial year (1 April start), counting Monday-to-Sunday weeks. */
export function weekOfSeason(date: string): number {
  const start = seasonRange(seasonKey(date)).from;
  const first = new Date(weekKey(start)).getTime();
  const cur = new Date(weekKey(date)).getTime();
  return Math.round((cur - first) / (7 * 86400000)) + 1;
}
