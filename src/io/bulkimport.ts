import ExcelJS from "exceljs";
import { save, open } from "@tauri-apps/plugin-dialog";
import { writeFile, readFile } from "@tauri-apps/plugin-fs";
import type { Estate } from "../domain/types";

/**
 * Bulk import — years of history in one workbook.
 *
 * Day Pack carries a single day from field to office. This is the other end of
 * the problem: an estate that already has two or three years on paper (or in a
 * spreadsheet) and wants it all in at once.
 *
 * The file is read, validated and summarised first; nothing touches the
 * database until the review screen is confirmed.
 */

export const BULK_VERSION = 1;

export const SHEETS = {
  register: "Daily Register",
  labour: "Labour",
  smokehouse: "Smokehouse",
  sales: "Sales",
  purchases: "Purchases",
  cash: "Cash Book",
  payments: "Buyer Payments",
  vendorPayments: "Vendor Payments",
} as const;

export interface RowIssue {
  sheet: string;
  row: number;
  message: string;
}

export interface DayDraft {
  date: string;
  weather: string;
  supervisor: string;
  remarks: string;
  rows: EntryDraft[];
}

export interface EntryDraft {
  sheetRow: number;
  blockCode: string;
  tapperName: string;
  productMode: "Latex" | "Sheet";
  status: "Completed" | "Not Done";
  reason: string;
  tappedDespiteRain: boolean;
  treesScheduled: number;
  treesTapped: number;
  tareKg: number;
  buckets: { label: string; kg: number }[];
  wetSheets: number;
  scrapKg: number;
  barrels: { barrelCode: string; kg: number }[];
}

export interface LabourDraft {
  date: string;
  name: string;
  sex: string;
  men: number;
  women: number;
  work_type: string;
  who: string;
  where_: string;
}

export interface SmokeDraft {
  date: string;
  wetIn: number;
  dryOut: number;
  person: string;
  note: string;
}

export interface SaleDraft {
  sheetRow: number;
  invoiceNo: string;
  date: string;
  buyer: string;
  grade: string;
  qty: number;
  rate: number;
  drc: number | null;
  status: "Final" | "Pending DRC";
  note: string;
  /** Latex leaves the estate in barrels; naming them here is what empties
   *  those barrels so they can be filled again. */
  barrels: { barrelCode: string; kg: number }[];
}

export interface PaymentDraft {
  sheetRow: number;
  date: string;
  buyer: string;
  amount: number;
  type: string;
  note: string;
  invoiceNo: string;
}

export interface VendorPaymentDraft {
  sheetRow: number;
  date: string;
  vendor: string;
  amount: number;
  note: string;
}

export interface PurchaseDraft {
  sheetRow: number;
  billNo: string;
  date: string;
  vendor: string;
  item: string;
  categoryCode: string;
  qty: number;
  unit: string;
  rate: number;
  note: string;
}

export interface CashDraft {
  date: string;
  particulars: string;
  categoryCode: string;
  sub: string;
  income: number;
  expense: number;
}

export interface BulkParsed {
  filename: string;
  days: DayDraft[];
  labour: LabourDraft[];
  smokehouse: SmokeDraft[];
  sales: SaleDraft[];
  purchases: PurchaseDraft[];
  cash: CashDraft[];
  payments: PaymentDraft[];
  vendorPayments: VendorPaymentDraft[];
  errors: RowIssue[];
  warnings: RowIssue[];
  unknown: {
    blocks: string[];
    tappers: string[];
    barrels: string[];
    buyers: string[];
    vendors: string[];
  };
  dateRange: { from: string; to: string } | null;
  entryRowCount: number;
}

export interface KnownMasters {
  blocks: string[];
  tappers: string[];
  barrels: string[];
  buyers: string[];
  vendors: string[];
  purchaseCats: { code: string; label: string }[];
  expenseCats: { code: string; label: string }[];
}

/** How a master's name or code is matched. Must be exactly the key the commit
 *  step looks rows up by (trim + lower-case): a looser key here would call a
 *  name "known" that the commit then cannot find, silently dropping its rows. */
function nameKey(s: unknown): string {
  return String(s ?? "").trim().toLowerCase();
}

/* ------------------------------------------------------------------ utils */

/** Headers are matched loosely so "Trees Tapped", "TreesTapped" and
 *  "trees_tapped" all land on the same column. */
