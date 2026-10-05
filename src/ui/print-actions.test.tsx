import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, fireEvent, cleanup, waitFor } from "@testing-library/react";
import { toast } from "sonner";
import "../i18n";
import App from "../app/App";
import { resetDb, run, scalar } from "../test/fakes/db";
import { ensureSeeded } from "../db/seed";
import { useApp } from "../app/store";

async function login() {
  render(<App />);
  await screen.findByLabelText(/password/i);
  fireEvent.change(screen.getByLabelText(/password/i), { target: { value: "ninan123@4" } });
  fireEvent.click(screen.getByRole("button", { name: /sign in/i }));
  await screen.findByText(/Rubber estates/i);
}
const goto = (route: string) => {
  window.location.hash = `#/${route}`;
  useApp.getState().setRoute(route);
};
const printed = () => document.querySelector(".print-host")?.textContent ?? "";

let printSpy: ReturnType<typeof vi.fn>;
beforeEach(async () => {
  cleanup();
  toast.dismiss();
  resetDb();
  window.localStorage.clear();
  window.location.hash = "#/dashboard";
  useApp.setState({ user: null, estate: null, estates: [], route: "dashboard", dataVersion: 0 });
  await ensureSeeded();
  printSpy = vi.fn(async () => undefined);
  (window as unknown as { print: unknown }).print = printSpy;
  document.title = "Estate Ledger";
  run("UPDATE estates SET letterhead_json=$1 WHERE id=1", [
    JSON.stringify({ name: "Karukachal Rubber Estate", address: "Karukachal P.O., Kottayam", showBarrelList: true }),
  ]);
});

describe("printing a sales invoice", () => {
  it("prints it on the letterhead, with its barrels, from the invoice list", async () => {
    const buyer = run("INSERT INTO buyers (estate_id, name) VALUES (1,'Pala Traders')").lastInsertId;
    const invId = run(
      "INSERT INTO invoices (estate_id, invoice_no, date, buyer_id, grade, qty, rate, drc, value, status, advance) " +
        "VALUES (1,'KAR-INV-0003','2026-10-05',$1,'Latex',327.2,196.07,34.3,22004.86,'Final',0)",
      [buyer]
    ).lastInsertId;
    const barrel = scalar("SELECT id FROM barrels WHERE estate_id=1 AND code='BR-4'");
    run("INSERT INTO invoice_barrels (invoice_id, barrel_id, kg) VALUES ($1,$2,200)", [invId, barrel]);

    await login();
    goto("latex");
    fireEvent.click(await screen.findByRole("button", { name: /^Invoices$/i }));
    fireEvent.click(await screen.findByRole("button", { name: "Print invoice KAR-INV-0003" }));

    await waitFor(() => expect(printSpy).toHaveBeenCalled());
    const t = printed();
    expect(t).toContain("KARUKACHAL RUBBER ESTATE");
    expect(t).toContain("Karukachal P.O., Kottayam");
    expect(t).toContain("Sales invoice");
    expect(t).toContain("KAR-INV-0003");
    expect(t).toContain("Pala Traders");
    expect(t).toContain("22,004.86");
    expect(t).toContain("Rupees Twenty Two Thousand Four And Eighty Six Paise Only");
    expect(t).toContain("BR-4 (200.00 kg)");
    // named for the PDF, and the page title comes back afterwards
    expect(document.title).toBe("Invoice KAR-INV-0003");
  });
});

