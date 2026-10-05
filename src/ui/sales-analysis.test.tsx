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

const invoice = (no: string, date: string, grade: string, qty: number, rate: number, value: number | null, status: string) =>
  run(
    "INSERT INTO invoices (estate_id, invoice_no, date, grade, qty, rate, value, status) VALUES (1,$1,$2,$3,$4,$5,$6,$7)",
    [no, date, grade, qty, rate, value, status]
  );

// "Sales value" is also a column heading further down, so only count a label
// that sits inside a headline box
const kpiBoxes = (label: string) =>
  screen
    .queryAllByText(label)
    .map((el) => el.closest("[class*='rounded-[18px]']") as HTMLElement | null)
    .filter((b): b is HTMLElement => b !== null);

const kpi = async (label: string) => {
  const boxes = await waitFor(() => {
    const b = kpiBoxes(label);
    expect(b.length).toBeGreaterThan(0);
    return b;
  });
  return boxes[0];
};

beforeEach(async () => {
  cleanup();
  toast.dismiss();
  resetDb();
  window.localStorage.clear();
  window.location.hash = "#/dashboard";
  useApp.setState({ user: null, estate: null, estates: [], route: "dashboard", dataVersion: 0 });
  await ensureSeeded();
  invoice("A/1", "2026-08-10", "Latex", 100, 180, 18000, "Final");
  invoice("A/2", "2026-09-10", "RSS4", 50, 200, 10000, "Final");
  invoice("A/3", "2026-09-20", "Latex", 400, 0, null, "Pending DRC");
  invoice("A/4", "2026-09-25", "Latex", 999, 180, 99999, "Cancelled");
});

async function open() {
  await login();
  window.location.hash = "#/sales-analysis";
  useApp.getState().setRoute("sales-analysis");
  const fy = await waitFor(() => {
    const sel = [...document.querySelectorAll("select")].find((x) =>
      [...x.options].some((o) => o.value === "all")
    );
    expect(sel).toBeTruthy();
    return sel!;
  });
  fireEvent.change(fy, { target: { value: "all" } });
}

describe("Sales analysis charts", () => {
  it("opens with a headline strip worked out from the invoices, leaving cancelled ones out", async () => {
    await open();
    // 18,000 + 10,000; the cancelled 99,999 and the pending one carry no value
    expect((await kpi("Sales value")).textContent).toContain("28,000.00");
    expect((await kpi("Sales value")).textContent).toContain("3 invoice(s) · 1 cancelled left out");
    // billed kg includes the pending 400: 100 + 50 + 400
    expect((await kpi("Quantity sold")).textContent).toContain("550.00 kg");
    // rate is over the invoices that have a value only: 28,000 / 150
    expect((await kpi("Average rate")).textContent).toContain("186.67");
    const pending = await kpi("Awaiting DRC");
    expect(pending.textContent).toContain("1");
    expect(pending.textContent).toContain("no value until DRC is set");
  });

  it("shows the four chart cards, each with its own Line / Bars switch", async () => {
    await open();
    for (const title of ["Sales per month", "Sales by grade", "Sales by buyer", "Rate achieved per month"]) {
      const card = (await screen.findByText(title)).closest(".card") as HTMLElement;
      expect(card, title).toBeTruthy();
      const buttons = [...card.querySelectorAll("button")].map((b) => b.textContent);
      expect(buttons, title).toEqual(expect.arrayContaining(["Line", "Bars"]));
    }
  });

  it("warns that the rate mixes grades until one is picked", async () => {
    await open();
    expect((await kpi("Average rate")).textContent).toContain("mixes grades");
    fireEvent.click(await screen.findByRole("button", { name: "RSS4" }));
    await waitFor(async () =>
      expect((await kpi("Average rate")).textContent).toContain("value ÷ billed kg")
    );
    expect((await kpi("Average rate")).textContent).toContain("200.00");
  });

  it("shows no charts when there is nothing to chart", async () => {
    run("DELETE FROM invoices");
    await open();
    await screen.findByText(/No invoices in range/i);
    expect(kpiBoxes("Sales value")).toHaveLength(0);
  });

  it("keeps the invoice table folded away until asked for", async () => {
    await open();
    const header = await screen.findByRole("button", { name: /Invoices.*in range/i });
    expect(header.getAttribute("aria-expanded")).toBe("false");
    // the charts come first; no invoice rows are on screen yet
    expect(screen.queryByText("A/1")).toBeNull();
    expect(header.textContent).toContain("4 in range"); // the table lists the cancelled one too

    fireEvent.click(header);
    expect(await screen.findByText("A/1")).toBeTruthy();
    expect(header.getAttribute("aria-expanded")).toBe("true");

    // and folds shut again
    fireEvent.click(header);
    await waitFor(() => expect(screen.queryByText("A/1")).toBeNull());
  });

  it("names the grade in the heading when one is picked", async () => {
    await open();
    fireEvent.click(await screen.findByRole("button", { name: "RSS4" }));
    const header = await screen.findByRole("button", { name: /Invoices.*RSS4/i });
    expect(header.textContent).toContain("1 in range · RSS4");
  });
});
