import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Toaster, toast } from "sonner";
import {
  LayoutDashboard,
  ClipboardList,
  History,
  Flame,
  TrendingUp,
  Users,
  Trees,
  TriangleAlert,
  ChartColumn,
  Container,
  FileText,
  Package,
  Receipt,
  Wallet,
  FileSpreadsheet,
  Settings2,
  LogOut,
  Languages,
  CalendarDays,
  Leaf,
  ChevronDown,
} from "lucide-react";
import { useApp, useHashRoute, navigate } from "./store";
import { login } from "../db/auth";
import { select } from "../db/client";
import { ensureSeeded } from "../db/seed";
import { audit } from "../audit";
import { installAuditCapture } from "../audit/capture";
import { parseProfile } from "../domain/profile";
import { fmtDate, todayISO } from "../domain/dates";
import type { Estate } from "../domain/types";
import { IconChip, cn } from "../ui/components";

import { Dashboard } from "../pages/Dashboard";
import { DailyEntry } from "../pages/DailyEntry";
import { EntryHistory } from "../pages/EntryHistory";
import { SmokehousePage } from "../pages/Smokehouse";
import { AttendancePage } from "../pages/AttendancePage";
import { TrendsPage } from "../pages/Trends";
import { TapperPerformancePage } from "../pages/TapperPerformance";
import { BlockPerformancePage } from "../pages/BlockPerformance";
import { MissedTappingPage } from "../pages/MissedTappingPage";
import { SalesAnalysisPage } from "../pages/SalesAnalysisPage";
import { StockHubPage } from "../pages/StockHub";
import { PurchaseRegisterPage } from "../pages/PurchaseRegister";
import { ExpenseLedgerPage } from "../pages/ExpenseLedger";
import { ReportsPage } from "../pages/Reports";
import { MastersPage } from "../pages/Masters";
import { SettingsPage } from "../pages/Settings";
import { DayPackPage } from "../pages/DayPackPage";

const NAV: {
  group: string;
  items: { id: string; label: string; icon: React.ElementType; admin?: boolean }[];
}[] = [
  {
    group: "dailyWork",
    items: [
      { id: "dashboard", label: "dashboard", icon: LayoutDashboard },
      { id: "entry", label: "entry", icon: ClipboardList },
      { id: "history", label: "history", icon: History, admin: true },
      { id: "smokehouse", label: "smokehouse", icon: Flame },
    ],
  },
  {
    group: "analysis",
    items: [
      { id: "trends", label: "trends", icon: TrendingUp },
      { id: "tappers", label: "tappers", icon: Users },
      { id: "blocks", label: "blocks", icon: Trees },
      { id: "missed", label: "missed", icon: TriangleAlert },
      { id: "attendance", label: "attendance", icon: ChartColumn },
      { id: "sales-analysis", label: "salesAnalysis", icon: FileSpreadsheet },
    ],
  },
  {
    group: "stockMoney",
    items: [
      { id: "latex", label: "latex", icon: Container },
      { id: "sheets", label: "sheets", icon: FileText },
      { id: "scrap", label: "scrap", icon: Package },
      { id: "othercrop", label: "otherCrop", icon: Package },
      { id: "purchases", label: "purchases", icon: Receipt },
      { id: "expenses", label: "expenses", icon: Wallet },
    ],
  },
  {
    group: "reportsSetup",
    items: [
      { id: "daypack", label: "daypack", icon: FileSpreadsheet },
      { id: "reports", label: "reports", icon: FileSpreadsheet },
      { id: "masters", label: "masters", icon: Settings2, admin: true },
      { id: "settings", label: "settings", icon: Settings2 },
    ],
  },
];

