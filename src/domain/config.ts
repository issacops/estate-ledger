/**
 * Fix list #5 — purchase categories, mirroring the expense categories (coded
 * so the register and any report can reference a short code instead of
 * retyping the label). Seeded into `config_lists`; Estates setup can add more.
 */
export const PURCHASE_CATS: [string, string][] = [
  ["P1", "Fertiliser"],
  ["P2", "Weedicide"],
  ["P3", "Tools"],
  ["P4", "Other"],
];
