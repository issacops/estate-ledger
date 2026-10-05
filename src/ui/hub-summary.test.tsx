import { describe, it, expect, beforeEach } from "vitest";
import { render, screen, fireEvent, cleanup, waitFor } from "@testing-library/react";
import { toast } from "sonner";
import "../i18n";
import App from "../app/App";
import { resetDb, run } from "../test/fakes/db";
import { ensureSeeded } from "../db/seed";
import { useApp } from "../app/store";
import { sumPools } from "../pages/StockHub";

const pool = (added: number, disp: number, sold: number) => ({
  added, disp, sold, available: added - sold, inStock: added - disp, staged: disp - sold,
});

describe("hub totals", () => {
  it("adds every grade or item together", () => {
    const t = sumPools([pool(500, 200, 100), pool(300, 100, 50)]);
    expect(t).toMatchObject({ added: 800, disp: 300, sold: 150, inStock: 500, staged: 150, available: 650, oversold: false });
  });

  it("flags a pool that sold more than it was ever given", () => {
    expect(sumPools([pool(100, 100, 150)]).oversold).toBe(true);
  });

  it("flags dispatching more than was added", () => {
    expect(sumPools([pool(100, 150, 0)]).oversold).toBe(true);
  });

  it("does not let one grade's surplus hide another's shortfall", () => {
    const t = sumPools([pool(1000, 0, 0), pool(50, 50, 80)]);
    expect(t.available).toBe(970); // the total looks healthy…
    expect(t.oversold).toBe(true); // …but RSS5 sold 30 it never had
  });

  it("treats an empty hub as balanced", () => {
    expect(sumPools([])).toMatchObject({ added: 0, available: 0, oversold: false });
  });
});

async function login() {
  render(<App />);
  await screen.findByLabelText(/password/i);
  fireEvent.change(screen.getByLabelText(/password/i), { target: { value: "ninan123@4" } });
  fireEvent.click(screen.getByRole("button", { name: /sign in/i }));
  await screen.findByText(/Rubber estates/i);
}
const goto = (route: string) => {
  window.location.hash = `#/${route}`;
  useApp.getState().setRoute(route);
};
const ledger = (hub: string, delta: number, reason: string) =>
  run(
    "INSERT INTO stock_ledger (estate_id, hub, date, qty_delta, reason) VALUES (1,$1,'2026-10-01',$2,$3)",
    [hub, delta, reason]
  );

beforeEach(async () => {
  cleanup();
  toast.dismiss();
  resetDb();
  window.localStorage.clear();
  window.location.hash = "#/dashboard";
  useApp.setState({ user: null, estate: null, estates: [], route: "dashboard", dataVersion: 0 });
  await ensureSeeded();
});

// a KPI is the rounded box around its label, value and sub-line
const kpi = (label: string) =>
  screen
    .findByText(label)
    .then((el) => el.closest("[class*='rounded-[18px]']") as HTMLElement);

describe("summary strip on the other stock hubs", () => {
  it("scrap shows added, in stock, dispatched and balance", async () => {
    ledger("scrap", 500, "manual");
    ledger("scrap", 200, "dispatch");
    ledger("scrap", -100, "sale");
    await login();
    goto("scrap");
    expect((await kpi("Total added")).textContent).toContain("500.00 kg");
    expect((await kpi("In stock")).textContent).toContain("300.00 kg");
    const disp = await kpi("Dispatched");
    expect(disp.textContent).toContain("200.00 kg");
    expect(disp.textContent).toContain("100.00 kg staged");
    const bal = await kpi("Balance");
    expect(bal.textContent).toContain("Balanced");
    expect(bal.textContent).toContain("400.00 kg available");
  });

  it("sheet adds its grades together and warns when one is oversold", async () => {
    ledger("sheet:RSS4", 1000, "manual");
    ledger("sheet:RSS5", 50, "manual");
    ledger("sheet:RSS5", -80, "sale");
    await login();
    goto("sheets");
    expect((await kpi("Total added")).textContent).toContain("1,050.00 kg");
    expect((await kpi("Balance")).textContent).toContain("Oversold");
  });

  it("other crop shows the strip above its item table", async () => {
    const id = run("INSERT INTO stock_items (estate_id, name, unit) VALUES (1,'Cocoa','kg')");
    ledger(`crop:${id.lastInsertId}`, 40, "manual");
    await login();
    goto("othercrop");
    expect((await kpi("Total added")).textContent).toContain("40.00 kg");
    expect(screen.getByText("Cocoa")).toBeTruthy();
  });

  it("an empty hub still shows a calm zeroed strip", async () => {
    await login();
    goto("scrap");
    await waitFor(async () => expect((await kpi("Balance")).textContent).toContain("Balanced"));
    expect((await kpi("Total added")).textContent).toContain("0.00 kg");
  });
});
