import type { ReactNode } from "react";
import type { Estate } from "../domain/types";
import { fmtDate, fmtMoney, fmtNum } from "../domain/dates";
import { rupeesInWords } from "../domain/words";
import { PrintSheet } from "./PrintSheet";

/**
 * The printed documents. Each is a plain function of its data, so what comes
 * out on paper is exactly what is on screen and can be checked in a test.
 */

function Fields(props: { rows: [string, ReactNode][] }) {
  return (
    <table className="mb-4">
      <tbody>
        {props.rows
          .filter(([, v]) => v !== null && v !== undefined && v !== "")
          .map(([k, v]) => (
            <tr key={k}>
              <td className="w-[38mm] font-semibold">{k}</td>
              <td>{v}</td>
            </tr>
          ))}
      </tbody>
    </table>
  );
}

function InWords(props: { amount: number }) {
  return (
    <div className="mt-2 text-[12px]">
      <b>Amount in words:</b> {rupeesInWords(props.amount)}
    </div>
  );
}

/* ------------------------------------------------------------- invoice */

export interface InvoiceDoc {
  invoice_no: string;
  date: string;
  grade: string;
  qty: number;
  buyer_qty: number | null;
  formalin_kg: number | null;
  rate: number;
  drc: number | null;
  value: number | null;
  advance: number;
  status: string;
  note: string;
}

export function InvoiceDocument(props: {
  estate: Estate;
  invoice: InvoiceDoc;
  buyerName: string;
  billedQty: number;
  /** Listed only when the estate letterhead asks for it. */
  barrels?: { code: string; kg: number }[];
}) {
  const { invoice: i } = props;
  const pending = i.value === null;
  const net = pending ? null : Math.round(((i.value ?? 0) - (i.advance || 0)) * 100) / 100;
  return (
    <PrintSheet
      estate={props.estate}
      title="Sales invoice"
      number={i.invoice_no}
      date={i.date}
      signatures={["Buyer's signature", "Authorised signatory"]}
    >
      <Fields rows={[["Buyer", props.buyerName || "—"], ["Status", i.status === "Cancelled" ? "CANCELLED" : pending ? "DRC pending" : ""]]} />
      <table>
        <thead>
          <tr>
            <th>Description</th>
            <th className="num">Estate weight (kg)</th>
            <th className="num">Billed weight (kg)</th>
            {i.drc !== null && <th className="num">DRC %</th>}
            <th className="num">Rate (Rs)</th>
            <th className="num">Amount (Rs)</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>{i.grade}</td>
            <td className="num">{fmtNum(i.qty)}</td>
            <td className="num">{fmtNum(props.billedQty)}</td>
            {i.drc !== null && <td className="num">{fmtNum(i.drc, 1)}</td>}
            <td className="num">{fmtNum(i.rate)}</td>
            <td className="num">{pending ? "—" : fmtNum(i.value ?? 0)}</td>
          </tr>
        </tbody>
      </table>

      {(i.formalin_kg || i.buyer_qty !== null) && (
        <div className="mt-2 text-[11px]">
          {i.formalin_kg ? `Formalin deducted: ${fmtNum(i.formalin_kg)} kg. ` : ""}
          {i.buyer_qty !== null ? `Weight on the buyer's scale: ${fmtNum(i.buyer_qty)} kg.` : ""}
        </div>
      )}

      {pending ? (
        <div className="mt-3 text-[12px]">
          <b>Value to be confirmed</b> once the buyer's DRC is known.
        </div>
      ) : (
        <div className="mt-3 ml-auto w-[70mm] text-[12.5px]">
          <div className="flex justify-between"><span>Invoice value</span><b>{fmtMoney(i.value)}</b></div>
          {i.advance > 0 && (
            <>
              <div className="flex justify-between"><span>Less: advance received</span><span>{fmtMoney(i.advance)}</span></div>
              <div className="flex justify-between border-t border-black pt-1"><b>Balance payable</b><b>{fmtMoney(net)}</b></div>
            </>
          )}
        </div>
      )}
      {!pending && <InWords amount={i.value ?? 0} />}

      {props.barrels && props.barrels.length > 0 && (
        <div className="mt-4 text-[11.5px]">
          <b>Barrels dispatched:</b>{" "}
          {props.barrels.map((b) => `${b.code} (${fmtNum(b.kg)} kg)`).join(", ")}
        </div>
      )}
      {i.note && <div className="mt-2 text-[11.5px]"><b>Note:</b> {i.note}</div>}
    </PrintSheet>
  );
}

/* ------------------------------------------------------------- receipt */

