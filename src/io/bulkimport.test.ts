import { describe, it, expect } from "vitest";
import ExcelJS from "exceljs";
import {
  chunkInsert,
  parseBulkWorkbook,
  parsePairs,
  SHEETS,
  type KnownMasters,
} from "./bulkimport";

const KNOWN: KnownMasters = {
  blocks: ["B1", "B2", "B3"],
  tappers: ["Rajendran", "Johnson"],
  barrels: ["BR-1", "BR-2"],
  buyers: ["Nagercoil Rubber Agencies"],
  vendors: ["Marthandam Farm Inputs"],
  purchaseCats: [
    { code: "P1", label: "Fertiliser" },
    { code: "P2", label: "Weedicide" },
  ],
  expenseCats: [
    { code: "E1", label: "Tapper Wages" },
    { code: "E11", label: "Sales Proceeds / Other Income" },
  ],
};

type Sheets = Record<string, (string | number | Date | null)[][]>;

async function build(sheets: Sheets): Promise<Uint8Array> {
  const wb = new ExcelJS.Workbook();
  for (const [name, rows] of Object.entries(sheets)) {
    const ws = wb.addWorksheet(name);
    for (const r of rows) ws.addRow(r);
  }
  const buf = await wb.xlsx.writeBuffer();
  return new Uint8Array(buf as ArrayBuffer);
}

const REG_HEAD = [
  "Date", "Block", "Tapper", "Mode", "Status", "Reason", "TappedDespiteRain",
  "TreesScheduled", "TreesTapped", "TareKg", "Bucket1", "Bucket2", "WetSheets",
  "ScrapKg", "Barrels", "Weather", "Supervisor", "Remarks",
];

const parse = async (sheets: Sheets) =>
  parseBulkWorkbook(await build(sheets), "history.xlsx", KNOWN);

describe("bulk import — barrel pairs", () => {
  it("reads code:kg pairs and ignores blanks", () => {
    expect(parsePairs("BR-12:150, BR-13:50")).toEqual([
      { code: "BR-12", kg: 150 },
      { code: "BR-13", kg: 50 },
    ]);
    expect(parsePairs("")).toEqual([]);
    expect(parsePairs("BR-1:40;BR-2:10")).toHaveLength(2);
  });
});

describe("bulk import — dates", () => {
  it("accepts ISO, dd/mm/yyyy and real Excel date cells", async () => {
    const res = await parse({
      [SHEETS.register]: [
        REG_HEAD,
        ["2024-06-01", "B1", "Rajendran", "Latex", "Completed", "", "No", 450, 450, 1.8, 30, 30, 0, 2, "", "Sunny", "", ""],
        ["02/06/2024", "B2", "Johnson", "Latex", "Completed", "", "No", 450, 450, 1.8, 20, 20, 0, 1, "", "Sunny", "", ""],
        [new Date(2024, 5, 3), "B3", "Rajendran", "Latex", "Completed", "", "No", 450, 450, 1.8, 25, 25, 0, 1, "", "Cloudy", "", ""],
      ],
    });
    expect(res.errors).toEqual([]);
    expect(res.days.map((d) => d.date)).toEqual(["2024-06-01", "2024-06-02", "2024-06-03"]);
    expect(res.dateRange).toEqual({ from: "2024-06-01", to: "2024-06-03" });
  });

  it("rejects a row whose date cannot be read", async () => {
    const res = await parse({
      [SHEETS.register]: [
        REG_HEAD,
        ["not a date", "B1", "", "Latex", "Completed", "", "No", 0, 0, 0, 0, 0, 0, 0, "", "", "", ""],
      ],
    });
    expect(res.errors).toHaveLength(1);
    expect(res.errors[0].message).toMatch(/date/i);
    expect(res.days).toEqual([]);
  });
});

