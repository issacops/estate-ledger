export type Role = "Admin" | "Staff";

export interface User {
  id: number;
  name: string;
  email: string;
  role: Role;
  active: number;
}

export type Arrangement = "Direct" | "Flat-rate" | "Revenue-share";
export type ProductMode = "Latex" | "Sheet";
export type EntryStatus = "Completed" | "Not Done";

export interface EstateProfile {
  productionModes: ProductMode[];
  defaultMode: ProductMode;
  latexCapture: "weighing" | "barrel-only";
  rotation: boolean;
  arrangements: boolean;
  smokehouse: boolean;
  barrelCapacityCheck: boolean;
  autoFillBarrels: boolean;
  labour: "aggregate" | "per-worker";
  customSaleGrades: boolean;
  fixedSheetGrades: string[];
  photos: boolean;
  attendance: boolean;
  gapAlerts: boolean;
  seasonGranularity: boolean;
  leaseProductionEntry: boolean;
  bucketLabels: string[];
  defaultBarrelCapacity: number;
  tapCycleOptions: number[];
}

export interface Estate {
  id: number;
  name: string;
  code: string;
  profile: EstateProfile;
  letterhead: Letterhead;
}

export interface Letterhead {
  name?: string;
  address?: string;
  note?: string;
  showBarrelList?: boolean;
}

export interface Tapper {
  id: number;
  estate_id: number;
  name: string;
  type: string;
  tap_days: number;
  status: string;
  sort_order: number;
}

export interface Block {
  id: number;
  estate_id: number;
  code: string;
  name: string;
  trees: number;
  tapper_id: number | null;
  arrangement: Arrangement;
  lease_rate: number | null;
  active: number;
}

export interface Barrel {
  id: number;
  estate_id: number;
  code: string;
  capacity: number;
  tare_weight: number | null;
  active: number;
}

export interface EntryDay {
  id: number;
  estate_id: number;
  date: string;
  weather: string;
  supervisor: string;
  page_no: string;
  remarks: string;
  photo: string | null;
  created_by: number | null;
  updated_at: string;
}

export interface EntryRow {
  id: number;
  day_id: number;
  block_id: number;
  tapper_id: number | null;
  product_mode: ProductMode;
  status: EntryStatus;
  reason: string;
  tapped_despite_rain: number;
  trees_scheduled: number;
  trees_tapped: number;
  wet_sheets: number;
  scrap_kg: number;
  tare_kg: number;
  sale_id: number | null;
}

export interface EntryRowBucket {
  id: number;
  row_id: number;
  label: string;
  kg: number;
  sort_order: number;
}

export interface EntryRowBarrel {
  id: number;
  row_id: number;
  barrel_id: number;
  kg: number;
  sort_order: number;
}

export interface LabourRow {
  id: number;
  day_id: number;
  name: string;
  sex: string;
  men: number;
  women: number;
  work_type: string;
  who: string;
  where_: string;
  sort_order: number;
}

export interface SmokehouseLog {
  id: number;
  estate_id: number;
  date: string;
  wet_in: number;
  dry_out: number;
  note: string;
  person: string;
}

export interface StockLedgerRow {
  id: number;
  estate_id: number;
  hub: string;
  date: string;
  qty_delta: number;
  reason: string;
  ref_table: string;
  ref_id: number | null;
}

export interface Buyer {
  id: number;
  estate_id: number;
  name: string;
  contact: string;
  active: number;
}

export interface Vendor {
  id: number;
  estate_id: number;
  name: string;
  contact: string;
  active: number;
}

export interface Invoice {
  id: number;
  estate_id: number;
  invoice_no: string;
  date: string;
  buyer_id: number | null;
  grade: string;
  qty: number;
  /** Fix list #11 — the buyer's own scale reading at handover. Null = the
   *  estate's weight was billed as-is. */
  buyer_qty: number | null;
  /** Fix list #1 — formalin mixed into this latex. Null = none recorded. */
  formalin_kg: number | null;
  rate: number;
  paper_rate: number | null;
  drc: number | null;
  advance: number;
  value: number | null;
  status: "Final" | "Pending DRC" | "Cancelled";
  note: string;
  /** Fix list #4 — the bill/invoice photo, a compressed JPEG data URL. */
  photo: string | null;
}

export interface InvoiceBarrel {
  id: number;
  invoice_id: number;
  barrel_id: number;
  kg: number;
}

export interface Payment {
  id: number;
  estate_id: number;
  buyer_id: number | null;
  date: string;
  amount: number;
  type: string;
  note: string;
  cashbook_id: number | null;
  invoice_id: number | null;
}

export interface CashbookRow {
  id: number;
  estate_id: number;
  date: string;
  particulars: string;
  category_code: string;
  sub: string;
  income: number;
  expense: number;
  advance: string;
  photo: string | null;
  source_ref: string;
}

export interface Purchase {
  id: number;
  estate_id: number;
  bill_no: string;
  date: string;
  vendor_id: number | null;
  item: string;
  qty: number;
  unit: string;
  rate: number;
  value: number;
  note: string;
  /** Fix list #4 — the bill photo, a compressed JPEG data URL. */
  photo: string | null;
  /** Fix list #5 — coded purchase category (P1, P2, ...). */
  category_code: string;
}

export interface VendorPayment {
  id: number;
  estate_id: number;
  vendor_id: number | null;
  date: string;
  amount: number;
  note: string;
  cashbook_id: number | null;
}

export interface StockItem {
  id: number;
  estate_id: number;
  name: string;
  unit: string;
  active: number;
}

export interface ConfigItem {
  id: number;
  estate_id: number;
  kind: string;
  code: string;
  label: string;
  locked: number;
  sort_order: number;
}

export interface DayPackEntryRow {
  blockCode: string;
  tapperName: string;
  productMode: ProductMode;
  status: EntryStatus;
  reason: string;
  tappedDespiteRain: boolean;
  treesScheduled: number;
  treesTapped: number;
  wetSheets: number;
  scrapKg: number;
  tareKg: number;
  buckets: { label: string; kg: number }[];
  barrels: { barrelCode: string; kg: number }[];
}

export interface DayPack {
  version: number;
  estateCode: string;
  date: string;
  weather: string;
  supervisor: string;
  pageNo: string;
  remarks: string;
  photo: string | null;
  entries: DayPackEntryRow[];
  labour: Omit<LabourRow, "id" | "day_id">[];
  smokehouse: { wetIn: number; dryOut: number; note: string } | null;
}
