import { describe, it, expect, beforeEach } from "vitest";
import { render, screen, fireEvent, cleanup, waitFor } from "@testing-library/react";
import "../i18n";
import App from "../app/App";
import { resetDb, run } from "../test/fakes/db";
import { ensureSeeded } from "../db/seed";
import { useApp } from "../app/store";

async function login() {
  render(<App />);
  await screen.findByLabelText(/password/i);
  fireEvent.change(screen.getByLabelText(/password/i), {
    target: { value: "ninan123@4" },
  });
  fireEvent.click(screen.getByRole("button", { name: /sign in/i }));
  await screen.findByText(/Rubber estates/i);
}

function goto(route: string) {
  window.location.hash = `#/${route}`;
  useApp.getState().setRoute(route);
}

async function settle() {
  await waitFor(() => {
    expect(screen.queryByText(/preparing estate database/i)).toBeNull();
  });
}

// K1: one latex day (10 kg bucket - 2 kg tare = 8 kg net) + a miss the
// next day (one row per block per day is the schema's rule).
// K2: one sheet day. Blocks are K1(400), K2(400), K3(2400), K4(1500).
function seedFixture() {
  const day = run("INSERT INTO entry_days (estate_id, date) VALUES ($1,$2)", [
    1,
    "2026-09-15",
  ]);
  const row = run(
    "INSERT INTO entry_rows (day_id, block_id, product_mode, status, tare_kg) VALUES ($1,1,'Latex','Completed',2)",
    [day.lastInsertId]
  );
  run(
    "INSERT INTO entry_row_buckets (row_id, label, kg, sort_order) VALUES ($1,'B1',10,1)",
    [row.lastInsertId]
  );
  run(
    "INSERT INTO entry_rows (day_id, block_id, product_mode, status, wet_sheets) VALUES ($1,2,'Sheet','Completed',50)",
    [day.lastInsertId]
  );
  const day2 = run("INSERT INTO entry_days (estate_id, date) VALUES ($1,$2)", [
    1,
    "2026-09-16",
  ]);
  run(
    "INSERT INTO entry_rows (day_id, block_id, product_mode, status) VALUES ($1,1,'Latex','Not Done')",
    [day2.lastInsertId]
  );
}

function statsTable(): HTMLTableElement {
  const t = [...document.querySelectorAll("table")].find((tb) =>
    /Days tapped/.test(tb.querySelector("thead")?.textContent || "")
  );
  expect(t).toBeTruthy();
  return t as HTMLTableElement;
}

function headers(t: HTMLTableElement): string[] {
  return [...t.querySelectorAll("thead th")].map((th) =>
    (th.textContent || "").trim()
  );
}

function col(hs: string[], name: string): number {
  return hs.findIndex((h) => h.startsWith(name));
}

function dataRows(t: HTMLTableElement): HTMLTableRowElement[] {
  return [...t.querySelectorAll("tbody tr")].filter((tr) =>
    tr.querySelector('input[type="checkbox"]')
  ) as HTMLTableRowElement[];
}

function totalsRow(t: HTMLTableElement): HTMLTableRowElement | undefined {
  return [...t.querySelectorAll("tbody tr")].find((tr) =>
    /Estate total|Selected total/.test(tr.textContent || "")
  ) as HTMLTableRowElement | undefined;
}

// In the totals row the leading checkbox+Block cells merge into one colSpan
// cell, so header index h maps to child h <= 1 ? 0 : h - 1.
function totalsCell(tr: HTMLTableRowElement, h: number): HTMLElement {
  return tr.children[h <= 1 ? 0 : h - 1] as HTMLElement;
}

function num(s: string | null | undefined): number {
  const m = String(s).replace(/,/g, "").match(/\d+(\.\d+)?/);
  return m ? parseFloat(m[0]) : 0;
}

function rowByCode(t: HTMLTableElement, code: string): HTMLTableRowElement | undefined {
  return dataRows(t).find((tr) => (tr.children[1]?.textContent || "").trim() === code);
}

async function openBlocks() {
  await login();
  await settle();
  goto("blocks");
  await waitFor(() => expect(statsTable()).toBeTruthy());
  // the season may not cover the fixture date; "All dates" covers everything
  const fySelect = [...document.querySelectorAll("select")].find((sel) =>
    [...sel.options].some((o) => o.value === "all")
  );
  expect(fySelect).toBeTruthy();
  fireEvent.change(fySelect!, { target: { value: "all" } });
  await waitFor(() => {
    const k1 = rowByCode(statsTable(), "K1");
    expect(k1).toBeTruthy();
    expect(num(k1!.children[col(headers(statsTable()), "Days tapped")].textContent)).toBe(1);
  });
}