function norm(s: unknown): string {
  return String(s ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}

function headerMap(ws: ExcelJS.Worksheet): Map<string, number> {
  const map = new Map<string, number>();
  const row = ws.getRow(1);
  row.eachCell((cell, col) => {
    const k = norm(cell.value);
    if (k && !map.has(k)) map.set(k, col);
  });
  return map;
}

function cellText(ws: ExcelJS.Worksheet, r: number, col: number | undefined): string {
  if (!col) return "";
  const v = ws.getRow(r).getCell(col).value;
  if (v === null || v === undefined) return "";
  if (typeof v === "object" && v !== null) {
    const o = v as { text?: string; result?: unknown; richText?: { text: string }[] };
    if (Array.isArray(o.richText)) return o.richText.map((t) => t.text).join("");
    if (o.text !== undefined) return String(o.text);
    if (o.result !== undefined) return String(o.result);
  }
  return String(v).trim();
}

function cellNum(ws: ExcelJS.Worksheet, r: number, col: number | undefined): number {
  const t = cellText(ws, r, col).replace(/,/g, "");
  if (t === "") return 0;
  const n = Number(t);
  return Number.isFinite(n) ? n : 0;
}

/** Accepts a real Excel date, an ISO string, or dd/mm/yyyy and dd-mm-yyyy. */
export function coerceDate(ws: ExcelJS.Worksheet, r: number, col: number | undefined): string {
  if (!col) return "";
  const v = ws.getRow(r).getCell(col).value;
  if (v instanceof Date) {
    const y = v.getFullYear();
    const m = String(v.getMonth() + 1).padStart(2, "0");
    const d = String(v.getDate()).padStart(2, "0");
    return `${y}-${m}-${d}`;
  }
  const s = String(v ?? "").trim();
  if (!s) return "";
  let m = /^(\d{4})-(\d{1,2})-(\d{1,2})/.exec(s);
  if (m) return `${m[1]}-${m[2].padStart(2, "0")}-${m[3].padStart(2, "0")}`;
  m = /^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/.exec(s);
  if (m) return `${m[3]}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}`;
  return "";
}

function isValidDate(iso: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) return false;
  const [y, m, d] = iso.split("-").map(Number);
  if (m < 1 || m > 12 || d < 1 || d > 31) return false;
  const dt = new Date(y, m - 1, d);
  return dt.getFullYear() === y && dt.getMonth() === m - 1 && dt.getDate() === d;
}

/** "BR-12:150, BR-13:50" -> [{barrelCode:"BR-12", kg:150}, ...] */
export function parsePairs(raw: string): { code: string; kg: number }[] {
  if (!raw.trim()) return [];
  return raw
    .split(/[,;]/)
    .map((part) => {
      const [code, kg] = part.split(":");
      return { code: (code ?? "").trim(), kg: Number((kg ?? "").trim()) || 0 };
    })
    .filter((p) => p.code !== "");
}

function lastRow(ws: ExcelJS.Worksheet): number {
  return ws.actualRowCount > 0 ? ws.rowCount : 1;
}

/* ------------------------------------------------------------------ parse */

