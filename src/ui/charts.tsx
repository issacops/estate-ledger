import { useState } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { Pill } from "./components";

/**
 * Line / Bars switch, shared by every chart that has one.
 *
 * The toggle sits in the card header and the chart in the body, so the two
 * cannot be one component. The hook hands back the pills to drop into the
 * header and the mode to pass down to <ModeChart>.
 */

export type ChartMode = "line" | "bar";

export const CHART_NEUTRAL = "#D4D4D4";
export const CHART_INK = "#333333";
export const CHART_GREEN = "#137A43";

export function useChartMode(initial: ChartMode = "bar") {
  const [mode, setMode] = useState<ChartMode>(initial);
  const toggle = (
    <div className="flex items-center gap-2">
      <Pill active={mode === "line"} onClick={() => setMode("line")}>
        Line
      </Pill>
      <Pill active={mode === "bar"} onClick={() => setMode("bar")}>
        Bars
      </Pill>
    </div>
  );
  return { mode, setMode, toggle };
}

/**
 * A key that does not exist in the data renders an empty chart with working
 * axes and no error — the kind of bug you only catch by looking. Say so.
 */
export function missingKeys<T extends Record<string, unknown>>(
  data: T[],
  xKey: string,
  dataKey: string
): string[] {
  if (!data.length) return [];
  const missing: string[] = [];
  if (!data.some((d) => xKey in d)) missing.push(xKey);
  if (!data.some((d) => dataKey in d)) missing.push(dataKey);
  return missing;
}

/** Sideways bars need a row each, so the plot grows with the data. */
export function barAreaHeight(rowCount: number, minHeight: number): number {
  return Math.max(minHeight, rowCount * 30 + 48);
}

/** Left gutter for the category names, capped so one long label cannot eat
 *  the plot. */
export function categoryLabelWidth(labels: string[]): number {
  return Math.min(170, Math.max(56, ...labels.map((l) => String(l ?? "").length * 7 + 16)));
}

export function ModeChart<T extends Record<string, unknown>>(props: {
  mode: ChartMode;
  data: T[];
  xKey: string;
  dataKey: string;
  name: string;
  /** Bar and line colour, unless a row carries its own `fill`. */
  color?: string;
  height?: number;
  allowDecimals?: boolean;
  legend?: boolean;
  /** Rows may carry `fill` to colour a bar — the best and worst, say. A line
   *  is one continuous series, so it uses `color` throughout. */
  perPointFill?: boolean;
  yTickFormatter?: (v: number) => string;
  yDomain?: [number | string, number | string];
  /** Bars lie on their side by default — categories read down the left, which
   *  stays legible however long the label. Set false for a time series, where
   *  the dates belong along the bottom. */
  horizontalBars?: boolean;
}) {
  const {
    mode,
    data,
    xKey,
    dataKey,
    name,
    color = CHART_INK,
    height = 260,
    allowDecimals = true,
    legend = false,
    perPointFill = false,
    yTickFormatter,
    yDomain,
    horizontalBars = true,
  } = props;

  const missing = missingKeys(data, xKey, dataKey);
  if (missing.length && import.meta.env.DEV) {
    console.warn(
      `ModeChart "${name}": no row has ${missing.join(" or ")} — the chart will be blank.`
    );
  }

  const grid = <CartesianGrid strokeDasharray="3 3" stroke={CHART_NEUTRAL} />;
  const tip = <Tooltip />;
  const leg = legend ? <Legend /> : null;

  // a sideways bar chart needs room per row, and a left gutter wide enough
  // for the longest category name
  const labelWidth = categoryLabelWidth(data.map((d) => String(d[xKey] ?? "")));
  const sideways = mode === "bar" && horizontalBars;
  const barHeight = barAreaHeight(data.length, height);

  return (
    <div className="w-full" style={{ height: sideways ? barHeight : height }}>
      <ResponsiveContainer width="100%" height="100%">
        {mode === "line" ? (
          <LineChart data={data}>
            {grid}
            <XAxis dataKey={xKey} tick={{ fontSize: 11 }} />
            <YAxis
              tick={{ fontSize: 11 }}
              allowDecimals={allowDecimals}
              tickFormatter={yTickFormatter}
              domain={yDomain}
            />
            {tip}
            {leg}
            <Line
              type="monotone"
              dataKey={dataKey}
              name={name}
              stroke={color}
              strokeWidth={2}
              dot={{ r: 2 }}
            />
          </LineChart>
        ) : sideways ? (
          <BarChart data={data} layout="vertical" margin={{ left: 4, right: 28 }}>
            {grid}
            <XAxis
              type="number"
              tick={{ fontSize: 11 }}
              allowDecimals={allowDecimals}
              tickFormatter={yTickFormatter}
              domain={yDomain}
            />
            <YAxis
              type="category"
              dataKey={xKey}
              tick={{ fontSize: 11 }}
              width={labelWidth}
            />
            {tip}
            {leg}
            <Bar dataKey={dataKey} name={name} fill={color} radius={[0, 3, 3, 0]}>
              {perPointFill &&
                data.map((d, i) => (
                  <Cell key={i} fill={(d.fill as string) ?? color} />
                ))}
            </Bar>
          </BarChart>
        ) : (
          <BarChart data={data}>
            {grid}
            <XAxis dataKey={xKey} tick={{ fontSize: 11 }} />
            <YAxis
              tick={{ fontSize: 11 }}
              allowDecimals={allowDecimals}
              tickFormatter={yTickFormatter}
              domain={yDomain}
            />
            {tip}
            {leg}
            <Bar dataKey={dataKey} name={name} fill={color} radius={[3, 3, 0, 0]}>
              {perPointFill &&
                data.map((d, i) => (
                  <Cell key={i} fill={(d.fill as string) ?? color} />
                ))}
            </Bar>
          </BarChart>
        )}
      </ResponsiveContainer>
    </div>
  );
}
