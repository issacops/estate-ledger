export function todayISO(): string {
  const d = new Date();
  return localISO(d);
}

export function localISO(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export function parseISO(s: string): Date {
  const [y, m, d] = s.split("-").map(Number);
  return new Date(y, (m || 1) - 1, d || 1);
}

export function addDaysISO(iso: string, n: number): string {
  const d = parseISO(iso);
  d.setDate(d.getDate() + n);
  return localISO(d);
}

export function dayName(iso: string): string {
  return parseISO(iso).toLocaleDateString("en-IN", { weekday: "long" });
}

export function fmtDate(iso: string): string {
  if (!iso) return "";
  const d = parseISO(iso);
  return d.toLocaleDateString("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

export function weekKey(iso: string): string {
  const d = parseISO(iso);
  const day = (d.getDay() + 6) % 7;
  d.setDate(d.getDate() - day);
  return localISO(d);
}

export function monthKey(iso: string): string {
  return iso.slice(0, 7);
}

export function seasonKey(iso: string): string {
  const d = parseISO(iso);
  const y = d.getFullYear();
  const startYear = d.getMonth() >= 3 ? y : y - 1;
  return `${startYear}-${startYear + 1}`;
}

export function seasonRange(key: string): { from: string; to: string } {
  const startYear = Number(key.slice(0, 4));
  return {
    from: `${startYear}-04-01`,
    to: `${startYear + 1}-03-31`,
  };
}

export function weekRange(iso: string): { from: string; to: string } {
  const from = weekKey(iso);
  return { from, to: addDaysISO(from, 6) };
}

export function monthRange(iso: string): { from: string; to: string } {
  const d = parseISO(iso);
  const from = `${iso.slice(0, 7)}-01`;
  const last = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
  return { from, to: `${iso.slice(0, 7)}-${String(last).padStart(2, "0")}` };
}

export function fmtMoney(n: number | null | undefined): string {
  if (n === null || n === undefined || Number.isNaN(n)) return "—";
  return `Rs ${n.toLocaleString("en-IN", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

export function fmtNum(n: number | null | undefined, dp = 2): string {
  if (n === null || n === undefined || Number.isNaN(n)) return "—";
  return n.toLocaleString("en-IN", {
    minimumFractionDigits: dp,
    maximumFractionDigits: dp,
  });
}