export async function parseBulkWorkbook(
  bytes: Uint8Array,
  filename: string,
  known: KnownMasters
): Promise<BulkParsed> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(bytes as unknown as ExcelJS.Buffer);

  const errors: RowIssue[] = [];
  const warnings: RowIssue[] = [];
  const unknownBlocks = new Set<string>();
  const unknownTappers = new Set<string>();
  const unknownBarrels = new Set<string>();
  const unknownBuyers = new Set<string>();
  const unknownVendors = new Set<string>();

  const blockSet = new Set(known.blocks.map(nameKey));
  const tapperSet = new Set(known.tappers.map(nameKey));
  const barrelSet = new Set(known.barrels.map(nameKey));
  const buyerSet = new Set(known.buyers.map(nameKey));
  const vendorSet = new Set(known.vendors.map(nameKey));

  const catByLabel = new Map<string, string>();
  for (const c of known.purchaseCats) catByLabel.set(norm(c.label), c.code);
  const expByLabel = new Map<string, string>();
  for (const c of known.expenseCats) expByLabel.set(norm(c.label), c.code);

  const dayMap = new Map<string, DayDraft>();
  const labour: LabourDraft[] = [];
  const smokehouse: SmokeDraft[] = [];
  const sales: SaleDraft[] = [];
  const purchases: PurchaseDraft[] = [];
  const cash: CashDraft[] = [];
  const payments: PaymentDraft[] = [];
  const vendorPayments: VendorPaymentDraft[] = [];
  const allDates: string[] = [];

  /* ---------------------------------------------------- Daily Register */
  const reg = wb.getWorksheet(SHEETS.register);
  if (!reg) {
    errors.push({
      sheet: SHEETS.register,
      row: 0,
      message: `Sheet "${SHEETS.register}" not found. Download the template and use its sheet names.`,
    });
  } else {
    const h = headerMap(reg);
    const need = ["date", "block"];
    for (const n of need) {
      if (!h.has(n))
        errors.push({
          sheet: SHEETS.register,
          row: 1,
          message: `Missing required column "${n}".`,
        });
    }
    const end = lastRow(reg);
    for (let r = 2; r <= end; r++) {
      const date = coerceDate(reg, r, h.get("date"));
      const blockCode = cellText(reg, r, h.get("block"));
      if (!date && !blockCode) continue; // blank spacer row
      if (!isValidDate(date)) {
        errors.push({ sheet: SHEETS.register, row: r, message: `Bad or missing date.` });
        continue;
      }
      if (!blockCode) {
        errors.push({ sheet: SHEETS.register, row: r, message: `Missing block code.` });
        continue;
      }
      if (!blockSet.has(nameKey(blockCode))) unknownBlocks.add(blockCode);

      const tapperName = cellText(reg, r, h.get("tapper"));
      if (tapperName && !tapperSet.has(nameKey(tapperName))) unknownTappers.add(tapperName);

      const modeRaw = cellText(reg, r, h.get("mode"));
      const productMode: "Latex" | "Sheet" = norm(modeRaw) === "sheet" ? "Sheet" : "Latex";
      const statusRaw = cellText(reg, r, h.get("status"));
      const status: "Completed" | "Not Done" =
        norm(statusRaw) === "notdone" ? "Not Done" : "Completed";

      const treesScheduled = cellNum(reg, r, h.get("treesscheduled"));
      const treesTapped = cellNum(reg, r, h.get("treestapped"));
      const scrapKg = cellNum(reg, r, h.get("scrapkg"));
      const wetSheets = cellNum(reg, r, h.get("wetsheets"));
      const tareKg = cellNum(reg, r, h.get("tarekg"));

      for (const [label, val] of [
        ["Trees scheduled", treesScheduled],
        ["Trees tapped", treesTapped],
        ["Scrap kg", scrapKg],
        ["Wet sheets", wetSheets],
      ] as [string, number][]) {
        if (val < 0)
          errors.push({ sheet: SHEETS.register, row: r, message: `${label} cannot be negative.` });
      }
      if (treesTapped > treesScheduled && treesScheduled > 0) {
        warnings.push({
          sheet: SHEETS.register,
          row: r,
          message: `Trees tapped (${treesTapped}) is more than scheduled (${treesScheduled}).`,
        });
      }

      const buckets: { label: string; kg: number }[] = [];
      const b1 = cellNum(reg, r, h.get("bucket1"));
      const b2 = cellNum(reg, r, h.get("bucket2"));
      if (b1 > 0) buckets.push({ label: "Bucket 1", kg: b1 });
      if (b2 > 0) buckets.push({ label: "Bucket 2", kg: b2 });

      const barrels = parsePairs(cellText(reg, r, h.get("barrels"))).map((p) => ({
        barrelCode: p.code,
        kg: p.kg,
      }));
      for (const b of barrels) {
        if (!barrelSet.has(nameKey(b.barrelCode))) unknownBarrels.add(b.barrelCode);
      }

      if (status === "Not Done" && (b1 > 0 || b2 > 0 || barrels.length > 0)) {
        warnings.push({
          sheet: SHEETS.register,
          row: r,
          message: `Row is Not Done but carries weights — the weights will be imported anyway.`,
        });
      }

      let day = dayMap.get(date);
      if (!day) {
        day = {
          date,
          weather: cellText(reg, r, h.get("weather")),
          supervisor: cellText(reg, r, h.get("supervisor")),
          remarks: cellText(reg, r, h.get("remarks")),
          rows: [],
        };
        dayMap.set(date, day);
        allDates.push(date);
      }
      if (day.rows.some((x) => norm(x.blockCode) === norm(blockCode))) {
        errors.push({
          sheet: SHEETS.register,
          row: r,
          message: `Block ${blockCode} appears twice on ${date}.`,
        });
        continue;
      }
      day.rows.push({
        sheetRow: r,
        blockCode,
        tapperName,
        productMode,
        status,
        reason: cellText(reg, r, h.get("reason")),
        tappedDespiteRain: /^(y|yes|true|1)$/i.test(
          cellText(reg, r, h.get("tappeddespiterain"))
        ),
        treesScheduled,
        treesTapped,
        tareKg,
        buckets,
        wetSheets,
        scrapKg,
        barrels,
      });
    }
  }

  /* ----------------------------------------------------------- Labour */
  const lab = wb.getWorksheet(SHEETS.labour);
  if (lab) {
    const h = headerMap(lab);
    const end = lastRow(lab);
    for (let r = 2; r <= end; r++) {
      const date = coerceDate(lab, r, h.get("date"));
      const name = cellText(lab, r, h.get("name"));
      const work = cellText(lab, r, h.get("worktype"));
      const men = cellNum(lab, r, h.get("men"));
      const women = cellNum(lab, r, h.get("women"));
      if (!date && !name && !work && !men && !women) continue;
      if (!isValidDate(date)) {
        errors.push({ sheet: SHEETS.labour, row: r, message: `Bad or missing date.` });
        continue;
      }
      labour.push({
        date,
        name,
        sex: cellText(lab, r, h.get("sex")),
        men,
        women,
        work_type: work,
        who: cellText(lab, r, h.get("who")),
        where_: cellText(lab, r, h.get("where")),
      });
      allDates.push(date);
    }
  }

  /* ------------------------------------------------------- Smokehouse */
  const sm = wb.getWorksheet(SHEETS.smokehouse);
  if (sm) {
    const h = headerMap(sm);
    const end = lastRow(sm);
    for (let r = 2; r <= end; r++) {
      const date = coerceDate(sm, r, h.get("date"));
      const wetIn = cellNum(sm, r, h.get("wetin"));
      const dryOut = cellNum(sm, r, h.get("dryout"));
      if (!date && !wetIn && !dryOut) continue;
      if (!isValidDate(date)) {
        errors.push({ sheet: SHEETS.smokehouse, row: r, message: `Bad or missing date.` });
        continue;
      }
      if (!wetIn && !dryOut) {
        warnings.push({
          sheet: SHEETS.smokehouse,
          row: r,
          message: `Neither wet in nor dry out — row skipped.`,
        });
        continue;
      }
      smokehouse.push({
        date,
        wetIn,
        dryOut,
        person: cellText(sm, r, h.get("person")) || "Estate",
        note: cellText(sm, r, h.get("note")),
      });
      allDates.push(date);
    }
  }

  /* ------------------------------------------------------------ Sales */
  const sal = wb.getWorksheet(SHEETS.sales);
  if (sal) {
    const h = headerMap(sal);
    const end = lastRow(sal);
    const seen = new Set<string>();
    for (let r = 2; r <= end; r++) {
      const date = coerceDate(sal, r, h.get("date"));
      const invoiceNo = cellText(sal, r, h.get("invoiceno"));
      const buyer = cellText(sal, r, h.get("buyer"));
      if (!date && !invoiceNo && !buyer) continue;
      if (!isValidDate(date)) {
        errors.push({ sheet: SHEETS.sales, row: r, message: `Bad or missing date.` });
        continue;
      }
      if (!invoiceNo) {
        errors.push({ sheet: SHEETS.sales, row: r, message: `Missing invoice number.` });
        continue;
      }
      if (seen.has(norm(invoiceNo))) {
        errors.push({
          sheet: SHEETS.sales,
          row: r,
          message: `Invoice ${invoiceNo} appears more than once in this file.`,
        });
        continue;
      }
      seen.add(norm(invoiceNo));
      if (buyer && !buyerSet.has(nameKey(buyer))) unknownBuyers.add(buyer);

      const qty = cellNum(sal, r, h.get("qty"));
      const rate = cellNum(sal, r, h.get("rate"));
      const drcRaw = cellText(sal, r, h.get("drc"));
      const drc = drcRaw === "" ? null : Number(drcRaw.replace("%", ""));
      if (qty < 0 || rate < 0)
        errors.push({ sheet: SHEETS.sales, row: r, message: `Qty and rate cannot be negative.` });
      if (drc !== null && (Number.isNaN(drc) || drc <= 0 || drc > 100))
        errors.push({ sheet: SHEETS.sales, row: r, message: `DRC must be between 0 and 100.` });

      const statusRaw = norm(cellText(sal, r, h.get("status")));
      const status: "Final" | "Pending DRC" =
        statusRaw === "pendingdrc" || (drc === null && /latex/i.test(cellText(sal, r, h.get("grade"))))
          ? "Pending DRC"
          : "Final";

      const saleBarrels = parsePairs(cellText(sal, r, h.get("barrels"))).map((p) => ({
        barrelCode: p.code,
        kg: p.kg,
      }));
      for (const b of saleBarrels) {
        if (!barrelSet.has(nameKey(b.barrelCode))) unknownBarrels.add(b.barrelCode);
      }
      // A latex sale is built from barrels, so the weights have to agree —
      // otherwise the barrels would not empty by the amount that was sold.
      if (saleBarrels.length) {
        const sum = saleBarrels.reduce((t, b) => t + b.kg, 0);
        if (Math.abs(sum - qty) > 0.05) {
          errors.push({
            sheet: SHEETS.sales,
            row: r,
            message: `Barrel weights (${sum.toFixed(2)} kg) must equal qty (${qty.toFixed(2)} kg).`,
          });
          continue;
        }
      } else if (/latex/i.test(cellText(sal, r, h.get("grade")))) {
        warnings.push({
          sheet: SHEETS.sales,
          row: r,
          message: `Latex sale with no barrels listed — the barrels it came from will not be emptied.`,
        });
      }

      sales.push({
        sheetRow: r,
        invoiceNo,
        date,
        buyer,
        grade: cellText(sal, r, h.get("grade")),
        qty,
        rate,
        drc: drc !== null && Number.isFinite(drc) ? drc : null,
        status,
        note: cellText(sal, r, h.get("note")),
        barrels: saleBarrels,
      });
      allDates.push(date);
    }
  }

  /* -------------------------------------------------------- Purchases */
  const pur = wb.getWorksheet(SHEETS.purchases);
  if (pur) {
    const h = headerMap(pur);
    const end = lastRow(pur);
    const seen = new Set<string>();
    for (let r = 2; r <= end; r++) {
      const date = coerceDate(pur, r, h.get("date"));
      const billNo = cellText(pur, r, h.get("billno"));
      const item = cellText(pur, r, h.get("item"));
      if (!date && !billNo && !item) continue;
      if (!isValidDate(date)) {
        errors.push({ sheet: SHEETS.purchases, row: r, message: `Bad or missing date.` });
        continue;
      }
      if (!billNo) {
        errors.push({ sheet: SHEETS.purchases, row: r, message: `Missing bill number.` });
        continue;
      }
      if (seen.has(norm(billNo))) {
        errors.push({
          sheet: SHEETS.purchases,
          row: r,
          message: `Bill ${billNo} appears more than once in this file.`,
        });
        continue;
      }
      seen.add(norm(billNo));
      const vendor = cellText(pur, r, h.get("vendor"));
      if (vendor && !vendorSet.has(nameKey(vendor))) unknownVendors.add(vendor);

      const catText = cellText(pur, r, h.get("category"));
      let categoryCode = "";
      if (catText) {
        categoryCode =
          catByLabel.get(norm(catText)) ??
          (known.purchaseCats.find((c) => norm(c.code) === norm(catText))?.code ?? "");
        if (!categoryCode) {
          warnings.push({
            sheet: SHEETS.purchases,
            row: r,
            message: `Unknown category "${catText}" — the bill imports without one.`,
          });
        }
      }

      purchases.push({
        sheetRow: r,
        billNo,
        date,
        vendor,
        item,
        categoryCode,
        qty: cellNum(pur, r, h.get("qty")),
        unit: cellText(pur, r, h.get("unit")) || "kg",
        rate: cellNum(pur, r, h.get("rate")),
        note: cellText(pur, r, h.get("note")),
      });
      allDates.push(date);
    }
  }

  /* --------------------------------------------------------- CashBook */
  const cb = wb.getWorksheet(SHEETS.cash);
  if (cb) {
    const h = headerMap(cb);
    const end = lastRow(cb);
    for (let r = 2; r <= end; r++) {
      const date = coerceDate(cb, r, h.get("date"));
      const particulars = cellText(cb, r, h.get("particulars"));
      const income = cellNum(cb, r, h.get("income"));
      const expense = cellNum(cb, r, h.get("expense"));
      if (!date && !particulars && !income && !expense) continue;
      if (!isValidDate(date)) {
        errors.push({ sheet: SHEETS.cash, row: r, message: `Bad or missing date.` });
        continue;
      }
      if (!particulars) {
        errors.push({ sheet: SHEETS.cash, row: r, message: `Missing particulars.` });
        continue;
      }
      const catText = cellText(cb, r, h.get("category"));
      const categoryCode = catText
        ? (expByLabel.get(norm(catText)) ??
          (known.expenseCats.find((c) => norm(c.code) === norm(catText))?.code ?? ""))
        : "";
      cash.push({
        date,
        particulars,
        categoryCode,
        sub: cellText(cb, r, h.get("sub")),
        income,
        expense,
      });
      allDates.push(date);
    }
  }

  /* -------------------------------------------------- Buyer payments */
  const pay = wb.getWorksheet(SHEETS.payments);
  if (pay) {
    const h = headerMap(pay);
    const end = lastRow(pay);
    for (let r = 2; r <= end; r++) {
      const date = coerceDate(pay, r, h.get("date"));
      const buyer = cellText(pay, r, h.get("buyer"));
      const amount = cellNum(pay, r, h.get("amount"));
      if (!date && !buyer && !amount) continue;
      if (!isValidDate(date)) {
        errors.push({ sheet: SHEETS.payments, row: r, message: `Bad or missing date.` });
        continue;
      }
      if (!buyer) {
        errors.push({ sheet: SHEETS.payments, row: r, message: `Missing buyer.` });
        continue;
      }
      if (amount <= 0) {
        errors.push({ sheet: SHEETS.payments, row: r, message: `Amount must be more than zero.` });
        continue;
      }
      if (!buyerSet.has(nameKey(buyer))) unknownBuyers.add(buyer);
      payments.push({
        sheetRow: r,
        date,
        buyer,
        amount,
        type: cellText(pay, r, h.get("type")) || "Settlement",
        note: cellText(pay, r, h.get("note")),
        invoiceNo: cellText(pay, r, h.get("invoiceno")),
      });
      allDates.push(date);
    }
  }

  /* ------------------------------------------------- Vendor payments */
  const vpay = wb.getWorksheet(SHEETS.vendorPayments);
  if (vpay) {
    const h = headerMap(vpay);
    const end = lastRow(vpay);
    for (let r = 2; r <= end; r++) {
      const date = coerceDate(vpay, r, h.get("date"));
      const vendor = cellText(vpay, r, h.get("vendor"));
      const amount = cellNum(vpay, r, h.get("amount"));
      if (!date && !vendor && !amount) continue;
      if (!isValidDate(date)) {
        errors.push({ sheet: SHEETS.vendorPayments, row: r, message: `Bad or missing date.` });
        continue;
      }
      if (!vendor) {
        errors.push({ sheet: SHEETS.vendorPayments, row: r, message: `Missing vendor.` });
        continue;
      }
      if (amount <= 0) {
        errors.push({ sheet: SHEETS.vendorPayments, row: r, message: `Amount must be more than zero.` });
        continue;
      }
      if (!vendorSet.has(nameKey(vendor))) unknownVendors.add(vendor);
      vendorPayments.push({
        sheetRow: r,
        date,
        vendor,
        amount,
        note: cellText(vpay, r, h.get("note")),
      });
      allDates.push(date);
    }
  }

  const sorted = allDates.filter(Boolean).sort();
  const days = [...dayMap.values()].sort((a, b) => (a.date < b.date ? -1 : 1));

  return {
    filename,
    days,
    labour,
    smokehouse,
    sales,
    purchases,
    cash,
    payments,
    vendorPayments,
    errors,
    warnings,
    unknown: {
      blocks: [...unknownBlocks],
      tappers: [...unknownTappers],
      barrels: [...unknownBarrels],
      buyers: [...unknownBuyers],
      vendors: [...unknownVendors],
    },
    dateRange: sorted.length ? { from: sorted[0], to: sorted[sorted.length - 1] } : null,
    entryRowCount: days.reduce((s, d) => s + d.rows.length, 0),
  };
}

