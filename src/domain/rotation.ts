import { parseISO } from "./dates";

const EPOCH = parseISO("2020-01-01");

/** Deterministic day counter used to pick which block in a tapper's cycle is due. */
export function dayIndex(dateISO: string): number {
  const d = parseISO(dateISO);
  return Math.floor((d.getTime() - EPOCH.getTime()) / 86400000);
}

export function tappingDayIndexFor(dateISO: string, groupSize: number): number {
  const size = Math.max(1, Math.floor(groupSize || 1));
  return ((dayIndex(dateISO) % size) + size) % size;
}

/**
 * Which blocks are due today for a rotation estate.
 * Blocks are grouped per assigned tapper; each tapper taps one block per day
 * following their cycle length. Flat-rate lease blocks never rotate in.
 */
export function dueBlockIds(
  dateISO: string,
  blocks: { id: number; tapper_id: number | null; arrangement: string }[],
  tappers: { id: number; tap_days: number }[],
  opts: { showAll?: boolean; includeFlatRate?: boolean } = {}
): number[] {
  const tapperCycle = new Map(tappers.map((t) => [t.id, t.tap_days]));
  const byTapper = new Map<number, number[]>();

  for (const b of blocks) {
    if (b.arrangement === "Flat-rate" && !opts.includeFlatRate) continue;
    if (opts.showAll) continue;
    if (!b.tapper_id) continue;
    const list = byTapper.get(b.tapper_id) || [];
    list.push(b.id);
    byTapper.set(b.tapper_id, list);
  }

  if (opts.showAll) {
    return blocks
      .filter((b) => opts.includeFlatRate || b.arrangement !== "Flat-rate")
      .map((b) => b.id);
  }

  const due: number[] = [];
  for (const [tapperId, list] of byTapper) {
    const cycle = tapperCycle.get(tapperId) || 1;
    const idx = tappingDayIndexFor(dateISO, Math.min(cycle, list.length || 1));
    const picked = list[idx % list.length];
    if (picked !== undefined) due.push(picked);
  }

  for (const b of blocks) {
    if (!b.tapper_id && b.arrangement !== "Flat-rate") due.push(b.id);
  }
  return due;
}

export function nextGapFlag(
  lastTapDate: string | null,
  todayISO: string,
  thresholdDays: number
): number | null {
  if (!lastTapDate) return null;
  const diff =
    (parseISO(todayISO).getTime() - parseISO(lastTapDate).getTime()) / 86400000;
  return diff > thresholdDays ? Math.round(diff) : null;
}

/**
 * The label the register carries on a block that was never due to be tapped.
 * Kulashekaram lists all nine blocks every day but taps three, so six rows a
 * day are untapped by design.
 */
export const NOT_SCHEDULED = "Not scheduled";

export function isNotScheduled(reason: string | null | undefined): boolean {
  return String(reason ?? "").trim().toLowerCase() === NOT_SCHEDULED.toLowerCase();
}

/**
 * A miss is tapping that should have happened and did not. A block that was
 * not due was not missed — nobody failed to do anything — so it is not counted
 * as one anywhere in the analysis.
 */
export function isMissedTapping(row: {
  status: string;
  reason?: string | null;
}): boolean {
  return row.status === "Not Done" && !isNotScheduled(row.reason);
}
