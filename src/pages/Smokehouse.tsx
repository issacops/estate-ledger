import { useState } from "react";
import { toast } from "sonner";
import ExcelJS from "exceljs";
import { Download, Plus, Trash2, Upload } from "lucide-react";
import { save, open } from "@tauri-apps/plugin-dialog";
import { readFile, writeFile } from "@tauri-apps/plugin-fs";
import { useApp } from "../app/store";
import { useQuery } from "../db/hooks";
import { execute, select } from "../db/client";
import { Card, Confirm, EmptyState, Field, KPI, PageHeader, Table } from "../ui/components";
import { fmtDate, fmtNum, localISO, todayISO } from "../domain/dates";

const ESTATE_PERSON = "Estate";

interface LogRow {
  id: number;
  date: string;
  wet_in: number;
  dry_out: number;
  note: string;
  person: string;
}

interface StageRow {
  person: string;
  wetWaiting: number;
  inSmokehouse: number;
  inStoreroom: number;
}

interface ParsedMovement {
  date: string;
  wetIn: number;
  dryOut: number;
  note: string;
  person: string;
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

export function SmokehousePage() {
  const estate = useApp((s) => s.estate)!;
  const bump = useApp((s) => s.bump);
  const profile = estate.profile;

  const [date, setDate] = useState(todayISO());
  const [wetIn, setWetIn] = useState(0);
  const [dryOut, setDryOut] = useState(0);
  const [note, setNote] = useState("");
  const [person, setPerson] = useState(ESTATE_PERSON);
  const [confirmDelete, setConfirmDelete] = useState<LogRow | null>(null);
  const [pendingImport, setPendingImport] = useState<ParsedMovement[] | null>(null);

  const stages = useQuery<StageRow>(async () => {
    const made = await select<{ n: number }>(
      "SELECT COALESCE(SUM(r.wet_sheets),0) AS n FROM entry_rows r JOIN entry_days d ON d.id=r.day_id WHERE d.estate_id=$1 AND r.product_mode='Sheet' AND r.status='Completed'",
      [estate.id]
    );
    const logs = await select<{ person: string; wet_in: number; dry_out: number }>(
      "SELECT COALESCE(NULLIF(TRIM(person),''),'Estate') AS person, COALESCE(SUM(wet_in),0) AS wet_in, COALESCE(SUM(dry_out),0) AS dry_out FROM smokehouse_log WHERE estate_id=$1 GROUP BY 1 ORDER BY 1",
      [estate.id]
    );
    const sold = await select<{ n: number }>(
      "SELECT COALESCE(SUM(qty),0) AS n FROM invoices WHERE estate_id=$1 AND (grade LIKE 'RSS%' OR grade='Ungraded') AND status!='Cancelled'",
      [estate.id]
    );
    // The estate's own wet sheets come from Daily Entry and its sales are its
    // own, so those two stages only apply to the estate's rows; a shared
    // person's sheets arrive ready-made and leave with them.
    const persons = [ESTATE_PERSON, ...logs.map((l) => l.person).filter((p) => p !== ESTATE_PERSON)];
    return persons.map((p) => {
      const l = logs.find((x) => x.person === p);
      const inSum = l?.wet_in ?? 0;
      const outSum = l?.dry_out ?? 0;
      return {
        person: p,
        wetWaiting: Math.max(0, (p === ESTATE_PERSON ? made[0]?.n ?? 0 : 0) - inSum),
        inSmokehouse: Math.max(0, inSum - outSum),
        inStoreroom: Math.max(0, outSum - (p === ESTATE_PERSON ? sold[0]?.n ?? 0 : 0)),
      };
    });
  }, [estate.id]);

  const log = useQuery<LogRow>(
    () =>
      select<LogRow>(
        "SELECT id, date, wet_in, dry_out, note, person FROM smokehouse_log WHERE estate_id=$1 ORDER BY date DESC, id DESC",
        [estate.id]
      ),
    [estate.id]
  );

  if (!profile.smokehouse) {
    return (
      <EmptyState
        title="Smokehouse is not enabled for this estate"
        hint="Turn on the Smokehouse flag in Estate setup to record wet-in and dry-out movements."
      />
    );
  }

  const st = stages.rows;
  const personNames = Array.from(
    new Set([ESTATE_PERSON, ...log.rows.map((l) => l.person || ESTATE_PERSON)])
  );

  const addMovement = async () => {
    if (!date) {
      toast.error("Pick a date for the movement");
      return;
    }
    if (!Number(wetIn) && !Number(dryOut)) {
      toast.error("Enter wet in or dry out");
      return;
    }
    await execute(
      "INSERT INTO smokehouse_log (estate_id, date, wet_in, dry_out, note, person) VALUES ($1,$2,$3,$4,$5,$6)",
      [estate.id, date, Number(wetIn) || 0, Number(dryOut) || 0, note, person.trim() || ESTATE_PERSON]
    );
    setWetIn(0);
    setDryOut(0);
    setNote("");
    bump();
    toast.success("Movement recorded");
  };

  const deleteMovement = async () => {
    if (!confirmDelete) return;
    await execute("DELETE FROM smokehouse_log WHERE id=$1", [confirmDelete.id]);
    setConfirmDelete(null);
    bump();
    toast.success("Movement deleted");
  };

  const onExport = async () => {
    const wb = new ExcelJS.Workbook();
    wb.creator = "Estate Ledger";
    wb.created = new Date();
    const ws = wb.addWorksheet("Smokehouse");
    ws.columns = [
      { header: "Date", key: "date", width: 12 },
      { header: "WetIn", key: "wetIn", width: 10 },
      { header: "DryOut", key: "dryOut", width: 10 },
      { header: "Note", key: "note", width: 40 },
      { header: "Person", key: "person", width: 16 },
    ];
    for (const l of log.rows) {
      ws.addRow({ date: l.date, wetIn: l.wet_in, dryOut: l.dry_out, note: l.note, person: l.person });
    }
    styleHeader(ws.getRow(1));
    const buffer = await wb.xlsx.writeBuffer();
    const path = await save({
      title: "Export smokehouse log",
      defaultPath: `${estate.name}_Smokehouse_${todayISO()}.xlsx`,
      filters: [{ name: "Excel", extensions: ["xlsx"] }],
    });
    if (!path) return;
    await writeFile(path, new Uint8Array(buffer as ArrayBuffer));
    toast.success("Smokehouse log exported");
  };

  const applyImport = async (parsed: ParsedMovement[], replace: boolean) => {
    if (replace) {
      await execute("DELETE FROM smokehouse_log WHERE estate_id=$1", [estate.id]);
    }
    for (const m of parsed) {
      await execute(
        "INSERT INTO smokehouse_log (estate_id, date, wet_in, dry_out, note, person) VALUES ($1,$2,$3,$4,$5,$6)",
        [estate.id, m.date, m.wetIn, m.dryOut, m.note, m.person]
      );
    }
    setPendingImport(null);
    bump();
    toast.success(`${parsed.length} movement(s) imported`);
  };

  const onImport = async () => {
    const path = await open({
      title: "Import smokehouse log",
      multiple: false,
      filters: [{ name: "Excel", extensions: ["xlsx"] }],
    });
    if (!path || Array.isArray(path)) return;
    const bytes = await readFile(path);
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(bytes as unknown as ExcelJS.Buffer);
    const ws = wb.getWorksheet("Smokehouse");
    if (!ws) {
      toast.error("No 'Smokehouse' sheet found in this file");
      return;
    }
    const parsed: ParsedMovement[] = [];
    ws.eachRow((row, n) => {
      if (n === 1) return;
      const rawDate = row.getCell(1).value;
      let d = "";
      if (rawDate instanceof Date) d = localISO(rawDate);
      else if (rawDate !== null && rawDate !== undefined) d = String(rawDate).slice(0, 10);
      if (!d) return;
      const rawWet = row.getCell(2).value;
      const rawDry = row.getCell(3).value;
      const rawNote = row.getCell(4).value;
      const rawPerson = row.getCell(5).value;
      parsed.push({
        date: d,
        wetIn: Number(rawWet ?? 0) || 0,
        dryOut: Number(rawDry ?? 0) || 0,
        note: rawNote === null || rawNote === undefined ? "" : String(rawNote),
        person:
          rawPerson === null || rawPerson === undefined || !String(rawPerson).trim()
            ? ESTATE_PERSON
            : String(rawPerson).trim(),
      });
    });
    if (!parsed.length) {
      toast.error("No movements found in this file");
      return;
    }
    if (log.rows.length > 0) {
      setPendingImport(parsed);
      return;
    }
    await applyImport(parsed, false);
  };

  return (
    <div>
      <PageHeader
        title="Smokehouse log"
        subtitle="Wet sheets in, dry sheets out — the stock at each stage, split per person sharing the smokehouse"
        right={
          <>
            <button className="btn btn-secondary" onClick={() => void onExport()}>
              <Download size={14} /> Export log
            </button>
            <button className="btn btn-secondary" onClick={() => void onImport()}>
              <Upload size={14} /> Import log
            </button>
          </>
        }
      />

      <div className="mb-4 space-y-3">
        {st.map((s) => (
          <div key={s.person}>
            <div className="mb-2 inline-block rounded-full border border-paper-line bg-paper-deep px-2.5 py-0.5 text-[11px] font-semibold uppercase tracking-wide text-ink-soft">
              {s.person}
              {s.person !== ESTATE_PERSON && " — sharing the smokehouse"}
            </div>
            <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
              <KPI
                label="Wet sheets waiting"
                value={fmtNum(s.wetWaiting, 0)}
                sub={
                  s.person === ESTATE_PERSON
                    ? "tapped but not yet smoked"
                    : "theirs arrive ready to smoke"
                }
              />
              <KPI
                label="In smokehouse"
                value={fmtNum(s.inSmokehouse, 0)}
                sub="wet in minus dry out"
                tone="warn"
              />
              <KPI
                label="In storeroom"
                value={fmtNum(s.inStoreroom, 0)}
                sub={
                  s.person === ESTATE_PERSON
                    ? "dried and not yet sold"
                    : "dry sheets they've taken"
                }
                tone="good"
              />
            </div>
          </div>
        ))}
      </div>

      <Card className="mb-4" title="Record movement">
        <div className="grid grid-cols-2 gap-3 md:grid-cols-6">
          <Field label="Date">
            <input
              type="date"
              className="input"
              value={date}
              onChange={(e) => setDate(e.target.value)}
            />
          </Field>
          <Field label="Wet in">
            <input
              type="number"
              className="input tnum"
              value={wetIn}
              onChange={(e) => setWetIn(Number(e.target.value))}
            />
          </Field>
          <Field label="Dry out">
            <input
              type="number"
              className="input tnum"
              value={dryOut}
              onChange={(e) => setDryOut(Number(e.target.value))}
            />
          </Field>
          <Field label="Note">
            <input
              className="input"
              value={note}
              onChange={(e) => setNote(e.target.value)}
            />
          </Field>
          <Field label="Person">
            <input
              className="input"
              list="smokehouse-persons"
              value={person}
              placeholder={ESTATE_PERSON}
              onChange={(e) => setPerson(e.target.value)}
            />
            <datalist id="smokehouse-persons">
              {personNames.map((p) => (
                <option key={p} value={p} />
              ))}
            </datalist>
          </Field>
          <Field label=" ">
            <button className="btn btn-primary w-full justify-center" onClick={() => void addMovement()}>
              <Plus size={14} /> Record movement
            </button>
          </Field>
        </div>
      </Card>

      <Card title="Movements" pad={false}>
        {log.rows.length === 0 ? (
          <div className="p-4">
            <EmptyState
              title="No smokehouse movements yet"
              hint="Each batch loaded into the smokehouse and each batch taken out is recorded here."
            />
          </div>
        ) : (
          <Table headers={["Date", "Person", "Wet in", "Dry out", "Note", ""]}>
            {log.rows.map((l) => (
              <tr key={l.id}>
                <td className="whitespace-nowrap">{fmtDate(l.date)}</td>
                <td>{l.person || ESTATE_PERSON}</td>
                <td className="tnum">{fmtNum(l.wet_in, 0)}</td>
                <td className="tnum">{fmtNum(l.dry_out, 0)}</td>
                <td>{l.note}</td>
                <td className="w-8 text-center">
                  <button className="text-danger" onClick={() => setConfirmDelete(l)}>
                    <Trash2 size={13} />
                  </button>
                </td>
              </tr>
            ))}
          </Table>
        )}
      </Card>

      <Confirm
        open={Boolean(confirmDelete)}
        title="Delete movement?"
        message={`Delete the ${confirmDelete?.date ?? ""} movement (wet in ${confirmDelete?.wet_in ?? 0}, dry out ${confirmDelete?.dry_out ?? 0})?`}
        confirmLabel="Delete"
        danger
        onConfirm={() => void deleteMovement()}
        onCancel={() => setConfirmDelete(null)}
      />

      <Confirm
        open={Boolean(pendingImport)}
        title="Replace smokehouse log?"
        message={`The log already has ${log.rows.length} movement(s). Importing ${
          pendingImport?.length ?? 0
        } movement(s) from the file will replace them entirely.`}
        confirmLabel="Replace and import"
        danger
        onConfirm={() => {
          if (pendingImport) void applyImport(pendingImport, true);
        }}
        onCancel={() => setPendingImport(null)}
      />
    </div>
  );
}
