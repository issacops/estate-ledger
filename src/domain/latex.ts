export interface BucketInput {
  label: string;
  kg: number;
}

export function grossLatex(buckets: BucketInput[]): number {
  return round3(buckets.reduce((s, b) => s + (Number(b.kg) || 0), 0));
}

export function netLatex(
  buckets: BucketInput[],
  tareKg: number,
  completed = true
): number {
  if (!completed) return 0;
  return round3(Math.max(0, grossLatex(buckets) - (Number(tareKg) || 0)));
}

export function allocatedKg(barrels: { kg: number }[]): number {
  return round3(barrels.reduce((s, b) => s + (Number(b.kg) || 0), 0));
}

export const ALLOC_TOLERANCE = 0.05;

export interface AllocCheck {
  ok: boolean;
  mismatch: boolean;
  overfill: boolean;
  message: string;
}

/**
 * Validates that barrel allocation reconciles against net latex and that no
 * barrel would exceed its capacity across the whole page (Kulashekaram rules).
 */
export function checkAllocation(
  net: number,
  alloc: { barrelCode: string; kg: number }[],
  barrelTotals: Map<string, { filled: number; capacity: number }>
): AllocCheck {
  const sum = allocatedKg(alloc);
  const mismatch = Math.abs(sum - net) > ALLOC_TOLERANCE;
  let overfill = false;
  for (const a of alloc) {
    const t = barrelTotals.get(a.barrelCode);
    if (!t) continue;
    if (t.filled + (Number(a.kg) || 0) > t.capacity + ALLOC_TOLERANCE) {
      overfill = true;
    }
  }
  const ok = !mismatch && !overfill;
  let message = "";
  if (mismatch)
    message = `Allocation (${sum.toFixed(2)} kg) must equal net latex (${net.toFixed(2)} kg)`;
  else if (overfill) message = "Allocated weight would overfill a barrel";
  return { ok, mismatch, overfill, message };
}

export interface BarrelFillTarget {
  barrelCode: string;
  capacity: number;
  current: number;
}

/**
 * Sequential fill-to-capacity suggestion. Splits overflow into the next
 * barrel and tells the caller when a brand new barrel is needed.
 */
export function autoAllocate(
  net: number,
  open: BarrelFillTarget[]
): {
  alloc: { barrelCode: string; kg: number; isNew?: boolean }[];
  needsNew: number;
} {
  const alloc: { barrelCode: string; kg: number; isNew?: boolean }[] = [];
  let remaining = net;
  let needsNew = 0;
  for (const b of open) {
    if (remaining <= ALLOC_TOLERANCE) break;
    const space = Math.max(0, b.capacity - b.current);
    if (space <= ALLOC_TOLERANCE) continue;
    const take = Math.min(space, remaining);
    alloc.push({ barrelCode: b.barrelCode, kg: round3(take) });
    remaining = round3(remaining - take);
  }
  while (remaining > ALLOC_TOLERANCE) {
    needsNew++;
    const take = Math.min(200, remaining);
    alloc.push({ barrelCode: `NEW-${needsNew}`, kg: round3(take), isNew: true });
    remaining = round3(remaining - take);
  }
  return { alloc, needsNew };
}

export function fillStatus(filled: number, capacity: number): "Empty" | "Full" | "Open" {
  if (filled <= ALLOC_TOLERANCE) return "Empty";
  if (filled >= capacity - ALLOC_TOLERANCE) return "Full";
  return "Open";
}

function round3(n: number): number {
  return Math.round((n + Number.EPSILON) * 1000) / 1000;
}
