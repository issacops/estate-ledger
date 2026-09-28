import type { EstateProfile } from "./types";

export const KARUKACHAL_PROFILE: EstateProfile = {
  productionModes: ["Sheet", "Latex"],
  defaultMode: "Sheet",
  latexCapture: "barrel-only",
  rotation: true,
  arrangements: true,
  smokehouse: true,
  barrelCapacityCheck: false,
  autoFillBarrels: false,
  labour: "aggregate",
  customSaleGrades: false,
  fixedSheetGrades: ["RSS4", "RSS5"],
  photos: false,
  attendance: true,
  gapAlerts: true,
  seasonGranularity: true,
  leaseProductionEntry: true,
  bucketLabels: ["Bucket 1", "Bucket 2"],
  defaultBarrelCapacity: 200,
  tapCycleOptions: [1, 2, 3, 4],
};

export const KULASHEKARAM_PROFILE: EstateProfile = {
  productionModes: ["Latex"],
  defaultMode: "Latex",
  latexCapture: "weighing",
  rotation: false,
  arrangements: false,
  smokehouse: false,
  barrelCapacityCheck: true,
  autoFillBarrels: true,
  labour: "per-worker",
  customSaleGrades: true,
  fixedSheetGrades: [],
  photos: true,
  attendance: true,
  gapAlerts: true,
  seasonGranularity: true,
  leaseProductionEntry: false,
  bucketLabels: ["Bucket 1", "Bucket 2"],
  defaultBarrelCapacity: 200,
  tapCycleOptions: [1, 2, 3, 4],
};

export function parseProfile(json: string): EstateProfile {
  try {
    const raw = JSON.parse(json || "{}");
    return { ...KARUKACHAL_PROFILE, ...raw } as EstateProfile;
  } catch {
    return { ...KARUKACHAL_PROFILE };
  }
}

export function saleGradesFor(profile: EstateProfile): string[] {
  return ["Latex", "Scrap", ...profile.fixedSheetGrades];
}