describe("bulk import — register", () => {
  it("groups rows into days and reads buckets and barrels", async () => {
    const res = await parse({
      [SHEETS.register]: [
        REG_HEAD,
        ["2024-06-01", "B1", "Rajendran", "Latex", "Completed", "", "No", 450, 450, 1.8, 30.5, 30.5, 0, 2.1, "BR-1:59.2", "Sunny", "Ninan", "ok"],
        ["2024-06-01", "B2", "Johnson", "Latex", "Not Done", "Heavy Rain", "No", 450, 0, 0, 0, 0, 0, 0, "", "Sunny", "Ninan", "ok"],
      ],
    });
    expect(res.errors).toEqual([]);
    expect(res.days).toHaveLength(1);
    const day = res.days[0];
    expect(day.weather).toBe("Sunny");
    expect(day.rows).toHaveLength(2);
    expect(res.entryRowCount).toBe(2);

    const b1 = day.rows[0];
    expect(b1.buckets).toEqual([
      { label: "Bucket 1", kg: 30.5 },
      { label: "Bucket 2", kg: 30.5 },
    ]);
    expect(b1.barrels).toEqual([{ barrelCode: "BR-1", kg: 59.2 }]);
    expect(b1.tareKg).toBe(1.8);

    expect(day.rows[1].status).toBe("Not Done");
    expect(day.rows[1].reason).toBe("Heavy Rain");
  });

  it("matches headers regardless of spacing and case", async () => {
    const res = await parse({
      [SHEETS.register]: [
        ["date", "BLOCK", "Trees Scheduled", "trees_tapped", "Scrap Kg"],
        ["2024-06-01", "B1", 450, 440, 2.5],
      ],
    });
    expect(res.errors).toEqual([]);
    expect(res.days[0].rows[0].treesScheduled).toBe(450);
    expect(res.days[0].rows[0].treesTapped).toBe(440);
    expect(res.days[0].rows[0].scrapKg).toBe(2.5);
  });

  it("flags the same block twice on one day", async () => {
    const res = await parse({
      [SHEETS.register]: [
        REG_HEAD,
        ["2024-06-01", "B1", "", "Latex", "Completed", "", "No", 450, 450, 0, 0, 0, 0, 0, "", "", "", ""],
        ["2024-06-01", "B1", "", "Latex", "Completed", "", "No", 450, 450, 0, 0, 0, 0, 0, "", "", "", ""],
      ],
    });
    expect(res.errors).toHaveLength(1);
    expect(res.errors[0].message).toMatch(/twice/i);
    expect(res.days[0].rows).toHaveLength(1);
  });

  it("rejects negative weights and warns when tapped exceeds scheduled", async () => {
    const res = await parse({
      [SHEETS.register]: [
        REG_HEAD,
        ["2024-06-01", "B1", "", "Latex", "Completed", "", "No", 450, 460, 0, 0, 0, 0, -3, "", "", "", ""],
      ],
    });
    expect(res.errors.some((e) => /negative/i.test(e.message))).toBe(true);
    expect(res.warnings.some((w) => /more than scheduled/i.test(w.message))).toBe(true);
  });

  it("errors when the register sheet is missing entirely", async () => {
    const res = await parse({ Something: [["a"], ["b"]] });
    expect(res.errors.some((e) => /not found/i.test(e.message))).toBe(true);
  });
});

describe("bulk import — unknown masters", () => {
  it("collects blocks, tappers, barrels, buyers and vendors it does not know", async () => {
    const res = await parse({
      [SHEETS.register]: [
        REG_HEAD,
        ["2024-06-01", "B9", "Poovas", "Latex", "Completed", "", "No", 450, 450, 1, 20, 20, 0, 1, "BR-77:39", "", "", ""],
      ],
      [SHEETS.sales]: [
        ["InvoiceNo", "Date", "Buyer", "Grade", "Qty", "Rate", "DRC", "Status"],
        ["KUL/L/001", "2024-06-04", "New Buyer Ltd", "Field Latex", 1850, 178, 32.5, "Final"],
      ],
      [SHEETS.purchases]: [
        ["BillNo", "Date", "Vendor", "Item", "Category", "Qty", "Unit", "Rate"],
        ["KUL/P/001", "2024-06-06", "New Vendor Co", "Rubber mixture", "Fertiliser", 500, "kg", 31.5],
      ],
    });
    expect(res.errors).toEqual([]);
    expect(res.unknown.blocks).toEqual(["B9"]);
    expect(res.unknown.tappers).toEqual(["Poovas"]);
    expect(res.unknown.barrels).toEqual(["BR-77"]);
    expect(res.unknown.buyers).toEqual(["New Buyer Ltd"]);
    expect(res.unknown.vendors).toEqual(["New Vendor Co"]);
  });

  it("does not report masters it already has", async () => {
    const res = await parse({
      [SHEETS.register]: [
        REG_HEAD,
        ["2024-06-01", "B1", "Rajendran", "Latex", "Completed", "", "No", 450, 450, 1, 20, 20, 0, 1, "BR-1:39", "", "", ""],
      ],
    });
    expect(res.unknown.blocks).toEqual([]);
    expect(res.unknown.tappers).toEqual([]);
    expect(res.unknown.barrels).toEqual([]);
  });
});