export async function pickAndReadBulkWorkbook(
  known: KnownMasters
): Promise<BulkParsed | null> {
  const path = await open({
    title: "Choose a history workbook",
    multiple: false,
    filters: [{ name: "Excel", extensions: ["xlsx"] }],
  });
  if (!path || typeof path !== "string") return null;
  const bytes = await readFile(path);
  const filename = path.split(/[\\/]/).pop() ?? "import.xlsx";
  return parseBulkWorkbook(bytes, filename, known);
}

/* ------------------------------------------------------------ sql batching */

export interface InsertStmt {
  sql: string;
  params: (string | number | boolean | null)[];
}

/**
 * Builds multi-row INSERTs.
 *
 * A three-year import is tens of thousands of rows; sending one statement each
 * would mean as many round trips across the Tauri bridge. Batching them keeps
 * the whole import to a few hundred statements. SQLite caps bound parameters
 * per statement, so each chunk stays well under that limit.
 */
export function chunkInsert(
  table: string,
  cols: string[],
  rows: (string | number | boolean | null)[][],
  maxParams = 800
): InsertStmt[] {
  if (!rows.length) return [];
  const per = Math.max(1, Math.floor(maxParams / cols.length));
  const out: InsertStmt[] = [];
  for (let i = 0; i < rows.length; i += per) {
    const slice = rows.slice(i, i + per);
    const values = slice
      .map(
        (_, j) => "(" + cols.map((_, k) => `$${j * cols.length + k + 1}`).join(",") + ")"
      )
      .join(",");
    out.push({
      sql: `INSERT INTO ${table} (${cols.join(",")}) VALUES ${values}`,
      params: slice.flat(),
    });
  }
  return out;
}

