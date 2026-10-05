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

async function open(route: string) {
  await login();
  window.location.hash = `#/${route}`;
  useApp.getState().setRoute(route);
  const fy = await waitFor(() => {
    const sel = [...document.querySelectorAll("select")].find((x) =>
      [...x.options].some((o) => o.value === "all")
    );
    expect(sel).toBeTruthy();
    return sel!;
  });
  fireEvent.change(fy, { target: { value: "all" } });
}

beforeEach(async () => {
  cleanup();
  toast.dismiss();
  resetDb();
  window.localStorage.clear();
  window.location.hash = "#/dashboard";
  useApp.setState({ user: null, estate: null, estates: [], route: "dashboard", dataVersion: 0 });
  await ensureSeeded();
});

/** One Not Done entry for John on K1 — a real miss, with a reason. */
function miss(date: string, reason: string) {
  const day = run("INSERT INTO entry_days (estate_id, date) VALUES (1,$1)", [date]).lastInsertId;
  run(
    "INSERT INTO entry_rows (day_id, block_id, tapper_id, product_mode, status, reason, trees_scheduled) " +
      "VALUES ($1,1,1,'Sheet','Not Done',$2,400)",
    [day, reason]
  );
}

function labour(date: string, men: number, women: number) {
  const day = run("INSERT INTO entry_days (estate_id, date) VALUES (1,$1)", [date]).lastInsertId;
  run(
    "INSERT INTO labour_rows (day_id, name, sex, men, women, work_type, who, where_, sort_order) " +
      "VALUES ($1,'','',$2,$3,'Weeding','','K1',0)",
    [day, men, women]
  );
}

describe("long tables fold away until asked for", () => {
  it("Missed tapping keeps the not-done register folded, with its count in the heading", async () => {
    miss("2026-09-01", "Heavy Rain");
    miss("2026-09-03", "Tapper Absent");
    await open("missed");

    const header = await screen.findByRole("button", { name: /Not-done register.*2 missed/i });
    expect(header.getAttribute("aria-expanded")).toBe("false");
    expect(screen.queryByText("Tapper Absent", { selector: "td" })).toBeNull();

    fireEvent.click(header);
    expect(await screen.findByText("Tapper Absent", { selector: "td" })).toBeTruthy();
    fireEvent.click(header);
    await waitFor(() =>
      expect(screen.queryByText("Tapper Absent", { selector: "td" })).toBeNull()
    );
  });

  it("Missed tapping stays open and says so when there is nothing missed", async () => {
    await open("missed");
    expect(await screen.findByText(/No missed tapping in range/i)).toBeTruthy();
    // nothing to fold, so no Show / Hide toggle on that card
    const card = screen.getByText("Not-done register").closest(".card") as HTMLElement;
    expect([...card.querySelectorAll("button")].map((b) => b.textContent)).not.toContain("Show");
  });

  it("Attendance keeps the day-by-day labour folded", async () => {
    labour("2026-09-01", 2, 3);
    await open("attendance");
    const header = await screen.findByRole("button", { name: /Day-by-day labour.*1 days/i });
    expect(header.getAttribute("aria-expanded")).toBe("false");
    expect(screen.queryByText(/^01 Sep/, { selector: "td" })).toBeNull();
    fireEvent.click(header);
    expect(await screen.findByText(/^01 Sep/, { selector: "td" })).toBeTruthy();
  });

  it("Smokehouse stays open and says so before anything is recorded", async () => {
    await login();
    window.location.hash = "#/smokehouse";
    useApp.getState().setRoute("smokehouse");
    expect(await screen.findByText(/No smokehouse movements yet/i)).toBeTruthy();
  });
});
