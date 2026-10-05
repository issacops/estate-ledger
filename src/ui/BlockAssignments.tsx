import { Check } from "lucide-react";
import {
  liveBlocks,
  tapperLoads,
  unassignedBlocks,
  type AssignBlock,
  type AssignTapper,
} from "../domain/assignments";
import { cn } from "./components";

/**
 * Who taps which block, laid out by person: one card per tapper with a tick on
 * every block they work. Ticking a block that someone else holds moves it
 * across; unticking leaves it with nobody until it is given to someone.
 */
export function BlockAssignments(props: {
  blocks: AssignBlock[];
  tappers: AssignTapper[];
  onAssign: (blockId: number, tapperId: number | null) => void;
}) {
  const { blocks, tappers, onAssign } = props;
  const shown = tappers.filter(
    (t) => t.status === "Active" || blocks.some((b) => b.tapper_id === t.id && b.active !== 0)
  );
  const loads = tapperLoads(blocks, shown);
  const live = liveBlocks(blocks);
  const unassigned = unassignedBlocks(blocks, tappers);
  const nameOf = (id: number | null) => tappers.find((t) => t.id === id)?.name ?? "";

  if (!live.length) {
    return <div className="text-[12.5px] text-ink-soft">No blocks yet — add them below.</div>;
  }

  return (
    <div>
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        {loads.map(({ tapper, blocks: mine, trees }) => (
          <div key={tapper.id} className="rounded-xl border border-paper-line bg-paper-card p-3.5">
            <div className="mb-2.5 flex items-baseline justify-between gap-2">
              <div className="font-display text-[14px] font-semibold">{tapper.name}</div>
              <div className="text-[11px] text-ink-soft">{tapper.type}</div>
            </div>
            <div className="mb-3 text-[11.5px] text-ink-soft">
              {mine.length === 0
                ? "No blocks"
                : `${mine.length} block${mine.length === 1 ? "" : "s"} · ${trees.toLocaleString("en-IN")} trees`}
            </div>
            <div className="flex flex-wrap gap-1.5">
              {live.map((b) => {
                const has = b.tapper_id === tapper.id;
                const other = !has && b.tapper_id !== null && nameOf(b.tapper_id);
                return (
                  <button
                    key={b.id}
                    type="button"
                    role="checkbox"
                    aria-checked={has}
                    aria-label={`${b.code} for ${tapper.name}`}
                    title={
                      has
                        ? `Click to take ${b.code} off ${tapper.name}`
                        : other
                          ? `${b.code} is with ${other} — click to move it to ${tapper.name}`
                          : `Give ${b.code} to ${tapper.name}`
                    }
                    onClick={() => onAssign(b.id, has ? null : tapper.id)}
                    className={cn(
                      "inline-flex items-center gap-1 rounded-lg border px-2.5 py-1.5 text-[12px] font-semibold transition",
                      has
                        ? "border-rust bg-rust-light text-rust"
                        : other
                          ? "border-dashed border-paper-line text-ink-soft hover:border-rust hover:text-rust"
                          : "border-paper-line text-ink hover:border-rust hover:text-rust"
                    )}
                  >
                    {has && <Check size={12} />}
                    {b.code}
                    <span className="font-normal opacity-70">{b.trees.toLocaleString("en-IN")}</span>
                    {other && <span className="font-normal">· {other}</span>}
                  </button>
                );
              })}
            </div>
          </div>
        ))}
      </div>

      {unassigned.length > 0 && (
        <div className="mt-3 rounded-xl border border-warn/30 bg-warn-bg px-3.5 py-2.5 text-[12px]">
          <b>No tapper:</b> {unassigned.map((b) => b.code).join(", ")} — tick them under someone above,
          or they will not appear in anyone's rotation.
        </div>
      )}

      <p className="mt-3 text-[11.5px] text-ink-soft">
        A block has one tapper at a time. Past entries stay with whoever tapped them; this decides
        who new entries and the rotation start from.
      </p>
    </div>
  );
}
