import { Fragment, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import {
  AlertTriangle,
  CheckCircle2,
  FileSpreadsheet,
  Plus,
  Trash2,
  UserPlus,
  Wand2,
} from "lucide-react";
import ExcelJS from "exceljs";
import { save } from "@tauri-apps/plugin-dialog";
import { writeFile } from "@tauri-apps/plugin-fs";
import { useApp } from "../app/store";
import { useMasters, useQuery } from "../db/hooks";
import { execute, logAudit, nextSequence, select } from "../db/client";
import {
  Badge,
  Card,
  Confirm,
  EmptyState,
  Field,
  KPI,
  Modal,
  PageHeader,
  PhotoField,
  PhotoThumb,
  Pill,
} from "../ui/components";
import { fmtDate, fmtMoney, fmtNum, monthRange, todayISO } from "../domain/dates";
import {
  billedQty,
  invoiceBillingQty,
  isPaperRateGapWorseThanUsual,
  latexValue,
  paperRateGap,
  simpleValue,
} from "../domain/valuation";
import { ALLOC_TOLERANCE, fillStatus } from "../domain/latex";
import {
  LEDGER_FILTERS,
  groupLedgerRows,
  ledgerTotals,
  paymentGroup,
} from "../domain/ledger";
import type { LedgerGroup } from "../domain/ledger";
import type { Invoice, Payment, StockLedgerRow } from "../domain/types";

interface BarrelCalc {
  id: number;
  code: string;
  capacity: number;
  poured: number;
  manual_kg: number;
  sold_kg: number;
  disp_kg: number;
  first_pour: string | null;
}

interface LedLine {
  date: string;
  type: string;
  ref: string;
  debit: number;
  credit: number;
}

function styleHeader(row: ExcelJS.Row) {
  row.eachCell((c) => {
    c.font = { bold: true, color: { argb: "FF1F3D2E" }, size: 10 };
    c.fill = {
      type: "pattern",
      pattern: "solid",
      fgColor: { argb: "FFEDE6D3" },
    };
    c.border = {
      top: { style: "thin", color: { argb: "FFE4DCC8" } },
      left: { style: "thin", color: { argb: "FFE4DCC8" } },
      bottom: { style: "thin", color: { argb: "FFE4DCC8" } },
      right: { style: "thin", color: { argb: "FFE4DCC8" } },
    };
    c.alignment = { vertical: "middle", wrapText: false };
  });
}

function sheetName(n: string, i: number): string {
  const s = (n || `Sheet${i}`).replace(/[\\/?*[\]:]/g, " ").trim();
  return (s || `Sheet${i}`).slice(0, 31);
}

type Tab = "stock" | "dispatch" | "sale" | "invoices" | "ledger" | "summary";

export function StockHubPage(props: { hub: "latex" | "sheet" | "scrap" | "othercrop" }) {
  const { t } = useTranslation();
  const estate = useApp((s) => s.estate)!;
  const user = useApp((s) => s.user);
  const bump = useApp((s) => s.bump);
  const m = useMasters(estate.id);
  const hub = props.hub;
  const profile = estate.profile;

  const [tab, setTab] = useState<Tab>("stock");

  const sheetGrades = useMemo(() => {
    const g = [...profile.fixedSheetGrades];
    if (!g.includes("Ungraded")) g.push("Ungraded");
    return g;
  }, [profile.fixedSheetGrades]);

  const hubPattern =
    hub === "latex" ? "latex" : hub === "scrap" ? "scrap" : hub === "sheet" ? "sheet:%" : "crop:%";

  const barrelsQ = useQuery(
    () =>
      select<BarrelCalc>(
        "SELECT b.id, b.code, b.capacity, " +
          "COALESCE((SELECT SUM(bb.kg) FROM entry_row_barrels bb WHERE bb.barrel_id=b.id),0) AS poured, " +
          "COALESCE((SELECT SUM(s.qty_delta) FROM stock_ledger s WHERE s.estate_id=$1 AND s.hub='latex' AND s.reason='manual' AND s.ref_id=b.id),0) AS manual_kg, " +
          "COALESCE((SELECT SUM(ib.kg) FROM invoice_barrels ib WHERE ib.barrel_id=b.id),0) AS sold_kg, " +
          "COALESCE((SELECT SUM(s.qty_delta) FROM stock_ledger s WHERE s.estate_id=$2 AND s.hub='latex' AND s.reason='dispatch' AND s.ref_id=b.id),0) AS disp_kg, " +
          "(SELECT MIN(d.date) FROM entry_row_barrels bb JOIN entry_rows r ON r.id=bb.row_id JOIN entry_days d ON d.id=r.day_id WHERE bb.barrel_id=b.id) AS first_pour " +
          "FROM barrels b WHERE b.estate_id=$3 ORDER BY b.code",
        [estate.id, estate.id, estate.id]
      ),
    [estate.id]
  );
  const ledgerQ = useQuery(
    () =>
      select<StockLedgerRow>(
        "SELECT * FROM stock_ledger WHERE estate_id=$1 AND hub LIKE $2 ORDER BY date, id",
        [estate.id, hubPattern]
      ),
    [estate.id, hubPattern]
  );
  const invoicesQ = useQuery(
    () =>
      select<Invoice>(
        "SELECT * FROM invoices WHERE estate_id=$1 ORDER BY date DESC, id DESC",
        [estate.id]
      ),
    [estate.id]
  );
  const paymentsQ = useQuery(
    () =>
      select<Payment>(
        "SELECT * FROM payments WHERE estate_id=$1 ORDER BY date, id",
        [estate.id]
      ),
    [estate.id]
  );

  const fillOf = (b: BarrelCalc) => b.poured + b.manual_kg - b.sold_kg - b.disp_kg;

  const invoiceHubKey = (inv: Invoice): string => {
    const row = ledgerQ.rows.find(
      (r) =>
        r.ref_table === "invoices" &&
        r.ref_id === inv.id &&
        (r.reason === "sale" || r.reason === "sale-reversal")
    );
    if (row) return row.hub;
    if (inv.grade === "Latex") return "latex";
    if (inv.grade === "Scrap") return "scrap";
    if (sheetGrades.includes(inv.grade)) return `sheet:${inv.grade}`;
    const item = m.items.find((i) => i.name === inv.grade);
    return item ? `crop:${item.id}` : `sheet:${inv.grade}`;
  };

  const pageOfHubKey = (key: string): string => {
    if (key === "latex") return "latex";
    if (key === "scrap") return "scrap";
    if (key.startsWith("sheet:")) return "sheet";
    return "othercrop";
  };

  const hubInvoices = useMemo(
    () => invoicesQ.rows.filter((inv) => pageOfHubKey(invoiceHubKey(inv)) === hub),
    [invoicesQ.rows, ledgerQ.rows, hub, sheetGrades, m.items]
  );

  const pool = (key: string) => {
    let added = 0;
    let disp = 0;
    let sold = 0;
    for (const r of ledgerQ.rows) {
      if (r.hub !== key) continue;
      if (r.reason === "manual") added += r.qty_delta;
      else if (r.reason === "dispatch") disp += r.qty_delta;
      else if (r.reason === "sale" || r.reason === "sale-reversal") sold += -r.qty_delta;
    }
    return {
      added,
      disp,
      sold,
      available: added - sold,
      inStock: added - disp,
      staged: disp - sold,
    };
  };

  const latexStats = useMemo(() => {
    let poured = 0;
    let manual = 0;
    let sold = 0;
    let disp = 0;
    let clamped = 0;
    for (const b of barrelsQ.rows) {
      poured += b.poured;
      manual += b.manual_kg;
      sold += b.sold_kg;
      disp += b.disp_kg;
      clamped += Math.max(0, fillOf(b));
    }
    const collected = poured + manual;
    const expected = collected - sold;
    const computed = clamped + disp;
    const ok = Math.abs(expected - computed) < 0.05;
    return { collected, inBarrels: clamped, disp, sold, expected, computed, ok };
  }, [barrelsQ.rows]);

  const [manualOpen, setManualOpen] = useState(false);
  const [manualQty, setManualQty] = useState("");
  const [manualNote, setManualNote] = useState("");
  const [manualBarrel, setManualBarrel] = useState<number | "">("");
  const [manualGrade, setManualGrade] = useState(sheetGrades[0] ?? "Ungraded");
  const [manualItem, setManualItem] = useState<number | "">("");

  const manualHubKey = () => {
    if (hub === "latex") return "latex";
    if (hub === "scrap") return "scrap";
    if (hub === "sheet") return `sheet:${manualGrade}`;
    return `crop:${manualItem}`;
  };

  const saveManual = async () => {
    const kg = Number(manualQty) || 0;
    if (kg <= 0) {
      toast.error("Enter a positive qty");
      return;
    }
    if (hub === "latex" && !manualBarrel) {
      toast.error("Pick a barrel");
      return;
    }
    if (hub === "othercrop" && !manualItem) {
      toast.error("Pick an item");
      return;
    }
    const note = manualNote.trim();
    await execute(
      "INSERT INTO stock_ledger (estate_id, hub, date, qty_delta, reason, ref_table, ref_id) VALUES ($1,$2,$3,$4,'manual',$5,$6)",
      [
        estate.id,
        manualHubKey(),
        todayISO(),
        kg,
        note ? `manual:${note}` : "manual",
        hub === "latex" ? Number(manualBarrel) : null,
      ]
    );
    await logAudit(user?.id ?? null, "stock_manual", "stock_ledger", null, `${manualHubKey()} +${kg}`);
    bump();
    setManualOpen(false);
    setManualQty("");
    setManualNote("");
    toast.success(`Added ${fmtNum(kg)} kg`);
  };

  const [dispSel, setDispSel] = useState<Record<number, number>>({});
  const [dispTarget, setDispTarget] = useState("");
  const [dispGrade, setDispGrade] = useState(sheetGrades[0] ?? "Ungraded");
  const [dispItem, setDispItem] = useState<number | "">("");
  const [dispKg, setDispKg] = useState("");

  const suggestOldest = () => {
    let remaining = Number(dispTarget) || 0;
    const total = remaining;
    const sel: Record<number, number> = {};
    const sorted = [...barrelsQ.rows]
      .filter((b) => fillOf(b) > ALLOC_TOLERANCE)
      .sort((a, b) => (a.first_pour ?? "9999").localeCompare(b.first_pour ?? "9999"));
    for (const b of sorted) {
      if (remaining <= ALLOC_TOLERANCE) break;
      const take = Math.min(fillOf(b), remaining);
      sel[b.id] = Math.round(take * 1000) / 1000;
      remaining = Math.round((remaining - take) * 1000) / 1000;
    }
    setDispSel(sel);
    if (remaining > ALLOC_TOLERANCE) {
      toast.error(`Only ${fmtNum(total - remaining)} kg in stock`);
    }
  };

  const saveDispatch = async () => {
    if (hub === "latex") {
      const picks = Object.entries(dispSel).filter(([, kg]) => kg > 0);
      if (!picks.length) {
        toast.error("Pick barrel kg to dispatch");
        return;
      }
      for (const [bid, kg] of picks) {
        await execute(
          "INSERT INTO stock_ledger (estate_id, hub, date, qty_delta, reason, ref_table, ref_id) VALUES ($1,'latex',$2,$3,'dispatch','barrels',$4)",
          [estate.id, todayISO(), kg, Number(bid)]
        );
      }
      const total = picks.reduce((s, [, kg]) => s + kg, 0);
      await logAudit(user?.id ?? null, "stock_dispatch", "stock_ledger", null, `latex +${total}`);
      setDispSel({});
      setDispTarget("");
      bump();
      toast.success(`Dispatched ${fmtNum(total)} kg to warehouse`);
      return;
    }
    const kg = Number(dispKg) || 0;
    if (kg <= 0) {
      toast.error("Enter a positive qty");
      return;
    }
    if (hub === "sheet" && !dispGrade) return;
    if (hub === "othercrop" && !dispItem) {
      toast.error("Pick an item");
      return;
    }
    const key = hub === "scrap" ? "scrap" : hub === "sheet" ? `sheet:${dispGrade}` : `crop:${dispItem}`;
    await execute(
      "INSERT INTO stock_ledger (estate_id, hub, date, qty_delta, reason, ref_table, ref_id) VALUES ($1,$2,$3,$4,'dispatch','manual',NULL)",
      [estate.id, key, todayISO(), kg]
    );
    await logAudit(user?.id ?? null, "stock_dispatch", "stock_ledger", null, `${key} +${kg}`);
    setDispKg("");
    bump();
    toast.success(`Dispatched ${fmtNum(kg)} kg to warehouse`);
  };

  const [saleDate, setSaleDate] = useState(todayISO());
  const [buyerId, setBuyerId] = useState<number | "">("");
  const [newBuyer, setNewBuyer] = useState("");
  const [saleGrade, setSaleGrade] = useState(
    hub === "sheet" ? (sheetGrades[0] ?? "") : hub === "scrap" ? "Scrap" : ""
  );
  const [saleItem, setSaleItem] = useState<number | "">("");
  const [qty, setQty] = useState("");
  // Fix list #1 — formalin mixed into the latex before it left the estate.
  const [formalin, setFormalin] = useState("");
  // Fix list #11 — the buyer's own scale reading at handover.
  const [buyerWeight, setBuyerWeight] = useState("");
  // Fix list #4 — the invoice's own photo, stored like the logbook's.
  const [salePhoto, setSalePhoto] = useState<string | null>(null);
  const [rate, setRate] = useState("");
  const [paperRate, setPaperRate] = useState("");
  const [drc, setDrc] = useState("");
  const [advance, setAdvance] = useState("");
  const [barrelSel, setBarrelSel] = useState<Record<number, number>>({});

  const qtyN = Number(qty) || 0;
  const rateN = Number(rate) || 0;
  const drcN = drc.trim() === "" ? null : Number(drc);
  const paperN = paperRate.trim() === "" ? null : Number(paperRate);
  const advN = Number(advance) || 0;
  const selKg = Object.values(barrelSel).reduce((s, v) => s + (Number(v) || 0), 0);
  // `estateQtyN` is the estate's own scale reading — it drives stock, the
  // barrel guard and the invoice record. `billedQtyN` is what the money is
  // computed from: the buyer's scale if they weighed it, otherwise the estate
  // weight less any formalin mixed in.
  const estateQtyN = hub === "latex" ? (qtyN > 0 ? qtyN : selKg) : qtyN;
  const formalinN = formalin.trim() === "" ? 0 : Number(formalin) || 0;
  const formalinKg = hub === "latex" && formalin.trim() !== "" ? formalinN : null;
  const buyerEntered = buyerWeight.trim() !== "" && Number(buyerWeight) > 0;
  const billedQtyN = billedQty(
    estateQtyN,
    formalinKg,
    buyerEntered ? Number(buyerWeight) : null
  );
  const netQty = formalinKg !== null ? Math.max(0, estateQtyN - formalinKg) : estateQtyN;
  const weightDiff = Math.round((estateQtyN - billedQtyN) * 100) / 100;
  const preview = hub === "latex" ? latexValue(billedQtyN, rateN, drcN) : simpleValue(billedQtyN, rateN);
  const gap = paperRateGap(paperN, rateN > 0 ? rateN : null);
  const gapWarn = isPaperRateGapWorseThanUsual(gap);

  const addBuyer = async () => {
    const name = newBuyer.trim();
    if (!name) return;
    const res = await execute(
      "INSERT INTO buyers (estate_id, name, contact, active) VALUES ($1,$2,'',1)",
      [estate.id, name]
    );
    setBuyerId(res.lastInsertId);
    setNewBuyer("");
    bump();
    toast.success("Buyer added");
  };

  const saleHubKey = (): string => {
    if (hub === "latex") return "latex";
    if (hub === "scrap") return "scrap";
    if (hub === "sheet") return `sheet:${saleGrade || "Ungraded"}`;
    return `crop:${saleItem}`;
  };

  const saleGradeLabel = (): string => {
    if (hub === "latex") return "Latex";
    if (hub === "scrap") return "Scrap";
    if (hub === "sheet") return saleGrade || "Ungraded";
    return m.byId.item.get(Number(saleItem))?.name ?? "";
  };

  const confirmSale = async () => {
    if (!buyerId) {
      toast.error("Pick a buyer");
      return;
    }
    const grade = saleGradeLabel();
    if (hub !== "latex" && !grade) {
      toast.error("Pick a grade or item");
      return;
    }
    if (hub === "latex") {
      if (selKg <= 0) {
        toast.error("Select barrel kg to sell");
        return;
      }
      if (qtyN > 0 && Math.abs(selKg - qtyN) > 0.05) {
        toast.error(`Barrel kg (${fmtNum(selKg)}) must equal qty (${fmtNum(qtyN)})`);
        return;
      }
    } else if (qtyN <= 0) {
      toast.error("Enter qty");
      return;
    }
    const saleQty = estateQtyN;
    const invoiceNo = await nextSequence(estate.id, "invoice", `${estate.code}-INV-`);
    const status: Invoice["status"] = hub === "latex" && drcN === null ? "Pending DRC" : "Final";
    // Money follows the billed weight; `saleQty` (estate weight) is what goes
    // back out of stock below, so the warehouse never quietly shrinks.
    const value = hub === "latex" ? latexValue(billedQtyN, rateN, drcN) : simpleValue(billedQtyN, rateN);
    const res = await execute(
      "INSERT INTO invoices (estate_id, invoice_no, date, buyer_id, grade, qty, buyer_qty, formalin_kg, rate, paper_rate, drc, advance, value, status, note, photo) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)",
      [
        estate.id,
        invoiceNo,
        saleDate,
        buyerId,
        grade,
        saleQty,
        buyerEntered ? Math.round(billedQtyN * 100) / 100 : null,
        formalinKg,
        rateN,
        paperN,
        drcN,
        advN,
        value,
        status,
        "",
        salePhoto,
      ]
    );
    const invoiceId = res.lastInsertId;
    if (hub === "latex") {
      const picks = Object.entries(barrelSel).filter(([, kg]) => kg > 0);
      for (const [bid, kg] of picks) {
        await execute(
          "INSERT INTO invoice_barrels (invoice_id, barrel_id, kg) VALUES ($1,$2,$3)",
          [invoiceId, Number(bid), kg]
        );
      }
      const bids = picks.map(([b]) => Number(b));
      if (bids.length) {
        const ph = bids.map((_, i) => `$${i + 2}`).join(",");
        await execute(
          `UPDATE entry_rows SET sale_id=$1 WHERE id IN (SELECT DISTINCT row_id FROM entry_row_barrels WHERE barrel_id IN (${ph}))`,
          [invoiceId, ...bids]
        );
      }
    }
    await execute(
      "INSERT INTO stock_ledger (estate_id, hub, date, qty_delta, reason, ref_table, ref_id) VALUES ($1,$2,$3,$4,'sale','invoices',$5)",
      [estate.id, saleHubKey(), saleDate, -saleQty, invoiceId]
    );
    if (advN > 0) {
      const cb = await execute(
        "INSERT INTO cashbook (estate_id, date, particulars, category_code, sub, income, expense, advance, photo, source_ref) VALUES ($1,$2,$3,'E11',$4,$5,0,'Yes',NULL,$6)",
        [estate.id, saleDate, `Advance — ${invoiceNo}`, m.byId.buyer.get(Number(buyerId))?.name ?? "", advN, `invoice:${invoiceId}`]
      );
      await execute(
        "INSERT INTO payments (estate_id, buyer_id, date, amount, type, note, cashbook_id, invoice_id) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)",
        [
          estate.id,
          buyerId,
          saleDate,
          advN,
          hub === "latex" ? "Advance — Latex" : `Advance — ${grade}`,
          invoiceNo,
          cb.lastInsertId,
          invoiceId,
        ]
      );
    }
    await logAudit(user?.id ?? null, "create_sale", "invoices", invoiceId, invoiceNo);
    bump();
    toast.success(`Invoice ${invoiceNo} saved`);
    setQty("");
    setFormalin("");
    setBuyerWeight("");
    setSalePhoto(null);
    setRate("");
    setPaperRate("");
    setDrc("");
    setAdvance("");
    setBarrelSel({});
  };

  const [drcEdit, setDrcEdit] = useState<Record<number, string>>({});
  const [delInv, setDelInv] = useState<Invoice | null>(null);

  const applyDrc = async (inv: Invoice) => {
    const v = Number(drcEdit[inv.id]);
    if (!Number.isFinite(v) || v <= 0) {
      toast.error("Enter DRC %");
      return;
    }
    // Fix list #11 — a late DRC settles on the billed weight, not the raw one.
    const value = latexValue(invoiceBillingQty(inv), inv.rate, v);
    await execute("UPDATE invoices SET drc=$1, value=$2, status='Final' WHERE id=$3", [
      v,
      value,
      inv.id,
    ]);
    await logAudit(user?.id ?? null, "set_drc", "invoices", inv.id, `${v}%`);
    bump();
    toast.success(`DRC ${v}% set on ${inv.invoice_no}`);
  };

  const deleteInvoice = async () => {
    const inv = delInv;
    if (!inv) return;
    await execute(
      "INSERT INTO stock_ledger (estate_id, hub, date, qty_delta, reason, ref_table, ref_id) VALUES ($1,$2,$3,$4,'sale-reversal','invoices',$5)",
      [estate.id, invoiceHubKey(inv), todayISO(), inv.qty, inv.id]
    );
    await execute("DELETE FROM invoice_barrels WHERE invoice_id=$1", [inv.id]);
    await execute("UPDATE entry_rows SET sale_id=NULL WHERE sale_id=$1", [inv.id]);
    await execute("DELETE FROM invoices WHERE id=$1", [inv.id]);
    await logAudit(user?.id ?? null, "delete_invoice", "invoices", inv.id, inv.invoice_no);
    setDelInv(null);
    bump();
    toast.success(`Invoice ${inv.invoice_no} deleted`);
  };

  const [ledgerBuyer, setLedgerBuyer] = useState<number | "">("");
  const [ledgerFilter, setLedgerFilter] = useState<"All" | LedgerGroup>("All");
  const [ledgerGrouped, setLedgerGrouped] = useState(false);

  // Fix list #2 — a third advance type, "Advance — Bank / Deposit", posted
  // through the same cashbook + payments pair as every other receipt.
  const [payDate, setPayDate] = useState(todayISO());
  const [payAmount, setPayAmount] = useState("");
  const [payType, setPayType] = useState("Settlement");
  const [payNote, setPayNote] = useState("");

  const recordPayment = async () => {
    const amount = Number(payAmount) || 0;
    if (!ledgerBuyer || amount <= 0) {
      toast.error("Enter an amount");
      return;
    }
    const bname = m.byId.buyer.get(Number(ledgerBuyer))?.name ?? "";
    const isAdvance = payType.startsWith("Advance");
    const cb = await execute(
      "INSERT INTO cashbook (estate_id, date, particulars, category_code, sub, income, expense, advance, photo, source_ref) VALUES ($1,$2,$3,'E11',$4,$5,0,$6,NULL,'buyer_payment')",
      [estate.id, payDate, `${payType} — ${bname}`, bname, amount, isAdvance ? "Yes" : "No"]
    );
    await execute(
      "INSERT INTO payments (estate_id, buyer_id, date, amount, type, note, cashbook_id, invoice_id) VALUES ($1,$2,$3,$4,$5,$6,$7,NULL)",
      [estate.id, Number(ledgerBuyer), payDate, amount, payType, payNote.trim(), cb.lastInsertId]
    );
    await logAudit(user?.id ?? null, "record_payment", "payments", null, `${bname} ${amount}`);
    setPayAmount("");
    setPayNote("");
    bump();
    toast.success("Payment recorded");
  };

  const buildLedger = (bid: number): (LedLine & { balance: number })[] => {
    const lines: LedLine[] = [];
    for (const inv of invoicesQ.rows) {
      if (inv.buyer_id !== bid) continue;
      if (pageOfHubKey(invoiceHubKey(inv)) !== hub) continue;
      if (inv.value === null) continue;
      lines.push({
        date: inv.date,
        type: "Invoice",
        ref: inv.invoice_no,
        debit: inv.value,
        credit: 0,
      });
    }
    for (const p of paymentsQ.rows) {
      if (p.buyer_id !== bid) continue;
      lines.push({
        date: p.date,
        type: p.type,
        ref: p.note,
        debit: 0,
        credit: p.amount,
      });
    }
    lines.sort((a, b) => a.date.localeCompare(b.date));
    let bal = 0;
    return lines.map((l) => {
      bal = Math.round((bal + l.debit - l.credit) * 100) / 100;
      return { ...l, balance: bal };
    });
  };

  const ledgerRows = useMemo(
    () => (ledgerBuyer ? buildLedger(Number(ledgerBuyer)) : []),
    [ledgerBuyer, invoicesQ.rows, paymentsQ.rows, hub, ledgerQ.rows, sheetGrades, m.items]
  );

  // #3 — the type filter only picks which rows are shown. It never rebuilds a
  // balance: `ledgerRows` is always the buyer's full chronological history, so
  // `outstanding` below stays correct no matter which type is on screen.
  const visibleLedger = useMemo(
    () =>
      ledgerFilter === "All"
        ? ledgerRows
        : ledgerRows.filter((l) => paymentGroup(l.type) === ledgerFilter),
    [ledgerRows, ledgerFilter]
  );
  const outstanding = ledgerRows.length
    ? ledgerRows[ledgerRows.length - 1].balance
    : 0;

  const exportLedger = async () => {
    const wb = new ExcelJS.Workbook();
    wb.creator = "Estate Ledger";
    wb.created = new Date();
    const summary = wb.addWorksheet("Summary");
    summary.columns = [
      { header: "Buyer", key: "buyer", width: 26 },
      { header: "Sales", key: "sales", width: 14 },
      { header: "Payments", key: "pay", width: 14 },
      { header: "Balance", key: "bal", width: 14 },
    ];
    styleHeader(summary.getRow(1));
    let si = 1;
    for (const b of m.buyers) {
      const lines = buildLedger(b.id);
      if (!lines.length) continue;
      si++;
      const sales = lines.reduce((s, l) => s + l.debit, 0);
      const pay = lines.reduce((s, l) => s + l.credit, 0);
      summary.addRow({ buyer: b.name, sales, pay, bal: Math.round((sales - pay) * 100) / 100 });
      const ws = wb.addWorksheet(sheetName(b.name, si));
      ws.columns = [
        { header: "Date", key: "date", width: 12 },
        { header: "Type", key: "type", width: 18 },
        { header: "Reference", key: "ref", width: 20 },
        { header: "Debit", key: "debit", width: 12 },
        { header: "Credit", key: "credit", width: 12 },
        { header: "Balance", key: "balance", width: 12 },
      ];
      for (const l of lines) {
        ws.addRow({
          date: l.date,
          type: l.type,
          ref: l.ref,
          debit: l.debit || undefined,
          credit: l.credit || undefined,
          balance: l.balance,
        });
      }
      styleHeader(ws.getRow(1));
    }
    const buffer = await wb.xlsx.writeBuffer();
    const path = await save({
      title: "Export buyer ledger",
      defaultPath: `${estate.name}_BuyerLedger_${hub}.xlsx`,
      filters: [{ name: "Excel", extensions: ["xlsx"] }],
    });
    if (!path) return;
    await writeFile(path, new Uint8Array(buffer as ArrayBuffer));
    toast.success("Ledger exported");
  };

  const [rangeFrom, setRangeFrom] = useState(monthRange(todayISO()).from);
  const [rangeTo, setRangeTo] = useState(monthRange(todayISO()).to);

  const summary = useMemo(() => {
    const inRange = hubInvoices.filter(
      (inv) => inv.date >= rangeFrom && inv.date <= rangeTo && inv.status !== "Cancelled"
    );
    const byGrade = new Map<
      string,
      { qty: number; value: number; count: number; pending: number; paperSum: number; paperN: number; rateSum: number }
    >();
    const byBuyer = new Map<number, { qty: number; value: number; count: number }>();
    for (const inv of inRange) {
      // Fix list #11 — sales analytics summarise the billed weight, the same
      // number the invoice value was computed from.
      const billed = invoiceBillingQty(inv);
      const g = byGrade.get(inv.grade) ?? {
        qty: 0,
        value: 0,
        count: 0,
        pending: 0,
        paperSum: 0,
        paperN: 0,
        rateSum: 0,
      };
      g.qty += billed;
      g.count++;
      g.rateSum += inv.rate * billed;
      if (inv.paper_rate !== null) {
        g.paperSum += inv.paper_rate;
        g.paperN++;
      }
      if (inv.value === null) g.pending++;
      else g.value += inv.value;
      byGrade.set(inv.grade, g);
      const b = byBuyer.get(inv.buyer_id ?? 0) ?? { qty: 0, value: 0, count: 0 };
      b.qty += billed;
      b.count++;
      b.value += inv.value ?? 0;
      byBuyer.set(inv.buyer_id ?? 0, b);
    }
    const grades = [...byGrade.entries()].map(([grade, g]) => {
      const avgPaper = g.paperN ? g.paperSum / g.paperN : null;
      const avgRate = g.qty > 0 ? g.rateSum / g.qty : null;
      return {
        grade,
        qty: g.qty,
        value: g.value,
        count: g.count,
        pending: g.pending,
        avgPaper,
        avgRate,
        gap: paperRateGap(avgPaper, avgRate),
      };
    });
    const buyers = [...byBuyer.entries()]
      .map(([id, b]) => ({ name: m.byId.buyer.get(id)?.name ?? "—", ...b }))
      .sort((a, b) => b.value - a.value)
      .slice(0, 8);
    return { grades, buyers, count: inRange.length };
  }, [hubInvoices, rangeFrom, rangeTo, m.byId.buyer]);

  const titles: Record<string, string> = {
    latex: "Barrel stock (Latex)",
    sheet: "Sheet stock",
    scrap: "Scrap stock",
    othercrop: "Other crop stock",
  };

  const stagedKg = useMemo(
    () =>
      hub === "latex"
        ? ledgerQ.rows
            .filter((r) => r.reason === "dispatch")
            .reduce((s, r) => s + r.qty_delta, 0)
        : hub === "scrap"
          ? pool("scrap").staged
          : hub === "sheet"
            ? sheetGrades.reduce((s, g) => s + pool(`sheet:${g}`).staged, 0)
            : m.items.reduce((s, i) => s + pool(`crop:${i.id}`).staged, 0),
    [ledgerQ.rows, hub, sheetGrades, m.items]
  );

  const saleHubTarget = hub === "sheet" ? `sheet:${saleGrade || "Ungraded"}` : hub === "scrap" ? "scrap" : hub === "latex" ? "latex" : `crop:${saleItem}`;
  const salePool = pool(saleHubTarget);

  return (
    <div>
      <PageHeader
        title={titles[hub]}
        subtitle={
          hub === "latex"
            ? `${fmtNum(latexStats.collected)} kg collected · ${fmtNum(latexStats.disp)} kg staged`
            : `${fmtNum(stagedKg)} kg staged at warehouse`
        }
        right={
          <button className="btn btn-secondary" onClick={() => setManualOpen(true)}>
            <Plus size={14} /> Manual stock add
          </button>
        }
      />

      <div className="mb-4 flex flex-wrap gap-2">
        <Pill active={tab === "stock"} onClick={() => setTab("stock")}>
          Stock
        </Pill>
        <Pill active={tab === "dispatch"} onClick={() => setTab("dispatch")}>
          Dispatch
        </Pill>
        <Pill active={tab === "sale"} onClick={() => setTab("sale")}>
          Create sale
        </Pill>
        <Pill active={tab === "invoices"} onClick={() => setTab("invoices")}>
          Invoices
        </Pill>
        <Pill active={tab === "ledger"} onClick={() => setTab("ledger")}>
          Buyer ledger
        </Pill>
        <Pill active={tab === "summary"} onClick={() => setTab("summary")}>
          Sales summary
        </Pill>
      </div>

      {tab === "stock" && (
        <>
          {hub === "latex" ? (
            <>
              <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-4">
                <KPI label="Total collected" value={`${fmtNum(latexStats.collected)} kg`} />
                <KPI label="In barrels" value={`${fmtNum(latexStats.inBarrels)} kg`} />
                <KPI label="Dispatched" value={`${fmtNum(latexStats.disp)} kg`} />
                <KPI
                  label="Reconciliation"
                  tone={latexStats.ok ? "good" : "warn"}
                  value={
                    <span className="inline-flex items-center gap-1">
                      {latexStats.ok ? <CheckCircle2 size={18} /> : <AlertTriangle size={18} />}
                      {latexStats.ok ? "Reconciled" : "Mismatch"}
                    </span>
                  }
                  sub={`computed ${fmtNum(latexStats.computed)} vs expected ${fmtNum(latexStats.expected)}`}
                />
              </div>
              <Card title="Barrels" pad={false}>
                <div className="overflow-x-auto">
                  <table className="register-table">
                    <thead>
                      <tr>
                        <th>Barrel</th>
                        <th>Capacity</th>
                        <th>Poured kg</th>
                        <th>Fill</th>
                        <th>Status</th>
                        <th>Location</th>
                      </tr>
                    </thead>
                    <tbody>
                      {barrelsQ.rows.length === 0 && (
                        <tr>
                          <td colSpan={6}>
                            <EmptyState title="No barrels" hint="Add barrels in Estate setup." />
                          </td>
                        </tr>
                      )}
                      {barrelsQ.rows.map((b) => {
                        const f = fillOf(b);
                        const st = fillStatus(f, b.capacity);
                        const loc = b.disp_kg > 0 && f <= ALLOC_TOLERANCE ? "Warehouse" : "Stock";
                        return (
                          <tr key={b.id}>
                            <td className="font-semibold whitespace-nowrap">{b.code}</td>
                            <td className="tnum text-right">{fmtNum(b.capacity)}</td>
                            <td className="tnum text-right">{fmtNum(f)}</td>
                            <td className="tnum text-right">{fmtNum(b.capacity > 0 ? (f / b.capacity) * 100 : 0, 0)}%</td>
                            <td>
                              <Badge tone={st === "Full" ? "ok" : st === "Empty" ? "neutral" : "warn"}>{st}</Badge>
                            </td>
                            <td>{loc}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </Card>
            </>
          ) : hub === "sheet" ? (
            <Card title="Sheet balances" pad={false}>
              <div className="overflow-x-auto">
                <table className="register-table">
                  <thead>
                    <tr>
                      <th>{t("common.grade")}</th>
                      <th>Added</th>
                      <th>In stock</th>
                      <th>Staged</th>
                      <th>Sold</th>
                      <th>Available</th>
                    </tr>
                  </thead>
                  <tbody>
                    {sheetGrades.map((g) => {
                      const p = pool(`sheet:${g}`);
                      return (
                        <tr key={g}>
                          <td className="font-semibold">{g}</td>
                          <td className="tnum text-right">{fmtNum(p.added)}</td>
                          <td className="tnum text-right">{fmtNum(p.inStock)}</td>
                          <td className="tnum text-right">{fmtNum(p.staged)}</td>
                          <td className="tnum text-right">{fmtNum(p.sold)}</td>
                          <td className="tnum bg-ok-bg text-right font-semibold">{fmtNum(p.available)}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </Card>
          ) : hub === "scrap" ? (
            <>
              <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-4">
                {(() => {
                  const p = pool("scrap");
                  return (
                    <>
                      <KPI label="Added" value={`${fmtNum(p.added)} kg`} />
                      <KPI label="In stock" value={`${fmtNum(p.inStock)} kg`} />
                      <KPI label="Staged" value={`${fmtNum(p.staged)} kg`} />
                      <KPI label="Available" value={`${fmtNum(p.available)} kg`} tone="good" />
                    </>
                  );
                })()}
              </div>
              <Card title="Scrap pool">
                <div className="text-[13px] text-ink-soft">
                  Sold {fmtNum(pool("scrap").sold)} kg to date.
                </div>
              </Card>
            </>
          ) : (
            <Card title="Other crop stock" pad={false}>
              <div className="overflow-x-auto">
                <table className="register-table">
                  <thead>
                    <tr>
                      <th>Item</th>
                      <th>Unit</th>
                      <th>Added</th>
                      <th>In stock</th>
                      <th>Staged</th>
                      <th>Sold</th>
                      <th>Available</th>
                    </tr>
                  </thead>
                  <tbody>
                    {m.items.length === 0 && (
                      <tr>
                        <td colSpan={7}>
                          <EmptyState title="No stock items" hint="Add items in Estate setup." />
                        </td>
                      </tr>
                    )}
                    {m.items.map((it) => {
                      const p = pool(`crop:${it.id}`);
                      return (
                        <tr key={it.id}>
                          <td className="font-semibold">{it.name}</td>
                          <td>{it.unit}</td>
                          <td className="tnum text-right">{fmtNum(p.added)}</td>
                          <td className="tnum text-right">{fmtNum(p.inStock)}</td>
                          <td className="tnum text-right">{fmtNum(p.staged)}</td>
                          <td className="tnum text-right">{fmtNum(p.sold)}</td>
                          <td className="tnum bg-ok-bg text-right font-semibold">{fmtNum(p.available)}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </Card>
          )}
        </>
      )}

      {tab === "dispatch" && (
        <Card
          title="Dispatch to warehouse"
          right={<Badge tone="neutral">Staged {fmtNum(stagedKg)} kg</Badge>}
        >
          {hub === "latex" ? (
            <div>
              <div className="mb-3 flex flex-wrap items-end gap-2">
                <Field label="Target kg">
                  <input
                    className="input w-[120px]"
                    value={dispTarget}
                    onChange={(e) => setDispTarget(e.target.value)}
                  />
                </Field>
                <button className="btn btn-secondary" onClick={suggestOldest}>
                  <Wand2 size={14} /> Suggest oldest barrels
                </button>
                <div className="text-[12px] text-ink-soft">
                  Selected {fmtNum(Object.values(dispSel).reduce((s, v) => s + (Number(v) || 0), 0))} kg
                </div>
                <button
                  className="btn btn-primary ml-auto"
                  onClick={saveDispatch}
                  disabled={!Object.values(dispSel).some((v) => v > 0)}
                >
                  Dispatch
                </button>
              </div>
              <div className="overflow-x-auto">
                <table className="register-table">
                  <thead>
                    <tr>
                      <th>Barrel</th>
                      <th>First filled</th>
                      <th>Fill kg</th>
                      <th>Dispatch kg</th>
                    </tr>
                  </thead>
                  <tbody>
                    {[...barrelsQ.rows]
                      .filter((b) => fillOf(b) > ALLOC_TOLERANCE)
                      .sort((a, b) => (a.first_pour ?? "9999").localeCompare(b.first_pour ?? "9999"))
                      .map((b) => (
                        <tr key={b.id}>
                          <td className="font-semibold">{b.code}</td>
                          <td>{b.first_pour ? fmtDate(b.first_pour) : "—"}</td>
                          <td className="tnum text-right">{fmtNum(fillOf(b))}</td>
                          <td>
                            <input
                              type="number"
                              step="0.1"
                              className="input w-[90px] border-0 bg-transparent px-1 py-0.5 text-right"
                              value={dispSel[b.id] ?? ""}
                              onChange={(e) =>
                                setDispSel((s) => ({ ...s, [b.id]: Number(e.target.value) }))
                              }
                            />
                          </td>
                        </tr>
                      ))}
                  </tbody>
                </table>
              </div>
            </div>
          ) : (
            <div className="flex flex-wrap items-end gap-3">
              {hub === "sheet" && (
                <Field label={t("common.grade")}>
                  <select
                    className="input w-[140px]"
                    value={dispGrade}
                    onChange={(e) => setDispGrade(e.target.value)}
                  >
                    {sheetGrades.map((g) => (
                      <option key={g} value={g}>
                        {g}
                      </option>
                    ))}
                  </select>
                </Field>
              )}
              {hub === "othercrop" && (
                <Field label="Item">
                  <select
                    className="input w-[180px]"
                    value={dispItem}
                    onChange={(e) => setDispItem(Number(e.target.value) || "")}
                  >
                    <option value="">—</option>
                    {m.items.map((it) => (
                      <option key={it.id} value={it.id}>
                        {it.name}
                      </option>
                    ))}
                  </select>
                </Field>
              )}
              <Field label={`${t("common.qty")} (kg)`}>
                <input
                  className="input w-[120px]"
                  value={dispKg}
                  onChange={(e) => setDispKg(e.target.value)}
                />
              </Field>
              <button className="btn btn-primary" onClick={saveDispatch}>
                Dispatch
              </button>
              {(() => {
                const key =
                  hub === "scrap" ? "scrap" : hub === "sheet" ? `sheet:${dispGrade}` : `crop:${dispItem}`;
                const p = pool(key);
                return (
                  <div className="text-[12px] text-ink-soft">
                    In stock {fmtNum(p.inStock)} kg · staged {fmtNum(p.staged)} kg
                  </div>
                );
              })()}
            </div>
          )}
        </Card>
      )}

      {tab === "sale" && (
        <Card title="Create sale">
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <Field label={t("common.date")}>
              <input
                type="date"
                className="input"
                value={saleDate}
                onChange={(e) => setSaleDate(e.target.value)}
              />
            </Field>
            <Field label={t("common.buyer")}>
              <div className="flex gap-1">
                <select
                  className="input"
                  value={buyerId}
                  onChange={(e) => setBuyerId(Number(e.target.value) || "")}
                >
                  <option value="">—</option>
                  {m.buyers.map((b) => (
                    <option key={b.id} value={b.id}>
                      {b.name}
                    </option>
                  ))}
                </select>
              </div>
            </Field>
            <Field label="Add buyer">
              <div className="flex gap-1">
                <input
                  className="input"
                  placeholder="New buyer"
                  value={newBuyer}
                  onChange={(e) => setNewBuyer(e.target.value)}
                />
                <button className="btn btn-secondary" onClick={addBuyer} title="Add buyer">
                  <UserPlus size={14} />
                </button>
              </div>
            </Field>
            {hub === "sheet" && (
              <Field label={t("common.grade")}>
                {profile.customSaleGrades ? (
                  <input
                    className="input"
                    list="sheet-grade-list"
                    value={saleGrade}
                    onChange={(e) => setSaleGrade(e.target.value)}
                  />
                ) : (
                  <select
                    className="input"
                    value={saleGrade}
                    onChange={(e) => setSaleGrade(e.target.value)}
                  >
                    {sheetGrades.map((g) => (
                      <option key={g} value={g}>
                        {g}
                      </option>
                    ))}
                  </select>
                )}
                <datalist id="sheet-grade-list">
                  {sheetGrades.map((g) => (
                    <option key={g} value={g} />
                  ))}
                </datalist>
              </Field>
            )}
            {hub === "scrap" && (
              <Field label={t("common.grade")}>
                <input
                  className="input"
                  value={saleGrade}
                  onChange={(e) => setSaleGrade(e.target.value)}
                />
              </Field>
            )}
            {hub === "othercrop" && (
              <Field label="Item">
                <select
                  className="input"
                  value={saleItem}
                  onChange={(e) => setSaleItem(Number(e.target.value) || "")}
                >
                  <option value="">—</option>
                  {m.items.map((it) => (
                    <option key={it.id} value={it.id}>
                      {it.name}
                    </option>
                  ))}
                </select>
              </Field>
            )}
            <Field label={t("common.estateWeight")}>
              <input
                className="input"
                value={qty}
                onChange={(e) => setQty(e.target.value)}
                disabled={hub === "latex"}
                placeholder={hub === "latex" ? String(Math.round(selKg * 1000) / 1000) : ""}
              />
            </Field>
            {hub === "latex" && (
              <Field label={t("common.formalinWeight")}>
                <input
                  className="input"
                  value={formalin}
                  onChange={(e) => setFormalin(e.target.value)}
                  placeholder="0"
                />
              </Field>
            )}
            <Field label={t("common.buyerWeight")}>
              <input
                className="input"
                value={buyerWeight}
                onChange={(e) => setBuyerWeight(e.target.value)}
                placeholder="As weighed by buyer"
              />
            </Field>
            <Field label={t("common.rate")}>
              <input className="input" value={rate} onChange={(e) => setRate(e.target.value)} />
            </Field>
            <Field label="Paper rate">
              <input
                className="input"
                value={paperRate}
                onChange={(e) => setPaperRate(e.target.value)}
              />
            </Field>
            {hub === "latex" && (
              <Field label="DRC % (optional)">
                <input
                  className="input"
                  value={drc}
                  onChange={(e) => setDrc(e.target.value)}
                  placeholder="Pending"
                />
              </Field>
            )}
            <Field label="Advance">
              <input
                className="input"
                value={advance}
                onChange={(e) => setAdvance(e.target.value)}
              />
            </Field>
          </div>

          <PhotoField
            label="Attach invoice photo"
            value={salePhoto}
            onChange={setSalePhoto}
            className="mt-4"
          />

          {/* Fix list #1 and #11 — both scales, and the gap between them,
              stated before any money is quoted. */}
          {estateQtyN > 0 && (
            <div
              className="mt-3 text-[12.5px]"
              style={{
                color:
                  buyerEntered && weightDiff !== 0
                    ? "var(--color-rust)"
                    : "var(--color-ink-soft)",
                fontWeight: buyerEntered && weightDiff !== 0 ? 600 : 400,
              }}
            >
              {buyerEntered
                ? weightDiff === 0
                  ? `Estate and buyer scales agree at ${fmtNum(estateQtyN)} kg.`
                  : `Difference: ${fmtNum(Math.abs(weightDiff))} kg ${
                      weightDiff > 0 ? "short of" : "over"
                    } the estate's ${fmtNum(estateQtyN)} kg — billed on the buyer's ${fmtNum(
                      billedQtyN
                    )} kg.`
                : formalinKg !== null
                  ? `Estate ${fmtNum(estateQtyN)} kg − ${fmtNum(formalinKg)} kg formalin = ${fmtNum(
                      netQty
                    )} kg net latex; billed on that. Add the buyer's weight to make any shortfall visible.`
                  : "Estate weight is what left the warehouse; add the buyer's weight to bill on it and make any shortfall visible."}
            </div>
          )}

          <div className="mt-4 flex flex-wrap items-center gap-3">
            <div className="font-display text-[15px] font-semibold text-ink">
              {t("common.value")}:{" "}
              {preview === null ? (
                <Badge tone="warn">Pending DRC</Badge>
              ) : (
                <span className="tnum">{fmtMoney(preview)}</span>
              )}
              {billedQtyN !== estateQtyN && (
                <span className="ml-2 text-[12px] font-normal text-ink-soft tnum">
                  {fmtNum(billedQtyN)} kg billed
                </span>
              )}
            </div>
            {gapWarn && (
              <div className="rounded-[8px] border border-warn/30 bg-warn-bg px-3 py-1.5 text-[12px] text-warn">
                Paper-rate gap {fmtMoney(gap)} is worse than usual
              </div>
            )}
            <div className="ml-auto text-[12px] text-ink-soft">
              Available {fmtNum(salePool.available)} kg
              {hub === "latex" ? ` · selected ${fmtNum(selKg)} kg` : ""}
            </div>
            <button className="btn btn-primary" onClick={confirmSale}>
              {t("common.save")} invoice
            </button>
          </div>

          {hub === "latex" && (
            <div className="mt-4">
              <div className="label mb-1">Barrels to sell</div>
              <div className="overflow-x-auto">
                <table className="register-table">
                  <thead>
                    <tr>
                      <th>Barrel</th>
                      <th>Fill kg</th>
                      <th>Sell kg</th>
                    </tr>
                  </thead>
                  <tbody>
                    {barrelsQ.rows.filter((b) => fillOf(b) > ALLOC_TOLERANCE).length === 0 && (
                      <tr>
                        <td colSpan={3}>
                          <EmptyState title="No filled barrels" />
                        </td>
                      </tr>
                    )}
                    {barrelsQ.rows
                      .filter((b) => fillOf(b) > ALLOC_TOLERANCE)
                      .map((b) => (
                        <tr key={b.id}>
                          <td className="font-semibold">{b.code}</td>
                          <td className="tnum text-right">{fmtNum(fillOf(b))}</td>
                          <td>
                            <input
                              type="number"
                              step="0.1"
                              className="input w-[90px] border-0 bg-transparent px-1 py-0.5 text-right"
                              value={barrelSel[b.id] ?? ""}
                              onChange={(e) =>
                                setBarrelSel((s) => ({ ...s, [b.id]: Number(e.target.value) }))
                              }
                            />
                          </td>
                        </tr>
                      ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </Card>
      )}

      {tab === "invoices" && (
        <Card title={t("common.invoice")} pad={false}>
          <div className="overflow-x-auto">
            <table className="register-table">
              <thead>
                <tr>
                  <th>{t("common.invoice")}</th>
                  <th>{t("common.date")}</th>
                  <th>{t("common.buyer")}</th>
                  <th>{t("common.grade")}</th>
                  <th>{t("common.estateBilled")}</th>
                  <th>{t("common.rate")}</th>
                  <th>DRC %</th>
                  <th>{t("common.value")}</th>
                  <th>{t("common.status")}</th>
                  <th>Photo</th>
                  <th>{t("common.actions")}</th>
                </tr>
              </thead>
              <tbody>
                {hubInvoices.length === 0 && (
                  <tr>
                    <td colSpan={11}>
                      <EmptyState title="No invoices yet" hint="Record a sale from the Create sale tab." />
                    </td>
                  </tr>
                )}
                {hubInvoices.map((inv) => {
                  const pending = inv.status === "Pending DRC";
                  const billed = invoiceBillingQty(inv);
                  const twoWeights = Math.abs(billed - inv.qty) > 0.004;
                  return (
                    <tr key={inv.id}>
                      <td className="font-semibold whitespace-nowrap">{inv.invoice_no}</td>
                      <td className="whitespace-nowrap">{fmtDate(inv.date)}</td>
                      <td>{m.byId.buyer.get(inv.buyer_id ?? 0)?.name ?? "—"}</td>
                      <td>{inv.grade}</td>
                      <td className="tnum text-right">
                        {twoWeights ? (
                          <span>
                            {fmtNum(inv.qty)}
                            <span className="block text-[11px] font-bold text-rust">
                              → {fmtNum(billed)} billed
                            </span>
                          </span>
                        ) : (
                          fmtNum(inv.qty)
                        )}
                      </td>
                      <td className="tnum text-right">{fmtNum(inv.rate)}</td>
                      <td>
                        {pending ? (
                          <div className="flex items-center gap-1">
                            <input
                              className="input w-[64px] border-0 bg-transparent px-1 py-0.5 text-right"
                              value={drcEdit[inv.id] ?? ""}
                              onChange={(e) =>
                                setDrcEdit((s) => ({ ...s, [inv.id]: e.target.value }))
                              }
                            />
                            <button className="btn btn-secondary" onClick={() => void applyDrc(inv)}>
                              Set
                            </button>
                          </div>
                        ) : (
                          <span className="tnum">{inv.drc !== null ? fmtNum(inv.drc) : "—"}</span>
                        )}
                      </td>
                      <td className="tnum text-right">
                        {inv.value === null ? "Pending DRC" : fmtMoney(inv.value)}
                      </td>
                      <td>
                        {pending ? (
                          <Badge tone="warn">Pending DRC</Badge>
                        ) : (
                          <Badge tone="ok">{inv.status}</Badge>
                        )}
                      </td>
                      <td>
                        {inv.photo ? (
                          <PhotoThumb dataUrl={inv.photo} size={32} />
                        ) : (
                          <span className="text-ink-soft">—</span>
                        )}
                      </td>
                      <td className="text-center">
                        <button className="text-danger" onClick={() => setDelInv(inv)}>
                          <Trash2 size={13} />
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {tab === "ledger" && (
        <Card
          title="Buyer ledger"
          pad={false}
          right={
            <div className="flex items-center gap-2">
              <select
                className="input w-[200px]"
                value={ledgerBuyer}
                onChange={(e) => setLedgerBuyer(Number(e.target.value) || "")}
              >
                <option value="">Select buyer</option>
                {m.buyers.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.name}
                  </option>
                ))}
              </select>
              <button className="btn btn-secondary" onClick={exportLedger}>
                <FileSpreadsheet size={14} /> Export ledger (Excel)
              </button>
            </div>
          }
        >
          {!ledgerBuyer ? (
            <div className="p-4">
              <EmptyState title="Pick a buyer" hint="Select a buyer to see their statement." />
            </div>
          ) : (
            <>
              <div className="flex flex-col gap-4 p-4">
                <Card title="Record a payment received" icon={<Plus size={15} />}>
                  <p className="mb-3 text-[12px] text-ink-soft">
                    Posts into the cashbook at the same time — one entry, not two.
                  </p>
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
                    <Field label={t("common.date")}>
                      <input
                        type="date"
                        className="input"
                        value={payDate}
                        onChange={(e) => setPayDate(e.target.value)}
                      />
                    </Field>
                    <Field label="Amount (Rs)">
                      <input
                        type="number"
                        min={0}
                        className="input"
                        value={payAmount}
                        onChange={(e) => setPayAmount(e.target.value)}
                      />
                    </Field>
                    <Field label="Type">
                      <select
                        className="input"
                        value={payType}
                        onChange={(e) => setPayType(e.target.value)}
                      >
                        <option value="Settlement">Settlement</option>
                        <option value="Advance — Estate expenses">
                          Advance — Estate expenses
                        </option>
                        <option value="Advance — Bank / Deposit">
                          Advance — Bank / Deposit
                        </option>
                      </select>
                    </Field>
                    <Field label="Note (optional)">
                      <input
                        className="input"
                        value={payNote}
                        onChange={(e) => setPayNote(e.target.value)}
                      />
                    </Field>
                  </div>
                  <div className="mt-3">
                    <button
                      className="btn btn-primary"
                      disabled={!payAmount || Number(payAmount) <= 0}
                      onClick={() => void recordPayment()}
                    >
                      <Plus size={14} /> Record payment
                    </button>
                  </div>
                </Card>
              </div>

              {ledgerRows.length === 0 ? (
                <div className="p-4">
                  <EmptyState title="No entries" />
                </div>
              ) : (
                <>
                  <div className="flex flex-wrap items-center gap-2 px-4 pt-4">
                    {LEDGER_FILTERS.map((f) => (
                      <Pill
                        key={f.id}
                        active={ledgerFilter === f.id}
                        onClick={() => setLedgerFilter(f.id)}
                      >
                        {f.label}
                      </Pill>
                    ))}
                    <button
                      type="button"
                      className="pill ml-auto"
                      onClick={() => setLedgerGrouped((g) => !g)}
                    >
                      {ledgerGrouped ? "Grouped by type ✓" : "Group by type"}
                    </button>
                  </div>
                  <p className="px-4 pt-2 text-[11.5px] text-ink-soft">
                    Rows shown: {visibleLedger.length} of {ledgerRows.length}. Balances are
                    never recalculated from this view — each one is the running total of the
                    buyer&apos;s full history, and the outstanding balance of{" "}
                    {fmtMoney(outstanding)} is unchanged.
                  </p>
                  <div className="overflow-x-auto">
                    <table className="register-table">
                      <thead>
                        <tr>
                          <th>{t("common.date")}</th>
                          <th>Type</th>
                          <th>{t("common.invoice")} / note</th>
                          <th>Debit</th>
                          <th>Credit</th>
                          <th>Balance</th>
                        </tr>
                      </thead>
                      <tbody>
                        {groupLedgerRows(visibleLedger, ledgerGrouped).map((block) => (
                          <Fragment key={block.group ?? "all"}>
                            {block.heading && (
                              <tr className="bg-paper-deep">
                                <td
                                  colSpan={6}
                                  className="text-[11.5px] font-semibold uppercase tracking-wide text-ink-soft"
                                >
                                  {block.heading} — {block.rows.length}{" "}
                                  {block.rows.length === 1 ? "entry" : "entries"}
                                </td>
                              </tr>
                            )}
                            {block.rows.map((l, i) => (
                              <tr key={`${block.group ?? "all"}-${i}`}>
                                <td className="whitespace-nowrap">{fmtDate(l.date)}</td>
                                <td>{l.type}</td>
                                <td>{l.ref}</td>
                                <td className="tnum text-right">
                                  {l.debit ? fmtMoney(l.debit) : ""}
                                </td>
                                <td className="tnum text-right">
                                  {l.credit ? fmtMoney(l.credit) : ""}
                                </td>
                                <td className="tnum text-right font-semibold">
                                  {fmtMoney(l.balance)}
                                </td>
                              </tr>
                            ))}
                            {block.heading && (
                              <tr className="border-t-2 border-paper-line font-semibold">
                                <td colSpan={3}>
                                  Subtotal — {block.heading}
                                </td>
                                <td className="tnum text-right">
                                  {fmtMoney(ledgerTotals(block.rows).debit)}
                                </td>
                                <td className="tnum text-right">
                                  {fmtMoney(ledgerTotals(block.rows).credit)}
                                </td>
                                <td className="tnum text-right">
                                  {fmtMoney(
                                    ledgerTotals(block.rows).debit -
                                      ledgerTotals(block.rows).credit
                                  )}
                                </td>
                              </tr>
                            )}
                          </Fragment>
                        ))}
                        {ledgerGrouped && visibleLedger.length > 0 && (
                          <tr className="bg-paper-deep font-semibold">
                            <td colSpan={3}>
                              Statement total — outstanding {fmtMoney(outstanding)}
                            </td>
                            <td className="tnum text-right">
                              {fmtMoney(ledgerTotals(visibleLedger).debit)}
                            </td>
                            <td className="tnum text-right">
                              {fmtMoney(ledgerTotals(visibleLedger).credit)}
                            </td>
                            <td className="tnum text-right">{fmtMoney(outstanding)}</td>
                          </tr>
                        )}
                      </tbody>
                    </table>
                  </div>
                </>
              )}
            </>
          )}
        </Card>
      )}

      {tab === "summary" && (
        <>
          <Card
            title="Sales summary"
            right={
              <div className="flex items-center gap-2">
                <input
                  type="date"
                  className="input w-[150px]"
                  value={rangeFrom}
                  onChange={(e) => setRangeFrom(e.target.value)}
                />
                <span className="text-[12px] text-ink-soft">{t("common.to")}</span>
                <input
                  type="date"
                  className="input w-[150px]"
                  value={rangeTo}
                  onChange={(e) => setRangeTo(e.target.value)}
                />
              </div>
            }
            pad={false}
          >
            <div className="overflow-x-auto">
              <table className="register-table">
                <thead>
                  <tr>
                    <th>{t("common.grade")}</th>
                    <th>Invoices</th>
                    <th>{t("common.qty")}</th>
                    <th>{t("common.value")}</th>
                    <th>Avg paper rate</th>
                    <th>Avg realised rate</th>
                    <th>Gap</th>
                  </tr>
                </thead>
                <tbody>
                  {summary.grades.length === 0 && (
                    <tr>
                      <td colSpan={7}>
                        <EmptyState title="No sales in range" />
                      </td>
                    </tr>
                  )}
                  {summary.grades.map((g) => (
                    <tr key={g.grade}>
                      <td className="font-semibold">
                        {g.grade}
                        {g.pending > 0 && (
                          <span className="ml-2">
                            <Badge tone="warn">{g.pending} pending</Badge>
                          </span>
                        )}
                      </td>
                      <td className="tnum text-right">{g.count}</td>
                      <td className="tnum text-right">{fmtNum(g.qty)}</td>
                      <td className="tnum text-right">{fmtMoney(g.value)}</td>
                      <td className="tnum text-right">
                        {g.avgPaper === null ? "—" : fmtNum(g.avgPaper)}
                      </td>
                      <td className="tnum text-right">
                        {g.avgRate === null ? "—" : fmtNum(g.avgRate)}
                      </td>
                      <td className="text-right">
                        {g.gap === null ? (
                          "—"
                        ) : (
                          <Badge tone={isPaperRateGapWorseThanUsual(g.gap) ? "warn" : "neutral"}>
                            {fmtNum(g.gap)}
                          </Badge>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
          <Card title="Top buyers" className="mt-4" pad={false}>
            <div className="overflow-x-auto">
              <table className="register-table">
                <thead>
                  <tr>
                    <th>{t("common.buyer")}</th>
                    <th>Invoices</th>
                    <th>{t("common.qty")}</th>
                    <th>{t("common.value")}</th>
                  </tr>
                </thead>
                <tbody>
                  {summary.buyers.length === 0 && (
                    <tr>
                      <td colSpan={4}>
                        <EmptyState title="No buyers in range" />
                      </td>
                    </tr>
                  )}
                  {summary.buyers.map((b, i) => (
                    <tr key={i}>
                      <td className="font-semibold">{b.name}</td>
                      <td className="tnum text-right">{b.count}</td>
                      <td className="tnum text-right">{fmtNum(b.qty)}</td>
                      <td className="tnum text-right">{fmtMoney(b.value)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        </>
      )}

      <Modal open={manualOpen} onClose={() => setManualOpen(false)} title="Manual stock add" width={460}>
        <div className="grid grid-cols-2 gap-3">
          {hub === "latex" && (
            <Field label="Barrel">
              <select
                className="input"
                value={manualBarrel}
                onChange={(e) => setManualBarrel(Number(e.target.value) || "")}
              >
                <option value="">—</option>
                {barrelsQ.rows.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.code}
                  </option>
                ))}
              </select>
            </Field>
          )}
          {hub === "sheet" && (
            <Field label={t("common.grade")}>
              <select
                className="input"
                value={manualGrade}
                onChange={(e) => setManualGrade(e.target.value)}
              >
                {sheetGrades.map((g) => (
                  <option key={g} value={g}>
                    {g}
                  </option>
                ))}
              </select>
            </Field>
          )}
          {hub === "othercrop" && (
            <Field label="Item">
              <select
                className="input"
                value={manualItem}
                onChange={(e) => setManualItem(Number(e.target.value) || "")}
              >
                <option value="">—</option>
                {m.items.map((it) => (
                  <option key={it.id} value={it.id}>
                    {it.name}
                  </option>
                ))}
              </select>
            </Field>
          )}
          <Field label={`${t("common.qty")} (kg)`}>
            <input
              className="input"
              value={manualQty}
              onChange={(e) => setManualQty(e.target.value)}
            />
          </Field>
          <Field label={t("common.notes")} className="col-span-2">
            <input
              className="input"
              value={manualNote}
              onChange={(e) => setManualNote(e.target.value)}
            />
          </Field>
        </div>
        <div className="mt-4 flex justify-end gap-2">
          <button className="btn btn-secondary" onClick={() => setManualOpen(false)}>
            {t("common.cancel")}
          </button>
          <button className="btn btn-primary" onClick={saveManual}>
            {t("common.save")}
          </button>
        </div>
      </Modal>

      <Confirm
        open={Boolean(delInv)}
        title="Delete invoice?"
        message={`Invoice ${delInv?.invoice_no ?? ""} will be removed and its stock reversed.`}
        confirmLabel={t("common.delete")}
        danger
        onConfirm={deleteInvoice}
        onCancel={() => setDelInv(null)}
      />
    </div>
  );
}
