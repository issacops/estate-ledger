import { describe, it, expect, beforeEach } from "vitest";
import { render, screen, fireEvent, cleanup, waitFor } from "@testing-library/react";
import { toast } from "sonner";
import "../i18n";
import App from "../app/App";
import { resetDb, rows, run, scalar } from "../test/fakes/db";
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

const holder = (code: string) =>
  rows<{ name: string | null }>(
    "SELECT t.name FROM blocks b LEFT JOIN tappers t ON t.id=b.tapper_id WHERE b.estate_id=1 AND b.code=$1",
    [code]
  )[0]?.name ?? null;

const chip = (code: string, tapper: string) =>
  screen.findByRole("checkbox", { name: `${code} for ${tapper}` });

beforeEach(async () => {
  cleanup();
  toast.dismiss();
  resetDb();
  window.localStorage.clear();
  window.location.hash = "#/dashboard";
  useApp.setState({ user: null, estate: null, estates: [], route: "dashboard", dataVersion: 0 });
  await ensureSeeded();
});

describe("Estate setup — who taps which block", () => {
  it("starts with the blocks where the estate put them", async () => {
    await login();
    goto("masters");
    expect((await chip("K1", "John")).getAttribute("aria-checked")).toBe("true");
    expect((await chip("K2", "John")).getAttribute("aria-checked")).toBe("true");
    expect((await chip("K3", "Reji Kumar")).getAttribute("aria-checked")).toBe("true");
    expect((await chip("K3", "John")).getAttribute("aria-checked")).toBe("false");
    expect(await screen.findByText(/2 blocks · 800 trees/)).toBeTruthy();
  });

  it("gives K3 and K4 to John, taking them from whoever held them", async () => {
    await login();
    goto("masters");
    fireEvent.click(await chip("K3", "John"));
    await waitFor(() => expect(holder("K3")).toBe("John"));
    fireEvent.click(await chip("K4", "John"));
    await waitFor(() => expect(holder("K4")).toBe("John"));

    // a block has one tapper, so the others lose it
    expect((await chip("K3", "Reji Kumar")).getAttribute("aria-checked")).toBe("false");
    expect((await chip("K4", "Biju")).getAttribute("aria-checked")).toBe("false");
    expect(await screen.findByText(/4 blocks · 4,700 trees/)).toBeTruthy();
  });

  it("leaves a block with nobody when it is unticked, and says so", async () => {
    await login();
    goto("masters");
    fireEvent.click(await chip("K2", "John"));
    await waitFor(() => expect(holder("K2")).toBeNull());
    expect(await screen.findByText(/No tapper:/)).toBeTruthy();
    expect(document.body.textContent).toContain("K2");

    // and it can be given to someone again
    fireEvent.click(await chip("K2", "Biju"));
    await waitFor(() => expect(holder("K2")).toBe("Biju"));
    await waitFor(() => expect(screen.queryByText(/No tapper:/)).toBeNull());
  });

  it("works the same way at Kulashekaram", async () => {
    await login();
    const sel = document.querySelector("aside select") as HTMLSelectElement;
    fireEvent.change(sel, { target: { value: "2" } });
    goto("masters");
    // B1 is Rajendran's; hand it to Poovas
    fireEvent.click(await chip("B1", "Poovas"));
    await waitFor(() =>
      expect(
        rows<{ name: string }>(
          "SELECT t.name FROM blocks b JOIN tappers t ON t.id=b.tapper_id WHERE b.estate_id=2 AND b.code='B1'"
        )[0]?.name
      ).toBe("Poovas")
    );
    expect(await screen.findByText(/4 blocks · 1,800 trees/)).toBeTruthy();
  });

  it("changes who new entries start from, and leaves old entries with who tapped them", async () => {
    // Rajendran tapped B1 in September
    const day = run("INSERT INTO entry_days (estate_id, date) VALUES (2,'2026-09-01')").lastInsertId;
    const b1 = scalar("SELECT id FROM blocks WHERE estate_id=2 AND code='B1'");
    const rajendran = scalar("SELECT id FROM tappers WHERE estate_id=2 AND name='Rajendran'");
    run(
      "INSERT INTO entry_rows (day_id, block_id, tapper_id, product_mode, status, reason, trees_scheduled, trees_tapped) " +
        "VALUES ($1,$2,$3,'Latex','Completed','',450,450)",
      [day, b1, rajendran]
    );

    await login();
    const sel = document.querySelector("aside select") as HTMLSelectElement;
    fireEvent.change(sel, { target: { value: "2" } });
    goto("masters");
    fireEvent.click(await chip("B1", "Poovas"));
    await waitFor(() =>
      expect(scalar("SELECT tapper_id FROM blocks WHERE id=$1", [b1])).not.toBe(rajendran)
    );

    // the September entry still belongs to Rajendran, who tapped it
    expect(scalar("SELECT tapper_id FROM entry_rows WHERE block_id=$1", [b1])).toBe(rajendran);

    // a day not yet entered starts B1 with Poovas (Kulashekaram lists every block daily)
    goto("entry");
    const row = await waitFor(() => {
      const t = [...document.querySelectorAll<HTMLTableElement>(".register-table")].find(
        (x) => x.tHead?.rows.length === 2
      );
      const r = t && [...t.tBodies[0].rows].find((x) => x.cells[0].textContent?.startsWith("B1"));
      expect(r).toBeTruthy();
      return r!;
    });
    const tapperSelect = row.querySelector("select") as HTMLSelectElement;
    expect(tapperSelect.selectedOptions[0].textContent).toBe("Poovas");
  });
});
