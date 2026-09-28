import type { EstateProfile } from "../domain/types";
import {
  KARUKACHAL_PROFILE,
  KULASHEKARAM_PROFILE,
} from "../domain/profile";
import { execute, select } from "./client";
import { hashPassword, randomSalt } from "./auth";

const WEATHER_OPTS = [
  "Sunny",
  "Cloudy",
  "Rain (Morning)",
  "Rain (Afternoon)",
  "Full Day Rain",
];
const REASON_OPTS = [
  "Heavy Rain",
  "Tapper Absent",
  "Labour Shortage",
  "Holiday",
  "Equipment Issue",
  "Other",
];

const KARA_EXPENSE_CATS = [
  ["E1", "Tapper Wages"],
  ["E2", "Weeding Expenses"],
  ["E3", "Casual Daily Labour"],
  ["E4", "Smokehouse Expenses"],
  ["E5", "Fertiliser Expenses"],
  ["E6", "Construction Expenses"],
  ["E7", "Salaries"],
  ["E8", "Bonuses"],
  ["E9", "Opening Balance"],
  ["E10", "Other"],
  ["E11", "Sales Proceeds / Other Income"],
];

const KULA_EXPENSE_CATS = [
  ["E1", "Tapper Wages"],
  ["E2", "Weeding Expenses"],
  ["E3", "Salaries"],
  ["E4", "Bonuses"],
  ["E5", "Casual Daily Labour"],
  ["E6", "Smokehouse Expenses"],
  ["E7", "Construction Expenses"],
  ["E8", "Fertiliser Expenses"],
  ["E9", "Opening Balance"],
  ["E10", "Other"],
  ["E11", "Sales Proceeds / Other Income"],
];

const WORK_TYPES = [
  ["W1", "Weeding"],
  ["W2", "Manuring / Fertilising"],
  ["W3", "Pruning"],
  ["W4", "Smokehouse work"],
  ["W5", "Other"],
];

const DEFAULT_USERS: {
  name: string;
  email: string;
  password: string;
  role: "Admin" | "Staff";
}[] = [
  {
    name: "Ninan Philip",
    email: "ninanphilp@rubberestate.com",
    password: "ninan123@4",
    role: "Admin",
  },
  {
    name: "Daily Entry",
    email: "dailyentry@rubberestate.com",
    password: "ninan123@4",
    role: "Staff",
  },
];

export async function ensureSeeded(): Promise<void> {
  const users = await select<{ id: number }>("SELECT id FROM users LIMIT 1");
  if (users.length === 0) {
    for (const u of DEFAULT_USERS) {
      const salt = randomSalt();
      const hash = await hashPassword(u.password, salt);
      await execute(
        "INSERT INTO users (name, email, password_hash, password_salt, role) VALUES ($1,$2,$3,$4,$5)",
        [u.name, u.email, hash, salt, u.role]
      );
    }
  }

  const estates = await select<{ id: number }>("SELECT id FROM estates LIMIT 1");
  if (estates.length > 0) return;

  await seedEstate(
    "Karukachal",
    "KAR",
    KARUKACHAL_PROFILE,
    KARA_EXPENSE_CATS,
    [
      ["John", "Employee", 2],
      ["Reji Kumar", "Lease", 1],
      ["Biju", "Contract", 2],
    ],
    [
      ["K1", 400, "John", "Direct"],
      ["K2", 400, "John", "Direct"],
      ["K3", 2400, "Reji Kumar", "Flat-rate"],
      ["K4", 1500, "Biju", "Revenue-share"],
    ],
    60
  );

  await seedEstate(
    "Kulashekaram",
    "KUL",
    KULASHEKARAM_PROFILE,
    KULA_EXPENSE_CATS,
    [
      ["Rajendran", "Employee", 2],
      ["Johnson", "Employee", 2],
      ["Poovas", "Employee", 3],
    ],
    [
      ["B1", 450, "Rajendran", "Direct"],
      ["B2", 450, "Rajendran", "Direct"],
      ["B3", 450, "Rajendran", "Direct"],
      ["B4", 450, "Johnson", "Direct"],
      ["B5", 450, "Johnson", "Direct"],
      ["B6", 450, "Johnson", "Direct"],
      ["B7", 450, "Poovas", "Direct"],
      ["B8", 450, "Poovas", "Direct"],
      ["B9", 450, "Poovas", "Direct"],
    ],
    60
  );

  await execute(
    "INSERT OR IGNORE INTO settings (key, value) VALUES ('seeded','1')"
  );
}

async function seedEstate(
  name: string,
  code: string,
  profile: EstateProfile,
  expenseCats: string[][],
  tappers: [string, string, number][],
  blocks: [string, number, string, string][],
  barrelCount: number
): Promise<void> {
  const res = await execute(
    "INSERT INTO estates (name, code, profile_json) VALUES ($1,$2,$3)",
    [name, code, JSON.stringify(profile)]
  );
  const estateId = res.lastInsertId;

  const tapperIds = new Map<string, number>();
  for (let i = 0; i < tappers.length; i++) {
    const [tname, type, tapDays] = tappers[i];
    const r = await execute(
      "INSERT INTO tappers (estate_id, name, type, tap_days, status, sort_order) VALUES ($1,$2,$3,$4,'Active',$5)",
      [estateId, tname, type, tapDays, i]
    );
    tapperIds.set(tname, r.lastInsertId);
  }

  for (const [bcode, trees, tapperName, arrangement] of blocks) {
    await execute(
      "INSERT INTO blocks (estate_id, code, name, trees, tapper_id, arrangement) VALUES ($1,$2,$3,$4,$5,$6)",
      [
        estateId,
        bcode,
        bcode,
        trees,
        tapperIds.get(tapperName) ?? null,
        arrangement,
      ]
    );
  }

  for (let i = 1; i <= barrelCount; i++) {
    await execute(
      "INSERT INTO barrels (estate_id, code, capacity) VALUES ($1,$2,$3)",
      [estateId, `BR-${i}`, profile.defaultBarrelCapacity]
    );
  }

  const addList = async (kind: string, items: string[][], start = 0) => {
    for (let i = 0; i < items.length; i++) {
      const [code, label] = items[i];
      await execute(
        "INSERT INTO config_lists (estate_id, kind, code, label, sort_order) VALUES ($1,$2,$3,$4,$5)",
        [estateId, kind, code, label, start + i]
      );
    }
  };

  await addList("expenseCat", expenseCats);
  await addList("workType", WORK_TYPES);
  await addList(
    "weather",
    WEATHER_OPTS.map((w, i) => [`W${i + 1}`, w])
  );
  await addList(
    "reason",
    REASON_OPTS.map((r, i) => [`R${i + 1}`, r])
  );
  await addList(
    "bucket",
    profile.bucketLabels.map((b, i) => [`B${i + 1}`, b])
  );

  const grades = profile.fixedSheetGrades.map((g, i) => [`G${i + 1}`, g]);
  if (grades.length) await addList("sheetGrade", grades);

  for (const [name, prefix] of [
    ["invoice", `${code}-INV-`],
    ["purchase", "PB-"],
    ["othercrop", "OC-"],
    ["daypack", `${code}-DP-`],
  ] as const) {
    await execute(
      "INSERT INTO sequences (estate_id, name, next_val) VALUES ($1,$2,1)",
      [estateId, name]
    );
    void prefix;
  }
}
