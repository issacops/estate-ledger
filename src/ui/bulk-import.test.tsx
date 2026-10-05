import { describe, it, expect, beforeEach } from "vitest";
import { render, screen, fireEvent, cleanup, waitFor } from "@testing-library/react";
import { toast } from "sonner";
import ExcelJS from "exceljs";
import "../i18n";
import App from "../app/App";
import { resetDb, rows, scalar } from "../test/fakes/db";
import { ioFiles } from "../test/fakes/plugin-fs";
import { setMockOpenPath } from "../test/fakes/plugin-dialog";
import { useApp } from "../app/store";

/**
 * End-to-end over the real commit path: a workbook goes in through the file
 * picker, the review screen is confirmed, and the database is checked. The
 * parser and the SQL batching have their own tests; this is the only thing
 * that proves the rows actually land, and that deleting the import takes
 * them out again.
 */

const FILE = "/tmp/history.xlsx";

const REG_HEAD = [
  "Date","Block","Tapper","Mode","Status","Reason","TappedDespiteRain",
  "TreesScheduled","TreesTapped","TareKg","Bucket1","Bucket2","WetSheets",
  "ScrapKg","Barrels","Weather","Supervisor","Remarks",
];

async function makeWorkbook(): Promise<Uint8Array> {
  const wb = new ExcelJS.Workbook();
  const reg = wb.addWorksheet("Daily Register");
  reg.addRow(REG_HEAD);
  // two days, three blocks each; B1 fills a barrel across both days
  reg.addRow(["2025-01-06","B1","Rajendran","Latex","Completed","","No",450,450,1.8,60,60,0,2.1,"BR-1:118.2","Sunny","Office",""]);
  reg.addRow(["2025-01-06","B4","Johnson","Latex","Completed","","No",450,450,2.0,55,55,0,1.9,"BR-1:81.8, BR-2:26.2","Sunny","Office",""]);
  reg.addRow(["2025-01-06","B7","Poovas","Latex","Not Done","Tapper Absent","No",450,0,0,0,0,0,0,"","Sunny","Office",""]);
  reg.addRow(["2025-01-07","B2","Rajendran","Latex","Completed","","No",450,450,1.9,50,50,0,1.7,"BR-2:98.1","Cloudy","Office",""]);

  const lab = wb.addWorksheet("Labour");
  lab.addRow(["Date","Name","Sex","Men","Women","WorkType","Who","Where"]);
  lab.addRow(["2025-01-06","Selvam","M",1,0,"Weeding","Selvam","B1"]);

  const sal = wb.addWorksheet("Sales");
  sal.addRow(["InvoiceNo","Date","Buyer","Grade","Qty","Rate","DRC","Status","Barrels","Note"]);
  // takes both barrels out, so they are empty and reusable afterwards
  sal.addRow(["KUL/L/0001","2025-01-07","Nagercoil Agencies","Field Latex",324.3,180,32,"Final","BR-1:200, BR-2:124.3",""]);

  const pur = wb.addWorksheet("Purchases");
  pur.addRow(["BillNo","Date","Vendor","Item","Category","Qty","Unit","Rate","Note"]);
  pur.addRow(["KUL/P/0001","2025-01-08","Marthandam Inputs","Rubber mixture","Fertiliser",100,"kg",30,""]);

  const cb = wb.addWorksheet("Cash Book");
  cb.addRow(["Date","Particulars","Category","Sub","Income","Expense"]);
  cb.addRow(["2025-01-08","Tapper wages","Tapper Wages","Wages",0,5400]);

  const pay = wb.addWorksheet("Buyer Payments");
  pay.addRow(["Date","Buyer","Amount","Type","InvoiceNo","Note"]);
  pay.addRow(["2025-01-15","Nagercoil Agencies",18680,"Settlement","KUL/L/0001",""]);

  const vp = wb.addWorksheet("Vendor Payments");
  vp.addRow(["Date","Vendor","Amount","Note"]);
  vp.addRow(["2025-01-16","Marthandam Inputs",3000,"cheque"]);

  return new Uint8Array((await wb.xlsx.writeBuffer()) as ArrayBuffer);
}