describe("bulk import — sales", () => {
  it("maps a latex sale with no DRC to Pending DRC", async () => {
    const res = await parse({
      [SHEETS.register]: [REG_HEAD],
      [SHEETS.sales]: [
        ["InvoiceNo", "Date", "Buyer", "Grade", "Qty", "Rate", "DRC", "Status"],
        ["L/1", "2024-06-04", "Nagercoil Rubber Agencies", "Field Latex", 1000, 180, "", ""],
        ["S/1", "2024-06-05", "Nagercoil Rubber Agencies", "RSS4", 500, 195, "", ""],
      ],
    });
    expect(res.errors).toEqual([]);
    expect(res.sales[0].status).toBe("Pending DRC");
    expect(res.sales[0].drc).toBeNull();
    expect(res.sales[1].status).toBe("Final");
  });

  it("rejects a duplicate invoice number and an out-of-range DRC", async () => {
    const res = await parse({
      [SHEETS.register]: [REG_HEAD],
      [SHEETS.sales]: [
        ["InvoiceNo", "Date", "Buyer", "Grade", "Qty", "Rate", "DRC", "Status"],
        ["L/1", "2024-06-04", "Nagercoil Rubber Agencies", "Field Latex", 1000, 180, 32, "Final"],
        ["L/1", "2024-06-05", "Nagercoil Rubber Agencies", "Field Latex", 900, 180, 32, "Final"],
        ["L/2", "2024-06-06", "Nagercoil Rubber Agencies", "Field Latex", 900, 180, 140, "Final"],
      ],
    });
    expect(res.errors.some((e) => /more than once/i.test(e.message))).toBe(true);
    expect(res.errors.some((e) => /between 0 and 100/i.test(e.message))).toBe(true);
  });
});

describe("bulk import — purchases and cash book", () => {
  it("resolves category labels to their codes", async () => {
    const res = await parse({
      [SHEETS.register]: [REG_HEAD],
      [SHEETS.purchases]: [
        ["BillNo", "Date", "Vendor", "Item", "Category", "Qty", "Unit", "Rate"],
        ["P/1", "2024-06-06", "Marthandam Farm Inputs", "Mixture", "Fertiliser", 500, "kg", 31.5],
        ["P/2", "2024-06-07", "Marthandam Farm Inputs", "Spray", "P2", 10, "ltr", 400],
      ],
      [SHEETS.cash]: [
        ["Date", "Particulars", "Category", "Sub", "Income", "Expense"],
        ["2024-06-07", "Tapper wages", "Tapper Wages", "Wages", 0, 12400],
      ],
    });
    expect(res.errors).toEqual([]);
    expect(res.purchases[0].categoryCode).toBe("P1");
    expect(res.purchases[1].categoryCode).toBe("P2");
    expect(res.cash[0].categoryCode).toBe("E1");
    expect(res.cash[0].expense).toBe(12400);
  });

  it("warns on an unknown purchase category instead of failing", async () => {
    const res = await parse({
      [SHEETS.register]: [REG_HEAD],
      [SHEETS.purchases]: [
        ["BillNo", "Date", "Vendor", "Item", "Category", "Qty", "Unit", "Rate"],
        ["P/1", "2024-06-06", "Marthandam Farm Inputs", "Mixture", "Diesel", 500, "kg", 31.5],
      ],
    });
    expect(res.errors).toEqual([]);
    expect(res.warnings.some((w) => /unknown category/i.test(w.message))).toBe(true);
    expect(res.purchases[0].categoryCode).toBe("");
  });

  it("requires particulars on a cash row", async () => {
    const res = await parse({
      [SHEETS.register]: [REG_HEAD],
      [SHEETS.cash]: [
        ["Date", "Particulars", "Category", "Sub", "Income", "Expense"],
        ["2024-06-07", "", "Tapper Wages", "Wages", 0, 12400],
      ],
    });
    expect(res.errors.some((e) => /particulars/i.test(e.message))).toBe(true);
  });
});

