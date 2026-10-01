import { useMemo } from "react";
import {
  Boxes,
  Droplets,
  TriangleAlert,
  Wallet,
  Leaf,
  Layers,
  Package,
  TrendingUp,
  ArrowUpRight,
} from "lucide-react";
import { useApp } from "../app/store";
import { query, useMasters, useQuery } from "../db/hooks";
import {
  Card,
  EmptyState,
  Gauge,
  IconChip,
  cn,
} from "../ui/components";
import {
  fmtDate,
  fmtMoney,
  fmtNum,
  monthKey,
  monthRange,
  parseISO,
  seasonKey,
  todayISO,
} from "../domain/dates";
import { pctChange, rangeForPreset } from "../domain/periods";
import { nextGapFlag } from "../domain/rotation";

interface DayRow {
  block_id: number;
  product_mode: string;
  status: string;
  wet_sheets: number;
  tare_kg: number;
  bucket_kg: number;
}

interface HubRow {
  hub: string;
  qty: number;
}

interface SumRow {
  total: number;
}

interface AlertRow {
  id: number;
  code: string;
  tapper_id: number | null;
  last_date: string | null;
}

interface SalesRow {
  sales: number;
  qty: number;
}

interface WetRow {
  wet: number;
}

interface MonthSalesRow {
  mk: string;
  sales: number;
}

interface MonthExpRow {
  mk: string;
  expense: number;
}

