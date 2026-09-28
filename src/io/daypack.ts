import ExcelJS from "exceljs";
import { save, open } from "@tauri-apps/plugin-dialog";
import { writeFile, readFile } from "@tauri-apps/plugin-fs";
import type { DayPack, Estate, DayPackEntryRow } from "../domain/types";
import { dayName } from "../domain/dates";

const VERSION = 1;

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

export async function exportDayPack(estate: Estate, pack: Omit<DayPack, "version" | "estateCode">) {
  const wb = new ExcelJS.Workbook();
  wb.creator = "Estate Ledger";
  wb.created = new Date();

  const info = wb.addWorksheet("DayInfo");
  info.columns = [{ width: 18 }, { width: 40 }];
  const infoRows: [string, string][] = [
    ["Estate", estate.name],
    ["Date", pack.date],
    ["Day", dayName(pack.date)],
    ["Page no", pack.pageNo],
    ["Supervisor", pack.supervisor],
    ["Weather", pack.weather],
    ["Remarks", pack.remarks],
    ["Format", `EstateLedger DayPack v${VERSION}`],
  ];
  info.addRows(infoRows);
  info.getRow(1).font = { bold: true };

  const entries = wb.addWorksheet("Entries");
  entries.columns = [
    { header: "Block", key: "block", width: 10 },
    { header: "Tapper", key: "tapper", width: 16 },
    { header: "Mode", key: "mode", width: 8 },
    { header: "Status", key: "status", width: 11 },
    { header: "Reason", key: "reason", width: 16 },
    { header: "TappedDespiteRain", key: "rain", width: 16 },
    { header: "TreesSched", key: "treesSched", width: 11 },
    { header: "TreesTapped", key: "treesTapped", width: 11 },
    { header: "WetSheets", key: "wet", width: 10 },
    { header: "ScrapKg", key: "scrap", width: 9 },
    { header: "TareKg", key: "tare", width: 9 },
    { header: "Buckets", key: "buckets", width: 30 },
    { header: "Barrels", key: "barrels", width: 30 },
    { header: "NetKg", key: "net", width: 9 },
  ];
  for (const e of pack.entries) {
    const net = e.productMode === "Latex"
      ? Math.max(0, e.buckets.reduce((s, b) => s + b.kg, 0) - e.tareKg)
      : 0;
    entries.addRow({
      block: e.blockCode,
      tapper: e.tapperName,
      mode: e.productMode,
      status: e.status,
      reason: e.reason,
      rain: e.tappedDespiteRain ? "Yes" : "No",
      treesSched: e.treesScheduled,
      treesTapped: e.treesTapped,
      wet: e.wetSheets,
      scrap: e.scrapKg,
      tare: e.tareKg,
      buckets: e.buckets.map((b) => `${b.label}:${b.kg}`).join(", "),
      barrels: e.barrels.map((b) => `${b.barrelCode}:${b.kg}`).join(", "),
      net: Math.round(net * 1000) / 1000,
    });
  }
  styleHeader(entries.getRow(1));

  const labour = wb.addWorksheet("Labour");
  labour.columns = [
    { header: "Name", key: "name", width: 18 },
    { header: "Sex", key: "sex", width: 8 },
    { header: "Men", key: "men", width: 7 },
    { header: "Women", key: "women", width: 8 },
    { header: "WorkType", key: "workType", width: 22 },
    { header: "Who", key: "who", width: 16 },
    { header: "Where", key: "where", width: 16 },
  ];
  for (const l of pack.labour) {
    labour.addRow({
      name: l.name,
      sex: l.sex,
      men: l.men,
      women: l.women,
      workType: l.work_type,
      who: l.who,
      where: l.where_,
    });
  }
  styleHeader(labour.getRow(1));

  if (pack.smokehouse) {
    const sh = wb.addWorksheet("Smokehouse");
    sh.columns = [
      { header: "WetIn", key: "wetIn", width: 10 },
      { header: "DryOut", key: "dryOut", width: 10 },
      { header: "Note", key: "note", width: 40 },
    ];
    sh.addRow({
      wetIn: pack.smokehouse.wetIn,
      dryOut: pack.smokehouse.dryOut,
      note: pack.smokehouse.note,
    });
    styleHeader(sh.getRow(1));
  }

  const manifest = wb.addWorksheet("manifest");
  manifest.state = "hidden";
  manifest.addRow(["daypack", VERSION, estate.code, pack.date]);
  manifest.addRow([JSON.stringify(pack)]);

  const buffer = await wb.xlsx.writeBuffer();
  const defaultName = `${estate.name}_DayPack_${pack.date}.xlsx`;
  const path = await save({
    title: "Save Day Pack",
    defaultPath: defaultName,
    filters: [{ name: "Excel", extensions: ["xlsx"] }],
  });
  if (!path) return null;
  await writeFile(path, new Uint8Array(buffer as ArrayBuffer));
  return path;
}