describe("bulk import — labour and smokehouse", () => {
  it("reads both sheets and skips an empty smokehouse movement", async () => {
    const res = await parse({
      [SHEETS.register]: [REG_HEAD],
      [SHEETS.labour]: [
        ["Date", "Name", "Sex", "Men", "Women", "WorkType", "Who", "Where"],
        ["2024-06-01", "Selvam", "M", 1, 0, "Weeding", "Selvam", "B1"],
      ],
      [SHEETS.smokehouse]: [
        ["Date", "WetIn", "DryOut", "Person", "Note"],
        ["2024-06-01", 40, 0, "Estate", ""],
        ["2024-06-02", 0, 0, "Estate", "nothing happened"],
      ],
    });
    expect(res.errors).toEqual([]);
    expect(res.labour).toHaveLength(1);
    expect(res.labour[0].work_type).toBe("Weeding");
    expect(res.smokehouse).toHaveLength(1);
    expect(res.smokehouse[0].wetIn).toBe(40);
    expect(res.warnings.some((w) => /neither wet in nor dry out/i.test(w.message))).toBe(true);
  });

  it("defaults the smokehouse person to the estate", async () => {
    const res = await parse({
      [SHEETS.register]: [REG_HEAD],
      [SHEETS.smokehouse]: [
        ["Date", "WetIn", "DryOut", "Person", "Note"],
        ["2024-06-01", 40, 0, "", ""],
      ],
    });
    expect(res.smokehouse[0].person).toBe("Estate");
  });
});

describe("bulk import — scale", () => {
  it("handles three years of daily rows", async () => {
    const rows: (string | number)[][] = [REG_HEAD];
    const start = new Date(2022, 3, 1);
    for (let i = 0; i < 365 * 3; i++) {
      const d = new Date(start.getTime() + i * 86400000);
      const iso = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
      for (const b of ["B1", "B2", "B3"]) {
        rows.push([iso, b, "Rajendran", "Latex", "Completed", "", "No", 450, 450, 1.8, 20, 20, 0, 1.2, "BR-1:38.2", "Sunny", "", ""]);
      }
    }
    const res = await parse({ [SHEETS.register]: rows });
    expect(res.errors).toEqual([]);
    expect(res.days).toHaveLength(365 * 3);
    expect(res.entryRowCount).toBe(365 * 3 * 3);
    expect(res.dateRange?.from).toBe("2022-04-01");
  });
});

describe("bulk import — SQL batching", () => {
  it("numbers placeholders continuously across a chunk", () => {
    const [stmt] = chunkInsert("t", ["a", "b"], [[1, 2], [3, 4]]);
    expect(stmt.sql).toBe("INSERT INTO t (a,b) VALUES ($1,$2),($3,$4)");
    expect(stmt.params).toEqual([1, 2, 3, 4]);
  });

  it("splits so no statement exceeds the parameter cap, and restarts numbering", () => {
    const rows = Array.from({ length: 5 }, (_, i) => [i, i, i]);
    const out = chunkInsert("t", ["a", "b", "c"], rows, 6); // 2 rows per chunk
    expect(out).toHaveLength(3);
    expect(out[0].params).toHaveLength(6);
    expect(out[2].params).toHaveLength(3);
    // every chunk starts again at $1
    for (const s of out) expect(s.sql).toContain("VALUES ($1,$2,$3)");
    // nothing is lost or duplicated
    expect(out.flatMap((s) => s.params)).toEqual(rows.flat());
  });

  it("keeps every parameter within the cap for a realistic entry_rows load", () => {
    const cols = ["id", "day_id", "block_id", "tapper_id", "product_mode", "status",
                  "reason", "tapped_despite_rain", "trees_scheduled", "trees_tapped",
                  "wet_sheets", "scrap_kg", "tare_kg"];
    const rows = Array.from({ length: 9855 }, (_, i) => cols.map(() => i));
    const out = chunkInsert("entry_rows", cols, rows);
    expect(out.length).toBeLessThan(200);
    for (const s of out) {
      expect(s.params.length).toBeLessThanOrEqual(800);
      // highest placeholder must equal the parameter count
      const nums = [...s.sql.matchAll(/\$(\d+)/g)].map((m) => Number(m[1]));
      expect(Math.max(...nums)).toBe(s.params.length);
    }
    expect(out.flatMap((s) => s.params)).toHaveLength(9855 * cols.length);
  });

  it("returns nothing for an empty set", () => {
    expect(chunkInsert("t", ["a"], [])).toEqual([]);
  });
});