const ROUTE_TITLES: Record<string, string> = {
  dashboard: "nav.dashboard",
  entry: "nav.entry",
  history: "nav.history",
  smokehouse: "nav.smokehouse",
  trends: "nav.trends",
  tappers: "nav.tappers",
  blocks: "nav.blocks",
  missed: "nav.missed",
  attendance: "nav.attendance",
  "sales-analysis": "nav.salesAnalysis",
  latex: "nav.latex",
  sheets: "nav.sheets",
  scrap: "nav.scrap",
  othercrop: "nav.otherCrop",
  purchases: "nav.purchases",
  expenses: "nav.expenses",
  daypack: "nav.daypack",
  reports: "nav.reports",
  masters: "nav.masters",
  settings: "nav.settings",
};

function LoginPage() {
  const { t } = useTranslation();
  const [email, setEmail] = useState("ninanphilp@rubberestate.com");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const setUser = useApp((s) => s.setUser);
  const bump = useApp((s) => s.bump);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      const user = await login(email, password);
      if (!user) {
        setError(t("login.failed"));
        void audit("login_failed", email, "users");
        return;
      }
      setUser(user);
      void audit("login", email, "users", user.id);
      navigate("dashboard");
      bump();
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="tex-mesh flex min-h-screen items-center justify-center p-6">
      <div className="w-full max-w-[880px] overflow-hidden rounded-[28px] shadow-[var(--shadow-pop)] lg:grid lg:grid-cols-2">
        <div className="card-butter tex-ribbed relative hidden flex-col justify-between p-9 lg:flex">
          <div className="relative z-10 flex items-center gap-3">
            <IconChip round ink>
              <Leaf size={16} />
            </IconChip>
            <div className="font-display text-[19px] font-semibold text-ink">
              {t("appName")}
            </div>
          </div>
          <div className="relative z-10">
            <div className="font-display text-[34px] leading-[1.08] font-semibold tracking-tight text-ink">
              Two ledgers,
              <br />
              one crop.
            </div>
            <p className="mt-3 max-w-[280px] text-[12.5px] leading-relaxed text-ink-light">
              {t("login.subtitle")}
            </p>
          </div>
          <div className="relative z-10 flex gap-2 text-[11px] font-semibold text-ink-light">
            <span className="rounded-full border border-ink/15 bg-white/55 px-3 py-1">
              Karukachal
            </span>
            <span className="rounded-full border border-ink/15 bg-white/55 px-3 py-1">
              Kulashekaram
            </span>
          </div>
        </div>

        <div className="card rounded-none border-0 p-9">
          <div className="mb-6 flex items-center gap-3 lg:hidden">
            <IconChip round>
              <Leaf size={16} />
            </IconChip>
            <div className="font-display text-[19px] font-semibold">
              {t("appName")}
            </div>
          </div>
          <div className="mb-1 font-display text-[24px] font-semibold tracking-tight text-ink">
            {t("login.title")}
          </div>
          <div className="mb-6 text-[12px] text-ink-soft">
            {t("login.subtitle")}
          </div>
          <form onSubmit={submit} className="space-y-3">
            <label className="block">
              <div className="label mb-1">{t("login.email")}</div>
              <input
                className="input"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                autoComplete="username"
              />
            </label>
            <label className="block">
              <div className="label mb-1">{t("login.password")}</div>
              <input
                className="input"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete="current-password"
              />
            </label>
            {error && <div className="text-[12px] text-danger">{error}</div>}
            <button
              className="btn btn-primary w-full justify-center"
              disabled={busy}
            >
              {t("login.submit")}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}

