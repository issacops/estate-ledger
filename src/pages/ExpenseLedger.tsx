import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import {
  Camera,
  ChevronLeft,
  ChevronRight,
  Download,
  Printer,
  Trash2,
  Upload,
} from "lucide-react";
import ExcelJS from "exceljs";
import { open, save } from "@tauri-apps/plugin-dialog";
import { readFile, writeFile } from "@tauri-apps/plugin-fs";
import { useApp } from "../app/store";
import { useMasters, useQuery } from "../db/hooks";
import { execute, logAudit, select, type SqlValue } from "../db/client";
import { WeeklyStatement } from "../ui/WeeklyStatement";
import { printDocument } from "../ui/print";
import { buildStatementWorkbook } from "../io/statementExport";
import { buildStatement, weekOfSeason } from "../domain/statement";
import { monthLabel } from "../domain/drilldown";
import {
  Badge,
  Card,
  Confirm,
  EmptyState,
  KPI,
  PageHeader,
  PhotoCell,
  Pill,
  cn,
} from "../ui/components";
import {
  addDaysISO,
  fmtDate,
  fmtMoney,
  todayISO,
  weekRange,
  monthRange,
} from "../domain/dates";
import { evalMath } from "../domain/expr";
import { round2 } from "../domain/valuation";
import type { CashbookRow } from "../domain/types";

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

function previewMath(s: string): string {
  if (s.trim() === "") return "";
  const v = evalMath(s);
  return v === null ? "Can't work that out" : `= ${v}`;
}

