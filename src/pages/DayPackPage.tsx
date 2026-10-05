import { useState } from "react";
import { toast } from "sonner";
import { Download, History, Upload, Trash2 } from "lucide-react";
import { useApp } from "../app/store";
import { useMasters, useQuery, getDayBundle } from "../db/hooks";
import {
  countRows,
  loadBatches,
  makeUndoPlan,
  parseUndoPlan,
  undoImport,
  type BatchRow,
} from "../db/imports";
import { execute, select } from "../db/client";
import { Badge, Card, Confirm, EmptyState, Field, PageHeader, Table } from "../ui/components";
import { dayName, fmtDate, fmtNum, todayISO } from "../domain/dates";
import { exportDayPack, pickAndReadDayPack, type ImportReview } from "../io/daypack";
import type { DayPackEntryRow } from "../domain/types";

interface ReviewState extends ImportReview {
  filename: string;
  existingBlockIds: number[];
  dayExists: boolean;
}

function nextBarrelNumber(codes: string[]): number {
  let max = 0;
  for (const c of codes) {
    const m = /^BR-(\d+)$/.exec(c);
    if (m) max = Math.max(max, Number(m[1]));
  }
  return max + 1;
}

export function DayPackPage() {
  const estate = useApp((s) => s.estate)!;
  const user = useApp((s) => s.user);
  const bump = useApp((s) => s.bump);
  const masters = useMasters(estate.id);
  const profile = estate.profile;

  const [exportDate, setExportDate] = useState(todayISO());
  const [review, setReview] = useState<ReviewState | null>(null);
  const [policy, setPolicy] = useState<"replace" | "skip">("replace");
  const [busy, setBusy] = useState(false);

  const savedDay = useQuery<{ id: number }>(
    () =>
      select<{ id: number }>("SELECT id FROM entry_days WHERE estate_id=$1 AND date=$2", [
        estate.id,
        exportDate,
      ]),
    [estate.id, exportDate]
  );

  const history = useQuery<BatchRow>(() => loadBatches(estate.id, "daypack"), [estate.id]);
  const [undoing, setUndoing] = useState<BatchRow | null>(null);

  const onExport = async () => {
    const bundle = await getDayBundle(estate.id, exportDate);
    if (!bundle.day) {
      toast.error("No saved day for this date — record it in Daily Entry first");
      return;
    }
    const bucketsByRow = new Map<number, { label: string; kg: number }[]>();
    for (const b of bundle.buckets) {
      const list = bucketsByRow.get(b.row_id) ?? [];
      list.push({ label: b.label, kg: b.kg });
      bucketsByRow.set(b.row_id, list);
    }
    const barrelsByRow = new Map<number, { barrelCode: string; kg: number }[]>();
    for (const b of bundle.barrels) {
      const list = barrelsByRow.get(b.row_id) ?? [];
      list.push({ barrelCode: masters.byId.barrel.get(b.barrel_id)?.code ?? "", kg: b.kg });
      barrelsByRow.set(b.row_id, list);
    }
    const entries: DayPackEntryRow[] = bundle.rows.map((r) => ({
      blockCode: masters.byId.block.get(r.block_id)?.code ?? "",
      tapperName: r.tapper_id ? (masters.byId.tapper.get(r.tapper_id)?.name ?? "") : "",
      productMode: r.product_mode,
      status: r.status,
      reason: r.reason,
      tappedDespiteRain: Boolean(r.tapped_despite_rain),
      treesScheduled: r.trees_scheduled,
      treesTapped: r.trees_tapped,
      wetSheets: r.wet_sheets,
      scrapKg: r.scrap_kg,
      tareKg: r.tare_kg,
      buckets: bucketsByRow.get(r.id) ?? [],
      barrels: barrelsByRow.get(r.id) ?? [],
    }));
    const labour = bundle.labour.map((l) => ({
      name: l.name,
      sex: l.sex,
      men: l.men,
      women: l.women,
      work_type: l.work_type,
      who: l.who,
      where_: l.where_,
      sort_order: l.sort_order,
    }));
    const path = await exportDayPack(estate, {
      date: bundle.day.date,
      weather: bundle.day.weather,
      supervisor: bundle.day.supervisor,
      pageNo: bundle.day.page_no,
      remarks: bundle.day.remarks,
      photo: bundle.day.photo,
      entries,
      labour,
      smokehouse: null,
    });
    if (path) toast.success(`Day Pack exported for ${bundle.day.date}`);
  };

  const onPick = async () => {
    const picked = await pickAndReadDayPack(estate.code);
    if (!picked) return;
    const knownBlocks = new Set(masters.blocks.map((b) => b.code));
    const knownTappers = new Set(masters.tappers.map((t) => t.name));
    const knownBarrels = new Set(masters.barrels.map((b) => b.code));
    const unknownBlocks = [
      ...new Set(
        picked.pack.entries.map((e) => e.blockCode).filter((c) => c && !knownBlocks.has(c))
      ),
    ];
    const unknownTappers = [
      ...new Set(
        picked.pack.entries.map((e) => e.tapperName).filter((n) => n && !knownTappers.has(n))
      ),
    ];
    const unknownBarrels = [
      ...new Set(
        picked.pack.entries
          .flatMap((e) => e.barrels.map((b) => b.barrelCode))
          .filter((c) => c && !knownBarrels.has(c))
      ),
    ];
    const existing = await select<{ block_id: number }>(
      "SELECT r.block_id FROM entry_rows r JOIN entry_days d ON d.id=r.day_id WHERE d.estate_id=$1 AND d.date=$2",
      [estate.id, picked.pack.date]
    );
    const dayExists = await select<{ id: number }>(
      "SELECT id FROM entry_days WHERE estate_id=$1 AND date=$2",
      [estate.id, picked.pack.date]
    );
    setReview({
      ...picked,
      unknownBlocks,
      unknownTappers,
      unknownBarrels,
      filename: `${estate.name}_DayPack_${picked.pack.date}.xlsx`,
      existingBlockIds: existing.map((r) => r.block_id),
      dayExists: dayExists.length > 0,
    });
  };

  const commit = async () => {
    if (!review) return;
    setBusy(true);
    try {
      const pack = review.pack;
      const blockIdByCode = new Map(masters.blocks.map((b) => [b.code, b.id] as const));
      const tapperIdByName = new Map(masters.tappers.map((t) => [t.name, t.id] as const));
      const barrelIdByCode = new Map(masters.barrels.map((b) => [b.code, b.id] as const));

      for (const code of review.unknownBlocks) {
        const res = await execute(
          "INSERT INTO blocks (estate_id, code, name, trees, arrangement, active) VALUES ($1,$2,$3,0,'Direct',1)",
          [estate.id, code, code]
        );
        blockIdByCode.set(code, res.lastInsertId);
      }
      for (const name of review.unknownTappers) {
        const res = await execute(
          "INSERT INTO tappers (estate_id, name, type, tap_days, status, sort_order) VALUES ($1,$2,'Employee',2,'Active',0)",
          [estate.id, name]
        );
        tapperIdByName.set(name, res.lastInsertId);
      }
      let barrelN = nextBarrelNumber(masters.barrels.map((b) => b.code));
      for (const code of review.unknownBarrels) {
        const minted = `BR-${barrelN++}`;
        const res = await execute(
          "INSERT INTO barrels (estate_id, code, capacity, active) VALUES ($1,$2,$3,1)",
          [estate.id, minted, profile.defaultBarrelCapacity]
        );
        barrelIdByCode.set(code, res.lastInsertId);
      }

      const days = await select<{ id: number }>(
        "SELECT id FROM entry_days WHERE estate_id=$1 AND date=$2",
        [estate.id, pack.date]
      );
      let dayId: number;
      let createdDayId: number | null = null;
      // "Skip" means keep what is saved: an existing day's header, photo and
      // labour are only rewritten when the day is being replaced.
      const keepSavedDay = days.length > 0 && policy === "skip";
      if (days.length) {
        dayId = days[0].id;
        if (policy === "replace") {
          await execute(
            "UPDATE entry_days SET weather=$1, supervisor=$2, page_no=$3, remarks=$4, photo=COALESCE($5, photo), updated_at=datetime('now') WHERE id=$6",
            [pack.weather, pack.supervisor, pack.pageNo, pack.remarks, pack.photo, dayId]
          );
          await execute("DELETE FROM entry_rows WHERE day_id=$1", [dayId]);
        }
      } else {
        const res = await execute(
          "INSERT INTO entry_days (estate_id, date, weather, supervisor, page_no, remarks, photo, created_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)",
          [estate.id, pack.date, pack.weather, pack.supervisor, pack.pageNo, pack.remarks, pack.photo, user?.id ?? null]
        );
        dayId = res.lastInsertId;
        createdDayId = dayId;
      }

      const conflictIds = new Set(policy === "replace" ? [] : review.existingBlockIds);
      let saved = 0;
      let skipped = 0;
      // first id written into each table, so the batch can be taken out again
      let firstRow = 0, firstBucket = 0, firstBarrel = 0, firstLabour = 0;
      let nBuckets = 0, nBarrels = 0, nLabour = 0;
      for (const e of pack.entries) {
        const blockId = blockIdByCode.get(e.blockCode);
        if (!blockId || conflictIds.has(blockId)) {
          skipped++;
          continue;
        }
        const tapperId = e.tapperName ? (tapperIdByName.get(e.tapperName) ?? null) : null;
        const res = await execute(
          "INSERT INTO entry_rows (day_id, block_id, tapper_id, product_mode, status, reason, tapped_despite_rain, trees_scheduled, trees_tapped, wet_sheets, scrap_kg, tare_kg) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)",
          [
            dayId,
            blockId,
            tapperId,
            e.productMode,
            e.status,
            e.reason,
            e.tappedDespiteRain ? 1 : 0,
            e.treesScheduled,
            e.treesTapped,
            e.wetSheets,
            e.scrapKg,
            e.tareKg,
          ]
        );
        const rowId = res.lastInsertId;
        if (!firstRow) firstRow = rowId;
        for (let i = 0; i < e.buckets.length; i++) {
          const b = e.buckets[i];
          if (Number(b.kg) <= 0) continue;
          const bk = await execute(
            "INSERT INTO entry_row_buckets (row_id, label, kg, sort_order) VALUES ($1,$2,$3,$4)",
            [rowId, b.label, Number(b.kg) || 0, i]
          );
          if (!firstBucket) firstBucket = bk.lastInsertId;
          nBuckets++;
        }
        for (let i = 0; i < e.barrels.length; i++) {
          const b = e.barrels[i];
          const barrelId = barrelIdByCode.get(b.barrelCode);
          if (!barrelId || Number(b.kg) <= 0) continue;
          const br = await execute(
            "INSERT INTO entry_row_barrels (row_id, barrel_id, kg, sort_order) VALUES ($1,$2,$3,$4)",
            [rowId, barrelId, Number(b.kg) || 0, i]
          );
          if (!firstBarrel) firstBarrel = br.lastInsertId;
          nBarrels++;
        }
        saved++;
      }

      if (!keepSavedDay) await execute("DELETE FROM labour_rows WHERE day_id=$1", [dayId]);
      for (let i = 0; i < (keepSavedDay ? 0 : pack.labour.length); i++) {
        const l = pack.labour[i];
        if (!l.name && !l.work_type && !Number(l.men) && !Number(l.women)) continue;
        const lb = await execute(
          "INSERT INTO labour_rows (day_id, name, sex, men, women, work_type, who, where_, sort_order) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)",
          [dayId, l.name, l.sex, Number(l.men) || 0, Number(l.women) || 0, l.work_type, l.who, l.where_, i]
        );
        if (!firstLabour) firstLabour = lb.lastInsertId;
        nLabour++;
      }

      const summary =
        `${pack.date} · ${policy === "replace" ? "replace day" : "skip conflicts"} · ${saved} rows saved` +
        (skipped ? ` · ${skipped} skipped` : "") +
        ` · ${review.unknownBlocks.length} blocks, ${review.unknownTappers.length} tappers, ${review.unknownBarrels.length} barrels auto-created`;
      const undo = makeUndoPlan({
        entry_days:        { first: createdDayId ?? 0, count: createdDayId ? 1 : 0 },
        entry_rows:        { first: firstRow, count: saved },
        entry_row_buckets: { first: firstBucket, count: nBuckets },
        entry_row_barrels: { first: firstBarrel, count: nBarrels },
        labour_rows:       { first: firstLabour, count: nLabour },
      });
      await execute(
        "INSERT INTO import_batches (estate_id, kind, filename, row_count, status, summary, undo_json) VALUES ($1,'daypack',$2,$3,'Committed',$4,$5)",
        [estate.id, review.filename, saved, summary, JSON.stringify(undo)]
      );

      toast.success(`Day pack imported — ${saved} row(s) saved`);
      setReview(null);
      bump();
    } catch (err) {
      console.error(err);
      toast.error("Import failed — check the file and try again");
    } finally {
      setBusy(false);
    }
  };

  const runUndo = async () => {
    if (!undoing) return;
    setBusy(true);
    try {
      const n = await undoImport(undoing);
      toast.success(`Import removed — ${fmtNum(n, 0)} row(s) deleted`);
      setUndoing(null);
      bump();
      history.reload();
    } catch (err) {
      console.error(err);
      toast.error(err instanceof Error ? err.message : "Could not remove that import");
    } finally {
      setBusy(false);
    }
  };

  const badgeFor = (e: DayPackEntryRow): { label: string; tone: "ok" | "warn" | "neutral" } => {
    if (!review) return { label: "New", tone: "ok" };
    const known = masters.blocks.find((b) => b.code === e.blockCode);
    if (known && review.existingBlockIds.includes(known.id)) return { label: "Conflict", tone: "warn" };
    if (review.dayExists) return { label: "Update", tone: "neutral" };
    return { label: "New", tone: "ok" };
  };

  return (
    <div>
      <PageHeader
        title="Day Pack"
        subtitle="Export saved days to Excel and import field packs back into the ledger"
      />

      <Card className="mb-4" title="Export a day">
        <div className="flex flex-wrap items-end gap-3">
          <Field label="Date">
            <input
              type="date"
              className="input w-[170px]"
              value={exportDate}
              onChange={(e) => setExportDate(e.target.value)}
            />
          </Field>
          {savedDay.rows.length > 0 ? (
            <button className="btn btn-primary" onClick={() => void onExport()}>
              <Download size={14} /> Export Day Pack
            </button>
          ) : (
            <div className="text-[11.5px] text-ink-soft">
              {dayName(exportDate)} · {fmtDate(exportDate)}
            </div>
          )}
        </div>
        {savedDay.rows.length === 0 ? (
          <div className="mt-3">
            <EmptyState
              title="No saved day for this date"
              hint="Record the register in Daily Entry first — only saved days can be exported as a Day Pack."
            />
          </div>
        ) : (
          <div className="mt-3 text-[11.5px] text-ink-soft">
            This day is recorded in the ledger. The Day Pack file carries the register, labour rows and
            day header for offline sync over WhatsApp or email.
          </div>
        )}
      </Card>

      <Card className="mb-4" title="Import a day pack">
        {!review ? (
          <div className="flex flex-wrap items-center gap-3">
            <button className="btn btn-primary" onClick={() => void onPick()}>
              <Upload size={14} /> Choose Day Pack file
            </button>
            <div className="text-[11.5px] text-ink-soft">
              Select the Excel file received from the field. Nothing is written until the review below is
              committed.
            </div>
          </div>
        ) : (
          <div>
            <div className="grid grid-cols-2 gap-3 md:grid-cols-6">
              <div>
                <div className="label">Date</div>
                <div className="text-[13px] text-ink">
                  {fmtDate(review.pack.date)} · {dayName(review.pack.date)}
                </div>
              </div>
              <div>
                <div className="label">Supervisor</div>
                <div className="text-[13px] text-ink">{review.pack.supervisor || "—"}</div>
              </div>
              <div>
                <div className="label">Weather</div>
                <div className="text-[13px] text-ink">{review.pack.weather || "—"}</div>
              </div>
              <div>
                <div className="label">Page no</div>
                <div className="text-[13px] text-ink">{review.pack.pageNo || "—"}</div>
              </div>
              <div>
                <div className="label">Entry rows</div>
                <div className="tnum text-[13px] text-ink">{review.pack.entries.length}</div>
              </div>
              <div>
                <div className="label">Labour rows</div>
                <div className="tnum text-[13px] text-ink">{review.pack.labour.length}</div>
              </div>
            </div>
            {review.pack.remarks && (
              <div className="mt-2 text-[11.5px] text-ink-soft">Remarks: {review.pack.remarks}</div>
            )}

            {(review.unknownBlocks.length > 0 ||
              review.unknownTappers.length > 0 ||
              review.unknownBarrels.length > 0) && (
              <div className="mt-3 rounded-[10px] border border-warn/30 bg-warn-bg px-3 py-2">
                <div className="label text-warn">Will be auto-created on commit</div>
                <div className="mt-1 space-y-1 text-[11.5px] text-ink-light">
                  {review.unknownBlocks.length > 0 && (
                    <div>
                      Blocks:{" "}
                      {review.unknownBlocks.map((c) => (
                        <span key={c} className="mr-1">
                          <Badge tone="neutral">{c}</Badge>
                        </span>
                      ))}
                    </div>
                  )}
                  {review.unknownTappers.length > 0 && (
                    <div>
                      Tappers (Employee, tap days 2):{" "}
                      {review.unknownTappers.map((c) => (
                        <span key={c} className="mr-1">
                          <Badge tone="neutral">{c}</Badge>
                        </span>
                      ))}
                    </div>
                  )}
                  {review.unknownBarrels.length > 0 && (
                    <div>
                      Barrels (fresh BR codes, capacity{" "}
                      {fmtNum(profile.defaultBarrelCapacity, 0)} kg):{" "}
                      {review.unknownBarrels.map((c) => (
                        <span key={c} className="mr-1">
                          <Badge tone="neutral">{c}</Badge>
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            )}

            <div className="mt-3">
              <Table headers={["Status", "Block", "Tapper", "Mode", "Wet sheets", "Scrap kg", "Tare kg", "Buckets", "Barrels"]}>
                {review.pack.entries.map((e, i) => {
                  const badge = badgeFor(e);
                  return (
                    <tr key={i}>
                      <td>
                        <Badge tone={badge.tone}>{badge.label}</Badge>
                      </td>
                      <td className="font-semibold whitespace-nowrap">{e.blockCode}</td>
                      <td className="whitespace-nowrap">{e.tapperName || "—"}</td>
                      <td>{e.productMode}</td>
                      <td className="tnum">{fmtNum(e.wetSheets, 0)}</td>
                      <td className="tnum">{fmtNum(e.scrapKg)}</td>
                      <td className="tnum">{fmtNum(e.tareKg)}</td>
                      <td className="whitespace-nowrap">
                        {e.buckets.map((b) => `${b.label}: ${fmtNum(b.kg)}`).join(", ") || "—"}
                      </td>
                      <td className="whitespace-nowrap">
                        {e.barrels.map((b) => `${b.barrelCode}: ${fmtNum(b.kg)}`).join(", ") || "—"}
                      </td>
                    </tr>
                  );
                })}
              </Table>
            </div>

            <div className="mt-4 flex flex-wrap items-end gap-3">
              <Field label="Conflict policy">
                <select
                  className="input w-[220px]"
                  value={policy}
                  onChange={(e) => setPolicy(e.target.value as "replace" | "skip")}
                >
                  <option value="replace">Replace day</option>
                  <option value="skip">Skip conflicting rows</option>
                </select>
              </Field>
              <div className="text-[11.5px] text-ink-soft">
                {policy === "replace"
                  ? "Existing rows for this date are deleted and the pack is written in full."
                  : "Rows that already exist for a block on this date are left untouched."}
              </div>
              <div className="ml-auto flex items-center gap-2">
                <button className="btn btn-secondary" onClick={() => setReview(null)} disabled={busy}>
                  Cancel
                </button>
                <button className="btn btn-primary" onClick={() => void commit()} disabled={busy}>
                  <Upload size={14} /> Commit import
                </button>
              </div>
            </div>
          </div>
        )}
      </Card>

      <Card title={<span className="flex items-center gap-2"><History size={14} /> Import history</span>} pad={false}>
        {history.rows.length === 0 ? (
          <div className="p-4">
            <EmptyState title="No imports yet" hint="Committed Day Pack imports are listed here." />
          </div>
        ) : (
          <Table headers={["Date", "Kind", "Filename", "Rows", "Status", "Summary", ""]}>
            {history.rows.map((b) => {
              const plan = parseUndoPlan(b.undo_json);
              return (
                <tr key={b.id}>
                  <td className="whitespace-nowrap">{fmtDate(b.created_at.slice(0, 10))}</td>
                  <td>{b.kind}</td>
                  <td className="whitespace-nowrap">{b.filename}</td>
                  <td className="tnum">{fmtNum(b.row_count, 0)}</td>
                  <td>
                    <Badge tone="ok">{b.status}</Badge>
                  </td>
                  <td>{b.summary}</td>
                  <td className="whitespace-nowrap text-right">
                    {plan ? (
                      <button
                        className="btn btn-danger"
                        onClick={() => setUndoing(b)}
                        disabled={busy}
                        title="Remove everything this Day Pack added"
                      >
                        <Trash2 size={13} /> Delete
                      </button>
                    ) : (
                      <span className="text-[11px] text-ink-soft">
                        imported before undo was recorded
                      </span>
                    )}
                  </td>
                </tr>
              );
            })}
          </Table>
        )}
      </Card>

      <Confirm
        open={!!undoing}
        danger
        title="Delete this Day Pack import?"
        confirmLabel="Delete import"
        message={
          undoing
            ? `This removes the ${fmtNum(
                countRows(parseUndoPlan(undoing.undo_json) ?? {}),
                0
              )} row(s) that "${undoing.filename}" added. Anything typed in by hand afterwards is left alone. ` +
              `If this pack was committed with "Replace day", the rows it overwrote were deleted at the time and will not come back.`
            : ""
        }
        onConfirm={runUndo}
        onCancel={() => setUndoing(null)}
      />
    </div>
  );
}
