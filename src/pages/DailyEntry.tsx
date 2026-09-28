import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { Plus, Save, Trash2, FileSpreadsheet, Wand2, Camera } from "lucide-react";
import { useApp } from "../app/store";
import { useMasters, getDayBundle } from "../db/hooks";
import { execute, select, tx, logAudit, type TxStmt } from "../db/client";
import { exportDayPack } from "../io/daypack";
import {
  Card,
  Field,
  KPI,
  PageHeader,
  Pill,
  cn,
  EmptyState,
  Confirm,
} from "../ui/components";
import {
  addDaysISO,
  dayName,
  fmtNum,
  todayISO,
} from "../domain/dates";
import {
  autoAllocate,
  checkAllocation,
  netLatex,
} from "../domain/latex";

interface RowState {
  key: string;
  blockId: number;
  tapperId: number | null;
  productMode: "Latex" | "Sheet";
  status: "Completed" | "Not Done";
  reason: string;
  tappedDespiteRain: boolean;
  treesScheduled: number;
  treesTapped: number;
  wetSheets: number;
  scrapKg: number;
  tareKg: number;
  buckets: { label: string; kg: number }[];
  barrel1: string;
  barrel1wt: number;
  barrel2: string;
  barrel2wt: number;
  existingId: number | null;
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

export function DailyEntry() {
  const { t } = useTranslation();
  const estate = useApp((s) => s.estate)!;
  const user = useApp((s) => s.user);
  const bump = useApp((s) => s.bump);
  const masters = useMasters(estate.id);
  const profile = estate.profile;

  const [date, setDate] = useState(todayISO());
  const [weather, setWeather] = useState("");
  const [supervisor, setSupervisor] = useState("");
  const [pageNo, setPageNo] = useState("");
  const [remarks, setRemarks] = useState("");
  const [photo, setPhoto] = useState<string | null>(null);
  const [showAll, setShowAll] = useState(false);
  const [rows, setRows] = useState<RowState[]>([]);
  const [labour, setLabour] = useState<LabourState[]>([]);
  const [existingDayId, setExistingDayId] = useState<number | null>(null);
  const [dirty, setDirty] = useState(false);
  const [confirmOverwrite, setConfirmOverwrite] = useState(false);

  const tapperName = (id: number | null) =>
    id ? (masters.byId.tapper.get(id)?.name ?? "") : "";

  const loadDay = async (d: string) => {
    const bundle = await getDayBundle(estate.id, d);
    setExistingDayId(bundle.day?.id ?? null);
    setWeather(bundle.day?.weather ?? "");
    setSupervisor(bundle.day?.supervisor ?? "");
    setPageNo(bundle.day?.page_no ?? "");
    setRemarks(bundle.day?.remarks ?? "");
    setPhoto(bundle.day?.photo ?? null);

    const savedByBlock = new Map(bundle.rows.map((r) => [r.block_id, r]));
    const bucketsByRow = new Map<number, { label: string; kg: number }[]>();
    for (const b of bundle.buckets) {
      const list = bucketsByRow.get(b.row_id) || [];
      list.push({ label: b.label, kg: b.kg });
      bucketsByRow.set(b.row_id, list);
    }
    const barrelsByRow = new Map<
      number,
      { code: string; kg: number }[]
    >();
    for (const b of bundle.barrels) {
      const code = masters.byId.barrel.get(b.barrel_id)?.code ?? "";
      const list = barrelsByRow.get(b.row_id) || [];
      list.push({ code, kg: b.kg });
      barrelsByRow.set(b.row_id, list);
    }

    const visible = masters.blocks.filter((b) => {
      if (!profile.rotation || showAll) return true;
      if (profile.arrangements && b.arrangement === "Flat-rate") return false;
      return true;
    });

    setRows(
      visible.map((b): RowState => {
        const saved = savedByBlock.get(b.id);
        const bk = saved ? (bucketsByRow.get(saved.id) ?? []) : [];
        const br = saved ? (barrelsByRow.get(saved.id) ?? []) : [];
        const b1 = br[0];
        const b2 = br[1];
        return {
          key: `${b.id}`,
          blockId: b.id,
          tapperId: saved?.tapper_id ?? b.tapper_id,
          productMode:
            (saved?.product_mode as "Latex" | "Sheet") ?? profile.defaultMode,
          status: (saved?.status as "Completed" | "Not Done") ?? "Completed",
          reason: saved?.reason ?? "",
          tappedDespiteRain: Boolean(saved?.tapped_despite_rain),
          treesScheduled: saved?.trees_scheduled ?? b.trees,
          treesTapped: saved?.trees_tapped ?? 0,
          wetSheets: saved?.wet_sheets ?? 0,
          scrapKg: saved?.scrap_kg ?? 0,
          tareKg: saved?.tare_kg ?? 0,
          buckets: profile.bucketLabels.map((label) => ({
            label,
            kg: bk.find((x) => x.label === label)?.kg ?? 0,
          })),
          barrel1: b1?.code ?? "",
          barrel1wt: b1?.kg ?? 0,
          barrel2: b2?.code ?? "",
          barrel2wt: b2?.kg ?? 0,
          existingId: saved?.id ?? null,
          locked: Boolean(saved),
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

  useEffect(() => {
    if (masters.blocks.length) void loadDay(date);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [date, masters.blocks.length, showAll, estate.id]);

  const updateRow = (key: string, patch: Partial<RowState>) => {
    setRows((rs) => rs.map((r) => (r.key === key ? { ...r, ...patch } : r)));
    setDirty(true);
  };

  const barrelCodes = masters.barrels.map((b) => b.code);

  const totals = useMemo(() => {
    let wet = 0;
    let taps = 0;
    let net = 0;
    for (const r of rows) {
      if (r.status !== "Completed") continue;
      if (r.productMode === "Sheet") wet += Number(r.wetSheets) || 0;
      else taps += 1;
      net += netLatex(r.buckets, r.tareKg, true);
    }
    return { wet, taps, net };
  }, [rows]);

  const rowNet = (r: RowState) =>
    r.productMode === "Latex" && r.status === "Completed"
      ? netLatex(r.buckets, r.tareKg, true)
      : 0;

  const validation = useMemo(() => {
    const totalsMap = new Map<string, { filled: number; capacity: number }>();
    for (const b of masters.barrels) {
      totalsMap.set(b.code, { filled: 0, capacity: b.capacity });
    }
    const problems = new Map<string, string>();
    for (const r of rows) {
      if (r.status !== "Completed" || r.productMode !== "Latex") continue;
      const net = rowNet(r);
      const alloc = [
        r.barrel1 ? { barrelCode: r.barrel1, kg: Number(r.barrel1wt) || 0 } : null,
        r.barrel2 ? { barrelCode: r.barrel2, kg: Number(r.barrel2wt) || 0 } : null,
      ].filter(Boolean) as { barrelCode: string; kg: number }[];
      if (profile.barrelCapacityCheck) {
        const chk = checkAllocation(net, alloc, totalsMap);
        if (!chk.ok) problems.set(r.key, chk.message);
      }
      for (const a of alloc) {
        const cur = totalsMap.get(a.barrelCode);
        if (cur) cur.filled += a.kg;
      }
    }
    return problems;
  }, [rows, masters.barrels, profile.barrelCapacityCheck]);

  const autofill = () => {
    const open = masters.barrels
      .filter((b) => b.capacity > 0)
      .slice(0, 20)
      .map((b) => ({ barrelCode: b.code, capacity: b.capacity, current: 0 }));
    setRows((rs) =>
      rs.map((r) => {
        if (r.status !== "Completed" || r.productMode !== "Latex") return r;
        const net = rowNet(r);
        if (net <= 0) return r;
        const { alloc } = autoAllocate(net, open);
        return {
          ...r,
          barrel1: alloc[0]?.isNew ? "" : (alloc[0]?.barrelCode ?? ""),
          barrel1wt: alloc[0]?.kg ?? 0,
          barrel2: alloc[1]?.isNew ? "" : (alloc[1]?.barrelCode ?? ""),
          barrel2wt: alloc[1]?.kg ?? 0,
        };
      })
    );
    setDirty(true);
    toast.success("Suggested barrels filled (override any row by hand)");
  };

  const persist = async () => {
    const stmts: TxStmt[] = [];
    let dayId = existingDayId;

    if (dayId) {
      stmts.push({
        sql: "UPDATE entry_days SET weather=$1, supervisor=$2, page_no=$3, remarks=$4, photo=$5, updated_at=datetime('now') WHERE id=$6",
        params: [weather, supervisor, pageNo, remarks, photo, dayId],
      });
    } else {
      stmts.push({
        sql: "INSERT INTO entry_days (estate_id, date, weather, supervisor, page_no, remarks, photo, created_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)",
        params: [estate.id, date, weather, supervisor, pageNo, remarks, photo, user?.id ?? null],
      });
    }

    await tx(stmts);

    if (!existingDayId) {
      const again = await select<{ id: number }>(
        "SELECT id FROM entry_days WHERE estate_id=$1 AND date=$2",
        [estate.id, date]
      );
      dayId = again[0]?.id ?? null;
    }
    if (!dayId) return;

    for (const r of rows) {
      const params = [
        dayId,
        r.blockId,
        r.tapperId,
        r.productMode,
        r.status,
        r.reason,
        r.tappedDespiteRain ? 1 : 0,
        Number(r.treesScheduled) || 0,
        Number(r.treesTapped) || 0,
        Number(r.wetSheets) || 0,
        Number(r.scrapKg) || 0,
        Number(r.tareKg) || 0,
      ];
      let rowId = r.existingId;
      if (rowId) {
        await execute(
          "UPDATE entry_rows SET tapper_id=$1, product_mode=$2, status=$3, reason=$4, tapped_despite_rain=$5, trees_scheduled=$6, trees_tapped=$7, wet_sheets=$8, scrap_kg=$9, tare_kg=$10 WHERE id=$11",
          [
            params[2],
            params[3],
            params[4],
            params[5],
            params[6],
            params[7],
            params[8],
            params[9],
            params[10],
            params[11],
            rowId,
          ]
        );
        await execute("DELETE FROM entry_row_buckets WHERE row_id=$1", [rowId]);
        await execute("DELETE FROM entry_row_barrels WHERE row_id=$1", [rowId]);
      } else {
        const res = await execute(
          "INSERT INTO entry_rows (day_id, block_id, tapper_id, product_mode, status, reason, tapped_despite_rain, trees_scheduled, trees_tapped, wet_sheets, scrap_kg, tare_kg) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)",
          params
        );
        rowId = res.lastInsertId;
      }

      if (r.productMode === "Latex") {
        for (let i = 0; i < r.buckets.length; i++) {
          if (Number(r.buckets[i].kg) > 0) {
            await execute(
              "INSERT INTO entry_row_buckets (row_id, label, kg, sort_order) VALUES ($1,$2,$3,$4)",
              [rowId, r.buckets[i].label, Number(r.buckets[i].kg) || 0, i]
            );
          }
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
            [rowId, br.id, Number(kg) || 0, i]
          );
        }
      }
    }

    await execute("DELETE FROM labour_rows WHERE day_id=$1", [dayId]);
    for (let i = 0; i < labour.length; i++) {
      const l = labour[i];
      if (!l.name && !l.workType && !Number(l.men) && !Number(l.women)) continue;
      await execute(
        "INSERT INTO labour_rows (day_id, name, sex, men, women, work_type, who, where_, sort_order) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)",
        [
          dayId,
          l.name,
          l.sex,
          Number(l.men) || 0,
          Number(l.women) || 0,
          l.workType,
          l.who,
          l.where,
          i,
        ]
      );
    }

    await logAudit(user?.id ?? null, "save_day", "entry_days", dayId, date);
    setDirty(false);
    setExistingDayId(dayId);
    bump();
    toast.success(t("entry.saved"));
    void loadDay(date);
  };

  const onSave = () => {
    if (validation.size > 0) {
      toast.error("Fix barrel allocation problems before saving");
      return;
    }
    if (existingDayId) setConfirmOverwrite(true);
    else void persist();
  };

  const onExportDayPack = async () => {
    await exportDayPack(estate, {
      date,
      weather,
      supervisor,
      pageNo,
      remarks,
      photo,
      entries: rows.map((r) => ({
        blockCode: masters.byId.block.get(r.blockId)?.code ?? "",
        tapperName: tapperName(r.tapperId),
        productMode: r.productMode,
        status: r.status,
        reason: r.reason,
        tappedDespiteRain: r.tappedDespiteRain,
        treesScheduled: r.treesScheduled,
        treesTapped: r.treesTapped,
        wetSheets: r.wetSheets,
        scrapKg: r.scrapKg,
        tareKg: r.tareKg,
        buckets: r.buckets,
        barrels: [
          r.barrel1 ? { barrelCode: r.barrel1, kg: r.barrel1wt } : null,
          r.barrel2 ? { barrelCode: r.barrel2, kg: r.barrel2wt } : null,
        ].filter(Boolean) as { barrelCode: string; kg: number }[],
      })),
      labour: labour.map((l) => ({
        name: l.name,
        sex: l.sex,
        men: Number(l.men) || 0,
        women: Number(l.women) || 0,
        work_type: l.workType,
        who: l.who,
        where_: l.where,
        sort_order: 0,
      })),
      smokehouse: null,
    });
  };

  const reasons = masters.list("reason");
  const weathers = masters.list("weather");
  const workTypes = masters.list("workType");

  return (
    <div>
      <PageHeader
        title={t("entry.title")}
        subtitle={
          <span>
            {dayName(date)} · {date}
            {existingDayId ? (
              <span className="ml-2 text-ok">· recorded</span>
            ) : dirty ? (
              <span className="ml-2 text-warn">· unsaved changes</span>
            ) : null}
          </span>
        }
        right={
          <>
            <input
              type="date"
              className="input w-[150px]"
              value={date}
              onChange={(e) => setDate(e.target.value)}
            />
            <button className="btn btn-secondary" onClick={() => setDate(addDaysISO(date, -1))}>
              ‹
            </button>
            <button className="btn btn-secondary" onClick={() => setDate(addDaysISO(date, 1))}>
              ›
            </button>
            <button className="btn btn-secondary" onClick={onExportDayPack}>
              <FileSpreadsheet size={14} /> {t("entry.exportDayPack")}
            </button>
            <button className="btn btn-primary" onClick={onSave} disabled={!dirty}>
              <Save size={14} /> {t("entry.saveDay")}
            </button>
          </>
        }
      />

      <Card className="mb-4">
        <div className="grid grid-cols-2 gap-3 md:grid-cols-6">
          <Field label={t("entry.pageNo")}>
            <input
              className="input"
              value={pageNo}
              onChange={(e) => {
                setPageNo(e.target.value);
                setDirty(true);
              }}
            />
          </Field>
          <Field label={t("entry.supervisor")}>
            <input
              className="input"
              value={supervisor}
              onChange={(e) => {
                setSupervisor(e.target.value);
                setDirty(true);
              }}
            />
          </Field>
          <Field label={t("entry.weather")}>
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
          <Field label={t("entry.remarks")} className="md:col-span-2">
            <input
              className="input"
              value={remarks}
              onChange={(e) => {
                setRemarks(e.target.value);
                setDirty(true);
              }}
            />
          </Field>
          {profile.photos ? (
            <Field label="Logbook photo">
              <label className="btn btn-secondary w-full justify-center cursor-pointer">
                <Camera size={14} />
                {photo ? "Replace" : "Attach"}
                <input
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange={async (e) => {
                    const f = e.target.files?.[0];
                    if (!f) return;
                    const { compressImage } = await import("../io/photo");
                    const dataUrl = await compressImage(f);
                    setPhoto(dataUrl);
                    setDirty(true);
                  }}
                />
              </label>
            </Field>
          ) : (
            <div />
          )}
        </div>
      </Card>

      <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-4">
        <KPI label="Blocks in page" value={rows.length} />
        <KPI
          label={profile.productionModes.includes("Sheet") ? "Wet sheets" : "Tapping rows"}
          value={profile.productionModes.includes("Sheet") ? totals.wet : totals.taps}
        />
        <KPI label="Net latex (kg)" value={fmtNum(totals.net)} />
        <KPI label={t("entry.labour")} value={labour.length} />
      </div>

      <Card
        title="Register — tapping"
        pad={false}
        right={
          <div className="flex items-center gap-2">
            {profile.autoFillBarrels && (
              <button className="btn btn-secondary" onClick={autofill}>
                <Wand2 size={14} /> Auto-fill barrels
              </button>
            )}
            {profile.rotation && (
              <Pill active={showAll} onClick={() => setShowAll((s) => !s)}>
                {t("entry.showAllBlocks")}
              </Pill>
            )}
          </div>
        }
      >
        <div className="overflow-x-auto">
          <table className="register-table min-w-[1080px]">
            <thead>
              <tr>
                <th rowSpan={2}>Block</th>
                <th rowSpan={2}>Tapper</th>
                {profile.productionModes.length > 1 && <th rowSpan={2}>Mode</th>}
                <th rowSpan={2}>Status</th>
                <th rowSpan={2}>Reason</th>
                <th colSpan={2} className="text-center">
                  Trees
                </th>
                <th
                  colSpan={
                    profile.latexCapture === "weighing"
                      ? profile.bucketLabels.length + 3
                      : 2
                  }
                  className="text-center"
                >
                  Collection
                </th>
                <th colSpan={4} className="text-center">
                  Barrel allocation
                </th>
                <th rowSpan={2}>Rain</th>
              </tr>
              <tr>
                <th>Sched</th>
                <th>Tapped</th>
                {profile.productionModes.includes("Sheet") && <th>Wet sheets</th>}
                {profile.latexCapture === "weighing" ? (
                  <>
                    {profile.bucketLabels.map((b) => (
                      <th key={b}>{b}</th>
                    ))}
                    <th>Tare</th>
                    <th>Net</th>
                  </>
                ) : (
                  <th>Scrap kg</th>
                )}
                <th>Barrel 1</th>
                <th>kg</th>
                <th>Barrel 2</th>
                <th>kg</th>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 && (
                <tr>
                  <td colSpan={16}>
                    <EmptyState
                      title="No blocks configured"
                      hint="Add blocks in Estate setup first."
                    />
                  </td>
                </tr>
              )}
              {rows.map((r) => {
                const block = masters.byId.block.get(r.blockId);
                const problem = validation.get(r.key);
                const net = rowNet(r);
                return (
                  <tr key={r.key} className={cn(r.locked && "opacity-60")}>
                    <td className="font-semibold whitespace-nowrap">
                      {block?.code}
                      {profile.arrangements && block?.arrangement !== "Direct" && (
                        <span className="ml-1 text-[9px] text-rust">
                          {block?.arrangement}
                        </span>
                      )}
                    </td>
                    <td>
                      <select
                        className="input border-0 bg-transparent px-1 py-0.5"
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
                    {profile.productionModes.length > 1 && (
                      <td>
                        <select
                          className="input border-0 bg-transparent px-1 py-0.5"
                          value={r.productMode}
                          disabled={r.locked}
                          onChange={(e) =>
                            updateRow(r.key, {
                              productMode: e.target.value as "Latex" | "Sheet",
                            })
                          }
                        >
                          {profile.productionModes.map((m) => (
                            <option key={m} value={m}>
                              {m}
                            </option>
                          ))}
                        </select>
                      </td>
                    )}
                    <td>
                      <select
                        className="input border-0 bg-transparent px-1 py-0.5"
                        value={r.status}
                        disabled={r.locked}
                        onChange={(e) => {
                          const status = e.target.value as "Completed" | "Not Done";
                          updateRow(r.key, {
                            status,
                            ...(status === "Not Done"
                              ? {
                                  wetSheets: 0,
                                  scrapKg: 0,
                                  barrels: [],
                                  barrel1: "",
                                  barrel1wt: 0,
                                  barrel2: "",
                                  barrel2wt: 0,
                                }
                              : {}),
                          });
                        }}
                      >
                        <option>Completed</option>
                        <option>Not Done</option>
                      </select>
                    </td>
                    <td>
                      <select
                        className="input border-0 bg-transparent px-1 py-0.5"
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
                        className="input w-[64px] border-0 bg-transparent px-1 py-0.5 text-right"
                        value={r.treesScheduled}
                        disabled={r.locked}
                        onChange={(e) =>
                          updateRow(r.key, { treesScheduled: Number(e.target.value) })
                        }
                      />
                    </td>
                    <td>
                      <input
                        type="number"
                        className="input w-[64px] border-0 bg-transparent px-1 py-0.5 text-right"
                        value={r.treesTapped}
                        disabled={r.locked}
                        onChange={(e) =>
                          updateRow(r.key, { treesTapped: Number(e.target.value) })
                        }
                      />
                    </td>

                    {profile.productionModes.includes("Sheet") && (
                      <td>
                        <input
                          type="number"
                          className={cn(
                            "input w-[72px] border-0 bg-transparent px-1 py-0.5 text-right",
                            r.productMode === "Sheet" ? "" : "opacity-30"
                          )}
                          value={r.wetSheets}
                          disabled={r.locked || r.productMode !== "Sheet"}
                          onChange={(e) =>
                            updateRow(r.key, { wetSheets: Number(e.target.value) })
                          }
                        />
                      </td>
                    )}

                    {profile.latexCapture === "weighing" ? (
                      <>
                        {r.buckets.map((b, bi) => (
                          <td key={b.label}>
                            <input
                              type="number"
                              step="0.1"
                              className={cn(
                                "input w-[70px] border-0 bg-transparent px-1 py-0.5 text-right",
                                r.productMode === "Latex" ? "" : "opacity-30"
                              )}
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
                          <input
                            type="number"
                            step="0.1"
                            className={cn(
                              "input w-[64px] border-0 bg-transparent px-1 py-0.5 text-right",
                              r.productMode === "Latex" ? "" : "opacity-30"
                            )}
                            value={r.tareKg}
                            disabled={r.locked || r.productMode !== "Latex"}
                            onChange={(e) =>
                              updateRow(r.key, { tareKg: Number(e.target.value) })
                            }
                          />
                        </td>
                        <td className="tnum bg-ok-bg text-right font-semibold">
                          {fmtNum(net)}
                        </td>
                      </>
                    ) : (
                      <td>
                        <input
                          type="number"
                          step="0.1"
                          className={cn(
                            "input w-[72px] border-0 bg-transparent px-1 py-0.5 text-right",
                            r.productMode === "Latex" ? "" : "opacity-30"
                          )}
                          value={r.scrapKg}
                          disabled={r.locked || r.productMode !== "Latex"}
                          onChange={(e) =>
                            updateRow(r.key, { scrapKg: Number(e.target.value) })
                          }
                        />
                      </td>
                    )}

                    <td>
                      <select
                        className={cn(
                          "input w-[92px] border-0 bg-transparent px-1 py-0.5",
                          problem && "warn",
                          r.productMode === "Latex" ? "" : "opacity-30"
                        )}
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
                        className={cn(
                          "input w-[64px] border-0 bg-transparent px-1 py-0.5 text-right",
                          problem && "warn",
                          r.productMode === "Latex" ? "" : "opacity-30"
                        )}
                        value={r.barrel1wt}
                        disabled={r.locked || r.productMode !== "Latex"}
                        onChange={(e) =>
                          updateRow(r.key, { barrel1wt: Number(e.target.value) })
                        }
                      />
                    </td>
                    <td>
                      <select
                        className={cn(
                          "input w-[92px] border-0 bg-transparent px-1 py-0.5",
                          problem && "warn",
                          r.productMode === "Latex" ? "" : "opacity-30"
                        )}
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
                        className={cn(
                          "input w-[64px] border-0 bg-transparent px-1 py-0.5 text-right",
                          problem && "warn",
                          r.productMode === "Latex" ? "" : "opacity-30"
                        )}
                        value={r.barrel2wt}
                        disabled={r.locked || r.productMode !== "Latex"}
                        onChange={(e) =>
                          updateRow(r.key, { barrel2wt: Number(e.target.value) })
                        }
                      />
                    </td>
                    <td className="text-center">
                      <input
                        type="checkbox"
                        checked={r.tappedDespiteRain}
                        disabled={r.locked}
                        onChange={(e) =>
                          updateRow(r.key, { tappedDespiteRain: e.target.checked })
                        }
                      />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        {validation.size > 0 && (
          <div className="border-t border-paper-line bg-warn-bg px-4 py-2 text-[11.5px] text-warn">
            {[...validation.values()][0]}
          </div>
        )}
      </Card>

      <Card
        title={t("entry.labour")}
        className="mt-4"
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
                          className="input border-0 bg-transparent px-1 py-0.5"
                          value={l.name}
                          onChange={(e) => {
                            const next = [...labour];
                            next[i] = { ...l, name: e.target.value };
                            setLabour(next);
                            setDirty(true);
                          }}
                        />
                      </td>
                      <td>
                        <select
                          className="input border-0 bg-transparent px-1 py-0.5"
                          value={l.sex}
                          onChange={(e) => {
                            const next = [...labour];
                            next[i] = { ...l, sex: e.target.value };
                            setLabour(next);
                            setDirty(true);
                          }}
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
                          className="input w-[70px] border-0 bg-transparent px-1 py-0.5 text-right"
                          value={l.men}
                          onChange={(e) => {
                            const next = [...labour];
                            next[i] = { ...l, men: Number(e.target.value) };
                            setLabour(next);
                            setDirty(true);
                          }}
                        />
                      </td>
                      <td>
                        <input
                          type="number"
                          className="input w-[70px] border-0 bg-transparent px-1 py-0.5 text-right"
                          value={l.women}
                          onChange={(e) => {
                            const next = [...labour];
                            next[i] = { ...l, women: Number(e.target.value) };
                            setLabour(next);
                            setDirty(true);
                          }}
                        />
                      </td>
                    </>
                  )}
                  <td>
                    <select
                      className="input border-0 bg-transparent px-1 py-0.5"
                      value={l.workType}
                      onChange={(e) => {
                        const next = [...labour];
                        next[i] = { ...l, workType: e.target.value };
                        setLabour(next);
                        setDirty(true);
                      }}
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
                      className="input border-0 bg-transparent px-1 py-0.5"
                      value={l.who}
                      onChange={(e) => {
                        const next = [...labour];
                        next[i] = { ...l, who: e.target.value };
                        setLabour(next);
                        setDirty(true);
                      }}
                    />
                  </td>
                  <td>
                    <input
                      className="input border-0 bg-transparent px-1 py-0.5"
                      value={l.where}
                      onChange={(e) => {
                        const next = [...labour];
                        next[i] = { ...l, where: e.target.value };
                        setLabour(next);
                        setDirty(true);
                      }}
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

      <Confirm
        open={confirmOverwrite}
        title="Overwrite saved day?"
        message={`A register already exists for ${date}. Saving will replace its rows with the values on screen.`}
        confirmLabel="Replace day"
        onConfirm={() => {
          setConfirmOverwrite(false);
          void persist();
        }}
        onCancel={() => setConfirmOverwrite(false)}
      />
    </div>
  );
}
