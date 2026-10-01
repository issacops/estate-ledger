import { describe, it, expect, beforeEach } from "vitest";
import { render, screen, fireEvent, cleanup, waitFor } from "@testing-library/react";
import "../i18n";
import App from "../app/App";
import { resetDb, run, scalar } from "../test/fakes/db";
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

// John (K1+K2): one latex day of 8 kg (10-2) + one of 5 kg (6-1) on
// 2026-09-15, plus a miss on K1 the next day. Reji Kumar (K3): one latex
// day of 20 kg. Blocks: K1(400), K2(400), K3(2400), K4(1500); tappers
// John=K1+K2, Reji Kumar=K3, Biju=K4 (no records → absent from stats).
function seedFixture() {
  const john = scalar<number>("SELECT id FROM tappers WHERE name='John'");
  const reji = scalar<number>("SELECT id FROM tappers WHERE name='Reji Kumar'");
  const day = run("INSERT INTO entry_days (estate_id, date) VALUES ($1,$2)", [
    1,
    "2026-09-15",
  ]);
  const k1 = run(
    "INSERT INTO entry_rows (day_id, block_id, tapper_id, product_mode, status, tare_kg) VALUES ($1,1,$2,'Latex','Completed',2)",
    [day.lastInsertId, john]
  );
  run(
    "INSERT INTO entry_row_buckets (row_id, label, kg, sort_order) VALUES ($1,'B1',10,1)",
    [k1.lastInsertId]
  );
  const k2 = run(
    "INSERT INTO entry_rows (day_id, block_id, tapper_id, product_mode, status, tare_kg) VALUES ($1,2,$2,'Latex','Completed',1)",
    [day.lastInsertId, john]
  );
  run(
    "INSERT INTO entry_row_buckets (row_id, label, kg, sort_order) VALUES ($1,'B1',6,1)",
    [k2.lastInsertId]
  );
  const k3 = run(
    "INSERT INTO entry_rows (day_id, block_id, tapper_id, product_mode, status) VALUES ($1,3,$2,'Latex','Completed')",
    [day.lastInsertId, reji]
  );
  run(
    "INSERT INTO entry_row_buckets (row_id, label, kg, sort_order) VALUES ($1,'B1',20,1)",
    [k3.lastInsertId]
  );
  const day2 = run("INSERT INTO entry_days (estate_id, date) VALUES ($1,$2)", [
    1,
    "2026-09-16",
  ]);
  run(
    "INSERT INTO entry_rows (day_id, block_id, tapper_id, product_mode, status) VALUES ($1,1,$2,'Latex','Not Done')",
    [day2.lastInsertId, john]
  );
}

function statsTable(): HTMLTableElement {
  const t = [...document.querySelectorAll("table")].find((tb) =>
    /Days worked/.test(tb.querySelector("thead")?.textContent || "")
  );
  expect(t).toBeTruthy();
  return t as HTMLTableElement;
}