/* --------------------------------------------------------------- template */

const HEAD_FILL = "FFEDE6D3";
const HEAD_FONT = "FF1F3D2E";

function styleHead(ws: ExcelJS.Worksheet) {
  const row = ws.getRow(1);
  row.eachCell((c) => {
    c.font = { bold: true, color: { argb: HEAD_FONT }, size: 10 };
    c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: HEAD_FILL } };
    c.border = {
      top: { style: "thin", color: { argb: "FFE4DCC8" } },
      left: { style: "thin", color: { argb: "FFE4DCC8" } },
      bottom: { style: "thin", color: { argb: "FFE4DCC8" } },
      right: { style: "thin", color: { argb: "FFE4DCC8" } },
    };
  });
  row.commit();
  ws.views = [{ state: "frozen", ySplit: 1 }];
}

/** A blank workbook with the right sheets, headers and one worked example row. */
export async function exportBulkTemplate(estate: Estate, known: KnownMasters) {
  const wb = new ExcelJS.Workbook();
  wb.creator = "Estate Ledger";
  wb.created = new Date();

  const info = wb.addWorksheet("Instructions");
  info.columns = [{ width: 24 }, { width: 94 }];
  const blocks = known.blocks.join(", ") || "(none set up yet)";
  const tappers = known.tappers.join(", ") || "(none set up yet)";
  const cats = known.purchaseCats.map((c) => c.label).join(", ");
  const exps = known.expenseCats.map((c) => c.label).join(", ");
  const lines: [string, string][] = [
    ["Estate Ledger", "Bulk history import template"],
    ["Estate", `${estate.name} (${estate.code})`],
    ["", ""],
    ["How to use", "Fill the sheets below and import from Reports & setup > Bulk import."],
    ["", "Every row you import belongs to the estate named above. Switch estate first if that is wrong."],
    ["", "Leave a sheet empty if you have nothing for it — only Daily Register is required."],
    ["", "Do not rename the sheets or the header row. Extra columns are ignored."],
    ["", "Nothing is written until you confirm the review screen."],
    ["", ""],
    ["Dates", "Any of 2024-06-01, 01/06/2024 or a real Excel date cell. One row per block per day."],
    ["Barrels", 'Write them as "BR-12:150, BR-13:50" — barrel code, colon, kilograms.'],
    ["", "On the Sales sheet, name the barrels the latex went out in. That is what empties"],
    ["", "them so they can be filled again — the estate only has so many barrels, and they"],
    ["", "come straight back from the shop. Barrel weights must add up to the sale qty."],
    ["Buckets", "Kulashekaram weighs two buckets gross; put the tare in Tare kg. Net is worked out for you."],
    ["Status", "Completed or Not Done. A Not Done row needs a reason."],
    ["Mode", "Latex or Sheet."],
    ["", ""],
    ["Your blocks", blocks],
    ["Your tappers", tappers],
    ["Purchase categories", cats],
    ["Expense categories", exps],
    ["", ""],
    ["Anything new", "Blocks, tappers, barrels, buyers and vendors that do not exist yet are listed"],
    ["", "on the review screen, and created for you when you confirm."],
    ["", ""],
    ["Template version", String(BULK_VERSION)],
  ];
  info.addRows(lines);
  info.getColumn(1).font = { bold: true };
  info.getRow(1).font = { bold: true, size: 13, color: { argb: "FF005F40" } };

  const reg = wb.addWorksheet(SHEETS.register);
  reg.columns = [
    { header: "Date", width: 12 },
    { header: "Block", width: 9 },
    { header: "Tapper", width: 15 },
    { header: "Mode", width: 9 },
    { header: "Status", width: 11 },
    { header: "Reason", width: 15 },
    { header: "TappedDespiteRain", width: 17 },
    { header: "TreesScheduled", width: 14 },
    { header: "TreesTapped", width: 13 },
    { header: "TareKg", width: 9 },
    { header: "Bucket1", width: 10 },
    { header: "Bucket2", width: 10 },
    { header: "WetSheets", width: 11 },
    { header: "ScrapKg", width: 10 },
    { header: "Barrels", width: 26 },
    { header: "Weather", width: 15 },
    { header: "Supervisor", width: 15 },
    { header: "Remarks", width: 24 },
  ];
  const egBlock = known.blocks[0] ?? "B1";
  const egTapper = known.tappers[0] ?? "";
  const egBarrel = known.barrels[0] ?? "BR-1";
  reg.addRow([
    "2024-06-01", egBlock, egTapper, "Latex", "Completed", "", "No",
    450, 450, 1.8, 30.5, 30.5, 0, 2.1, `${egBarrel}:59.2`, "Sunny", "", "Example row — delete it",
  ]);
  styleHead(reg);

  const lab = wb.addWorksheet(SHEETS.labour);
  lab.columns = [
    { header: "Date", width: 12 },
    { header: "Name", width: 18 },
    { header: "Sex", width: 7 },
    { header: "Men", width: 7 },
    { header: "Women", width: 8 },
    { header: "WorkType", width: 22 },
    { header: "Who", width: 15 },
    { header: "Where", width: 15 },
  ];
  lab.addRow(["2024-06-01", "", "", 2, 1, "Weeding", "Estate", egBlock]);
  styleHead(lab);

  const sm = wb.addWorksheet(SHEETS.smokehouse);
  sm.columns = [
    { header: "Date", width: 12 },
    { header: "WetIn", width: 9 },
    { header: "DryOut", width: 9 },
    { header: "Person", width: 15 },
    { header: "Note", width: 30 },
  ];
  sm.addRow(["2024-06-01", 40, 0, "Estate", ""]);
  styleHead(sm);

  const sal = wb.addWorksheet(SHEETS.sales);
  sal.columns = [
    { header: "InvoiceNo", width: 14 },
    { header: "Date", width: 12 },
    { header: "Buyer", width: 28 },
    { header: "Grade", width: 14 },
    { header: "Qty", width: 11 },
    { header: "Rate", width: 10 },
    { header: "DRC", width: 8 },
    { header: "Status", width: 13 },
    { header: "Barrels", width: 30 },
    { header: "Note", width: 24 },
  ];
  sal.addRow([
    `${estate.code}/L/001`, "2024-06-04", known.buyers[0] ?? "Buyer name",
    "Field Latex", 390, 178, 32.5, "Final",
    `${known.barrels[0] ?? "BR-1"}:200, ${known.barrels[1] ?? "BR-2"}:190`, "",
  ]);
  styleHead(sal);

  const pur = wb.addWorksheet(SHEETS.purchases);
  pur.columns = [
    { header: "BillNo", width: 14 },
    { header: "Date", width: 12 },
    { header: "Vendor", width: 26 },
    { header: "Item", width: 26 },
    { header: "Category", width: 16 },
    { header: "Qty", width: 10 },
    { header: "Unit", width: 8 },
    { header: "Rate", width: 10 },
    { header: "Note", width: 22 },
  ];
  pur.addRow([
    `${estate.code}/P/001`, "2024-06-06", known.vendors[0] ?? "Vendor name",
    "Rubber mixture", known.purchaseCats[0]?.label ?? "Fertiliser", 500, "kg", 31.5, "",
  ]);
  styleHead(pur);

  const cb = wb.addWorksheet(SHEETS.cash);
  cb.columns = [
    { header: "Date", width: 12 },
    { header: "Particulars", width: 34 },
    { header: "Category", width: 26 },
    { header: "Sub", width: 16 },
    { header: "Income", width: 13 },
    { header: "Expense", width: 13 },
  ];
  cb.addRow([
    "2024-06-07", "Tapper wages", known.expenseCats[0]?.label ?? "Tapper Wages", "Wages", 0, 12400,
  ]);
  styleHead(cb);

  const pay = wb.addWorksheet(SHEETS.payments);
  pay.columns = [
    { header: "Date", width: 12 },
    { header: "Buyer", width: 28 },
    { header: "Amount", width: 13 },
    { header: "Type", width: 16 },
    { header: "InvoiceNo", width: 14 },
    { header: "Note", width: 22 },
  ];
  pay.addRow([
    "2024-06-10", known.buyers[0] ?? "Buyer name", 250000, "Settlement",
    `${estate.code}/L/001`, "",
  ]);
  styleHead(pay);

  const vpay = wb.addWorksheet(SHEETS.vendorPayments);
  vpay.columns = [
    { header: "Date", width: 12 },
    { header: "Vendor", width: 28 },
    { header: "Amount", width: 13 },
    { header: "Note", width: 24 },
  ];
  vpay.addRow(["2024-06-12", known.vendors[0] ?? "Vendor name", 15750, ""]);
  styleHead(vpay);

  const buffer = await wb.xlsx.writeBuffer();
  const path = await save({
    title: "Save bulk import template",
    defaultPath: `${estate.name}_BulkImport_Template.xlsx`,
    filters: [{ name: "Excel", extensions: ["xlsx"] }],
  });
  if (!path) return false;
  await writeFile(path, new Uint8Array(buffer));
  return true;
}