export function ExpenseLedgerPage() {
  const { t } = useTranslation();
  const estate = useApp((s) => s.estate)!;
  const user = useApp((s) => s.user);
  const bump = useApp((s) => s.bump);
  const m = useMasters(estate.id);

  const [anchor, setAnchor] = useState(todayISO());
  const { from, to } = weekRange(anchor);

  const rowsQ = useQuery(
    () =>
      select<CashbookRow>(
        "SELECT * FROM cashbook WHERE estate_id=$1 AND date >= $2 AND date <= $3 ORDER BY date, id",
        [estate.id, from, to]
      ),
    [estate.id, from, to]
  );
  const rows = rowsQ.rows;

  // The statement can cover the week on screen or the whole month it sits in.
  const [stmtKind, setStmtKind] = useState<"week" | "month">("week");
  const stmtRange = stmtKind === "week" ? { from, to } : monthRange(anchor);

  const stmtRowsQ = useQuery(
    () =>
      select<CashbookRow>(
        "SELECT * FROM cashbook WHERE estate_id=$1 AND date >= $2 AND date <= $3 ORDER BY date, id",
        [estate.id, stmtRange.from, stmtRange.to]
      ),
    [estate.id, stmtRange.from, stmtRange.to]
  );

  // cash in hand brought forward: every receipt less every payment before the period
  const openingQ = useQuery(
    () =>
      select<{ bal: number }>(
        "SELECT COALESCE(SUM(income - expense), 0) AS bal FROM cashbook WHERE estate_id=$1 AND date < $2",
        [estate.id, stmtRange.from]
      ),
    [estate.id, stmtRange.from]
  );
  const statement = useMemo(
    () => buildStatement(stmtRowsQ.rows, openingQ.rows[0]?.bal ?? 0),
    [stmtRowsQ.rows, openingQ.rows]
  );

  // the photographed paper register for this week or month
  const stmtPhotoQ = useQuery(
    () =>
      select<{ photo: string }>(
        "SELECT photo FROM statement_photos WHERE estate_id=$1 AND kind=$2 AND period_start=$3",
        [estate.id, stmtKind, stmtRange.from]
      ),
    [estate.id, stmtKind, stmtRange.from]
  );
  const stmtPhoto = stmtPhotoQ.rows[0]?.photo ?? null;

  const setStatementPhoto = async (dataUrl: string | null) => {
    if (dataUrl) {
      await execute(
        "INSERT INTO statement_photos (estate_id, kind, period_start, photo) VALUES ($1,$2,$3,$4) " +
          "ON CONFLICT(estate_id, kind, period_start) DO UPDATE SET photo=excluded.photo, updated_at=datetime('now')",
        [estate.id, stmtKind, stmtRange.from, dataUrl]
      );
    } else {
      await execute(
        "DELETE FROM statement_photos WHERE estate_id=$1 AND kind=$2 AND period_start=$3",
        [estate.id, stmtKind, stmtRange.from]
      );
    }
    await logAudit(
      user?.id ?? null,
      dataUrl ? "statement_photo_add" : "statement_photo_remove",
      "statement_photos",
      null,
      `${stmtKind} ${stmtRange.from}`
    );
    toast.success(dataUrl ? "Statement photo attached" : "Statement photo removed");
    bump();
  };

  const stmtTitle =
    stmtKind === "week" ? "Weekly Income & Expenses Register" : "Monthly Income & Expenses Register";
  const stmtLabel = stmtKind === "month" ? monthLabel(stmtRange.from.slice(0, 7)) : undefined;

  const cats = m.list("expenseCat");
  const catLabel = (code: string) =>
    cats.find((c) => c.code === code)?.label ?? code;

  const [fDate, setFDate] = useState(from);
  const [fParticulars, setFParticulars] = useState("");
  const [fCategory, setFCategory] = useState("");
  const [fSub, setFSub] = useState("");
  const [fIncome, setFIncome] = useState("");
  const [fExpense, setFExpense] = useState("");
  const [fAdvance, setFAdvance] = useState(false);
  const [fPhoto, setFPhoto] = useState<string | null>(null);
  const catCode = fCategory || cats[0]?.code || "";

  useEffect(() => {
    setFDate(from);
  }, [from]);

  const addRow = async () => {
    const inc = fIncome.trim() === "" ? 0 : evalMath(fIncome);
    const exp = fExpense.trim() === "" ? 0 : evalMath(fExpense);
    if (fIncome.trim() !== "" && inc === null) {
      toast.error("Income: can't work that out");
      return;
    }
    if (fExpense.trim() !== "" && exp === null) {
      toast.error("Expense: can't work that out");
      return;
    }
    if (!fParticulars.trim()) {
      toast.error("Enter particulars");
      return;
    }
    await execute(
      "INSERT INTO cashbook (estate_id, date, particulars, category_code, sub, income, expense, advance, photo, source_ref) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'')",
      [
        estate.id,
        fDate,
        fParticulars.trim(),
        catCode,
        fSub.trim(),
        inc ?? 0,
        exp ?? 0,
        fAdvance ? "Yes" : "No",
        fPhoto,
      ]
    );
    await logAudit(user?.id ?? null, "cashbook_add", "cashbook", null, fParticulars.trim());
    bump();
    toast.success("Row added");
    setFParticulars("");
    setFSub("");
    setFIncome("");
    setFExpense("");
    setFAdvance(false);
    setFPhoto(null);
  };

  const updateRow = async (id: number, patch: Partial<CashbookRow>) => {
    const keys = Object.keys(patch) as (keyof CashbookRow)[];
    if (!keys.length) return;
    const sets = keys.map((k, i) => `${String(k)}=$${i + 1}`).join(", ");
    await execute(`UPDATE cashbook SET ${sets} WHERE id=$${keys.length + 1}`, [
      ...keys.map((k) => patch[k] as SqlValue),
      id,
    ]);
    bump();
  };

  /** The receipt photographed on the phone, attached to the row afterwards. */
  const setRowPhoto = async (row: CashbookRow, dataUrl: string | null) => {
    await updateRow(row.id, { photo: dataUrl });
    await logAudit(
      user?.id ?? null,
      dataUrl ? "cashbook_photo_add" : "cashbook_photo_remove",
      "cashbook",
      row.id,
      row.particulars
    );
    toast.success(dataUrl ? "Photo attached" : "Photo removed");
  };

  const [delRow, setDelRow] = useState<CashbookRow | null>(null);

  const deleteRow = async () => {
    if (!delRow) return;
    await execute("DELETE FROM cashbook WHERE id=$1", [delRow.id]);
    await logAudit(user?.id ?? null, "cashbook_delete", "cashbook", delRow.id, delRow.particulars);
    setDelRow(null);
    bump();
    toast.success("Row deleted");
  };

  const totals = useMemo(() => {
    let income = 0;
    let expense = 0;
    for (const r of rows) {
      income += r.income;
      expense += r.expense;
    }
    income = round2(income);
    expense = round2(expense);
    return { income, expense, net: round2(income - expense) };
  }, [rows]);

  const reconciled = Math.abs(totals.income - totals.expense) <= 0.5;

  const byCategory = useMemo(() => {
    const map = new Map<string, { code: string; income: number; expense: number; n: number }>();
    for (const r of rows) {
      const e = map.get(r.category_code) ?? {
        code: r.category_code,
        income: 0,
        expense: 0,
        n: 0,
      };
      e.income += r.income;
      e.expense += r.expense;
      e.n++;
      map.set(r.category_code, e);
    }
    return [...map.values()].sort((a, b) => b.expense - a.expense || b.income - a.income);
  }, [rows]);

  const statementDoc = () => (
    <div className="print-sheet">
      <WeeklyStatement
        title={stmtTitle}
        estateName={estate.name}
        weekNo={weekOfSeason(from)}
        periodLabel={stmtLabel}
        from={stmtRange.from}
        to={stmtRange.to}
        statement={statement}
      />
    </div>
  );
  // the title becomes the file name if the office chooses "Save as PDF"
  const printStatement = () =>
    void printDocument(statementDoc(), `${estate.name} ${stmtKind} statement ${stmtRange.from}`);

  /** The statement as a spreadsheet, in the register's own layout. */
  const downloadStatement = async () => {
    try {
      const wb = buildStatementWorkbook({
        title: stmtTitle,
        estateName: estate.name,
        periodLabel: stmtLabel ?? `(${weekOfSeason(from)})`,
        from: stmtRange.from,
        to: stmtRange.to,
        statement,
      });
      const buffer = await wb.xlsx.writeBuffer();
      const path = await save({
        title: "Save statement",
        defaultPath: `${estate.name}_${stmtKind === "week" ? "Week" : "Month"}_Statement_${stmtRange.from}.xlsx`,
        filters: [{ name: "Excel", extensions: ["xlsx"] }],
      });
      if (!path) return;
      await writeFile(path, new Uint8Array(buffer as ArrayBuffer));
      toast.success("Statement saved");
    } catch (err) {
      console.error(err);
      toast.error(`Could not save the statement — ${err instanceof Error ? err.message : String(err)}`);
    }
  };

  const exportWeek = async () => {
   try {
    const wb = new ExcelJS.Workbook();
    wb.creator = "Estate Ledger";
    wb.created = new Date();
    const ws = wb.addWorksheet("IncomeExpense");
    ws.columns = [
      { header: "Date", key: "date", width: 12 },
      { header: "Particulars", key: "particulars", width: 36 },
      { header: "Category", key: "category_code", width: 12 },
      { header: "Sub", key: "sub", width: 16 },
      { header: "Income", key: "income", width: 12 },
      { header: "Expense", key: "expense", width: 12 },
      { header: "Advance", key: "advance", width: 10 },
    ];
    for (const r of rows) {
      ws.addRow({
        date: r.date,
        particulars: r.particulars,
        category_code: r.category_code,
        sub: r.sub,
        income: r.income || undefined,
        expense: r.expense || undefined,
        advance: r.advance,
      });
    }
    ws.addRow({});
    ws.addRow({ particulars: "Total", income: totals.income, expense: totals.expense });
    styleHeader(ws.getRow(1));
    const buffer = await wb.xlsx.writeBuffer();
    const path = await save({
      title: "Export week",
      defaultPath: `${estate.name}_Week_${from}.xlsx`,
      filters: [{ name: "Excel", extensions: ["xlsx"] }],
    });
    if (!path) return;
    await writeFile(path, new Uint8Array(buffer as ArrayBuffer));
    toast.success("Week exported");
   } catch (err) {
    console.error(err);
    toast.error(`Could not export the week — ${err instanceof Error ? err.message : String(err)}`);
   }
  };

  const importWeek = async () => {
    const path = await open({
      title: "Select IncomeExpense file",
      multiple: false,
      filters: [{ name: "Excel", extensions: ["xlsx"] }],
    });
    if (!path || Array.isArray(path)) return;
    const bytes = await readFile(path);
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(bytes as unknown as ExcelJS.Buffer);
    const ws = wb.getWorksheet("IncomeExpense");
    if (!ws) {
      toast.error("IncomeExpense sheet not found");
      return;
    }
    const parsed: {
      date: string;
      particulars: string;
      category_code: string;
      sub: string;
      income: number;
      expense: number;
      advance: string;
    }[] = [];
    ws.eachRow((row, n) => {
      if (n === 1) return;
      const val = (i: number) => {
        const v = row.getCell(i).value;
        return v === null || v === undefined ? "" : String(v);
      };
      const date = val(1);
      const particulars = val(2);
      if (!date || !particulars || particulars === "Total") return;
      parsed.push({
        date,
        particulars,
        category_code: val(3),
        sub: val(4),
        income: Number(val(5)) || 0,
        expense: Number(val(6)) || 0,
        advance: /yes/i.test(val(7)) ? "Yes" : "No",
      });
    });
    if (!parsed.length) {
      toast.error("No rows found to import");
      return;
    }
    for (const p of parsed) {
      await execute(
        "INSERT INTO cashbook (estate_id, date, particulars, category_code, sub, income, expense, advance, photo, source_ref) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,NULL,'import')",
        [
          estate.id,
          p.date,
          p.particulars,
          p.category_code,
          p.sub,
          p.income,
          p.expense,
          p.advance,
        ]
      );
    }
    await logAudit(user?.id ?? null, "cashbook_import", "cashbook", null, `${parsed.length} rows`);
    bump();
    toast.success(`Imported ${parsed.length} rows`);
  };

  const [incEdit, setIncEdit] = useState<Record<number, string>>({});
  const [expEdit, setExpEdit] = useState<Record<number, string>>({});

  return (
    <div>
      <div>
        <PageHeader
          title="Income & expenses"
          subtitle={`Week ${fmtDate(from)} – ${fmtDate(to)}`}
          right={
            <>
              <button className="btn btn-secondary" onClick={() => setAnchor(addDaysISO(from, -7))}>
                <ChevronLeft size={14} />
              </button>
              <input
                type="date"
                className="input w-[150px]"
                value={anchor}
                onChange={(e) => setAnchor(e.target.value || todayISO())}
              />
              <button className="btn btn-secondary" onClick={() => setAnchor(addDaysISO(to, 1))}>
                <ChevronRight size={14} />
              </button>
              <button className="btn btn-secondary" onClick={printStatement}>
                <Printer size={14} /> {t("common.print")} statement
              </button>
              <button className="btn btn-secondary" onClick={exportWeek}>
                <Download size={14} /> Export week (Excel)
              </button>
              <button className="btn btn-secondary" onClick={importWeek}>
                <Upload size={14} /> {t("common.import")}
              </button>
            </>
          }
        />

        <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-4">
          <KPI label="Income" value={fmtMoney(totals.income)} tone="good" />
          <KPI label="Expense" value={fmtMoney(totals.expense)} tone="warn" />
          <KPI
            label="Net"
            value={fmtMoney(totals.net)}
            tone={totals.net >= 0 ? "default" : "bad"}
          />
          <div
            className={cn(
              "rounded-[10px] border px-4 py-3",
              reconciled ? "border-ok/30 bg-ok-bg" : "border-warn/30 bg-warn-bg"
            )}
          >
            <div className="label">Reconciliation</div>
            <div className="mt-1 text-[13px] leading-snug font-semibold text-ink">
              {reconciled ? (
                <span className="inline-flex items-center gap-1 text-ok">
                  <Badge tone="ok">Reconciled</Badge> Income equals Expenses plus Cash by hand
                </span>
              ) : (
                <span className="inline-flex items-center gap-1 text-warn">
                  <Badge tone="warn">Mismatch</Badge> Income ≠ Expenses + Cash by hand
                </span>
              )}
            </div>
          </div>
        </div>

        <Card title="Weekly register" pad={false}>
          <div className="overflow-x-auto">
            <table className="register-table min-w-[1080px]">
              <thead>
                <tr>
                  <th>{t("common.date")}</th>
                  <th>Particulars</th>
                  <th>Category</th>
                  <th>Sub</th>
                  <th>Income</th>
                  <th>Expense</th>
                  <th>Advance</th>
                  <th>Photo</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                <tr className="bg-paper-deep">
                  <td>
                    <input
                      type="date"
                      className="input w-[130px]"
                      value={fDate}
                      onChange={(e) => setFDate(e.target.value)}
                    />
                  </td>
                  <td>
                    <input
                      className="input"
                      value={fParticulars}
                      placeholder="Particulars"
                      onChange={(e) => setFParticulars(e.target.value)}
                    />
                  </td>
                  <td>
                    <select
                      className="input w-[150px]"
                      value={catCode}
                      onChange={(e) => setFCategory(e.target.value)}
                    >
                      <option value="">—</option>
                      {cats.map((c) => (
                        <option key={c.id} value={c.code}>
                          {c.code} {c.label}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td>
                    <input
                      className="input w-[120px]"
                      value={fSub}
                      onChange={(e) => setFSub(e.target.value)}
                    />
                  </td>
                  <td>
                    <input
                      className="input w-[110px] text-right"
                      value={fIncome}
                      placeholder="0"
                      onChange={(e) => setFIncome(e.target.value)}
                    />
                    <div className="tnum mt-0.5 text-[10px] text-ink-soft">
                      {previewMath(fIncome)}
                    </div>
                  </td>
                  <td>
                    <input
                      className="input w-[110px] text-right"
                      value={fExpense}
                      placeholder="0"
                      onChange={(e) => setFExpense(e.target.value)}
                    />
                    <div className="tnum mt-0.5 text-[10px] text-ink-soft">
                      {previewMath(fExpense)}
                    </div>
                  </td>
                  <td>
                    <select
                      className="input w-[70px]"
                      value={fAdvance ? "Yes" : "No"}
                      onChange={(e) => setFAdvance(e.target.value === "Yes")}
                    >
                      <option>No</option>
                      <option>Yes</option>
                    </select>
                  </td>
                  <td>
                    <label className="btn btn-ghost cursor-pointer">
                      <Camera size={13} />
                      <input
                        type="file"
                        accept="image/*"
                        className="hidden"
                        onChange={async (e) => {
                          const f = e.target.files?.[0];
                          if (!f) return;
                          const { compressImage } = await import("../io/photo");
                          setFPhoto(await compressImage(f));
                        }}
                      />
                    </label>
                  </td>
                  <td>
                    <button className="btn btn-primary" onClick={addRow}>
                      {t("common.add")}
                    </button>
                  </td>
                </tr>
                {rows.length === 0 && (
                  <tr>
                    <td colSpan={9}>
                      <EmptyState title="No entries this week" hint="Add the first row above." />
                    </td>
                  </tr>
                )}
                {rows.map((r) => (
                  <tr key={r.id}>
                    <td>
                      <input
                        type="date"
                        className="input w-[130px] border-0 bg-transparent px-1 py-0.5"
                        defaultValue={r.date}
                        onBlur={(e) => {
                          if (e.target.value && e.target.value !== r.date)
                            void updateRow(r.id, { date: e.target.value });
                        }}
                      />
                    </td>
                    <td>
                      <input
                        className="input border-0 bg-transparent px-1 py-0.5"
                        defaultValue={r.particulars}
                        onBlur={(e) => {
                          if (e.target.value !== r.particulars)
                            void updateRow(r.id, { particulars: e.target.value });
                        }}
                      />
                    </td>
                    <td>
                      <select
                        className="input w-[150px] border-0 bg-transparent px-1 py-0.5"
                        defaultValue={r.category_code}
                        onChange={(e) => void updateRow(r.id, { category_code: e.target.value })}
                      >
                        <option value="">—</option>
                        {cats.map((c) => (
                          <option key={c.id} value={c.code}>
                            {c.code} {c.label}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td>
                      <input
                        className="input w-[120px] border-0 bg-transparent px-1 py-0.5"
                        defaultValue={r.sub}
                        onBlur={(e) => {
                          if (e.target.value !== r.sub)
                            void updateRow(r.id, { sub: e.target.value });
                        }}
                      />
                    </td>
                    <td>
                      <input
                        className="input w-[110px] border-0 bg-transparent px-1 py-0.5 text-right"
                        value={incEdit[r.id] ?? (r.income ? String(r.income) : "")}
                        onChange={(e) => setIncEdit((s) => ({ ...s, [r.id]: e.target.value }))}
                        onBlur={(e) => {
                          const raw = e.target.value;
                          setIncEdit((s) => {
                            const n = { ...s };
                            delete n[r.id];
                            return n;
                          });
                          if (raw.trim() === "") {
                            if (r.income !== 0) void updateRow(r.id, { income: 0 });
                            return;
                          }
                          const v = evalMath(raw);
                          if (v === null) {
                            toast.error("Can't work that out");
                            return;
                          }
                          if (v !== r.income) void updateRow(r.id, { income: v });
                        }}
                      />
                      {incEdit[r.id] !== undefined && (
                        <div className="tnum mt-0.5 text-[10px] text-ink-soft">
                          {previewMath(incEdit[r.id])}
                        </div>
                      )}
                    </td>
                    <td>
                      <input
                        className="input w-[110px] border-0 bg-transparent px-1 py-0.5 text-right"
                        value={expEdit[r.id] ?? (r.expense ? String(r.expense) : "")}
                        onChange={(e) => setExpEdit((s) => ({ ...s, [r.id]: e.target.value }))}
                        onBlur={(e) => {
                          const raw = e.target.value;
                          setExpEdit((s) => {
                            const n = { ...s };
                            delete n[r.id];
                            return n;
                          });
                          if (raw.trim() === "") {
                            if (r.expense !== 0) void updateRow(r.id, { expense: 0 });
                            return;
                          }
                          const v = evalMath(raw);
                          if (v === null) {
                            toast.error("Can't work that out");
                            return;
                          }
                          if (v !== r.expense) void updateRow(r.id, { expense: v });
                        }}
                      />
                      {expEdit[r.id] !== undefined && (
                        <div className="tnum mt-0.5 text-[10px] text-ink-soft">
                          {previewMath(expEdit[r.id])}
                        </div>
                      )}
                    </td>
                    <td>
                      <select
                        className="input w-[70px] border-0 bg-transparent px-1 py-0.5"
                        defaultValue={r.advance === "Yes" ? "Yes" : "No"}
                        onChange={(e) =>
                          void updateRow(r.id, { advance: e.target.value === "Yes" ? "Yes" : "No" })
                        }
                      >
                        <option>No</option>
                        <option>Yes</option>
                      </select>
                    </td>
                    <td className="text-center">
                      <PhotoCell
                        value={r.photo}
                        label={r.particulars || "Cash book entry"}
                        onChange={(dataUrl) => void setRowPhoto(r, dataUrl)}
                      />
                    </td>
                    <td className="w-8 text-center">
                      <button className="text-danger" onClick={() => setDelRow(r)}>
                        <Trash2 size={13} />
                      </button>
                    </td>
                  </tr>
                ))}
                <tr>
                  <td colSpan={4} className="text-right font-semibold">
                    {t("common.total")}
                  </td>
                  <td className="tnum text-right font-semibold">{fmtMoney(totals.income)}</td>
                  <td className="tnum text-right font-semibold">{fmtMoney(totals.expense)}</td>
                  <td colSpan={3} />
                </tr>
              </tbody>
            </table>
          </div>
        </Card>

        <Card
          title={stmtKind === "week" ? "Weekly statement" : "Monthly statement"}
          className="mt-4"
          right={
            <div className="flex items-center gap-2">
              <button className="btn btn-secondary" onClick={printStatement}>
                <Printer size={14} /> Print
              </button>
              <button className="btn btn-secondary" onClick={() => void downloadStatement()}>
                <Download size={14} /> Download
              </button>
              <Pill active={stmtKind === "week"} onClick={() => setStmtKind("week")}>
                Week
              </Pill>
              <Pill active={stmtKind === "month"} onClick={() => setStmtKind("month")}>
                Month
              </Pill>
            </div>
          }
        >
          <div className="mb-4 flex flex-wrap items-center gap-3 rounded-xl border border-paper-line bg-paper-deep px-3 py-2.5">
            <PhotoCell
              value={stmtPhoto}
              label={`${stmtKind === "week" ? "Week" : "Month"} of ${stmtRange.from}`}
              onChange={(dataUrl) => void setStatementPhoto(dataUrl)}
            />
            <div className="text-[12px]">
              <div className="font-semibold">
                {stmtPhoto ? "Photo of the written statement" : "No photo of the written statement yet"}
              </div>
              <div className="text-ink-soft">
                {stmtPhoto
                  ? "Click it to enlarge, replace or remove."
                  : `Attach a photo of the paper register for this ${stmtKind}.`}
              </div>
            </div>
          </div>
          <WeeklyStatement
            title={stmtTitle}
            estateName={estate.name}
            weekNo={weekOfSeason(from)}
            periodLabel={stmtLabel}
            from={stmtRange.from}
            to={stmtRange.to}
            statement={statement}
          />
        </Card>

        <Card title="Category totals" className="mt-4" pad={false}>
          <div className="overflow-x-auto">
            <table className="register-table">
              <thead>
                <tr>
                  <th>Category</th>
                  <th>Rows</th>
                  <th>Income</th>
                  <th>Expense</th>
                  <th>Net</th>
                </tr>
              </thead>
              <tbody>
                {byCategory.length === 0 && (
                  <tr>
                    <td colSpan={5}>
                      <EmptyState title="Nothing to summarise" />
                    </td>
                  </tr>
                )}
                {byCategory.map((c) => (
                  <tr key={c.code || "—"}>
                    <td className="font-semibold">
                      {c.code} {catLabel(c.code)}
                    </td>
                    <td className="tnum text-right">{c.n}</td>
                    <td className="tnum text-right">{c.income ? fmtMoney(c.income) : "—"}</td>
                    <td className="tnum text-right">{c.expense ? fmtMoney(c.expense) : "—"}</td>
                    <td className="tnum text-right font-semibold">
                      {fmtMoney(round2(c.income - c.expense))}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      </div>

      <Confirm
        open={Boolean(delRow)}
        title="Delete row?"
        message={`"${delRow?.particulars ?? ""}" will be removed from the cash book.`}
        confirmLabel={t("common.delete")}
        danger
        onConfirm={deleteRow}
        onCancel={() => setDelRow(null)}
      />
    </div>
  );
}
