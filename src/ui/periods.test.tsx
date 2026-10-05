import { describe, it, expect, beforeEach } from "vitest";
import { render, screen, fireEvent, cleanup, waitFor } from "@testing-library/react";
import { toast } from "sonner";
import "../i18n";
import App from "../app/App";
import { resetDb } from "../test/fakes/db";
import { ensureSeeded } from "../db/seed";
import { useApp } from "../app/store";
import {
  ALL_DATES,
  calendarYearRange,
  fyOptions,
  monthsOfYear,
  pickersFor,
  quarterRangeOf,
  yearOptions,
} from "./periods";
import { seasonRange } from "../domain/dates";

const TODAY = "2026-10-06";
const fys = fyOptions(TODAY);
const period = (from: string, to: string) => ({ id: "x", label: "", from, to });

describe("year then month", () => {
  it("offers the last few years, newest first", () => {
    expect(yearOptions(TODAY, 3)).toEqual(["2026", "2025", "2024", "2023"]);
  });

  it("lists twelve months for a past year", () => {
    const m = monthsOfYear("2025", TODAY);
    expect(m).toHaveLength(12);
    expect(m[0]).toEqual({ key: "2025-01", label: "January" });
    expect(m[11]).toEqual({ key: "2025-12", label: "December" });
  });

  it("stops the current year at this month", () => {
    const m = monthsOfYear("2026", TODAY);
    expect(m).toHaveLength(10);
    expect(m[9].label).toBe("October");
  });

  it("offers no months for a year that has not started", () => {
    expect(monthsOfYear("2027", TODAY)).toEqual([]);
  });

  it("reads back a whole year, a whole month, and neither", () => {
    expect(pickersFor(period("2025-01-01", "2025-12-31"), fys)).toMatchObject({ year: "2025", month: "year" });
    expect(pickersFor(period("2025-03-01", "2025-03-31"), fys)).toMatchObject({ year: "2025", month: "2025-03" });
    expect(pickersFor(period("2025-03-05", "2025-03-20"), fys)).toMatchObject({ year: "2025", month: "" });
    // a financial year spans two calendar years, so there is no single year to show
    expect(pickersFor(period("2026-04-01", "2027-03-31"), fys)).toMatchObject({ year: "", month: "" });
  });

  it("knows February in a leap year", () => {
    expect(pickersFor(period("2024-02-01", "2024-02-29"), fys).month).toBe("2024-02");
    expect(pickersFor(period("2024-02-01", "2024-02-28"), fys).month).toBe("");
  });
});

describe("financial year then quarter", () => {
  it("reads back a whole financial year", () => {
    const r = seasonRange("2025-2026");
    expect(pickersFor(period(r.from, r.to), fys)).toMatchObject({ fy: "2025-2026", quarter: "fy" });
  });

  it("reads back each quarter against its financial year, Q4 included", () => {
    for (const q of ["Q1", "Q2", "Q3", "Q4"]) {
      const r = quarterRangeOf(q, "2025-2026");
      expect(pickersFor(period(r.from, r.to), fys)).toMatchObject({ fy: "2025-2026", quarter: q });
    }
    // Q4 is January to March of the second calendar year
    expect(quarterRangeOf("Q4", "2025-2026")).toEqual({ from: "2026-01-01", to: "2026-03-31" });
  });

  it("reads back all dates", () => {
    expect(pickersFor(period(ALL_DATES.from, ALL_DATES.to), fys)).toMatchObject({ fy: "all" });
  });

  it("shows nothing for a custom range", () => {
    expect(pickersFor(period("2025-06-10", "2025-08-02"), fys)).toMatchObject({ fy: "", quarter: "" });
  });
});

describe("year range", () => {
  it("is January to December", () => {
    expect(calendarYearRange("2025")).toEqual({ from: "2025-01-01", to: "2025-12-31" });
  });
});

// --- the real dropdowns, on a real page
async function login() {
  render(<App />);
  await screen.findByLabelText(/password/i);
  fireEvent.change(screen.getByLabelText(/password/i), { target: { value: "ninan123@4" } });
  fireEvent.click(screen.getByRole("button", { name: /sign in/i }));
  await screen.findByText(/Rubber estates/i);
}
const selectWith = (label: string) =>
  [...document.querySelectorAll("label")]
    .find((l) => l.querySelector("span.label")?.textContent === label)!
    .querySelector("select") as HTMLSelectElement;

describe("the pickers on the page", () => {
  beforeEach(async () => {
    cleanup();
    toast.dismiss();
    resetDb();
    window.localStorage.clear();
    window.location.hash = "#/dashboard";
    useApp.setState({ user: null, estate: null, estates: [], route: "dashboard", dataVersion: 0 });
    await ensureSeeded();
  });

  async function openTrends() {
    await login();
    window.location.hash = "#/trends";
    useApp.getState().setRoute("trends");
    await waitFor(() => expect(selectWith("Year")).toBeTruthy());
  }

  it("keeps Month locked until a year is chosen, then offers its months", async () => {
    await openTrends();
    // the default period is a financial year, which is no single calendar year
    expect(selectWith("Month").disabled).toBe(true);
    fireEvent.change(selectWith("Year"), { target: { value: "2025" } });
    await waitFor(() => expect(selectWith("Month").disabled).toBe(false));
    expect(document.body.textContent).toContain("Showing 2025-01-01 to 2025-12-31");
    expect([...selectWith("Month").options].map((o) => o.textContent)).toEqual([
      "Whole year", "January", "February", "March", "April", "May", "June",
      "July", "August", "September", "October", "November", "December",
    ]);

    fireEvent.change(selectWith("Month"), { target: { value: "2025-03" } });
    await waitFor(() => expect(document.body.textContent).toContain("Showing 2025-03-01 to 2025-03-31"));
    // and back out to the whole year
    fireEvent.change(selectWith("Month"), { target: { value: "year" } });
    await waitFor(() => expect(document.body.textContent).toContain("Showing 2025-01-01 to 2025-12-31"));
  });

  it("lists only four quarters once a financial year is chosen", async () => {
    await openTrends();
    // the page opens on the current financial year, so Quarter is already usable
    expect(selectWith("Quarter").disabled).toBe(false);
    expect([...selectWith("Quarter").options].map((o) => o.textContent)).toEqual([
      "Whole financial year", "Q1 — Apr to Jun", "Q2 — Jul to Sep", "Q3 — Oct to Dec", "Q4 — Jan to Mar",
    ]);
    fireEvent.change(selectWith("Quarter"), { target: { value: "Q4" } });
    await waitFor(() => expect(document.body.textContent).toContain("Showing 2027-01-01 to 2027-03-31"));
  });

  it("locks Quarter when no financial year applies", async () => {
    await openTrends();
    fireEvent.change(selectWith("Year"), { target: { value: "2025" } });
    await waitFor(() => expect(selectWith("Quarter").disabled).toBe(true));
  });
});
