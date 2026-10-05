/**
 * Which tapper works which block.
 *
 * A block has exactly one tapper at a time. Giving K3 to John takes it from
 * whoever held it; there is no way to double-book a block. What each person
 * did in the past is stored on the entries themselves, so changing this never
 * rewrites history — it decides who new entries and the rotation start from.
 */

export interface AssignBlock {
  id: number;
  code: string;
  trees: number;
  tapper_id: number | null;
  active: number;
}

export interface AssignTapper {
  id: number;
  name: string;
  type: string;
  status: string;
}

export interface TapperLoad {
  tapper: AssignTapper;
  blocks: AssignBlock[];
  trees: number;
}

const byCode = (a: AssignBlock, b: AssignBlock) =>
  a.code.localeCompare(b.code, undefined, { numeric: true });

/** Blocks still in use; a retired block does not need a tapper. */
export function liveBlocks(blocks: AssignBlock[]): AssignBlock[] {
  return blocks.filter((b) => b.active !== 0).sort(byCode);
}

/** Each tapper with the blocks they hold now and the trees that makes. */
export function tapperLoads(blocks: AssignBlock[], tappers: AssignTapper[]): TapperLoad[] {
  const live = liveBlocks(blocks);
  return tappers.map((t) => {
    const mine = live.filter((b) => b.tapper_id === t.id);
    return { tapper: t, blocks: mine, trees: mine.reduce((n, b) => n + (Number(b.trees) || 0), 0) };
  });
}

/** Live blocks nobody is tapping. */
export function unassignedBlocks(blocks: AssignBlock[], tappers: AssignTapper[]): AssignBlock[] {
  const known = new Set(tappers.map((t) => t.id));
  return liveBlocks(blocks).filter((b) => b.tapper_id === null || !known.has(b.tapper_id));
}

export interface Move {
  blockId: number;
  from: number | null;
  to: number | null;
  /** False when the block already belonged to that tapper. */
  changed: boolean;
}

/** What giving `blockId` to `to` (or taking it from everyone) would do. */
export function planMove(blocks: AssignBlock[], blockId: number, to: number | null): Move {
  const b = blocks.find((x) => x.id === blockId);
  const from = b?.tapper_id ?? null;
  return { blockId, from, to, changed: !!b && from !== to };
}

/** "K3 moved from Reji Kumar to John" for the toast. */
export function describeMove(
  m: Move,
  blocks: AssignBlock[],
  tappers: AssignTapper[]
): string {
  const code = blocks.find((b) => b.id === m.blockId)?.code ?? "Block";
  const name = (id: number | null) =>
    id === null ? "" : tappers.find((t) => t.id === id)?.name ?? `tapper #${id}`;
  if (m.to === null) return `${code} is no longer assigned to ${name(m.from)}`;
  if (m.from === null) return `${code} given to ${name(m.to)}`;
  return `${code} moved from ${name(m.from)} to ${name(m.to)}`;
}
