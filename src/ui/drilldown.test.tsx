import { describe, it, expect, beforeEach } from "vitest";
import { render, screen, fireEvent, cleanup, waitFor } from "@testing-library/react";
import { toast } from "sonner";
import "../i18n";
import App from "../app/App";
import { resetDb, run } from "../test/fakes/db";
import { ensureSeeded } from "../db/seed";
import { useApp } from "../app/store";

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

/** One entry for tapper 1 on block 1 — Karukachal's John on K1. */
function entry(date: string, status: "Completed" | "Not Done", reason: string, wet = 0) {
  const day = run("INSERT INTO entry_days (estate_id, date) VALUES (1,$1)", [date]).lastInsertId;
  run(
    "INSERT INTO entry_rows (day_id, block_id, tapper_id, product_mode, status, reason, trees_scheduled, trees_tapped, wet_sheets) " +
      "VALUES ($1,1,1,'Sheet',$2,$3,400,$4,$5)",
    [day, status, reason, status === "Completed" ? 400 : 0, wet]
  );
}

beforeEach(async () => {
  cleanup();
  toast.dismiss();
  resetDb();
  window.localStorage.clear();
  window.location.hash = "#/dashboard";
  useApp.setState({ user: null, estate: null, estates: [], route: "dashboard", dataVersion: 0 });
  await ensureSeeded();

  // 31 + 30 + 19 = 80 entries, well past the old limit of 30
  for (let d = 1; d <= 31; d++) entry(`2026-08-${String(d).padStart(2, "0")}`, "Completed", "", 10);
  for (let d = 1; d <= 9; d++) entry(`2026-09-${String(d).padStart(2, "0")}`, "Not Done", "Heavy Rain");
  for (let d = 10; d <= 30; d++) entry(`2026-09-${String(d).padStart(2, "0")}`, "Completed", "", 12);
  for (let d = 1; d <= 19; d++) entry(`2026-10-${String(d).padStart(2, "0")}`, "Not Done", "Not scheduled");
});

async function openJohn(route: "tappers" | "blocks", name: string) {
  await login();
  await screen.findByText(/Rubber estates/i);
  goto(route);
  // the season may not cover the fixture dates
  const fy = await waitFor(() => {
    const sel = [...document.querySelectorAll("select")].find((x) =>
      [...x.options].some((o) => o.value === "all")
    );
    expect(sel).toBeTruthy();
    return sel!;
  });
  fireEvent.change(fy, { target: { value: "all" } });
  const cell = await waitFor(() => {
    const c = [...document.querySelectorAll("td")].find((t) => t.textContent === name);
    expect(c).toBeTruthy();
    return c!;
  });
  fireEvent.click(cell.closest("tr")!);
}

describe("entry drill-down shows the whole history", () => {
  it("lists all 80 entries for a tapper, not the latest 30", async () => {
    await openJohn("tappers", "John");
    await screen.findByText(/John — 80 entries/);
    // first page is full; there are more pages, so nothing was cut off
    expect(screen.getByText(/Showing 1–50 of 80/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    expect(await screen.findByText(/Showing 51–80 of 80/)).toBeTruthy();
  });

  it("filters to one month", async () => {
    await openJohn("tappers", "John");
    await screen.findByText(/John — 80 entries/);
    // the page's own Period picker also lists September, so find the panel's
    // by its "All time" option
    const month = [...document.querySelectorAll("select")].find((x) =>
      [...x.options].some((o) => o.textContent === "All time")
    )!;
    fireEvent.change(month, { target: { value: "2026-09" } });
    await screen.findByText(/John — 30 of 80 entries/);
  });

  it("tells a real miss from a block that was not due", async () => {
    await openJohn("tappers", "John");
    await screen.findByText(/John — 80 entries/);
    const status = [...document.querySelectorAll("select")].find((x) =>
      [...x.options].some((o) => o.value === "missed")
    )!;
    fireEvent.change(status, { target: { value: "missed" } });
    await screen.findByText(/John — 9 of 80 entries/);
    fireEvent.change(status, { target: { value: "notScheduled" } });
    await screen.findByText(/John — 19 of 80 entries/);
  });

  it("reads month by month, and a month opens its entries", async () => {
    await openJohn("tappers", "John");
    await screen.findByText(/John — 80 entries/);
    fireEvent.click(screen.getByRole("button", { name: "By month" }));
    const aug = await screen.findByRole("button", { name: "August 2026" });
    expect(screen.getByRole("button", { name: "September 2026" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "October 2026" })).toBeTruthy();
    fireEvent.click(aug);
    await screen.findByText(/John — 31 of 80 entries/);
  });

  it("shows wet sheets for a sheet block, not a column of zeros", async () => {
    await openJohn("tappers", "John");
    await screen.findByText(/John — 80 entries/);
    fireEvent.click(screen.getByRole("button", { name: "By month" }));
    const aug = (await screen.findByRole("button", { name: "August 2026" })).closest("tr")!;
    expect(aug.textContent).toContain("310"); // 31 days x 10 wet sheets
  });

  it("works for a block too, and names the tapper", async () => {
    await openJohn("blocks", "K1");
    await screen.findByText(/Block K1 — 80 entries/);
    expect([...document.querySelectorAll("th")].some((h) => h.textContent === "Tapper")).toBe(true);
  });
});