function monthKeysBack(today: string, n: number): string[] {
  const base = parseISO(`${monthKey(today)}-01`);
  const out: string[] = [];
  for (let i = n - 1; i >= 0; i--) {
    const d = new Date(base.getFullYear(), base.getMonth() - i, 1);
    out.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`);
  }
  return out;
}

function monthLabel(mk: string): string {
  const [y, m] = mk.split("-");
  return new Date(Number(y), Number(m) - 1, 1).toLocaleDateString("en-IN", {
    month: "short",
    year: "numeric",
  });
}

function greeting(): string {
  const h = new Date().getHours();
  if (h < 12) return "Good morning";
  if (h < 17) return "Good afternoon";
  return "Good evening";
}

function Delta(props: { cur: number; prev: number }) {
  const pct = pctChange(props.cur, props.prev);
  if (pct === null) return <span className="tnum text-ink-soft">—</span>;
  const up = pct >= 0;
  return (
    <span
      className={cn(
        "tnum ml-1 inline-flex items-center gap-0.5 text-[10.5px] font-bold",
        up ? "text-ok" : "text-danger"
      )}
    >
      {up ? "▲" : "▼"} {Math.abs(pct)}%
    </span>
  );
}

export function Dashboard() {
  const estate = useApp((s) => s.estate)!;
  const user = useApp((s) => s.user);
  const masters = useMasters(estate.id);
  const today = todayISO();
  const season = rangeForPreset("season", today);
  const keys = monthKeysBack(today, 7);
  const monthFrom = `${keys[0]}-01`;
  const monthTo = monthRange(today).to;

  const todayQ = useQuery<DayRow>(
    () =>
      query<DayRow>(
        "SELECT r.block_id, r.product_mode, r.status, r.wet_sheets, r.tare_kg, COALESCE((SELECT SUM(b.kg) FROM entry_row_buckets b WHERE b.row_id = r.id), 0) AS bucket_kg FROM entry_rows r JOIN entry_days d ON d.id = r.day_id WHERE d.estate_id = $1 AND d.date = $2",
        [estate.id, today]
      ),
    [estate.id, today]
  );

  const hubsQ = useQuery<HubRow>(
    () =>
      query<HubRow>(
        "SELECT hub, COALESCE(SUM(qty_delta), 0) AS qty FROM stock_ledger WHERE estate_id = $1 GROUP BY hub",
        [estate.id]
      ),
    [estate.id]
  );

  const barrelsQ = useQuery<SumRow>(
    () =>
      query<SumRow>(
        "SELECT COALESCE(SUM(rb.kg), 0) AS total FROM entry_row_barrels rb JOIN entry_rows r ON r.id = rb.row_id JOIN entry_days d ON d.id = r.day_id WHERE d.estate_id = $1",
        [estate.id]
      ),
    [estate.id]
  );

  const alertsQ = useQuery<AlertRow>(
    () =>
      query<AlertRow>(
        "SELECT b.id, b.code, b.tapper_id, MAX(d.date) AS last_date FROM blocks b LEFT JOIN entry_rows r ON r.block_id = b.id AND r.status = 'Completed' LEFT JOIN entry_days d ON d.id = r.day_id WHERE b.estate_id = $1 AND b.active = 1 GROUP BY b.id, b.code, b.tapper_id ORDER BY b.code",
        [estate.id]
      ),
    [estate.id]
  );

  const salesQ = useQuery<SalesRow>(
    () =>
      query<SalesRow>(
        // Fix list #11 — kg sold is the billed weight, the same number the
        // season's revenue was computed from, so profit-per-kg divides evenly.
        "SELECT COALESCE(SUM(value), 0) AS sales, COALESCE(SUM(COALESCE(buyer_qty, qty - COALESCE(formalin_kg, 0))), 0) AS qty FROM invoices WHERE estate_id = $1 AND date >= $2 AND date <= $3 AND value IS NOT NULL AND status <> 'Cancelled'",
        [estate.id, season.from, season.to]
      ),
    [estate.id, season.from, season.to]
  );

  const expQ = useQuery<SumRow>(
    () =>
      query<SumRow>(
        "SELECT COALESCE(SUM(expense), 0) AS total FROM cashbook WHERE estate_id = $1 AND date >= $2 AND date <= $3",
        [estate.id, season.from, season.to]
      ),
    [estate.id, season.from, season.to]
  );

  const paidQ = useQuery<SumRow>(
    () =>
      query<SumRow>(
        "SELECT COALESCE(SUM(amount), 0) AS total FROM payments WHERE estate_id = $1 AND date >= $2 AND date <= $3",
        [estate.id, season.from, season.to]
      ),
    [estate.id, season.from, season.to]
  );

  const wetQ = useQuery<WetRow>(
    () =>
      query<WetRow>(
        "SELECT COALESCE(SUM(r.wet_sheets), 0) AS wet FROM entry_rows r JOIN entry_days d ON d.id = r.day_id WHERE d.estate_id = $1 AND d.date >= $2 AND d.date <= $3 AND r.status = 'Completed' AND r.product_mode = 'Sheet'",
        [estate.id, season.from, season.to]
      ),
    [estate.id, season.from, season.to]
  );

  const salesMQ = useQuery<MonthSalesRow>(
    () =>
      query<MonthSalesRow>(
        "SELECT substr(date, 1, 7) AS mk, COALESCE(SUM(value), 0) AS sales FROM invoices WHERE estate_id = $1 AND date >= $2 AND date <= $3 AND value IS NOT NULL AND status <> 'Cancelled' GROUP BY mk",
        [estate.id, monthFrom, monthTo]
      ),
    [estate.id, monthFrom, monthTo]
  );

  const expMQ = useQuery<MonthExpRow>(
    () =>
      query<MonthExpRow>(
        "SELECT substr(date, 1, 7) AS mk, COALESCE(SUM(expense), 0) AS expense FROM cashbook WHERE estate_id = $1 AND date >= $2 AND date <= $3 GROUP BY mk",
        [estate.id, monthFrom, monthTo]
      ),
    [estate.id, monthFrom, monthTo]
  );

  const todayStats = useMemo(() => {
    const blocks = new Set<number>();
    let wet = 0;
    let net = 0;
    for (const r of todayQ.rows) {
      if (r.status !== "Completed") continue;
      blocks.add(r.block_id);
      if (r.product_mode === "Sheet") wet += Number(r.wet_sheets) || 0;
      else
        net += Math.max(0, (Number(r.bucket_kg) || 0) - (Number(r.tare_kg) || 0));
    }
    return { blocks: blocks.size, wet, net, entries: todayQ.rows.length };
  }, [todayQ.rows]);

  const stock = useMemo(() => {
    const byHub = new Map(hubsQ.rows.map((h) => [h.hub, Number(h.qty) || 0]));
    const sheets: { grade: string; qty: number }[] = [];
    for (const [hub, qty] of byHub) {
      if (hub.startsWith("sheet:")) sheets.push({ grade: hub.slice(6), qty });
    }
    sheets.sort((a, b) => (a.grade < b.grade ? -1 : 1));
    return {
      latex: byHub.get("latex") ?? 0,
      scrap: byHub.get("scrap") ?? 0,
      sheets,
      sheetTotal: sheets.reduce((s, x) => s + x.qty, 0),
      inBarrels: Number(barrelsQ.rows[0]?.total ?? 0),
    };
  }, [hubsQ.rows, barrelsQ.rows]);

  const alerts = useMemo(() => {
    const out: { id: number; text: string }[] = [];
    for (const a of alertsQ.rows) {
      const tapper = a.tapper_id
        ? masters.byId.tapper.get(a.tapper_id)
        : undefined;
      if (!a.last_date) {
        out.push({ id: a.id, text: `Block ${a.code} has no completed tap yet` });
        continue;
      }
      const flag = nextGapFlag(a.last_date, today, (tapper?.tap_days ?? 2) + 2);
      if (flag !== null)
        out.push({ id: a.id, text: `Block ${a.code} untapped for ${flag} days` });
    }
    return out;
  }, [alertsQ.rows, masters.byId.tapper, today]);

  const sales = Number(salesQ.rows[0]?.sales ?? 0);
  const qtySold = Number(salesQ.rows[0]?.qty ?? 0);
  const expenses = Number(expQ.rows[0]?.total ?? 0);
  const paid = Number(paidQ.rows[0]?.total ?? 0);
  const net = sales - expenses;
  const wetSheets = Number(wetQ.rows[0]?.wet ?? 0);
  const profitPerKg = qtySold > 0 ? net / qtySold : null;
  const costPerSheet = wetSheets > 0 ? expenses / wetSheets : null;
  const collectedPct = sales > 0 ? Math.min(100, (paid / sales) * 100) : 0;

  const monthRows = useMemo(() => {
    const sMap = new Map(salesMQ.rows.map((r) => [r.mk, Number(r.sales) || 0]));
    const eMap = new Map(expMQ.rows.map((r) => [r.mk, Number(r.expense) || 0]));
    return monthKeysBack(today, 7).map((mk) => {
      const s = sMap.get(mk) ?? 0;
      const e = eMap.get(mk) ?? 0;
      return { mk, label: monthLabel(mk), sales: s, expense: e, net: s - e };
    });
  }, [salesMQ.rows, expMQ.rows, today]);

  const maxMonth = Math.max(1, ...monthRows.map((m) => m.sales));
  const prodSplit = [
    { key: "Latex", kg: stock.inBarrels, icon: Droplets },
    { key: "Sheets", kg: stock.sheetTotal, icon: Layers },
    { key: "Scrap", kg: stock.scrap, icon: Package },
  ];
  const maxProd = Math.max(1, ...prodSplit.map((p) => p.kg));
  const firstName = (user?.name ?? "").split(" ")[0];

  return (
    <div>
      <div className="mb-5 grid grid-cols-1 gap-4 lg:grid-cols-3">
        <div className="card card-butter tex-ribbed col-span-1 flex flex-col justify-between p-6 lg:col-span-2">
          <div>
            <div className="label mb-2">Home / Dashboard</div>
            <h1 className="font-display text-[34px] leading-[1.05] font-semibold tracking-tight text-ink">
              {greeting()}, {firstName}
            </h1>
            <p className="mt-1.5 text-[12.5px] text-ink-light">
              {estate.name} · {fmtDate(today)} · Season {seasonKey(today)}
            </p>
          </div>
          <div className="mt-6 grid grid-cols-2 gap-5 sm:grid-cols-4">
            <div className="stat-row">
              <IconChip round>
                <Droplets size={14} />
              </IconChip>
              <div>
                <div className="kpi-num text-[24px] leading-none">
                  {todayStats.blocks}
                </div>
                <div className="label mt-1.5">Blocks tapped</div>
              </div>
            </div>
            <div className="stat-row">
              <IconChip round>
                <Leaf size={14} />
              </IconChip>
              <div>
                <div className="kpi-num text-[24px] leading-none">
                  {fmtNum(todayStats.wet, 0)}
                </div>
                <div className="label mt-1.5">Wet sheets</div>
              </div>
            </div>
            <div className="stat-row">
              <IconChip round>
                <Boxes size={14} />
              </IconChip>
              <div>
                <div className="kpi-num text-[24px] leading-none">
                  {fmtNum(todayStats.net)}
                </div>
                <div className="label mt-1.5">Net latex kg</div>
              </div>
            </div>
            <div className="stat-row">
              <IconChip round>
                <TrendingUp size={14} />
              </IconChip>
              <div>
                <div className="kpi-num text-[24px] leading-none">
                  {todayStats.entries}
                </div>
                <div className="label mt-1.5">Rows recorded</div>
              </div>
            </div>
          </div>
        </div>

        <Card tone="butter" className="tex-linen flex flex-col items-center justify-center">
          <Gauge
            value={collectedPct}
            label="Collected this season"
            caption={
              sales > 0 ? `${fmtMoney(paid)} of ${fmtMoney(sales)}` : "No sales yet"
            }
          />
        </Card>
      </div>

      <div className="mb-4 grid grid-cols-1 gap-4 lg:grid-cols-12">
        <Card
          className="lg:col-span-4"
          title="Alerts"
          icon={<TriangleAlert size={14} />}
        >
          {alerts.length === 0 ? (
            <EmptyState
              title="All blocks current"
              hint="No block has exceeded its expected tapping gap."
            />
          ) : (
            <div className="flex max-h-[260px] flex-col gap-2 overflow-y-auto">
              {alerts.map((a) => (
                <div
                  key={a.id}
                  className="tex-linen rounded-[13px] border border-warn/30 bg-warn-bg px-3.5 py-2.5 text-[12px] font-semibold text-warn"
                >
                  {a.text}
                </div>
              ))}
            </div>
          )}
        </Card>

        <Card
          className="card-butter tex-ribbed lg:col-span-5"
          title="Sales, last 7 months"
          icon={<TrendingUp size={14} />}
          right={<ArrowUpRight size={15} className="text-ink-light" />}
        >
          <div className="kpi-num text-[30px] leading-none">
            {fmtMoney(monthRows[monthRows.length - 1]?.sales ?? 0)}
          </div>
          <div className="label mt-1.5">This month</div>
          <div className="mt-4 flex h-[110px] items-end gap-2">
            {monthRows.map((m) => (
              <div
                key={m.mk}
                className="flex flex-1 flex-col items-center gap-1.5"
                title={`${m.label}: ${fmtMoney(m.sales)}`}
              >
                <div
                  className="w-full rounded-t-[8px] bg-ink/85"
                  style={{
                    height: `${Math.max(6, (m.sales / maxMonth) * 88)}px`,
                  }}
                />
                <div className="text-[9.5px] font-semibold text-ink-light">
                  {m.label.split(" ")[0]}
                </div>
              </div>
            ))}
          </div>
        </Card>

        <Card
          className="lg:col-span-3"
          title="Stock split"
          icon={<Boxes size={14} />}
        >
          <div className="text-[11px] text-ink-soft">Right now, by product</div>
          <div className="mt-4 space-y-4">
            {prodSplit.map((p) => {
              const Pct = p.icon;
              return (
                <div key={p.key}>
                  <div className="mb-1 flex items-center justify-between text-[11.5px]">
                    <span className="flex items-center gap-1.5 font-semibold text-ink">
                      <Pct size={12} /> {p.key}
                    </span>
                    <span className="tnum text-ink-soft">{fmtNum(p.kg, 0)}</span>
                  </div>
                  <div className="h-2 overflow-hidden rounded-full bg-paper-deep">
                    <div
                      className="h-full rounded-full bg-gradient-to-r from-amber to-butter-deep"
                      style={{ width: `${(p.kg / maxProd) * 100}%` }}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        </Card>
      </div>

      <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-5">
        {[
          {
            label: "Season sales",
            value: fmtMoney(sales),
            icon: <TrendingUp size={14} />,
          },
          {
            label: "Season expenses",
            value: fmtMoney(expenses),
            icon: <Wallet size={14} />,
          },
          {
            label: "Season net",
            value: fmtMoney(net),
            icon: <ArrowUpRight size={14} />,
            good: net >= 0,
          },
          {
            label: "Profit / kg sold",
            value: profitPerKg === null ? "—" : fmtMoney(profitPerKg),
            icon: <Droplets size={14} />,
          },
          {
            label: "Cost / wet sheet",
            value: costPerSheet === null ? "—" : fmtMoney(costPerSheet),
            icon: <Leaf size={14} />,
          },
        ].map((s) => (
          <div
            key={s.label}
            className="card tex-linen flex items-center gap-3 px-4 py-3"
          >
            <IconChip round>{s.icon}</IconChip>
            <div className="min-w-0">
              <div
                className={cn(
                  "kpi-num truncate text-[16px] leading-tight",
                  s.good !== undefined && (s.good ? "text-ok" : "text-danger")
                )}
              >
                {s.value}
              </div>
              <div className="label mt-0.5 truncate">{s.label}</div>
            </div>
          </div>
        ))}
      </div>

      <Card
        title="Month by month"
        icon={<Wallet size={14} />}
        pad={false}
        right={
          <span className="label">
            Season {seasonKey(today)}
          </span>
        }
      >
        <div className="overflow-x-auto">
          <table className="register-table">
            <thead>
              <tr>
                <th>Month</th>
                <th className="text-right">Sales</th>
                <th className="text-right">vs prev</th>
                <th className="text-right">Expenses</th>
                <th className="text-right">Net</th>
              </tr>
            </thead>
            <tbody>
              {monthRows.map((m, i) => {
                const prev = i > 0 ? monthRows[i - 1].sales : 0;
                return (
                  <tr key={m.mk}>
                    <td className="font-semibold">{m.label}</td>
                    <td className="tnum text-right">{fmtMoney(m.sales)}</td>
                    <td className="text-right">
                      <Delta cur={m.sales} prev={prev} />
                    </td>
                    <td className="tnum text-right">{fmtMoney(m.expense)}</td>
                    <td
                      className={cn(
                        "tnum text-right font-semibold",
                        m.net >= 0 ? "text-ok" : "text-danger"
                      )}
                    >
                      {fmtMoney(m.net)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}