beforeEach(async () => {
  cleanup();
  resetDb();
  window.localStorage.clear();
  window.location.hash = "#/dashboard";
  useApp.setState({
    user: null,
    estate: null,
    estates: [],
    route: "dashboard",
  });
  await ensureSeeded();
  seedFixture();
});

describe("fix list #7 — block stats tick-to-total", () => {
  it("shows no totals until blocks are ticked, then an Estate total re-derived from the sums", async () => {
    await openBlocks();
    const t = statsTable();
    const hs = headers(t);
    expect(hs[0]).toBe(""); // leading checkbox column
    expect(hs.some((h) => h.startsWith("Missed"))).toBe(true);
    expect(totalsRow(t)).toBeUndefined();

    // K1's own numbers: 1 tap day, 1 miss, 8 kg net, 8/400 per tree.
    const k1 = rowByCode(t, "K1")!;
    expect(num(k1.children[col(hs, "Days tapped")].textContent)).toBe(1);
    expect(num(k1.children[col(hs, "Missed")].textContent)).toBe(1);
    expect(num(k1.children[col(hs, "Net latex")].textContent)).toBe(8);
    expect((k1.children[col(hs, "Avg kg / tree")].textContent || "").trim()).toBe(
      "0.020"
    );

    fireEvent.click(screen.getByLabelText("Select all blocks"));
    const tot = await waitFor(() => {
      const r = totalsRow(statsTable());
      expect(r).toBeTruthy();
      return r!;
    });
    expect(tot.children[0].textContent?.trim()).toBe("Estate total");

    const hs2 = headers(statsTable());
    expect(num(totalsCell(tot, col(hs2, "Trees")).textContent)).toBe(4700);
    expect(num(totalsCell(tot, col(hs2, "Days tapped")).textContent)).toBe(2);
    expect(num(totalsCell(tot, col(hs2, "Missed")).textContent)).toBe(1);
    expect(num(totalsCell(tot, col(hs2, "Net latex")).textContent)).toBe(8);
    // 8 kg / 4700 trees, re-derived from the summed columns — not the
    // mean of the per-row averages.
    expect(
      (totalsCell(tot, col(hs2, "Avg kg / tree")).textContent || "").trim()
    ).toBe("0.002");
    // Avg gap has no summed equivalent, so it stays empty.
    expect(
      (totalsCell(tot, col(hs2, "Avg gap")).textContent || "").trim()
    ).toBe("—");

    // every row ticked; ticking must not open the row's investigate panel
    expect(
      dataRows(statsTable()).every((r) =>
        (r.querySelector("input") as HTMLInputElement).checked
      )
    ).toBe(true);
    expect(screen.queryByText(/last 30 entries/)).toBeNull();
  });

  it("labels a partial selection Selected total (n) and totals only the ticked rows", async () => {
    await openBlocks();
    fireEvent.click(screen.getByLabelText("Select all blocks"));
    await waitFor(() => expect(totalsRow(statsTable())).toBeTruthy());

    fireEvent.click(screen.getByLabelText("Select K3"));
    let tot = await waitFor(() => {
      const r = totalsRow(statsTable());
      expect(r?.children[0].textContent?.trim()).toBe("Selected total (3)");
      return r!;
    });
    let hs = headers(statsTable());
    expect(num(totalsCell(tot, col(hs, "Trees")).textContent)).toBe(2300);
    expect(num(totalsCell(tot, col(hs, "Days tapped")).textContent)).toBe(2);
    expect(num(totalsCell(tot, col(hs, "Missed")).textContent)).toBe(1);
    expect(
      (totalsCell(tot, col(hs, "Avg kg / tree")).textContent || "").trim()
    ).toBe("0.003"); // 8 / 2300

    // drop K1 too — the miss and the latex go with it
    fireEvent.click(screen.getByLabelText("Select K1"));
    tot = await waitFor(() => {
      const r = totalsRow(statsTable());
      expect(r?.children[0].textContent?.trim()).toBe("Selected total (2)");
      return r!;
    });
    hs = headers(statsTable());
    expect(num(totalsCell(tot, col(hs, "Trees")).textContent)).toBe(1900);
    expect(num(totalsCell(tot, col(hs, "Missed")).textContent)).toBe(0);
    expect(num(totalsCell(tot, col(hs, "Net latex")).textContent)).toBe(0);

    // untick everything — the totals row goes away
    fireEvent.click(screen.getByLabelText("Select K2"));
    fireEvent.click(screen.getByLabelText("Select K4"));
    await waitFor(() => {
      expect(totalsRow(statsTable())).toBeUndefined();
    });
  });
});
