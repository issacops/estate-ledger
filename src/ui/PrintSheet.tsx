import type { ReactNode } from "react";
import type { Estate } from "../domain/types";
import { fmtDate } from "../domain/dates";

/**
 * The page every printed document sits on: the estate's letterhead at the top,
 * the document's name and number, the body, then a note and signature lines.
 * Black on white with plain rules, so it prints the same on any printer.
 */
export function PrintSheet(props: {
  estate: Estate;
  title: string;
  number?: string;
  date?: string;
  /** Signature lines at the foot; a ledger statement has none. */
  signatures?: string[];
  children: ReactNode;
}) {
  const lh = props.estate.letterhead;
  const name = (lh.name || props.estate.name).toUpperCase();
  return (
    <div className="print-sheet">
      <header className="mb-5 border-b-2 border-black pb-3 text-center">
        <div className="text-[19px] font-bold tracking-wide">{name}</div>
        {lh.address && (
          <div className="mt-0.5 whitespace-pre-line text-[11.5px]">{lh.address}</div>
        )}
      </header>

      <div className="mb-4 flex items-end justify-between">
        <div className="text-[15px] font-bold uppercase tracking-wide">{props.title}</div>
        <div className="text-right text-[12px]">
          {props.number && <div><b>No:</b> {props.number}</div>}
          {props.date && <div><b>Date:</b> {fmtDate(props.date)}</div>}
        </div>
      </div>

      {props.children}

      {lh.note && (
        <div className="mt-6 whitespace-pre-line border-t border-black pt-2 text-[11px]">{lh.note}</div>
      )}

      {props.signatures && props.signatures.length > 0 && (
        <div className="mt-14 flex justify-between gap-8 text-[11.5px]">
          {props.signatures.map((s) => (
            <div key={s} className="flex-1 border-t border-black pt-1 text-center">{s}</div>
          ))}
        </div>
      )}
      <div className="mt-6 text-center text-[9.5px] text-neutral-500">
        Printed from Estate Ledger
      </div>
    </div>
  );
}
