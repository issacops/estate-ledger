/**
 * Valuation rules.
 * Latex: value = qty x (drc/100) x rate  — stays pending until DRC is known.
 * Sheets/scrap/other: value = qty x rate.
 */

export function latexValue(
  qty: number,
  rate: number,
  drc: number | null | undefined
): number | null {
  if (drc === null || drc === undefined || Number.isNaN(Number(drc))) return null;
  return round2((Number(qty) || 0) * (Number(drc) / 100) * (Number(rate) || 0));
}

export function simpleValue(qty: number, rate: number): number {
  return round2((Number(qty) || 0) * (Number(rate) || 0));
}

export const PAPER_RATE_GAP_WARN = 15;

export function paperRateGap(
  paperRate: number | null | undefined,
  rate: number | null | undefined
): number | null {
  if (paperRate == null || rate == null) return null;
  return round2(Math.abs(Number(paperRate) - Number(rate)));
}

export function isPaperRateGapWorseThanUsual(gap: number | null): boolean {
  return gap !== null && gap > PAPER_RATE_GAP_WARN;
}

/**
 * Apportions kg across contributors proportional to pour count —
 * used for tapper shares and for kg-sold-by-block on lease blocks.
 */
export function shareByCount(
  total: number,
  counts: Record<string, number>
): Record<string, number> {
  const entries = Object.entries(counts).filter(([, c]) => c > 0);
  const totalCounts = entries.reduce((s, [, c]) => s + c, 0);
  const out: Record<string, number> = {};
  if (totalCounts <= 0) return out;
  for (const [k, c] of entries) {
    out[k] = round3((total * c) / totalCounts);
  }
  return out;
}

export function rainCoverMatches(text: string): boolean {
  return /rain|cover|skirt/i.test(text || "");
}

export function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

function round3(n: number): number {
  return Math.round((n + Number.EPSILON) * 1000) / 1000;
}
