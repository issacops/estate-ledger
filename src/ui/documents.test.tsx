import { describe, it, expect, afterEach } from "vitest";
import { render, cleanup } from "@testing-library/react";
import {
  InvoiceDocument, LedgerStatementDocument, PaymentVoucherDocument, PurchaseBillDocument, ReceiptDocument,
  type InvoiceDoc,
} from "./documents";
import type { Estate } from "../domain/types";

afterEach(cleanup);

const estate = (letterhead: Estate["letterhead"] = {}): Estate =>
  ({ id: 1, name: "Karukachal", code: "KAR", profile: {} as never, letterhead });

const inv = (over: Partial<InvoiceDoc> = {}): InvoiceDoc => ({
  invoice_no: "KAR-INV-0003", date: "2026-10-05", grade: "Latex", qty: 327.2, buyer_qty: null,
  formalin_kg: null, rate: 196.07, drc: 34.3, value: 22004.86, advance: 0, status: "Final", note: "", ...over,
});

const text = (c: HTMLElement) => c.textContent ?? "";

describe("letterhead", () => {
  it("heads every document with the estate's own name and address", () => {
    const { container } = render(
      <ReceiptDocument estate={estate({ name: "Karukachal Rubber Estate", address: "Karukachal P.O.\nKottayam" })}
        receiptNo="R-1" date="2026-10-05" buyerName="Pala" amount={100} type="Settlement" note="" />
    );
    expect(text(container)).toContain("KARUKACHAL RUBBER ESTATE");
    expect(text(container)).toContain("Karukachal P.O.");
    expect(text(container)).toContain("Kottayam");
  });
  it("falls back to the estate name when no letterhead is set", () => {
    const { container } = render(
      <ReceiptDocument estate={estate()} receiptNo="R-1" date="2026-10-05" buyerName="Pala" amount={100} type="x" note="" />
    );
    expect(text(container)).toContain("KARUKACHAL");
  });
  it("prints the letterhead note at the foot", () => {
    const { container } = render(
      <ReceiptDocument estate={estate({ note: "Bank: SBI 1234" })} receiptNo="R-1" date="2026-10-05"
        buyerName="Pala" amount={100} type="x" note="" />
    );
    expect(text(container)).toContain("Bank: SBI 1234");
  });
});

describe("sales invoice", () => {
  it("shows the weights, rate, DRC and amount, with the amount in words", () => {
    const { container } = render(
      <InvoiceDocument estate={estate()} invoice={inv()} buyerName="Sree Latex Processors" billedQty={327.2} />
    );
    const t = text(container);
    expect(t).toContain("Sales invoice");
    expect(t).toContain("KAR-INV-0003");
    expect(t).toContain("Sree Latex Processors");
    expect(t).toContain("327.20");
    expect(t).toContain("34.3");
    expect(t).toContain("22,004.86");
    expect(t).toContain("Rupees Twenty Two Thousand Four And Eighty Six Paise Only");
  });

  it("works out the balance when an advance was taken", () => {
    const { container } = render(
      <InvoiceDocument estate={estate()} invoice={inv({ advance: 5000 })} buyerName="Pala" billedQty={327.2} />
    );
    const t = text(container);
    expect(t).toContain("Less: advance received");
    expect(t).toContain("17,004.86"); // 22,004.86 - 5,000
  });

  it("does not invent an amount while the DRC is still pending", () => {
    const { container } = render(
      <InvoiceDocument estate={estate()} invoice={inv({ value: null, drc: null, status: "Pending DRC" })}
        buyerName="Pala" billedQty={327.2} />
    );
    const t = text(container);
    expect(t).toContain("Value to be confirmed");
    expect(t).not.toContain("Amount in words");
    expect(t).not.toContain("NaN");
  });

  it("marks a cancelled invoice so it cannot be passed off as live", () => {
    const { container } = render(
      <InvoiceDocument estate={estate()} invoice={inv({ status: "Cancelled" })} buyerName="Pala" billedQty={1} />
    );
    expect(text(container)).toContain("CANCELLED");
  });

  it("explains a difference between the estate's weight and the buyer's", () => {
    const { container } = render(
      <InvoiceDocument estate={estate()} invoice={inv({ buyer_qty: 320, formalin_kg: 2 })}
        buyerName="Pala" billedQty={320} />
    );
    const t = text(container);
    expect(t).toContain("Formalin deducted: 2.00 kg");
    expect(t).toContain("buyer's scale: 320.00 kg");
  });

  it("lists the barrels only when it is given them", () => {
    const withB = render(
      <InvoiceDocument estate={estate()} invoice={inv()} buyerName="P" billedQty={1}
        barrels={[{ code: "BR-4", kg: 200 }, { code: "BR-5", kg: 127.2 }]} />
    );
    expect(text(withB.container)).toContain("BR-4 (200.00 kg), BR-5 (127.20 kg)");
    cleanup();
    const without = render(<InvoiceDocument estate={estate()} invoice={inv()} buyerName="P" billedQty={1} />);
    expect(text(without.container)).not.toContain("Barrels dispatched");
  });
});