describe("printing a receipt and a statement from the buyer ledger", () => {
  async function openLedger() {
    await login();
    goto("latex");
    fireEvent.click(await screen.findByRole("button", { name: /^Buyer ledger$/i }));
    const select = await waitFor(() => {
      const sel = [...document.querySelectorAll("select")].find((x) =>
        [...x.options].some((o) => o.textContent === "Pala Traders")
      );
      expect(sel).toBeTruthy();
      return sel!;
    });
    return select;
  }

  it("prints a receipt for a payment, naming the invoice it settles", async () => {
    const buyer = run("INSERT INTO buyers (estate_id, name) VALUES (1,'Pala Traders')").lastInsertId;
    const inv = run(
      "INSERT INTO invoices (estate_id, invoice_no, date, buyer_id, grade, qty, rate, value, status) " +
        "VALUES (1,'KAR-INV-0001','2026-10-01',$1,'Latex',100,180,18000,'Final')",
      [buyer]
    ).lastInsertId;
    run(
      "INSERT INTO payments (estate_id, buyer_id, date, amount, type, note, invoice_id) " +
        "VALUES (1,$1,'2026-10-02',18000,'Settlement','NEFT 8812',$2)",
      [buyer, inv]
    );
    const select = await openLedger();
    fireEvent.change(select, { target: { value: String(buyer) } });
    fireEvent.click(await screen.findByRole("button", { name: /Print receipt NEFT 8812/ }));

    await waitFor(() => expect(printSpy).toHaveBeenCalled());
    const t = printed();
    expect(t).toContain("Payment receipt");
    expect(t).toContain("RCT-0001");
    expect(t).toContain("Pala Traders");
    expect(t).toContain("18,000.00");
    expect(t).toContain("Rupees Eighteen Thousand Only");
    expect(t).toContain("KAR-INV-0001");
  });

  it("prints the buyer's statement ending on what is outstanding", async () => {
    const buyer = run("INSERT INTO buyers (estate_id, name) VALUES (1,'Pala Traders')").lastInsertId;
    run(
      "INSERT INTO invoices (estate_id, invoice_no, date, buyer_id, grade, qty, rate, value, status) " +
        "VALUES (1,'KAR-INV-0001','2026-10-01',$1,'Latex',100,220,22000,'Final')",
      [buyer]
    );
    run(
      "INSERT INTO payments (estate_id, buyer_id, date, amount, type, note) VALUES (1,$1,'2026-10-05',18000,'Settlement','NEFT')",
      [buyer]
    );
    const select = await openLedger();
    fireEvent.change(select, { target: { value: String(buyer) } });
    fireEvent.click(await screen.findByRole("button", { name: "Print statement" }));

    await waitFor(() => expect(printSpy).toHaveBeenCalled());
    const t = printed();
    expect(t).toContain("Buyer statement");
    expect(t).toContain("Pala Traders");
    expect(t).toContain("Outstanding: Rs 4,000.00");
  });
});

describe("printing from the purchase register", () => {
  async function openVendor() {
    const v = run("INSERT INTO vendors (estate_id, name) VALUES (1,'Agro Centre')").lastInsertId;
    run(
      "INSERT INTO purchases (estate_id, bill_no, date, vendor_id, item, qty, unit, rate, value, category_code) " +
        "VALUES (1,'KAR/P/0001','2026-10-01',$1,'Rubber mixture',500,'kg',31.5,15750,'P1')",
      [v]
    );
    run(
      "INSERT INTO vendor_payments (estate_id, vendor_id, date, amount, note) VALUES (1,$1,'2026-10-03',3000,'Cheque 4411')",
      [v]
    );
    await login();
    goto("purchases");
    return v;
  }

  it("prints a bill from the purchase list", async () => {
    await openVendor();
    fireEvent.click(await screen.findByRole("button", { name: /^Purchases$/i }));
    fireEvent.click(await screen.findByRole("button", { name: "Print purchase KAR/P/0001" }));
    await waitFor(() => expect(printSpy).toHaveBeenCalled());
    const t = printed();
    expect(t).toContain("Purchase record");
    expect(t).toContain("Agro Centre");
    expect(t).toContain("Rubber mixture");
    expect(t).toContain("Fertiliser");
    expect(t).toContain("15,750.00");
  });

  it("prints a payment voucher and the supplier statement from the vendor ledger", async () => {
    const v = await openVendor();
    fireEvent.click(await screen.findByRole("button", { name: /^Vendor ledger$/i }));
    const select = await waitFor(() => {
      const sel = [...document.querySelectorAll("select")].find((x) =>
        [...x.options].some((o) => o.textContent === "Agro Centre")
      );
      expect(sel).toBeTruthy();
      return sel!;
    });
    fireEvent.change(select, { target: { value: String(v) } });

    fireEvent.click(await screen.findByRole("button", { name: /Print voucher Cheque 4411/ }));
    await waitFor(() => expect(printSpy).toHaveBeenCalledTimes(1));
    expect(printed()).toContain("Payment voucher");
    expect(printed()).toContain("PV-0001");
    expect(printed()).toContain("Rupees Three Thousand Only");

    fireEvent.click(await screen.findByRole("button", { name: /Print statement/ }));
    await waitFor(() => expect(printSpy).toHaveBeenCalledTimes(2));
    const t = printed();
    expect(t).toContain("Supplier statement");
    expect(t).toContain("Payable: Rs 12,750.00"); // 15,750 billed - 3,000 paid
  });
});