export interface ImportReview {
  pack: DayPack;
  unknownBlocks: string[];
  unknownTappers: string[];
  unknownBarrels: string[];
}

export async function pickAndReadDayPack(
  estateCode: string
): Promise<ImportReview | null> {
  const path = await open({
    title: "Select Day Pack file",
    multiple: false,
    filters: [{ name: "Excel", extensions: ["xlsx"] }],
  });
  if (!path || Array.isArray(path)) return null;
  const bytes = await readFile(path);
  return parseDayPack(bytes, estateCode);
}

export async function parseDayPack(
  bytes: Uint8Array,
  estateCode: string
): Promise<ImportReview | null> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(bytes as unknown as ExcelJS.Buffer);

  let pack: DayPack | null = null;
  const manifest = wb.getWorksheet("manifest");
  if (manifest) {
    const json = manifest.getRow(2).getCell(1).value;
    if (typeof json === "string" && json.startsWith("{")) {
      try {
        pack = JSON.parse(json) as DayPack;
      } catch {
        pack = null;
      }
    }
  }

  if (!pack) {
    const info = wb.getWorksheet("DayInfo");
    const entries = wb.getWorksheet("Entries");
    if (!info || !entries) return null;
    const map = new Map<string, string>();
    info.eachRow((row) => {
      const k = String(row.getCell(1).value ?? "");
      const v = row.getCell(2).value;
      map.set(k, v === null || v === undefined ? "" : String(v));
    });
    const rows: DayPackEntryRow[] = [];
    entries.eachRow((row, n) => {
      if (n === 1) return;
      const val = (i: number) => {
        const v = row.getCell(i).value;
        return v === null || v === undefined ? "" : String(v);
      };
      const num = (i: number) => Number(val(i)) || 0;
      const bucketsRaw = val(12);
      const barrelsRaw = val(13);
      rows.push({
        blockCode: val(1),
        tapperName: val(2),
        productMode: (val(3) === "Sheet" ? "Sheet" : "Latex") as "Latex" | "Sheet",
        status: (val(4) === "Not Done" ? "Not Done" : "Completed") as
          | "Completed"
          | "Not Done",
        reason: val(5),
        tappedDespiteRain: /yes/i.test(val(6)),
        treesScheduled: num(7),
        treesTapped: num(8),
        wetSheets: num(9),
        scrapKg: num(10),
        tareKg: num(11),
        buckets: bucketsRaw
          ? bucketsRaw.split(",").map((s) => {
              const [label, kg] = s.split(":");
              return { label: (label ?? "").trim(), kg: Number(kg) || 0 };
            })
          : [],
        barrels: barrelsRaw
          ? barrelsRaw
              .split(",")
              .map((s) => {
                const [code, kg] = s.split(":");
                return {
                  barrelCode: (code ?? "").trim(),
                  kg: Number(kg) || 0,
                };
              })
              .filter((b) => b.barrelCode)
          : [],
      });
    });

    const labourRows: DayPack["labour"] = [];
    const labourSheet = wb.getWorksheet("Labour");
    if (labourSheet) {
      labourSheet.eachRow((row, n) => {
        if (n === 1) return;
        const val = (i: number) => {
          const v = row.getCell(i).value;
          return v === null || v === undefined ? "" : String(v);
        };
        labourRows.push({
          name: val(1),
          sex: val(2),
          men: Number(val(3)) || 0,
          women: Number(val(4)) || 0,
          work_type: val(5),
          who: val(6),
          where_: val(7),
          sort_order: n,
        });
      });
    }

    pack = {
      version: VERSION,
      estateCode: map.get("Estate") === estateCode ? estateCode : estateCode,
      date: map.get("Date") ?? "",
      weather: map.get("Weather") ?? "",
      supervisor: map.get("Supervisor") ?? "",
      pageNo: map.get("Page no") ?? "",
      remarks: map.get("Remarks") ?? "",
      photo: null,
      entries: rows,
      labour: labourRows,
      smokehouse: null,
    };
  }

  return {
    pack,
    unknownBlocks: [],
    unknownTappers: [],
    unknownBarrels: [],
  };
}
