import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { Plus, Search, Trash2, UserPlus, Wallet } from "lucide-react";
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
  Pill,
} from "../ui/components";
import { fmtDate, fmtMoney, fmtNum, monthKey, todayISO } from "../domain/dates";
import { round2 } from "../domain/valuation";
import type { Purchase, VendorPayment } from "../domain/types";

type Tab = "record" | "purchases" | "vendor" | "summary";

export function PurchaseRegisterPage() {
  const { t } = useTranslation();
  const estate = useApp((s) => s.estate)!;
  const user = useApp((s) => s.user);
  const bump = useApp((s) => s.bump);
  const m = useMasters(estate.id);

  const [tab, setTab] = useState<Tab>("record");

  const purchasesQ = useQuery(
    () =>
      select<Purchase>(
        "SELECT * FROM purchases WHERE estate_id=$1 ORDER BY date DESC, id DESC",
        [estate.id]
      ),
    [estate.id]
  );
  const vpQ = useQuery(
    () =>
      select<VendorPayment>(
        "SELECT * FROM vendor_payments WHERE estate_id=$1 ORDER BY date, id",
        [estate.id]
      ),
    [estate.id]
  );
  const seqQ = useQuery(
    () =>
      select<{ next_val: number }>(
        "SELECT next_val FROM sequences WHERE estate_id=$1 AND name='purchase'",
        [estate.id]
      ),
    [estate.id]
  );

  const suggested = `PB-${seqQ.rows[0]?.next_val ?? 1}`;

  const [billNo, setBillNo] = useState("");
  const [date, setDate] = useState(todayISO());
  const [vendorId, setVendorId] = useState<number | "">("");
  const [newVendor, setNewVendor] = useState("");
  const [item, setItem] = useState("");
  const [qty, setQty] = useState("");
  const [unit, setUnit] = useState("kg");
  const [rate, setRate] = useState("");
  const [value, setValue] = useState("");
  const [note, setNote] = useState("");
  const [useSuggested, setUseSuggested] = useState(true);

  useEffect(() => {
    if (useSuggested) setBillNo(suggested);
  }, [suggested, useSuggested]);

  const qtyN = Number(qty) || 0;
  const rateN = Number(rate) || 0;
  const valueN = value.trim() === "" ? round2(qtyN * rateN) : Number(value) || 0;

  const addVendor = async () => {
    const name = newVendor.trim();
    if (!name) return;
    const res = await execute(
      "INSERT INTO vendors (estate_id, name, contact, active) VALUES ($1,$2,'',1)",
      [estate.id, name]
    );
    setVendorId(res.lastInsertId);
    setNewVendor("");
    bump();
    toast.success("Vendor added");
  };

  const savePurchase = async () => {
    if (!item.trim()) {
      toast.error("Enter an item");
      return;
    }
    if (qtyN <= 0) {
      toast.error("Enter qty");
      return;
    }
    const trimmed = billNo.trim();
    const no =
      trimmed === "" || (useSuggested && trimmed === suggested)
        ? await nextSequence(estate.id, "purchase", "PB-")
        : trimmed;
    await execute(
      "INSERT INTO purchases (estate_id, bill_no, date, vendor_id, item, qty, unit, rate, value, note) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)",
      [
        estate.id,
        no,
        date,
        vendorId || null,
        item.trim(),
        qtyN,
        unit.trim() || "kg",
        rateN,
        valueN,
        note.trim(),
      ]
    );
    await logAudit(user?.id ?? null, "create_purchase", "purchases", null, no);
    bump();
    toast.success(`Purchase ${no} recorded`);
    setItem("");
    setQty("");
    setRate("");
    setValue("");
    setNote("");
    setUseSuggested(true);
  };

  const [delP, setDelP] = useState<Purchase | null>(null);
  const [filter, setFilter] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");

  const filtered = useMemo(() => {
    const q = filter.trim().toLowerCase();
    return purchasesQ.rows.filter((p) => {
      if (from && p.date < from) return false;
      if (to && p.date > to) return false;
      if (!q) return true;
      const vname = m.byId.vendor.get(p.vendor_id ?? 0)?.name ?? "";
      return (
        p.bill_no.toLowerCase().includes(q) ||
        p.item.toLowerCase().includes(q) ||
        vname.toLowerCase().includes(q) ||
        p.note.toLowerCase().includes(q)
      );
    });
  }, [purchasesQ.rows, filter, from, to, m.byId.vendor]);

  const deletePurchase = async () => {
    if (!delP) return;
    await execute("DELETE FROM purchases WHERE id=$1", [delP.id]);
    await logAudit(user?.id ?? null, "delete_purchase", "purchases", delP.id, delP.bill_no);
    setDelP(null);
    bump();
    toast.success("Purchase deleted");
  };

  const [ledgerVendor, setLedgerVendor] = useState<number | "">("");
  const [payOpen, setPayOpen] = useState(false);
  const [payDate, setPayDate] = useState(todayISO());
  const [payAmount, setPayAmount] = useState("");
  const [payNote, setPayNote] = useState("");

  const vendorLines = useMemo(() => {
    if (!ledgerVendor) return [];
    const vid = Number(ledgerVendor);
    const lines = [
      ...purchasesQ.rows
        .filter((p) => p.vendor_id === vid)
        .map((p) => ({
          id: p.id,
          date: p.date,
          type: "Purchase",
          ref: p.bill_no,
          debit: p.value,
          credit: 0,
        })),
      ...vpQ.rows
        .filter((p) => p.vendor_id === vid)
        .map((p) => ({
          id: p.id,
          date: p.date,
          type: "Payment",
          ref: p.note,
          debit: 0,
          credit: p.amount,
        })),
    ];
    lines.sort((a, b) => a.date.localeCompare(b.date) || a.id - b.id);
    let bal = 0;
    return lines.map((l) => {
      bal = round2(bal + l.debit - l.credit);
      return { ...l, balance: bal };
    });
  }, [ledgerVendor, purchasesQ.rows, vpQ.rows]);

  const savePayment = async () => {
    const amount = Number(payAmount) || 0;
    if (!ledgerVendor || amount <= 0) {
      toast.error("Enter an amount");
      return;
    }
    const vname = m.byId.vendor.get(Number(ledgerVendor))?.name ?? "";
    const cb = await execute(
      "INSERT INTO cashbook (estate_id, date, particulars, category_code, sub, income, expense, advance, photo, source_ref) VALUES ($1,$2,$3,'E10',$4,0,$5,'No',NULL,'vendor_payment')",
      [estate.id, payDate, `Vendor payment — ${vname}`, vname, amount]
    );
    await execute(
      "INSERT INTO vendor_payments (estate_id, vendor_id, date, amount, note, cashbook_id) VALUES ($1,$2,$3,$4,$5,$6)",
      [estate.id, Number(ledgerVendor), payDate, amount, payNote.trim(), cb.lastInsertId]
    );
    await logAudit(user?.id ?? null, "vendor_payment", "vendor_payments", null, `${vname} ${amount}`);
    setPayOpen(false);
    setPayAmount("");
    setPayNote("");
    bump();
    toast.success("Payment recorded");
  };

  const summary = useMemo(() => {
    const months = [...new Set(purchasesQ.rows.map((p) => monthKey(p.date)))].sort();
    const items = [...new Set(purchasesQ.rows.map((p) => p.item))].sort();
    const grid = months.map((mo) => {
      const cells = items.map((it) =>
        purchasesQ.rows
          .filter((p) => monthKey(p.date) === mo && p.item === it)
          .reduce((s, p) => s + p.value, 0)
      );
      return { month: mo, cells, total: cells.reduce((s, v) => s + v, 0) };
    });
    const colTotals = items.map((_, i) => grid.reduce((s, r) => s + r.cells[i], 0));
    return { months, items, grid, colTotals, total: colTotals.reduce((s, v) => s + v, 0) };
  }, [purchasesQ.rows]);

  const totalSpend = purchasesQ.rows.reduce((s, p) => s + p.value, 0);
  const totalPaid = vpQ.rows.reduce((s, p) => s + p.amount, 0);

  return (
    <div>
      <PageHeader
        title="Purchase register"
        subtitle={`${purchasesQ.rows.length} bills · ${fmtMoney(totalSpend)} spend`}
        right={
          <button className="btn btn-accent" onClick={() => setPayOpen(true)} disabled={!ledgerVendor}>
            <Wallet size={14} /> Record payment
          </button>
        }
      />

      <div className="mb-4 flex flex-wrap gap-2">
        <Pill active={tab === "record"} onClick={() => setTab("record")}>
          Record
        </Pill>
        <Pill active={tab === "purchases"} onClick={() => setTab("purchases")}>
          Purchases
        </Pill>
        <Pill active={tab === "vendor"} onClick={() => setTab("vendor")}>
          Vendor ledger
        </Pill>
        <Pill active={tab === "summary"} onClick={() => setTab("summary")}>
          Summary
        </Pill>
      </div>

      {tab === "record" && (
        <Card title="Record purchase">
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <Field label="Bill no">
              <input
                className="input"
                value={billNo}
                placeholder={suggested}
                onChange={(e) => {
                  setBillNo(e.target.value);
                  setUseSuggested(false);
                }}
              />
            </Field>
            <Field label={t("common.date")}>
              <input
                type="date"
                className="input"
                value={date}
                onChange={(e) => setDate(e.target.value)}
              />
            </Field>
            <Field label="Vendor">
              <select
                className="input"
                value={vendorId}
                onChange={(e) => setVendorId(Number(e.target.value) || "")}
              >
                <option value="">—</option>
                {m.vendors.map((v) => (
                  <option key={v.id} value={v.id}>
                    {v.name}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Add vendor">
              <div className="flex gap-1">
                <input
                  className="input"
                  placeholder="New vendor"
                  value={newVendor}
                  onChange={(e) => setNewVendor(e.target.value)}
                />
                <button className="btn btn-secondary" onClick={addVendor} title="Add vendor">
                  <UserPlus size={14} />
                </button>
              </div>
            </Field>
            <Field label="Item">
              <input
                className="input"
                list="purchase-items"
                value={item}
                onChange={(e) => setItem(e.target.value)}
              />
              <datalist id="purchase-items">
                {m.items.map((it) => (
                  <option key={it.id} value={it.name} />
                ))}
              </datalist>
            </Field>
            <Field label={t("common.qty")}>
              <input
                className="input"
                value={qty}
                onChange={(e) => {
                  setQty(e.target.value);
                  setValue(String(round2((Number(e.target.value) || 0) * rateN)));
                }}
              />
            </Field>
            <Field label="Unit">
              <input className="input" value={unit} onChange={(e) => setUnit(e.target.value)} />
            </Field>
            <Field label={t("common.rate")}>
              <input
                className="input"
                value={rate}
                onChange={(e) => {
                  setRate(e.target.value);
                  setValue(String(round2(qtyN * (Number(e.target.value) || 0))));
                }}
              />
            </Field>
            <Field label={t("common.value")}>
              <input className="input" value={value} onChange={(e) => setValue(e.target.value)} />
            </Field>
            <Field label={t("common.notes")} className="md:col-span-3">
              <input className="input" value={note} onChange={(e) => setNote(e.target.value)} />
            </Field>
          </div>
          <div className="mt-4 flex items-center gap-3">
            <div className="text-[13px] text-ink-soft">
              Value {fmtMoney(valueN)}
              {value.trim() !== "" && Math.abs(valueN - round2(qtyN * rateN)) > 0.01
                ? ` (qty × rate = ${fmtMoney(round2(qtyN * rateN))})`
                : ""}
            </div>
            <button className="btn btn-primary ml-auto" onClick={savePurchase}>
              <Plus size={14} /> {t("common.save")}
            </button>
          </div>
        </Card>
      )}

      {tab === "purchases" && (
        <Card
          title="Purchases"
          pad={false}
          right={
            <div className="flex flex-wrap items-center gap-2">
              <div className="flex items-center gap-1">
                <Search size={14} className="text-ink-soft" />
                <input
                  className="input w-[160px]"
                  placeholder={t("common.search")}
                  value={filter}
                  onChange={(e) => setFilter(e.target.value)}
                />
              </div>
              <input
                type="date"
                className="input w-[140px]"
                value={from}
                onChange={(e) => setFrom(e.target.value)}
              />
              <input
                type="date"
                className="input w-[140px]"
                value={to}
                onChange={(e) => setTo(e.target.value)}
              />
            </div>
          }
        >
          <div className="overflow-x-auto">
            <table className="register-table">
              <thead>
                <tr>
                  <th>Bill no</th>
                  <th>{t("common.date")}</th>
                  <th>Vendor</th>
                  <th>Item</th>
                  <th>{t("common.qty")}</th>
                  <th>Unit</th>
                  <th>{t("common.rate")}</th>
                  <th>{t("common.value")}</th>
                  <th>{t("common.notes")}</th>
                  <th>{t("common.actions")}</th>
                </tr>
              </thead>
              <tbody>
                {filtered.length === 0 && (
                  <tr>
                    <td colSpan={10}>
                      <EmptyState title="No purchases" hint="Record a bill from the Record tab." />
                    </td>
                  </tr>
                )}
                {filtered.map((p) => (
                  <tr key={p.id}>
                    <td className="font-semibold whitespace-nowrap">{p.bill_no}</td>
                    <td className="whitespace-nowrap">{fmtDate(p.date)}</td>
                    <td>{m.byId.vendor.get(p.vendor_id ?? 0)?.name ?? "—"}</td>
                    <td>{p.item}</td>
                    <td className="tnum text-right">{fmtNum(p.qty)}</td>
                    <td>{p.unit}</td>
                    <td className="tnum text-right">{fmtNum(p.rate)}</td>
                    <td className="tnum text-right font-semibold">{fmtMoney(p.value)}</td>
                    <td>{p.note}</td>
                    <td className="text-center">
                      <button className="text-danger" onClick={() => setDelP(p)}>
                        <Trash2 size={13} />
                      </button>
                    </td>
                  </tr>
                ))}
                {filtered.length > 0 && (
                  <tr>
                    <td colSpan={7} className="text-right font-semibold">
                      {t("common.total")}
                    </td>
                    <td className="tnum text-right font-semibold">
                      {fmtMoney(filtered.reduce((s, p) => s + p.value, 0))}
                    </td>
                    <td colSpan={2} />
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {tab === "vendor" && (
        <Card
          title="Vendor ledger"
          pad={false}
          right={
            <select
              className="input w-[200px]"
              value={ledgerVendor}
              onChange={(e) => setLedgerVendor(Number(e.target.value) || "")}
            >
              <option value="">Select vendor</option>
              {m.vendors.map((v) => (
                <option key={v.id} value={v.id}>
                  {v.name}
                </option>
              ))}
            </select>
          }
        >
          {!ledgerVendor ? (
            <div className="p-4">
              <EmptyState title="Pick a vendor" hint="Select a vendor to see their statement." />
            </div>
          ) : vendorLines.length === 0 ? (
            <div className="p-4">
              <EmptyState
                title="No entries"
                action={
                  <button className="btn btn-secondary" onClick={() => setPayOpen(true)}>
                    <Wallet size={14} /> Record payment
                  </button>
                }
              />
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="register-table">
                <thead>
                  <tr>
                    <th>{t("common.date")}</th>
                    <th>Type</th>
                    <th>Bill / note</th>
                    <th>Debit</th>
                    <th>Credit</th>
                    <th>Balance</th>
                  </tr>
                </thead>
                <tbody>
                  {vendorLines.map((l, i) => (
                    <tr key={`${l.type}-${l.id}-${i}`}>
                      <td className="whitespace-nowrap">{fmtDate(l.date)}</td>
                      <td>
                        <Badge tone={l.type === "Payment" ? "ok" : "neutral"}>{l.type}</Badge>
                      </td>
                      <td>{l.ref}</td>
                      <td className="tnum text-right">{l.debit ? fmtMoney(l.debit) : ""}</td>
                      <td className="tnum text-right">{l.credit ? fmtMoney(l.credit) : ""}</td>
                      <td className="tnum text-right font-semibold">{fmtMoney(l.balance)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      )}

      {tab === "summary" && (
        <>
          <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-4">
            <KPI label="Total spend" value={fmtMoney(totalSpend)} />
            <KPI label="Paid to vendors" value={fmtMoney(totalPaid)} />
            <KPI label="Outstanding" value={fmtMoney(totalSpend - totalPaid)} tone="warn" />
            <KPI label="Bills" value={purchasesQ.rows.length} />
          </div>
          <Card title="Spend by item per month" pad={false}>
            <div className="overflow-x-auto">
              <table className="register-table">
                <thead>
                  <tr>
                    <th>Month</th>
                    {summary.items.map((it) => (
                      <th key={it}>{it}</th>
                    ))}
                    <th>{t("common.total")}</th>
                  </tr>
                </thead>
                <tbody>
                  {summary.grid.length === 0 && (
                    <tr>
                      <td colSpan={summary.items.length + 2}>
                        <EmptyState title="No purchases yet" />
                      </td>
                    </tr>
                  )}
                  {summary.grid.map((r) => (
                    <tr key={r.month}>
                      <td className="font-semibold whitespace-nowrap">{r.month}</td>
                      {r.cells.map((c, i) => (
                        <td key={i} className="tnum text-right">
                          {c ? fmtMoney(c) : "—"}
                        </td>
                      ))}
                      <td className="tnum text-right font-semibold">{fmtMoney(r.total)}</td>
                    </tr>
                  ))}
                  {summary.grid.length > 0 && (
                    <tr>
                      <td className="text-right font-semibold">{t("common.total")}</td>
                      {summary.colTotals.map((c, i) => (
                        <td key={i} className="tnum text-right font-semibold">
                          {fmtMoney(c)}
                        </td>
                      ))}
                      <td className="tnum text-right font-semibold">{fmtMoney(summary.total)}</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </Card>
        </>
      )}

      <Modal open={payOpen} onClose={() => setPayOpen(false)} title="Record vendor payment" width={460}>
        <div className="grid grid-cols-2 gap-3">
          <Field label={t("common.date")}>
            <input
              type="date"
              className="input"
              value={payDate}
              onChange={(e) => setPayDate(e.target.value)}
            />
          </Field>
          <Field label="Amount">
            <input
              className="input"
              value={payAmount}
              onChange={(e) => setPayAmount(e.target.value)}
            />
          </Field>
          <Field label={t("common.notes")} className="col-span-2">
            <input className="input" value={payNote} onChange={(e) => setPayNote(e.target.value)} />
          </Field>
        </div>
        <div className="mt-2 text-[11.5px] text-ink-soft">
          Dual-posts a cashbook expense under E10.
        </div>
        <div className="mt-4 flex justify-end gap-2">
          <button className="btn btn-secondary" onClick={() => setPayOpen(false)}>
            {t("common.cancel")}
          </button>
          <button className="btn btn-primary" onClick={savePayment}>
            {t("common.save")}
          </button>
        </div>
      </Modal>

      <Confirm
        open={Boolean(delP)}
        title="Delete purchase?"
        message={`Bill ${delP?.bill_no ?? ""} will be removed.`}
        confirmLabel={t("common.delete")}
        danger
        onConfirm={deletePurchase}
        onCancel={() => setDelP(null)}
      />
    </div>
  );
}
