import { useState } from "react";
import { toast } from "sonner";
import { Lock, Plus, Save, Trash2 } from "lucide-react";
import { useApp } from "../app/store";
import { useMasters, useQuery, getDayBundle } from "../db/hooks";
import { execute, select, logAudit } from "../db/client";
import { Badge, Card, Confirm, EmptyState, Field, PageHeader, cn } from "../ui/components";
import { dayName, fmtDate } from "../domain/dates";

interface DayListItem {
  id: number;
  date: string;
  supervisor: string;
  row_count: number;
}

interface RowState {
  key: string;
  rowId: number;
  blockId: number;
  tapperId: number | null;
  productMode: "Latex" | "Sheet";
  status: "Completed" | "Not Done";
  reason: string;
  wetSheets: number;
  scrapKg: number;
  tareKg: number;
  buckets: { label: string; kg: number }[];
  barrel1: string;
  barrel1wt: number;
  barrel2: string;
  barrel2wt: number;
  saleId: number | null;
  locked: boolean;
}

interface LabourState {
  name: string;
  sex: string;
  men: number;
  women: number;
  workType: string;
  who: string;
  where: string;
}

const textCls = "input border-0 bg-transparent px-1 py-0.5";
const numCls = "input w-[72px] border-0 bg-transparent px-1 py-0.5 text-right";