async function loginAndOpenBulkImport() {
  render(<App />);
  await screen.findByLabelText(/password/i);
  fireEvent.change(screen.getByLabelText(/password/i), { target: { value: "ninan123@4" } });
  fireEvent.click(screen.getByRole("button", { name: /sign in/i }));
  await screen.findByText(/Rubber estates/i);
  // Kulashekaram is estate 2
  const kul = rows<{ id: number }>("SELECT id FROM estates WHERE code='KUL'")[0];
  const est = rows<{ profile_json: string }>("SELECT * FROM estates WHERE id=$1", [kul.id])[0];
  useApp.setState({
    estate: Object.assign({}, est, {
      profile: JSON.parse(String(est.profile_json)),
    }) as never,
  });
  window.location.hash = "#/bulkimport";
  useApp.getState().setRoute("bulkimport");
  await screen.findByText(/Bulk import/i);
}

beforeEach(async () => {
  cleanup();
  toast.dismiss();
  resetDb();
  window.localStorage.clear();
  setMockOpenPath(FILE);
  ioFiles().set(FILE, await makeWorkbook());
  window.location.hash = "#/dashboard";
  useApp.setState({ user: null, estate: null, estates: [], route: "dashboard", dataVersion: 0 });
});

describe("bulk import — the whole way through", () => {
  it("imports a workbook and writes every table, then undoes it cleanly", async () => {
    await loginAndOpenBulkImport();

    fireEvent.click(screen.getByRole("button", { name: /choose workbook/i }));
    const importBtn = await screen.findByRole("button", { name: /^Import/i }, { timeout: 8000 });

    // the review must have read the file before anything is written
    expect(scalar("SELECT COUNT(*) FROM entry_days")).toBe(0);
    await screen.findByText(/Will be created when you import/i);

    fireEvent.click(importBtn);
    await waitFor(
      () => expect(scalar("SELECT COUNT(*) FROM entry_days")).toBeGreaterThan(0),
      { timeout: 8000 }
    );

    // --- days and rows
    expect(scalar("SELECT COUNT(*) FROM entry_days")).toBe(2);
    expect(scalar("SELECT COUNT(*) FROM entry_rows")).toBe(4);
    expect(scalar("SELECT COUNT(*) FROM entry_row_buckets")).toBe(6); // 3 completed x 2
    expect(scalar("SELECT COUNT(*) FROM entry_row_barrels")).toBe(4);
    expect(scalar("SELECT COUNT(*) FROM labour_rows")).toBe(1);

    // the Not Done row keeps its reason and taps nothing
    const notDone = rows<{ status: string; reason: string; trees_tapped: number }>(
      "SELECT status, reason, trees_tapped FROM entry_rows WHERE status='Not Done'"
    );
    expect(notDone).toHaveLength(1);
    expect(notDone[0].reason).toBe("Tapper Absent");
    expect(notDone[0].trees_tapped).toBe(0);

    // --- the sale, and the barrels it emptied
    expect(scalar("SELECT COUNT(*) FROM invoices")).toBe(1);
    expect(scalar("SELECT COUNT(*) FROM invoice_barrels")).toBe(2);
    expect(scalar("SELECT COUNT(*) FROM stock_ledger WHERE reason='sale'")).toBe(1);

    // value = qty x drc/100 x rate, the way the app computes a latex sale
    const inv = rows<{ value: number; status: string }>("SELECT value, status FROM invoices")[0];
    expect(inv.status).toBe("Final");
    expect(inv.value).toBeCloseTo(324.3 * 0.32 * 180, 1);

    // --- this is the bug that started all of it: fill must not exceed capacity
    const fills = rows<{ code: string; fill: number; capacity: number }>(
      `SELECT b.code, b.capacity,
              COALESCE((SELECT SUM(x.kg) FROM entry_row_barrels x WHERE x.barrel_id=b.id),0)
            - COALESCE((SELECT SUM(i.kg) FROM invoice_barrels i WHERE i.barrel_id=b.id),0) AS fill
         FROM barrels b WHERE b.estate_id=(SELECT id FROM estates WHERE code='KUL')`
    );
    for (const f of fills) expect(f.fill).toBeLessThanOrEqual(f.capacity + 0.05);
    // both barrels went out on the sale, so both are empty again
    expect(fills.filter((f) => f.fill > 0.05)).toHaveLength(0);

    // --- money
    expect(scalar("SELECT COUNT(*) FROM purchases")).toBe(1);
    expect(scalar("SELECT COUNT(*) FROM cashbook")).toBe(1);
    expect(scalar("SELECT COUNT(*) FROM payments")).toBe(1);
    expect(scalar("SELECT COUNT(*) FROM vendor_payments")).toBe(1);
    // the payment is tied back to the invoice it settles
    expect(
      scalar(
        "SELECT COUNT(*) FROM payments p JOIN invoices i ON i.id=p.invoice_id WHERE i.invoice_no='KUL/L/0001'"
      )
    ).toBe(1);

    // purchase category resolved from its label
    expect(
      rows<{ category_code: string }>("SELECT category_code FROM purchases")[0].category_code
    ).toBe("P1");

    // --- buyers and vendors named in the file were created
    expect(scalar("SELECT COUNT(*) FROM buyers WHERE name='Nagercoil Agencies'")).toBe(1);
    expect(scalar("SELECT COUNT(*) FROM vendors WHERE name='Marthandam Inputs'")).toBe(1);

    // --- the batch recorded enough to undo itself
    const batch = rows<{ undo_json: string | null }>(
      "SELECT undo_json FROM import_batches WHERE kind='bulk'"
    );
    expect(batch).toHaveLength(1);
    expect(batch[0].undo_json).toBeTruthy();

    // --- now take it back out
    const del = await screen.findByRole("button", { name: /delete/i });
    fireEvent.click(del);
    fireEvent.click(await screen.findByRole("button", { name: /delete import/i }));

    await waitFor(() => expect(scalar("SELECT COUNT(*) FROM entry_days")).toBe(0), {
      timeout: 8000,
    });
    for (const t of [
      "entry_rows", "entry_row_buckets", "entry_row_barrels", "labour_rows",
      "invoices", "invoice_barrels", "stock_ledger", "purchases", "cashbook",
      "payments", "vendor_payments", "import_batches",
    ]) {
      expect(scalar(`SELECT COUNT(*) FROM ${t}`), `${t} should be empty`).toBe(0);
    }
    // masters the import created are deliberately left behind
    expect(scalar("SELECT COUNT(*) FROM buyers WHERE name='Nagercoil Agencies'")).toBe(1);
  });

  it("writes nothing when the workbook has an error", async () => {
    const wb = new ExcelJS.Workbook();
    const reg = wb.addWorksheet("Daily Register");
    reg.addRow(REG_HEAD);
    reg.addRow(["not-a-date","B1","Rajendran","Latex","Completed","","No",450,450,0,0,0,0,0,"","Sunny","",""]);
    const sal = wb.addWorksheet("Sales");
    sal.addRow(["InvoiceNo","Date","Buyer","Grade","Qty","Rate","DRC","Status","Barrels"]);
    // barrels do not add up to qty
    sal.addRow(["X/1","2025-01-07","Someone","Field Latex",500,180,32,"Final","BR-1:100"]);
    ioFiles().set(FILE, new Uint8Array((await wb.xlsx.writeBuffer()) as ArrayBuffer));

    await loginAndOpenBulkImport();
    fireEvent.click(screen.getByRole("button", { name: /choose workbook/i }));

    await screen.findByText(/error\(s\)/i, undefined, { timeout: 8000 });
    const btn = screen.getByRole("button", { name: /^Import/i }) as HTMLButtonElement;
    expect(btn.disabled).toBe(true);
    expect(scalar("SELECT COUNT(*) FROM entry_days")).toBe(0);
    expect(scalar("SELECT COUNT(*) FROM invoices")).toBe(0);
  });
});