export function ReceiptDocument(props: {
  estate: Estate;
  receiptNo: string;
  date: string;
  buyerName: string;
  amount: number;
  type: string;
  note: string;
  invoiceNo?: string;
}) {
  return (
    <PrintSheet
      estate={props.estate}
      title="Payment receipt"
      number={props.receiptNo}
      date={props.date}
      signatures={["Payer's signature", "Authorised signatory"]}
    >
      <Fields
        rows={[
          ["Received from", props.buyerName || "—"],
          ["Amount", <b key="a">{fmtMoney(props.amount)}</b>],
          ["Towards", props.type],
          ["Against invoice", props.invoiceNo],
          ["Reference", props.note],
        ]}
      />
      <InWords amount={props.amount} />
    </PrintSheet>
  );
}

/* ------------------------------------------------------------- voucher */

export function PaymentVoucherDocument(props: {
  estate: Estate;
  voucherNo: string;
  date: string;
  vendorName: string;
  amount: number;
  note: string;
}) {
  return (
    <PrintSheet
      estate={props.estate}
      title="Payment voucher"
      number={props.voucherNo}
      date={props.date}
      signatures={["Prepared by", "Received by", "Authorised signatory"]}
    >
      <Fields
        rows={[
          ["Paid to", props.vendorName || "—"],
          ["Amount", <b key="a">{fmtMoney(props.amount)}</b>],
          ["Particulars", props.note],
        ]}
      />
      <InWords amount={props.amount} />
    </PrintSheet>
  );
}

/* ------------------------------------------------------------ purchase */

export function PurchaseBillDocument(props: {
  estate: Estate;
  billNo: string;
  date: string;
  vendorName: string;
  item: string;
  category: string;
  qty: number;
  unit: string;
  rate: number;
  value: number;
  note: string;
}) {
  return (
    <PrintSheet
      estate={props.estate}
      title="Purchase record"
      number={props.billNo}
      date={props.date}
      signatures={["Received by", "Authorised signatory"]}
    >
      <Fields rows={[["Supplier", props.vendorName || "—"], ["Category", props.category]]} />
      <table>
        <thead>
          <tr>
            <th>Item</th>
            <th className="num">Quantity</th>
            <th className="num">Rate (Rs)</th>
            <th className="num">Amount (Rs)</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>{props.item}</td>
            <td className="num">{fmtNum(props.qty)} {props.unit}</td>
            <td className="num">{fmtNum(props.rate)}</td>
            <td className="num">{fmtNum(props.value)}</td>
          </tr>
        </tbody>
      </table>
      <InWords amount={props.value} />
      {props.note && <div className="mt-2 text-[11.5px]"><b>Note:</b> {props.note}</div>}
    </PrintSheet>
  );
}

/* ------------------------------------------------------ ledger statement */

export interface StatementLine {
  date: string;
  type: string;
  ref: string;
  debit: number;
  credit: number;
  balance: number;
}

/** A buyer's or a supplier's account, line by line, ending in what is owed. */
export function LedgerStatementDocument(props: {
  estate: Estate;
  heading: string;
  party: string;
  /** What the lines are limited to, if the screen was filtered. */
  scope?: string;
  lines: StatementLine[];
  debitLabel: string;
  creditLabel: string;
  closing: number;
  closingLabel: string;
}) {
  const debit = props.lines.reduce((s, l) => s + l.debit, 0);
  const credit = props.lines.reduce((s, l) => s + l.credit, 0);
  return (
    <PrintSheet
      estate={props.estate}
      title={props.heading}
      date={new Date().toISOString().slice(0, 10)}
      signatures={["Authorised signatory"]}
    >
      <Fields rows={[["Account", <b key="p">{props.party}</b>], ["Showing", props.scope]]} />
      <table>
        <thead>
          <tr>
            <th>Date</th>
            <th>Type</th>
            <th>Reference</th>
            <th className="num">{props.debitLabel}</th>
            <th className="num">{props.creditLabel}</th>
            <th className="num">Balance</th>
          </tr>
        </thead>
        <tbody>
          {props.lines.map((l, i) => (
            <tr key={i}>
              <td className="whitespace-nowrap">{fmtDate(l.date)}</td>
              <td>{l.type}</td>
              <td>{l.ref}</td>
              <td className="num">{l.debit ? fmtNum(l.debit) : ""}</td>
              <td className="num">{l.credit ? fmtNum(l.credit) : ""}</td>
              <td className="num">{fmtNum(l.balance)}</td>
            </tr>
          ))}
          <tr className="font-bold">
            <td colSpan={3}>Total</td>
            <td className="num">{fmtNum(debit)}</td>
            <td className="num">{fmtNum(credit)}</td>
            <td />
          </tr>
        </tbody>
      </table>
      <div className="mt-3 text-[13px]">
        <b>{props.closingLabel}: {fmtMoney(props.closing)}</b>
      </div>
      <InWords amount={props.closing} />
    </PrintSheet>
  );
}