export function EntryHistory() {
  const estate = useApp((s) => s.estate)!;
  const user = useApp((s) => s.user);
  const bump = useApp((s) => s.bump);
  const masters = useMasters(estate.id);
  const profile = estate.profile;

  const [month, setMonth] = useState("");
  const [selected, setSelected] = useState<DayListItem | null>(null);
  const [dayId, setDayId] = useState<number | null>(null);
  const [date, setDate] = useState("");
  const [weather, setWeather] = useState("");
  const [supervisor, setSupervisor] = useState("");
  const [pageNo, setPageNo] = useState("");
  const [remarks, setRemarks] = useState("");
  const [rows, setRows] = useState<RowState[]>([]);
  const [labour, setLabour] = useState<LabourState[]>([]);
  const [dirty, setDirty] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const months = useQuery<{ m: string }>(
    () =>
      select<{ m: string }>(
        "SELECT DISTINCT substr(date,1,7) AS m FROM entry_days WHERE estate_id=$1 ORDER BY m DESC",
        [estate.id]
      ),
    [estate.id]
  );

  const days = useQuery<DayListItem>(
    () =>
      select<DayListItem>(
        month
          ? "SELECT d.id, d.date, d.supervisor, COUNT(r.id) AS row_count FROM entry_days d LEFT JOIN entry_rows r ON r.day_id=d.id WHERE d.estate_id=$1 AND d.date LIKE $2 GROUP BY d.id ORDER BY d.date DESC"
          : "SELECT d.id, d.date, d.supervisor, COUNT(r.id) AS row_count FROM entry_days d LEFT JOIN entry_rows r ON r.day_id=d.id WHERE d.estate_id=$1 GROUP BY d.id ORDER BY d.date DESC",
        month ? [estate.id, `${month}%`] : [estate.id]
      ),
    [estate.id, month]
  );

  const loadDay = async (item: DayListItem) => {
    const bundle = await getDayBundle(estate.id, item.date);
    setSelected(item);
    setDayId(bundle.day?.id ?? item.id);
    setDate(item.date);
    setWeather(bundle.day?.weather ?? "");
    setSupervisor(bundle.day?.supervisor ?? "");
    setPageNo(bundle.day?.page_no ?? "");
    setRemarks(bundle.day?.remarks ?? "");

    const bucketsByRow = new Map<number, { label: string; kg: number }[]>();
    for (const b of bundle.buckets) {
      const list = bucketsByRow.get(b.row_id) ?? [];
      list.push({ label: b.label, kg: b.kg });
      bucketsByRow.set(b.row_id, list);
    }
    const barrelsByRow = new Map<number, { code: string; kg: number }[]>();
    for (const b of bundle.barrels) {
      const list = barrelsByRow.get(b.row_id) ?? [];
      list.push({ code: masters.byId.barrel.get(b.barrel_id)?.code ?? "", kg: b.kg });
      barrelsByRow.set(b.row_id, list);
    }

    setRows(
      bundle.rows.map((r): RowState => {
        const bk = bucketsByRow.get(r.id) ?? [];
        const br = barrelsByRow.get(r.id) ?? [];
        return {
          key: `${r.id}`,
          rowId: r.id,
          blockId: r.block_id,
          tapperId: r.tapper_id,
          productMode: r.product_mode,
          status: r.status,
          reason: r.reason,
          wetSheets: r.wet_sheets,
          scrapKg: r.scrap_kg,
          tareKg: r.tare_kg,
          buckets: profile.bucketLabels.map((label) => ({
            label,
            kg: bk.find((x) => x.label === label)?.kg ?? 0,
          })),
          barrel1: br[0]?.code ?? "",
          barrel1wt: br[0]?.kg ?? 0,
          barrel2: br[1]?.code ?? "",
          barrel2wt: br[1]?.kg ?? 0,
          saleId: r.sale_id,
          locked: r.sale_id != null,
        };
      })
    );
    setLabour(
      bundle.labour.map((l) => ({
        name: l.name,
        sex: l.sex,
        men: l.men,
        women: l.women,
        workType: l.work_type,
        who: l.who,
        where: l.where_,
      }))
    );
    setDirty(false);
  };

  const updateRow = (key: string, patch: Partial<RowState>) => {
    setRows((rs) => rs.map((r) => (r.key === key ? { ...r, ...patch } : r)));
    setDirty(true);
  };

  const setStatus = (key: string, status: "Completed" | "Not Done") => {
    setRows((rs) =>
      rs.map((r) =>
        r.key === key
          ? {
              ...r,
              status,
              ...(status === "Not Done"
                ? {
                    wetSheets: 0,
                    scrapKg: 0,
                    tareKg: 0,
                    buckets: r.buckets.map((b) => ({ ...b, kg: 0 })),
                    barrel1: "",
                    barrel1wt: 0,
                    barrel2: "",
                    barrel2wt: 0,
                  }
                : {}),
            }
          : r
      )
    );
    setDirty(true);
  };

  const updateLabour = (i: number, patch: Partial<LabourState>) => {
    setLabour((ls) => ls.map((l, j) => (j === i ? { ...l, ...patch } : l)));
    setDirty(true);
  };

  const saveDay = async () => {
    if (!selected || !dayId) return;
    for (const r of rows) {
      const clash = await select<{ n: number }>(
        "SELECT COUNT(*) AS n FROM entry_rows r JOIN entry_days d ON d.id=r.day_id WHERE d.estate_id=$1 AND d.date=$2 AND r.block_id=$3 AND r.id<>$4",
        [estate.id, date, r.blockId, r.rowId]
      );
      if ((clash[0]?.n ?? 0) > 0) {
        toast.error(
          `Another entry already exists for block ${
            masters.byId.block.get(r.blockId)?.code ?? r.blockId
          } on ${date} — save blocked`
        );
        return;
      }
    }

    await execute(
      "UPDATE entry_days SET weather=$1, supervisor=$2, page_no=$3, remarks=$4, updated_at=datetime('now') WHERE id=$5",
      [weather, supervisor, pageNo, remarks, dayId]
    );

    for (const r of rows) {
      if (r.locked) continue;
      const notDone = r.status === "Not Done";
      await execute(
        "UPDATE entry_rows SET tapper_id=$1, product_mode=$2, status=$3, reason=$4, wet_sheets=$5, scrap_kg=$6, tare_kg=$7 WHERE id=$8",
        [
          r.tapperId,
          r.productMode,
          r.status,
          r.reason,
          notDone ? 0 : Number(r.wetSheets) || 0,
          notDone ? 0 : Number(r.scrapKg) || 0,
          notDone ? 0 : Number(r.tareKg) || 0,
          r.rowId,
        ]
      );
      await execute("DELETE FROM entry_row_buckets WHERE row_id=$1", [r.rowId]);
      await execute("DELETE FROM entry_row_barrels WHERE row_id=$1", [r.rowId]);
      if (notDone) continue;
      for (let i = 0; i < r.buckets.length; i++) {
        const b = r.buckets[i];
        if (Number(b.kg) <= 0) continue;
        await execute(
          "INSERT INTO entry_row_buckets (row_id, label, kg, sort_order) VALUES ($1,$2,$3,$4)",
          [r.rowId, b.label, Number(b.kg) || 0, i]
        );
      }
      const alloc = [
        [r.barrel1, r.barrel1wt],
        [r.barrel2, r.barrel2wt],
      ] as [string, number][];
      for (let i = 0; i < alloc.length; i++) {
        const [code, kg] = alloc[i];
        if (!code || Number(kg) <= 0) continue;
        const br = masters.barrels.find((b) => b.code === code);
        if (!br) continue;
        await execute(
          "INSERT INTO entry_row_barrels (row_id, barrel_id, kg, sort_order) VALUES ($1,$2,$3,$4)",
          [r.rowId, br.id, Number(kg) || 0, i]
        );
      }
    }

    await execute("DELETE FROM labour_rows WHERE day_id=$1", [dayId]);
    for (let i = 0; i < labour.length; i++) {
      const l = labour[i];
      if (!l.name && !l.workType && !Number(l.men) && !Number(l.women)) continue;
      await execute(
        "INSERT INTO labour_rows (day_id, name, sex, men, women, work_type, who, where_, sort_order) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)",
        [dayId, l.name, l.sex, Number(l.men) || 0, Number(l.women) || 0, l.workType, l.who, l.where, i]
      );
    }

    await logAudit(user?.id ?? null, "edit_day", "entry_days", dayId, date);
    bump();
    setDirty(false);
    toast.success("Day updated");
    void loadDay(selected);
  };

  const deleteDay = async () => {
    if (!selected) return;
    await execute("DELETE FROM entry_days WHERE id=$1", [selected.id]);
    await logAudit(user?.id ?? null, "delete_day", "entry_days", selected.id, selected.date);
    bump();
    toast.success(`Register for ${selected.date} deleted`);
    setConfirmDelete(false);
    setSelected(null);
    setDayId(null);
    setRows([]);
    setLabour([]);
    setDirty(false);
  };

  const reasons = masters.list("reason");
  const weathers = masters.list("weather");
  const workTypes = masters.list("workType");
  const barrelCodes = masters.barrels.map((b) => b.code);

  return (
    <div>
      <PageHeader
        title="Entry history"
        subtitle="Edit or remove saved days"
        right={
          selected ? (
            <>
              <span className="text-[11.5px] text-ink-soft">
                {dirty ? "unsaved changes" : "saved"}
              </span>
              <button className="btn btn-danger" onClick={() => setConfirmDelete(true)}>
                <Trash2 size={14} /> Delete day
              </button>
              <button className="btn btn-primary" onClick={() => void saveDay()} disabled={!dirty}>
                <Save size={14} /> Save changes
              </button>
            </>
          ) : null
        }
      />

      <div className="flex gap-4">
        <div className="w-[260px] shrink-0">
          <Card title="Saved days" pad={false}>
            <div className="border-b border-paper-line p-3">
              <Field label="Month">
                <select className="input" value={month} onChange={(e) => setMonth(e.target.value)}>
                  <option value="">All</option>
                  {months.rows.map((m) => (
                    <option key={m.m} value={m.m}>
                      {m.m}
                    </option>
                  ))}
                </select>
              </Field>
            </div>
            <div className="max-h-[68vh] overflow-y-auto">
              {days.rows.length === 0 ? (
                <div className="p-4">
                  <EmptyState
                    title="No saved days"
                    hint="Days appear here after they are saved in Daily Entry."
                  />
                </div>
              ) : (
                days.rows.map((d) => (
                  <button
                    key={d.id}
                    onClick={() => void loadDay(d)}
                    className={cn(
                      "flex w-full items-center justify-between gap-2 border-b border-paper-line px-3 py-2 text-left transition",
                      selected?.id === d.id ? "bg-ink text-paper" : "hover:bg-paper-deep"
                    )}
                  >
                    <span>
                      <span className="block text-[12px] font-semibold">{fmtDate(d.date)}</span>
                      <span className="block text-[10.5px] opacity-70">
                        {dayName(d.date)} · {d.supervisor || "—"}
                      </span>
                    </span>
                    <span className="tnum text-[11px] opacity-80">{d.row_count}</span>
                  </button>
                ))
              )}
            </div>
          </Card>
        </div>

        <div className="min-w-0 flex-1">
          {!selected || !dayId ? (
            <EmptyState
              title="Select a saved day"
              hint="Pick a day on the left to edit its register, labour and header fields."
            />
          ) : (
            <>
              <Card
                className="mb-4"
                title={
                  <span>
                    {fmtDate(date)} · {dayName(date)}
                  </span>
                }
              >
                <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
                  <Field label="Page no">
                    <input
                      className="input"
                      value={pageNo}
                      onChange={(e) => {
                        setPageNo(e.target.value);
                        setDirty(true);
                      }}
                    />
                  </Field>
                  <Field label="Supervisor">
                    <input
                      className="input"
                      value={supervisor}
                      onChange={(e) => {
                        setSupervisor(e.target.value);
                        setDirty(true);
                      }}
                    />
                  </Field>
                  <Field label="Weather">
                    <select
                      className="input"
                      value={weather}
                      onChange={(e) => {
                        setWeather(e.target.value);
                        setDirty(true);
                      }}
                    >
                      <option value="">—</option>
                      {weathers.map((w) => (
                        <option key={w.id} value={w.label}>
                          {w.label}
                        </option>
                      ))}
                    </select>
                  </Field>
                  <Field label="Remarks" className="md:col-span-2">
                    <input
                      className="input"
                      value={remarks}
                      onChange={(e) => {
                        setRemarks(e.target.value);
                        setDirty(true);
                      }}
                    />
                  </Field>
                </div>
              </Card>

              <Card className="mb-4" title="Register — tapping" pad={false}>
                <div className="overflow-x-auto">
                  <table className="register-table min-w-[1080px]">
                    <thead>
                      <tr>
                        <th>Block</th>
                        <th>Tapper</th>
                        <th>Mode</th>
                        <th>Status</th>
                        <th>Reason</th>
                        <th>Wet sheets</th>
                        <th>Scrap kg</th>
                        <th>Tare kg</th>
                        {profile.bucketLabels.map((b) => (
                          <th key={b}>{b}</th>
                        ))}
                        <th>Barrel 1</th>
                        <th>kg</th>
                        <th>Barrel 2</th>
                        <th>kg</th>
                      </tr>
                    </thead>
                    <tbody>
                      {rows.length === 0 && (
                        <tr>
                          <td colSpan={13}>
                            <EmptyState title="No rows in this register" />
                          </td>
                        </tr>
                      )}
                      {rows.map((r) => {
                        const block = masters.byId.block.get(r.blockId);
                        return (
                          <tr key={r.key} className={cn(r.locked && "opacity-60")}>
                            <td>
                              <div className="flex items-center gap-1.5 whitespace-nowrap font-semibold">
                                {block?.code}
                                {r.locked && (
                                  <Badge tone="warn">
                                    <Lock size={10} className="mr-0.5" /> part of a completed sale
                                  </Badge>
                                )}
                              </div>
                            </td>
                            <td>
                              <select
                                className={textCls}
                                value={r.tapperId ?? ""}
                                disabled={r.locked}
                                onChange={(e) =>
                                  updateRow(r.key, { tapperId: Number(e.target.value) || null })
                                }
                              >
                                <option value="">—</option>
                                {masters.tappers.map((tp) => (
                                  <option key={tp.id} value={tp.id}>
                                    {tp.name}
                                  </option>
                                ))}
                              </select>
                            </td>
                            <td>
                              <select
                                className={textCls}
                                value={r.productMode}
                                disabled={r.locked}
                                onChange={(e) =>
                                  updateRow(r.key, {
                                    productMode: e.target.value as "Latex" | "Sheet",
                                  })
                                }
                              >
                                <option>Latex</option>
                                <option>Sheet</option>
                              </select>
                            </td>
                            <td>
                              <select
                                className={textCls}
                                value={r.status}
                                disabled={r.locked}
                                onChange={(e) =>
                                  setStatus(r.key, e.target.value as "Completed" | "Not Done")
                                }
                              >
                                <option>Completed</option>
                                <option>Not Done</option>
                              </select>
                            </td>
                            <td>
                              <select
                                className={textCls}
                                value={r.reason}
                                disabled={r.locked}
                                onChange={(e) => updateRow(r.key, { reason: e.target.value })}
                              >
                                <option value="">—</option>
                                {reasons.map((x) => (
                                  <option key={x.id} value={x.label}>
                                    {x.label}
                                  </option>
                                ))}
                              </select>
                            </td>
                            <td>
                              <input
                                type="number"
                                className={cn(numCls, r.productMode === "Sheet" ? "" : "opacity-30")}
                                value={r.wetSheets}
                                disabled={r.locked || r.productMode !== "Sheet"}
                                onChange={(e) => updateRow(r.key, { wetSheets: Number(e.target.value) })}
                              />
                            </td>
                            <td>
                              <input
                                type="number"
                                step="0.1"
                                className={numCls}
                                value={r.scrapKg}
                                disabled={r.locked}
                                onChange={(e) => updateRow(r.key, { scrapKg: Number(e.target.value) })}
                              />
                            </td>
                            <td>
                              <input
                                type="number"
                                step="0.1"
                                className={numCls}
                                value={r.tareKg}
                                disabled={r.locked}
                                onChange={(e) => updateRow(r.key, { tareKg: Number(e.target.value) })}
                              />
                            </td>
                            {r.buckets.map((b, bi) => (
                              <td key={b.label}>
                                <input
                                  type="number"
                                  step="0.1"
                                  className={cn(numCls, r.productMode === "Latex" ? "" : "opacity-30")}
                                  value={b.kg}
                                  disabled={r.locked || r.productMode !== "Latex"}
                                  onChange={(e) => {
                                    const buckets = r.buckets.map((x, i) =>
                                      i === bi ? { ...x, kg: Number(e.target.value) } : x
                                    );
                                    updateRow(r.key, { buckets });
                                  }}
                                />
                              </td>
                            ))}
                            <td>
                              <select
                                className={cn(textCls, "w-[92px]", r.productMode === "Latex" ? "" : "opacity-30")}
                                value={r.barrel1}
                                disabled={r.locked || r.productMode !== "Latex"}
                                onChange={(e) => updateRow(r.key, { barrel1: e.target.value })}
                              >
                                <option value="">—</option>
                                {barrelCodes.map((c) => (
                                  <option key={c} value={c}>
                                    {c}
                                  </option>
                                ))}
                              </select>
                            </td>
                            <td>
                              <input
                                type="number"
                                step="0.1"
                                className={cn(numCls, r.productMode === "Latex" ? "" : "opacity-30")}
                                value={r.barrel1wt}
                                disabled={r.locked || r.productMode !== "Latex"}
                                onChange={(e) => updateRow(r.key, { barrel1wt: Number(e.target.value) })}
                              />
                            </td>
                            <td>
                              <select
                                className={cn(textCls, "w-[92px]", r.productMode === "Latex" ? "" : "opacity-30")}
                                value={r.barrel2}
                                disabled={r.locked || r.productMode !== "Latex"}
                                onChange={(e) => updateRow(r.key, { barrel2: e.target.value })}
                              >
                                <option value="">—</option>
                                {barrelCodes.map((c) => (
                                  <option key={c} value={c}>
                                    {c}
                                  </option>
                                ))}
                              </select>
                            </td>
                            <td>
                              <input
                                type="number"
                                step="0.1"
                                className={cn(numCls, r.productMode === "Latex" ? "" : "opacity-30")}
                                value={r.barrel2wt}
                                disabled={r.locked || r.productMode !== "Latex"}
                                onChange={(e) => updateRow(r.key, { barrel2wt: Number(e.target.value) })}
                              />
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </Card>

              <Card
                title="Labour"
                pad={false}
                right={
                  <button
                    className="btn btn-secondary"
                    onClick={() => {
                      setLabour((l) => [
                        ...l,
                        {
                          name: "",
                          sex: "",
                          men: 0,
                          women: 0,
                          workType: workTypes[0]?.label ?? "",
                          who: "",
                          where: "",
                        },
                      ]);
                      setDirty(true);
                    }}
                  >
                    <Plus size={14} /> Add
                  </button>
                }
              >
                <div className="overflow-x-auto">
                  <table className="register-table min-w-[860px]">
                    <thead>
                      <tr>
                        {profile.labour === "per-worker" ? (
                          <>
                            <th>Worker</th>
                            <th>Sex</th>
                          </>
                        ) : (
                          <>
                            <th>Men</th>
                            <th>Women</th>
                          </>
                        )}
                        <th>Work type</th>
                        <th>Who</th>
                        <th>Where</th>
                        <th />
                      </tr>
                    </thead>
                    <tbody>
                      {labour.map((l, i) => (
                        <tr key={i}>
                          {profile.labour === "per-worker" ? (
                            <>
                              <td>
                                <input
                                  className={textCls}
                                  value={l.name}
                                  onChange={(e) => updateLabour(i, { name: e.target.value })}
                                />
                              </td>
                              <td>
                                <select
                                  className={textCls}
                                  value={l.sex}
                                  onChange={(e) => updateLabour(i, { sex: e.target.value })}
                                >
                                  <option value="">—</option>
                                  <option>Male</option>
                                  <option>Female</option>
                                </select>
                              </td>
                            </>
                          ) : (
                            <>
                              <td>
                                <input
                                  type="number"
                                  className={numCls}
                                  value={l.men}
                                  onChange={(e) => updateLabour(i, { men: Number(e.target.value) })}
                                />
                              </td>
                              <td>
                                <input
                                  type="number"
                                  className={numCls}
                                  value={l.women}
                                  onChange={(e) => updateLabour(i, { women: Number(e.target.value) })}
                                />
                              </td>
                            </>
                          )}
                          <td>
                            <select
                              className={textCls}
                              value={l.workType}
                              onChange={(e) => updateLabour(i, { workType: e.target.value })}
                            >
                              <option value="">—</option>
                              {workTypes.map((w) => (
                                <option key={w.id} value={w.label}>
                                  {w.label}
                                </option>
                              ))}
                            </select>
                          </td>
                          <td>
                            <input
                              className={textCls}
                              value={l.who}
                              onChange={(e) => updateLabour(i, { who: e.target.value })}
                            />
                          </td>
                          <td>
                            <input
                              className={textCls}
                              value={l.where}
                              onChange={(e) => updateLabour(i, { where: e.target.value })}
                            />
                          </td>
                          <td className="w-8 text-center">
                            <button
                              className="text-danger"
                              onClick={() => {
                                setLabour(labour.filter((_, j) => j !== i));
                                setDirty(true);
                              }}
                            >
                              <Trash2 size={13} />
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </Card>
            </>
          )}
        </div>
      </div>

      <Confirm
        open={confirmDelete}
        title="Delete day?"
        message={`Delete the whole register for ${date}? Its rows, bucket and barrel allocations and labour entries will be removed. This cannot be undone.`}
        confirmLabel="Delete day"
        danger
        onConfirm={() => void deleteDay()}
        onCancel={() => setConfirmDelete(false)}
      />
    </div>
  );
}
