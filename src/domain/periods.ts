import { weekKey, monthKey, seasonKey, seasonRange } from "./dates";

export type Granularity = "Daily" | "Weekly" | "Monthly" | "Season";

export interface PeriodBucket {
  key: string;
  label: string;
  from: string;
  to: string;
  dates: string[];
}

export function bucketDates(
  dates: string[],
  granularity: Granularity
): PeriodBucket[] {
  const map = new Map<string, string[]>();
  for (const d of dates) {
    const k =
      granularity === "Daily"
        ? d
        : granularity === "Weekly"
          ? weekKey(d)
          : granularity === "Monthly"
            ? monthKey(d)
            : seasonKey(d);
    const list = map.get(k) || [];
    list.push(d);
    map.set(k, list);
  }
  return [...map.entries()]
    .sort((a, b) => (a[0] < b[0] ? -1 : 1))
    .map(([key, ds]) => ({
      key,
      label: labelFor(key, granularity),
      from: ds[0],
      to: ds[ds.length - 1],
      dates: ds.sort(),
    }));
}

function labelFor(key: string, g: Granularity): string {
  if (g === "Season") return key;
  if (g === "Monthly") {
    const [y, m] = key.split("-");
    return new Date(Number(y), Number(m) - 1, 1).toLocaleDateString("en-IN", {
      month: "short",
      year: "2-digit",
    });
  }
  return key;
}

export interface FilterRange {
  from: string;
  to: string;
}

export function rangeForPreset(
  preset: "week" | "month" | "season" | "ytd" | "all",
  today: string
): FilterRange {
  switch (preset) {
    case "week": {
      const from = weekKey(today);
      return { from, to: today };
    }
    case "month": {
      return { from: `${today.slice(0, 7)}-01`, to: today };
    }
    case "season": {
      return seasonRange(seasonKey(today));
    }
    case "ytd": {
      return { from: `${today.slice(0, 4)}-01-01`, to: today };
    }
    default:
      return { from: "1970-01-01", to: "2999-12-31" };
  }
}

export function inRange(date: string, r: FilterRange): boolean {
  return date >= r.from && date <= r.to;
}

export function pctChange(cur: number, prev: number): number | null {
  if (!prev) return null;
  return Math.round(((cur - prev) / prev) * 1000) / 10;
}