describe("receipt, voucher and purchase record", () => {
  it("a receipt says who paid, how much, in words, and against what", () => {
    const { container } = render(
      <ReceiptDocument estate={estate()} receiptNo="RCT-12" date="2026-10-02" buyerName="Pala Traders"
        amount={18680} type="Settlement" note="NEFT 8812" invoiceNo="KAR-INV-0001" />
    );
    const t = text(container);
    expect(t).toContain("Payment receipt");
    expect(t).toContain("RCT-12");
    expect(t).toContain("Received from");
    expect(t).toContain("Pala Traders");
    expect(t).toContain("18,680.00");
    expect(t).toContain("Rupees Eighteen Thousand Six Hundred Eighty Only");
    expect(t).toContain("KAR-INV-0001");
    expect(t).toContain("NEFT 8812");
  });

  it("leaves out a line that has nothing to say", () => {
    const { container } = render(
      <ReceiptDocument estate={estate()} receiptNo="R" date="2026-10-02" buyerName="P" amount={1} type="Settlement" note="" />
    );
    expect(text(container)).not.toContain("Against invoice");
    expect(text(container)).not.toContain("Reference");
  });

  it("a voucher records the payment to a supplier and has room for three signatures", () => {
    const { container } = render(
      <PaymentVoucherDocument estate={estate()} voucherNo="PV-7" date="2026-10-02" vendorName="Agro Centre"
        amount={3000} note="Cheque 4411" />
    );
    const t = text(container);
    expect(t).toContain("Payment voucher");
    expect(t).toContain("Paid to");
    expect(t).toContain("Agro Centre");
    expect(t).toContain("Rupees Three Thousand Only");
    for (const s of ["Prepared by", "Received by", "Authorised signatory"]) expect(t).toContain(s);
  });

  it("a purchase record carries item, quantity, rate and total", () => {
    const { container } = render(
      <PurchaseBillDocument estate={estate()} billNo="KAR/P/0003" date="2026-10-01" vendorName="Agro Centre"
        item="Rubber mixture" category="Fertiliser" qty={500} unit="kg" rate={31.5} value={15750} note="" />
    );
    const t = text(container);
    expect(t).toContain("Rubber mixture");
    expect(t).toContain("500.00 kg");
    expect(t).toContain("15,750.00");
    expect(t).toContain("Rupees Fifteen Thousand Seven Hundred Fifty Only");
  });
});

describe("ledger statement", () => {
  const lines = [
    { date: "2026-10-01", type: "Invoice", ref: "KAR-INV-0001", debit: 22000, credit: 0, balance: 22000 },
    { date: "2026-10-05", type: "Settlement", ref: "NEFT", debit: 0, credit: 18000, balance: 4000 },
  ];
  it("lists each line, totals both columns and ends on what is outstanding", () => {
    const { container } = render(
      <LedgerStatementDocument estate={estate()} heading="Buyer statement" party="Pala Traders"
        lines={lines} debitLabel="Invoiced" creditLabel="Received" closing={4000} closingLabel="Outstanding" />
    );
    const t = text(container);
    expect(t).toContain("Pala Traders");
    expect(t).toContain("KAR-INV-0001");
    expect(t).toContain("22,000.00");
    expect(t).toContain("18,000.00");
    expect(t).toContain("Outstanding: Rs 4,000.00");
    expect(t).toContain("Rupees Four Thousand Only");
  });
  it("says what it was limited to when the screen was filtered", () => {
    const { container } = render(
      <LedgerStatementDocument estate={estate()} heading="Buyer statement" party="P" scope="Settlement only"
        lines={lines} debitLabel="Invoiced" creditLabel="Received" closing={4000} closingLabel="Outstanding" />
    );
    expect(text(container)).toContain("Settlement only");
  });
});