function bwCard(): HTMLElement {
  const c = [...document.querySelectorAll("div.card")].find((el) =>
    (el.textContent || "").includes("Block-wise production per tapper")
  );
  expect(c).toBeTruthy();
  return c as HTMLElement;
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
    /Selected total|— all blocks/.test(tr.textContent || "")
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

function rowByName(t: HTMLTableElement, name: string): HTMLTableRowElement | undefined {
  return [...t.querySelectorAll("tbody tr")].find(
    (tr) => (tr.children[0]?.textContent || "").trim() === name
  ) as HTMLTableRowElement | undefined;
}

function sectionTable(tapper: string): HTMLTableElement {
  const cb = screen.getByLabelText(`Select all blocks for ${tapper}`);
  const t = cb.closest("table") as HTMLTableElement;
  expect(t).toBeTruthy();
  return t;
}

async function openTappers() {
  await login();
  await settle();
  goto("tappers");
  await waitFor(() => expect(statsTable()).toBeTruthy());
  // season preset may not cover the fixture date — the All range covers everything
  const allPill = [...document.querySelectorAll("button")].find(
    (b) => (b.textContent || "").trim() === "All"
  );
  expect(allPill).toBeTruthy();
  fireEvent.click(allPill!);
  await waitFor(() => {
    expect(rowByName(statsTable(), "John")).toBeTruthy();
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

describe("fix list #9 — avg kg / tree on the tapper stats table", () => {
  it("divides each tapper's period latex by the trees on their assigned blocks", async () => {
    await openTappers();
    const t = statsTable();
    const hs = headers(t);
    expect(hs.some((h) => h.startsWith("Avg kg / day"))).toBe(true);
    expect(hs.some((h) => h.startsWith("Avg kg / tree"))).toBe(true);

    // John: 13 kg over 1 day on 2 blocks, 1 miss, responsible for
    // K1+K2 = 800 trees → 13 / 800 = 0.01625 → "0.016".
    const john = rowByName(t, "John")!;
    expect(num(john.children[col(hs, "Days worked")].textContent)).toBe(1);
    expect(num(john.children[col(hs, "Blocks tapped")].textContent)).toBe(2);
    expect(num(john.children[col(hs, "Missed")].textContent)).toBe(1);
    expect((john.children[col(hs, "Net latex")].textContent || "").trim()).toBe(
      "13.00"
    );
    expect((john.children[col(hs, "Avg kg / day")].textContent || "").trim()).toBe(
      "13.00"
    );
    expect((john.children[col(hs, "Avg kg / tree")].textContent || "").trim()).toBe(
      "0.016"
    );

    // Reji Kumar: 20 kg, responsible for K3 = 2400 trees → 0.0083… → "0.008".
    const reji = rowByName(t, "Reji Kumar")!;
    expect((reji.children[col(hs, "Net latex")].textContent || "").trim()).toBe(
      "20.00"
    );
    expect((reji.children[col(hs, "Avg kg / tree")].textContent || "").trim()).toBe(
      "0.008"
    );

    // Biju has no records in range → no stats row (and never a fake 0).
    expect(rowByName(t, "Biju")).toBeUndefined();
  });
});

describe("fix list #8 — block-wise production per tapper", () => {
  it("gives each tapper their own block table with an isolated all-blocks total", async () => {
    await openTappers();
    expect(screen.getByText(/Tick blocks to total/)).toBeTruthy();

    const card = bwCard();
    const tables = [...card.querySelectorAll("table")].filter((tb) =>
      /Days tapped/.test(tb.querySelector("thead")?.textContent || "")
    );
    expect(tables.length).toBe(2); // John + Reji Kumar

    const jt = sectionTable("John");
    const jhs = headers(jt);
    expect(col(jhs, "Block")).toBeGreaterThan(0);
    expect(col(jhs, "Wet sheets")).toBeGreaterThan(0);
    expect(dataRows(jt).length).toBe(2); // K1, K2
    expect(totalsRow(jt)).toBeUndefined();

    fireEvent.click(screen.getByLabelText("Select all blocks for John"));
    const tot = await waitFor(() => {
      const r = totalsRow(sectionTable("John"));
      expect(r).toBeTruthy();
      return r!;
    });
    expect(tot.children[0].textContent?.trim()).toBe("John — all blocks");

    const hs = headers(sectionTable("John"));
    // John's two blocks: days 1 + 1, misses 0 + 1, latex 8 + 5 = 13.
    expect(num(totalsCell(tot, col(hs, "Days tapped")).textContent)).toBe(2);
    expect(num(totalsCell(tot, col(hs, "Missed")).textContent)).toBe(1);
    expect(num(totalsCell(tot, col(hs, "Net latex")).textContent)).toBe(13);
    // Re-derived from the summed totals, not the mean of row averages.
    expect(
      (totalsCell(tot, col(hs, "Avg kg / day")).textContent || "").trim()
    ).toBe("6.50"); // 13 / 2
    expect(
      dataRows(sectionTable("John")).every(
        (r) => (r.querySelector("input") as HTMLInputElement).checked
      )
    ).toBe(true);

    // Reji Kumar's table keeps its own (empty) selection state.
    expect(totalsRow(sectionTable("Reji Kumar"))).toBeUndefined();

    // untick all — John's totals row disappears
    fireEvent.click(screen.getByLabelText("Select all blocks for John"));
    await waitFor(() => expect(totalsRow(sectionTable("John"))).toBeUndefined());

    // tick just K1 → Selected total (1) with only that block's numbers
    fireEvent.click(screen.getByLabelText("Select John block K1"));
    const part = await waitFor(() => {
      const r = totalsRow(sectionTable("John"));
      expect(r?.children[0].textContent?.trim()).toBe("Selected total (1)");
      return r!;
    });
    const phs = headers(sectionTable("John"));
    expect(num(totalsCell(part, col(phs, "Days tapped")).textContent)).toBe(1);
    expect(num(totalsCell(part, col(phs, "Missed")).textContent)).toBe(1);
    expect(num(totalsCell(part, col(phs, "Net latex")).textContent)).toBe(8);
    expect(
      (totalsCell(part, col(phs, "Avg kg / day")).textContent || "").trim()
    ).toBe("8.00");
  });
});
