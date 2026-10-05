import type { Statement } from "../domain/statement";
import { fmtDate, fmtNum } from "../domain/dates";
import { cn } from "./components";

/**
 * The weekly income & expenses register in the paper book's layout. One
 * header, receipts down the Income column, payments down the Expenses
 * column, then the cash in hand that makes the two sides agree.
 */
export function WeeklyStatement(props: {
  title: string;
  estateName: string;
  weekNo: number;
  /** Replaces "(week no)" under the title, e.g. "October 2026" for a month. */
  periodLabel?: string;
  from: string;
  to: string;
  statement: Statement;
  className?: string;
}) {
  const { statement: s } = props;
  const money = (n: number) => fmtNum(n);

  return (
    <div className={cn("weekly-statement", props.className)}>
      <div className="mb-4 text-center">
        <div className="font-display text-[20px] font-bold uppercase tracking-wide">
          {props.title}
        </div>
        <div className="text-[13px] font-semibold uppercase tracking-wide text-ink-soft">
          {props.estateName}
        </div>
        <div className="mt-1 text-[12.5px] text-ink-soft">
          <b>{props.periodLabel ?? `(${props.weekNo})`}</b> &nbsp;{props.from} to {props.to}
        </div>
      </div>

      <table className="w-full border-collapse text-[13px]">
        <thead>
          <tr className="border-b border-paper-line text-left text-[11px] uppercase tracking-wide text-ink-soft">
            <th className="w-[120px] py-2 pr-3">Date</th>
            <th className="py-2 pr-3">Particulars</th>
            <th className="w-[150px] py-2 text-right">Income</th>
            <th className="w-[150px] py-2 text-right">Expenses</th>
          </tr>
        </thead>

        <tbody>
          {s.opening !== 0 && (
            <tr>
              <td className="py-1.5 pr-3" />
              <td className="py-1.5 pr-3 italic">Opening balance (cash by hand b/f)</td>
              <td className="tnum py-1.5 text-right">{money(s.opening)}</td>
              <td />
            </tr>
          )}
          {s.incomeRows.length === 0 && (
            <tr>
              <td colSpan={4} className="py-2 italic text-ink-soft">
                No income recorded for this week yet.
              </td>
            </tr>
          )}
          {s.incomeRows.map((r) => (
            <tr key={r.id}>
              <td className="whitespace-nowrap py-1.5 pr-3">{fmtDate(r.date)}</td>
              <td className="py-1.5 pr-3">{r.particulars}</td>
              <td className="tnum py-1.5 text-right">{money(r.income)}</td>
              <td />
            </tr>
          ))}
          <tr className="border-y-2 border-ink font-bold italic">
            <td />
            <td className="py-2 text-center">Total</td>
            <td className="tnum py-2 text-right">{money(s.leftTotal)}</td>
            <td className="tnum py-2 text-right">—</td>
          </tr>

          {s.expenseRows.length === 0 && (
            <tr>
              <td colSpan={4} className="py-5 italic text-ink-soft">
                No expenses recorded for this week yet.
              </td>
            </tr>
          )}
          {s.expenseRows.map((r) => (
            <tr key={r.id}>
              <td className="whitespace-nowrap py-1.5 pr-3">{fmtDate(r.date)}</td>
              <td className="py-1.5 pr-3">{r.particulars}</td>
              <td />
              <td className="tnum py-1.5 text-right">{money(r.expense)}</td>
            </tr>
          ))}
        </tbody>

        <tfoot>
          <tr className="border-t-2 border-ink">
            <td colSpan={2} className="py-2 italic">
              OB Cash by hand Rs: {money(s.cashByHand)} =
            </td>
            <td className="tnum py-2 text-right font-semibold">{money(s.leftTotal)}</td>
            <td className="tnum py-2 text-right font-semibold">{money(s.cashByHand)}</td>
          </tr>
          <tr>
            <td />
            <td className="py-1.5 text-center italic">Total (Expenses + Cash by hand)</td>
            <td className="tnum py-1.5 text-right font-semibold">{money(s.leftTotal)}</td>
            <td className="tnum py-1.5 text-right font-semibold">{money(s.rightTotal)}</td>
          </tr>
        </tfoot>
      </table>

      {s.overspent && (
        <div className="mt-3 text-[12px] text-danger">
          More was paid out this week than was in hand — check for a missing receipt or opening balance.
        </div>
      )}
    </div>
  );
}
