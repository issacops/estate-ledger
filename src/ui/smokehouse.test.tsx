import { describe, it, expect, beforeEach } from "vitest";
import { render, screen, fireEvent, cleanup, waitFor } from "@testing-library/react";
import "../i18n";
import App from "../app/App";
import { resetDb, rows, run } from "../test/fakes/db";
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

// A person's KPI trio lives under their name chip; climb from the chip to
// the wrapper that holds all three cards.
function personSection(person: string): HTMLElement | null {
  const chip = [...document.querySelectorAll("div")].find(
    (d) =>
      typeof d.className === "string" &&
      d.className.includes("rounded-full") &&
      (d.textContent || "").trim().startsWith(person)
  );
  return chip ? (chip.parentElement as HTMLElement) : null;
}

function kpiValue(label: string, scope: HTMLElement | null): string {
  if (!scope) return "";
  const lab = [...scope.querySelectorAll(".label")].find((n) => n.textContent === label);
  if (!lab) return "";
  let el: HTMLElement | null = lab.parentElement;
  while (el && !el.querySelector(".kpi-num")) el = el.parentElement;
  return el?.querySelector(".kpi-num")?.textContent?.trim() ?? "";
}

// The submit button sits inside a Field (a <label>), which jsdom's
// accessible-name computation reports as "" — match on its text instead.
function clickRecord() {
  const btn = [...document.querySelectorAll("button")].find((b) =>
    /Record movement/i.test(b.textContent || "")
  );
  expect(btn).toBeTruthy();
  fireEvent.click(btn!);
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
});

describe("fix list #6 — smokehouse tracked per person", () => {
  it("shows the three stage totals separately for the estate and a shared person", async () => {
    // Estate: 200 wet sheets made, 100 smoked in, 60 out.
    const day = run(
      "INSERT INTO entry_days (estate_id, date) VALUES ($1,$2)",
      [1, "2026-09-01"]
    );
    run(
      "INSERT INTO entry_rows (day_id, block_id, product_mode, status, wet_sheets) VALUES ($1,1,'Sheet','Completed',200)",
      [day.lastInsertId]
    );
    run(
      "INSERT INTO smokehouse_log (estate_id, date, wet_in, dry_out, note, person) VALUES (1,'2026-09-02',100,60,'','Estate')"
    );
    // John shares the smokehouse: his sheets never touch the estate's totals.
    run(
      "INSERT INTO smokehouse_log (estate_id, date, wet_in, dry_out, note, person) VALUES (1,'2026-09-03',40,10,'','John')"
    );

    await login();
    await settle();
    goto("smokehouse");

    const estate = await waitFor(() => {
      const s = personSection("Estate");
      expect(s).not.toBeNull();
      return s!;
    });
    const john = await waitFor(() => {
      const s = personSection("John");
      expect(s).not.toBeNull();
      return s!;
    });

    // Estate keeps its own stages — John's rows are not merged in.
    expect(kpiValue("Wet sheets waiting", estate)).toBe("100"); // 200 made - 100 moved in
    expect(kpiValue("In smokehouse", estate)).toBe("40"); // 100 - 60
    expect(kpiValue("In storeroom", estate)).toBe("60"); // 60 - 0 sold

    // John's stages come from his own movements only.
    expect(kpiValue("Wet sheets waiting", john)).toBe("0");
    expect(kpiValue("In smokehouse", john)).toBe("30"); // 40 - 10
    expect(kpiValue("In storeroom", john)).toBe("10"); // his dry sheets leave with him
  });

  it("records a movement against the person typed on the form", async () => {
    await login();
    await settle();
    goto("smokehouse");
    const wetIn = await screen.findByLabelText("Wet in");

    fireEvent.change(wetIn, { target: { value: "5" } });
    fireEvent.change(screen.getByLabelText("Dry out"), { target: { value: "2" } });
    fireEvent.change(screen.getByLabelText("Person"), { target: { value: "John" } });
    clickRecord();

    await waitFor(() => {
      expect(
        rows<{ person: string; wet_in: number; dry_out: number }>(
          "SELECT person, wet_in, dry_out FROM smokehouse_log"
        )
      ).toEqual([{ person: "John", wet_in: 5, dry_out: 2 }]);
    });

    // John's own totals pick the movement up, and the log lists him by name.
    const john = await waitFor(() => {
      const s = personSection("John");
      expect(s).not.toBeNull();
      return s!;
    });
    expect(kpiValue("In smokehouse", john)).toBe("3");
    await screen.findByText("John");

    // Left blank, the movement counts as the estate's own.
    fireEvent.change(screen.getByLabelText("Wet in"), { target: { value: "1" } });
    fireEvent.change(screen.getByLabelText("Person"), { target: { value: "" } });
    clickRecord();
    await waitFor(() => {
      expect(
        rows<{ person: string }>("SELECT person FROM smokehouse_log ORDER BY id")
      ).toEqual([{ person: "John" }, { person: "Estate" }]);
    });
  });
});