function Sidebar() {
  const { t, i18n } = useTranslation();
  const route = useHashRoute();
  const user = useApp((s) => s.user);
  const estate = useApp((s) => s.estate);
  const estates = useApp((s) => s.estates);
  const setEstate = useApp((s) => s.setEstate);
  const setUser = useApp((s) => s.setUser);
  const isAdmin = user?.role === "Admin";

  const toggleLang = () => {
    i18n.changeLanguage(i18n.language === "en" ? "ml" : "en");
  };

  const initials = (user?.name ?? "?")
    .split(" ")
    .map((w) => w[0])
    .slice(0, 2)
    .join("");

  return (
    <aside className="tex-linen no-print flex w-[248px] shrink-0 flex-col gap-4 border-r border-paper-line/70 bg-cream/55 p-4 backdrop-blur-sm">
      <div className="flex items-center gap-2.5 px-1 pt-1">
        <IconChip round ink>
          <Leaf size={16} />
        </IconChip>
        <div>
          <div className="font-display text-[16.5px] leading-tight font-semibold text-ink">
            {t("appName")}
          </div>
          <div className="text-[10px] tracking-wider text-ink-soft uppercase">
            Rubber estates
          </div>
        </div>
      </div>

      <div className="relative">
        <select
          className="input appearance-none rounded-[14px] py-2.5 pr-9 pl-3.5 text-[12.5px] font-semibold"
          value={estate?.id ?? ""}
          onChange={(e) => {
            const found = estates.find((x) => x.id === Number(e.target.value));
            if (found) setEstate(found);
            navigate("dashboard");
          }}
        >
          {estates.map((e) => (
            <option key={e.id} value={e.id}>
              {e.name}
            </option>
          ))}
        </select>
        <ChevronDown
          size={14}
          className="pointer-events-none absolute top-1/2 right-3 -translate-y-1/2 text-ink-soft"
        />
      </div>

      <nav className="flex-1 space-y-4 overflow-y-auto pb-2">
        {NAV.map((g) => {
          const items = g.items.filter((it) => !it.admin || isAdmin);
          if (!items.length) return null;
          return (
            <div key={g.group}>
              <div className="label px-1.5 pb-1.5">{t(`nav.${g.group}`)}</div>
              <div className="space-y-1">
                {items.map((it) => {
                  const active = route === it.id;
                  const Icon = it.icon;
                  return (
                    <button
                      key={it.id}
                      onClick={() => navigate(it.id)}
                      className={cn("nav-item", active && "active")}
                    >
                      <Icon size={15} strokeWidth={2.1} />
                      <span className="truncate">{t(`nav.${it.label}`)}</span>
                    </button>
                  );
                })}
              </div>
            </div>
          );
        })}
      </nav>

      <div className="card flex items-center gap-2.5 rounded-[16px] p-2.5">
        <span className="icon-chip icon-chip-round font-display text-[11px] font-bold">
          {initials}
        </span>
        <div className="min-w-0 flex-1">
          <div className="truncate text-[12px] font-semibold text-ink">
            {user?.name}
          </div>
          <div className="text-[10px] text-ink-soft">{user?.role}</div>
        </div>
        <button
          className="btn-icon"
          title={t("nav.language")}
          onClick={toggleLang}
        >
          <Languages size={14} />
        </button>
        <button
          className="btn-icon"
          title={t("nav.logout")}
          onClick={() => {
            void audit("logout", user?.name ?? "", "users", user?.id ?? null);
            setUser(null);
            navigate("dashboard");
          }}
        >
          <LogOut size={14} />
        </button>
      </div>
    </aside>
  );
}

function TopBar() {
  const { t } = useTranslation();
  const route = useHashRoute();
  const estate = useApp((s) => s.estate);
  return (
    <div className="no-print mb-5 flex items-center justify-between gap-3">
      <div className="flex items-center gap-2 text-[11.5px] font-semibold text-ink-soft">
        <span>{estate?.name}</span>
        <span className="text-ink-soft/60">/</span>
        <span className="text-ink">
          {ROUTE_TITLES[route] ? t(ROUTE_TITLES[route]) : t("nav.dashboard")}
        </span>
      </div>
      <div className="flex items-center gap-2">
        <span className="pill topbar-date">
          <CalendarDays size={13} /> {fmtDate(todayISO())}
        </span>
        <button
          className="btn-icon"
          title={t("nav.reports")}
          onClick={() => navigate("reports")}
        >
          <FileSpreadsheet size={14} />
        </button>
        <button
          className="btn-icon"
          title={t("nav.settings")}
          onClick={() => navigate("settings")}
        >
          <Settings2 size={14} />
        </button>
      </div>
    </div>
  );
}

