import { useEffect, useMemo, useState } from "react";
import { fmtDate, fmtNum } from "../domain/dates";
import {
  NO_FILTER,
  filterEntries,
  monthLabel,
  monthSummary,
  monthsPresent,
  netKg,
  paginate,
  reasonsPresent,
  totalsOf,
  wetSheets,
  type EntryFilter,
  type EntryLine,
  type StatusFilter,
} from "../domain/drilldown";
import { Pill, cn } from "./components";

const PAGE = 50;

/**
 * Every entry behind one tapper or one block — not just the latest few. The
 * office narrows it by month, dates, status or reason, or reads it a month at
 * a time. Used by Tapper performance and Block performance.
 */
export function EntryDrilldown(props: {
  title: string;
  rows: EntryLine[];
  loading?: boolean;
  blockLabel: (id: number) => string;
  /** Block performance also wants to know who tapped it. */
  tapperLabel?: (id: number | null) => string;
  onClose: () => void;
}) {
  const [filter, setFilter] = useState<EntryFilter>(NO_FILTER);
  const [view, setView] = useState<"entries" | "months">("entries");
  const [page, setPage] = useState(1);

  // a different tapper or block starts from a clean slate
  useEffect(() => {
    setFilter(NO_FILTER);
    setView("entries");
    setPage(1);
  }, [props.title]);

  const set = (patch: Partial<EntryFilter>) => {
    setFilter((f) => ({ ...f, ...patch }));
    setPage(1);
  };

  const months = useMemo(() => monthsPresent(props.rows), [props.rows]);
  const reasons = useMemo(() => reasonsPresent(props.rows), [props.rows]);
  const filtered = useMemo(() => filterEntries(props.rows, filter), [props.rows, filter]);
  const totals = useMemo(() => totalsOf(filtered), [filtered]);
  const byMonth = useMemo(() => monthSummary(filtered), [filtered]);
  const pg = paginate(filtered, page, PAGE);

  const filtering =
    filter.month || filter.from || filter.to || filter.reason || filter.status !== "all";
  const hasSheets = props.rows.some((r) => r.product_mode === "Sheet");
  const hasLatex = props.rows.some((r) => r.product_mode !== "Sheet");

  return (
    <div className="border-t border-paper-line p-4">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div className="font-display text-[14.5px] font-semibold">
          {props.title} — {filtering ? `${fmtNum(filtered.length, 0)} of ` : ""}
          {fmtNum(props.rows.length, 0)} entries
        </div>
        <button className="btn btn-ghost" onClick={props.onClose}>
          Close
        </button>
      </div>

      <div className="mb-3 flex flex-wrap items-end gap-3">
        <label className="flex flex-col gap-1">
          <span className="label">Month</span>
          <select
            className="input w-[170px]"
            value={filter.month}
            onChange={(e) => set({ month: e.target.value, from: "", to: "" })}
          >
            <option value="">All time</option>
            {months.map((m) => (
              <option key={m} value={m}>{monthLabel(m)}</option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1">
          <span className="label">From</span>
          <input
            type="date"
            className="input w-[145px]"
            value={filter.from}
            onChange={(e) => set({ from: e.target.value, month: "" })}
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className="label">To</span>
          <input
            type="date"
            className="input w-[145px]"
            value={filter.to}
            onChange={(e) => set({ to: e.target.value, month: "" })}
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className="label">Status</span>
          <select
            className="input w-[170px]"
            value={filter.status}
            onChange={(e) => set({ status: e.target.value as StatusFilter })}
          >
            <option value="all">All entries</option>
            <option value="completed">Tapped</option>
            <option value="missed">Missed (was due)</option>
            <option value="notScheduled">Not scheduled</option>
          </select>
        </label>
        <label className="flex flex-col gap-1">
          <span className="label">Reason</span>
          <select
            className="input w-[170px]"
            value={filter.reason}
            onChange={(e) => set({ reason: e.target.value })}
          >
            <option value="">Any reason</option>
            {reasons.map((r) => (
              <option key={r} value={r}>{r}</option>
            ))}
          </select>
        </label>
        {filtering && (
          <button className="btn btn-secondary" onClick={() => set({ ...NO_FILTER })}>
            Clear filters
          </button>
        )}
      </div>

      <div className="mb-3 flex flex-wrap items-center gap-2">
        <Pill active={view === "entries"} onClick={() => setView("entries")}>Entries</Pill>
        <Pill active={view === "months"} onClick={() => setView("months")}>By month</Pill>
        <span className="ml-2 text-[11.5px] text-ink-soft">
          {fmtNum(totals.completed, 0)} tapped · {fmtNum(totals.missed, 0)} missed
          {totals.notScheduled > 0 && ` · ${fmtNum(totals.notScheduled, 0)} not scheduled`}
          {hasLatex && ` · ${fmtNum(totals.netKg, 1)} kg latex`}
          {hasSheets && ` · ${fmtNum(totals.wetSheets, 0)} wet sheets`}
        </span>
      </div>

      {props.loading ? (
        <div className="py-6 text-center text-[12.5px] text-ink-soft">Loading…</div>
      ) : filtered.length === 0 ? (
        <div className="py-6 text-center text-[12.5px] text-ink-soft">
          {filtering ? "No entries match these filters." : "No entries recorded yet."}
        </div>
      ) : view === "months" ? (
        <div className="overflow-x-auto">
          <table className="register-table">
            <thead>
              <tr>
                <th>Month</th>
                <th className="text-right">Days tapped</th>
                <th className="text-right">Entries</th>
                <th className="text-right">Missed</th>
                <th className="text-right">Not scheduled</th>
                {hasLatex && <th className="text-right">Net kg</th>}
                {hasSheets && <th className="text-right">Wet sheets</th>}
              </tr>
            </thead>
            <tbody>
              {byMonth.map((m) => (
                <tr key={m.month}>
                  <td>
                    <button
                      className="font-semibold text-rust underline-offset-2 hover:underline"
                      title="Show this month's entries"
                      onClick={() => {
                        set({ month: m.month, from: "", to: "" });
                        setView("entries");
                      }}
                    >
                      {monthLabel(m.month)}
                    </button>
                  </td>
                  <td className="tnum text-right">{m.daysTapped}</td>
                  <td className="tnum text-right">{m.entries}</td>
                  <td className={cn("tnum text-right", m.missed > 0 && "font-semibold")}>{m.missed}</td>
                  <td className="tnum text-right text-ink-soft">{m.notScheduled}</td>
                  {hasLatex && <td className="tnum text-right">{fmtNum(m.netKg, 1)}</td>}
                  {hasSheets && <td className="tnum text-right">{fmtNum(m.wetSheets, 0)}</td>}
                </tr>
              ))}
              <tr style={{ background: "rgba(0,0,0,0.03)" }} className="font-semibold">
                <td>Total</td>
                <td className="tnum text-right">{byMonth.reduce((n, m) => n + m.daysTapped, 0)}</td>
                <td className="tnum text-right">{totals.entries}</td>
                <td className="tnum text-right">{totals.missed}</td>
                <td className="tnum text-right">{totals.notScheduled}</td>
                {hasLatex && <td className="tnum text-right">{fmtNum(totals.netKg, 1)}</td>}
                {hasSheets && <td className="tnum text-right">{fmtNum(totals.wetSheets, 0)}</td>}
              </tr>
            </tbody>
          </table>
        </div>
      ) : (
        <>
          <div className="overflow-x-auto">
            <table className="register-table">
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Block</th>
                  {props.tapperLabel && <th>Tapper</th>}
                  <th>Status</th>
                  <th>Reason</th>
                  {hasLatex && <th className="text-right">Net kg</th>}
                  {hasSheets && <th className="text-right">Wet sheets</th>}
                </tr>
              </thead>
              <tbody>
                {pg.slice.map((r, i) => (
                  <tr key={`${r.date}-${r.block_id}-${i}`}>
                    <td className="whitespace-nowrap">{fmtDate(r.date)}</td>
                    <td>{props.blockLabel(r.block_id)}</td>
                    {props.tapperLabel && <td>{props.tapperLabel(r.tapper_id)}</td>}
                    <td>{r.status}</td>
                    <td className="text-ink-soft">{r.status === "Completed" ? "" : r.reason || "—"}</td>
                    {hasLatex && (
                      <td className="tnum text-right">
                        {r.product_mode === "Sheet" ? "—" : fmtNum(netKg(r))}
                      </td>
                    )}
                    {hasSheets && (
                      <td className="tnum text-right">
                        {r.product_mode === "Sheet" ? fmtNum(wetSheets(r), 0) : "—"}
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {pg.pages > 1 && (
            <div className="mt-3 flex items-center justify-between text-[12px]">
              <span className="text-ink-soft">
                Showing {fmtNum(pg.from, 0)}–{fmtNum(pg.to, 0)} of {fmtNum(filtered.length, 0)}
              </span>
              <div className="flex items-center gap-2">
                <button className="btn btn-secondary" disabled={pg.page <= 1} onClick={() => setPage(pg.page - 1)}>
                  Previous
                </button>
                <span>Page {pg.page} of {pg.pages}</span>
                <button className="btn btn-secondary" disabled={pg.page >= pg.pages} onClick={() => setPage(pg.page + 1)}>
                  Next
                </button>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