describe("bulk import — sales consume barrels", () => {
  const SAL_HEAD = ["InvoiceNo","Date","Buyer","Grade","Qty","Rate","DRC","Status","Barrels"];

  it("reads the barrels a latex sale went out in", async () => {
    const res = await parse({
      [SHEETS.register]: [REG_HEAD],
      [SHEETS.sales]: [
        SAL_HEAD,
        ["L/1","2024-06-04","Nagercoil Rubber Agencies","Field Latex",390,178,32,"Final","BR-1:200, BR-2:190"],
      ],
    });
    expect(res.errors).toEqual([]);
    expect(res.sales[0].barrels).toEqual([
      { barrelCode: "BR-1", kg: 200 },
      { barrelCode: "BR-2", kg: 190 },
    ]);
  });

  it("rejects barrel weights that do not add up to the sale qty", async () => {
    const res = await parse({
      [SHEETS.register]: [REG_HEAD],
      [SHEETS.sales]: [
        SAL_HEAD,
        ["L/1","2024-06-04","Nagercoil Rubber Agencies","Field Latex",500,178,32,"Final","BR-1:200, BR-2:190"],
      ],
    });
    expect(res.errors.some((e) => /must equal qty/i.test(e.message))).toBe(true);
    expect(res.sales).toHaveLength(0);
  });

  it("warns when a latex sale names no barrels, since none would be emptied", async () => {
    const res = await parse({
      [SHEETS.register]: [REG_HEAD],
      [SHEETS.sales]: [
        SAL_HEAD,
        ["L/1","2024-06-04","Nagercoil Rubber Agencies","Field Latex",390,178,32,"Final",""],
      ],
    });
    expect(res.errors).toEqual([]);
    expect(res.warnings.some((w) => /not be emptied/i.test(w.message))).toBe(true);
  });

  it("does not warn for a sheet sale, which has no barrels", async () => {
    const res = await parse({
      [SHEETS.register]: [REG_HEAD],
      [SHEETS.sales]: [
        SAL_HEAD,
        ["S/1","2024-06-04","Nagercoil Rubber Agencies","RSS4",500,195,"","Final",""],
      ],
    });
    expect(res.warnings).toEqual([]);
  });

  it("collects barrels named on a sale that the estate does not have", async () => {
    const res = await parse({
      [SHEETS.register]: [REG_HEAD],
      [SHEETS.sales]: [
        SAL_HEAD,
        ["L/1","2024-06-04","Nagercoil Rubber Agencies","Field Latex",100,178,32,"Final","BR-99:100"],
      ],
    });
    expect(res.unknown.barrels).toEqual(["BR-99"]);
  });
});

describe("bulk import — payments", () => {
  it("reads buyer payments and links them to an invoice", async () => {
    const res = await parse({
      [SHEETS.register]: [REG_HEAD],
      [SHEETS.payments]: [
        ["Date","Buyer","Amount","Type","InvoiceNo","Note"],
        ["2024-06-10","Nagercoil Rubber Agencies",250000,"Settlement","L/1",""],
      ],
    });
    expect(res.errors).toEqual([]);
    expect(res.payments).toHaveLength(1);
    expect(res.payments[0].amount).toBe(250000);
    expect(res.payments[0].invoiceNo).toBe("L/1");
  });

  it("defaults the payment type to Settlement", async () => {
    const res = await parse({
      [SHEETS.register]: [REG_HEAD],
      [SHEETS.payments]: [
        ["Date","Buyer","Amount","Type"],
        ["2024-06-10","Nagercoil Rubber Agencies",1000,""],
      ],
    });
    expect(res.payments[0].type).toBe("Settlement");
  });

  it("rejects a payment with no amount or no party", async () => {
    const res = await parse({
      [SHEETS.register]: [REG_HEAD],
      [SHEETS.payments]: [
        ["Date","Buyer","Amount"],
        ["2024-06-10","",5000],
        ["2024-06-11","Nagercoil Rubber Agencies",0],
      ],
      [SHEETS.vendorPayments]: [
        ["Date","Vendor","Amount","Note"],
        ["2024-06-12","Marthandam Farm Inputs",-5,""],
      ],
    });
    expect(res.errors.some((e) => /missing buyer/i.test(e.message))).toBe(true);
    expect(res.errors.filter((e) => /more than zero/i.test(e.message))).toHaveLength(2);
  });

  it("reads vendor payments", async () => {
    const res = await parse({
      [SHEETS.register]: [REG_HEAD],
      [SHEETS.vendorPayments]: [
        ["Date","Vendor","Amount","Note"],
        ["2024-06-12","Marthandam Farm Inputs",15750,"cheque"],
      ],
    });
    expect(res.errors).toEqual([]);
    expect(res.vendorPayments[0].amount).toBe(15750);
    expect(res.vendorPayments[0].note).toBe("cheque");
  });
});