function PageRouter() {
  const route = useHashRoute();
  const estate = useApp((s) => s.estate);
  const user = useApp((s) => s.user);
  if (!estate) return null;

  if (route === "history" && user?.role !== "Admin") {
    return <AdminLocked />;
  }
  if (route === "masters" && user?.role !== "Admin") {
    return <AdminLocked />;
  }

  switch (route) {
    case "entry":
      return <DailyEntry />;
    case "history":
      return <EntryHistory />;
    case "smokehouse":
      return <SmokehousePage />;
    case "attendance":
      return <AttendancePage />;
    case "trends":
      return <TrendsPage />;
    case "tappers":
      return <TapperPerformancePage />;
    case "blocks":
      return <BlockPerformancePage />;
    case "missed":
      return <MissedTappingPage />;
    case "sales-analysis":
      return <SalesAnalysisPage />;
    case "latex":
      return <StockHubPage hub="latex" />;
    case "sheets":
      return <StockHubPage hub="sheet" />;
    case "scrap":
      return <StockHubPage hub="scrap" />;
    case "othercrop":
      return <StockHubPage hub="othercrop" />;
    case "purchases":
      return <PurchaseRegisterPage />;
    case "expenses":
      return <ExpenseLedgerPage />;
    case "daypack":
      return <DayPackPage />;
    case "reports":
      return <ReportsPage />;
    case "masters":
      return <MastersPage />;
    case "settings":
      return <SettingsPage />;
    default:
      return <Dashboard />;
  }
}

function AdminLocked() {
  return (
    <div className="card p-8 text-center text-[13px] text-ink-soft">
      This page is available to the Admin account.
    </div>
  );
}

export default function App() {
  const user = useApp((s) => s.user);
  const setEstates = useApp((s) => s.setEstates);
  const setEstate = useApp((s) => s.setEstate);
  const estate = useApp((s) => s.estate);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    installAuditCapture();
    void audit("app_start");
    (async () => {
      try {
        await ensureSeeded();
        const rows = await select<{
          id: number;
          name: string;
          code: string;
          profile_json: string;
          letterhead_json: string;
        }>("SELECT * FROM estates ORDER BY id");
        const list: Estate[] = rows.map((r) => ({
          id: r.id,
          name: r.name,
          code: r.code,
          profile: parseProfile(r.profile_json),
          letterhead: JSON.parse(r.letterhead_json || "{}"),
        }));
        setEstates(list);
        const stored = window.localStorage.getItem("estateId");
        const found = list.find((e) => e.id === Number(stored)) ?? list[0];
        if (found) setEstate(found);
      } catch (err) {
        console.error(err);
        toast.error("Failed to initialise database");
      } finally {
        setReady(true);
      }
    })();
  }, []);

  useEffect(() => {
    if (estate) window.localStorage.setItem("estateId", String(estate.id));
  }, [estate]);

  if (!ready) {
    return (
      <div className="tex-mesh flex min-h-screen items-center justify-center">
        <div className="card px-8 py-6 text-[13px] text-ink-soft">
          Preparing estate database…
        </div>
      </div>
    );
  }

  return (
    <>
      <Toaster
        position="top-right"
        toastOptions={{
          style: {
            background: "#ffffff",
            border: "1px solid #e8e8e8",
            borderRadius: "14px",
            color: "#333333",
          },
        }}
      />
      {!user ? (
        <LoginPage />
      ) : (
        <div className="flex h-screen overflow-hidden">
          <Sidebar />
          <main className="flex-1 overflow-y-auto">
            <div className="mx-auto max-w-[1320px] p-6">
              <TopBar />
              <PageRouter />
            </div>
          </main>
        </div>
      )}
    </>
  );
}
