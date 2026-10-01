import { describe, it, expect, beforeEach } from "vitest";
import { render, screen, fireEvent, cleanup, waitFor } from "@testing-library/react";
import "../i18n";
import App from "../app/App";
import { resetDb, rows, scalar, run } from "../test/fakes/db";
import { ensureSeeded } from "../db/seed";
import { ioFiles } from "../test/fakes/plugin-fs";
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
    dataVersion: 0,
  });
});

describe("login", () => {
  it("rejects a wrong password and accepts the right one", async () => {
    render(<App />);
    await screen.findByLabelText(/password/i);
    fireEvent.change(screen.getByLabelText(/password/i), {
      target: { value: "nope" },
    });
    fireEvent.click(screen.getByRole("button", { name: /sign in/i }));
    await screen.findByText(/incorrect/i);
    expect(useApp.getState().user).toBeNull();

    fireEvent.change(screen.getByLabelText(/password/i), {
      target: { value: "ninan123@4" },
    });
    fireEvent.click(screen.getByRole("button", { name: /sign in/i }));
    await screen.findByText(/Rubber estates/i);
    expect(useApp.getState().user?.role).toBe("Admin");
  });
});

describe("every screen renders", () => {
  const routes = [
    "dashboard",
    "entry",
    "history",
    "smokehouse",
    "trends",
    "tappers",
    "blocks",
    "missed",
    "attendance",
    "sales-analysis",
    "latex",
    "sheets",
    "scrap",
    "othercrop",
    "purchases",
    "expenses",
    "daypack",
    "reports",
    "masters",
    "settings",
  ];

  it("for both estates without crashing", async () => {
    await login();
    await settle();
    for (const estateId of ["1", "2"]) {
      const select = document.querySelector("aside select") as HTMLSelectElement;
      fireEvent.change(select, { target: { value: estateId } });
      for (const r of routes) {
        goto(r);
        await waitFor(() => {
          expect(document.querySelector("main")).toBeTruthy();
        });
        expect(document.body.textContent).not.toMatch(/preparing estate database/i);
      }
    }
    expect(rows("SELECT count(*) n FROM estates")).toHaveLength(1);
  });
});

describe("daily entry — Kulashekaram weighing", () => {
  it("computes net latex, saves the day with buckets and barrels", async () => {
    await login();
    await settle();
    const select = document.querySelector("aside select") as HTMLSelectElement;
    fireEvent.change(select, { target: { value: "2" } });
    goto("entry");
    await screen.findAllByText("B1");

    const table = document.querySelector(".register-table") as HTMLTableElement;
    const row = table.tBodies[0].rows[0];
    const inputs = row.querySelectorAll<HTMLInputElement>("input:not([type=checkbox])");
    const selects = row.querySelectorAll<HTMLSelectElement>("select");
    fireEvent.change(inputs[2], { target: { value: "12" } });
    fireEvent.change(inputs[3], { target: { value: "8" } });
    fireEvent.change(inputs[4], { target: { value: "6" } });
    fireEvent.change(inputs[5], { target: { value: "14" } });
    fireEvent.change(selects[3], { target: { value: "BR-1" } });

    await waitFor(() => {
      expect(row.textContent).toContain("14.00");
    });

    fireEvent.click(screen.getByRole("button", { name: /save day/i }));
    await screen.findByText(/day saved/i);

    const days = rows<{ id: number }>(
      "SELECT id FROM entry_days WHERE estate_id = 2"
    );
    expect(days.length).toBe(1);
    expect(scalar("SELECT count(*) FROM entry_rows WHERE day_id = $1", [days[0].id])).toBe(9);
    expect(
      scalar("SELECT COALESCE(SUM(kg),0) FROM entry_row_buckets")
    ).toBe(20);
    expect(
      scalar("SELECT COALESCE(SUM(kg),0) FROM entry_row_barrels")
    ).toBe(14);
    expect(scalar("SELECT count(*) FROM labour_rows")).toBe(0);
  });
});

describe("daily entry — Karukachal sheets", () => {
  it("saves wet sheets in sheet mode", async () => {
    await login();
    await settle();
    goto("entry");
    await screen.findAllByText("K1");

    const table = document.querySelector(".register-table") as HTMLTableElement;
    const row = table.tBodies[0].rows[0];
    const wet = row.querySelectorAll<HTMLInputElement>("input:not([type=checkbox])")[2];
    fireEvent.change(wet, { target: { value: "25" } });

    fireEvent.click(screen.getByRole("button", { name: /save day/i }));
    await screen.findByText(/day saved/i);

    expect(
      scalar("SELECT COALESCE(SUM(wet_sheets),0) FROM entry_rows r JOIN entry_days d ON d.id = r.day_id WHERE d.estate_id = 1")
    ).toBe(25);
  });

  it("locks already-saved rows on revisit", async () => {
    await login();
    await settle();
    goto("entry");
    await screen.findAllByText("K1");
    const table = document.querySelector(".register-table") as HTMLTableElement;
    const wet = table.tBodies[0].rows[0].querySelectorAll<HTMLInputElement>(
      "input:not([type=checkbox])"
    )[2];
    fireEvent.change(wet, { target: { value: "7" } });
    fireEvent.click(screen.getByRole("button", { name: /save day/i }));
    await screen.findByText(/day saved/i);

    goto("dashboard");
    goto("entry");
    await screen.findAllByText("K1");
    const table2 = document.querySelector(".register-table") as HTMLTableElement;
    const wet2 = table2.tBodies[0].rows[0].querySelectorAll<HTMLInputElement>(
      "input:not([type=checkbox])"
    )[2];
    expect(wet2.disabled).toBe(true);
  });
});

describe("stock hub — latex sale with pending DRC", () => {
  it("creates a pending invoice, finalises it, and lists it", async () => {
    await ensureSeeded();
    run(
      "INSERT INTO buyers (estate_id, name, contact) VALUES ($1,$2,$3)",
      [1, "Kottayam Rubber Traders", ""]
    );
    const buyerId = scalar<number>("SELECT id FROM buyers LIMIT 1");
    const day = run(
      "INSERT INTO entry_days (estate_id, date) VALUES ($1,$2)",
      [1, "2026-09-20"]
    );
    const row = run(
      "INSERT INTO entry_rows (day_id, block_id, product_mode, status) VALUES ($1,$2,'Latex','Completed')",
      [day.lastInsertId, 1]
    );
    run(
      "INSERT INTO entry_row_barrels (row_id, barrel_id, kg) VALUES ($1,$2,$3)",
      [row.lastInsertId, 1, 50]
    );

    await login();
    await settle();
    goto("latex");
    const pills = await screen.findAllByRole("button", {
      name: /^create sale$/i,
    });
    fireEvent.click(pills[0]);

    const buyerSelect = await screen.findByLabelText(/^buyer$/i);
    fireEvent.change(buyerSelect, { target: { value: String(buyerId) } });

    const barrelsLabel = await screen.findByText("Barrels to sell");
    const sellInput = barrelsLabel
      .closest("div")!
      .parentElement!.querySelector<HTMLInputElement>('input[type="number"]')!;
    fireEvent.change(sellInput, { target: { value: "50" } });

    const rate = screen.getByLabelText("Rate");
    fireEvent.change(rate, { target: { value: "150" } });
    const advance = screen.getByLabelText("Advance");
    fireEvent.change(advance, { target: { value: "5000" } });

    const confirm = screen
      .getAllByRole("button", { name: /save invoice/i })
      .pop()!;
    fireEvent.click(confirm);

    await waitFor(() => {
      const inv = rows<{ status: string; value: number | null; advance: number }>(
        "SELECT status, value, advance FROM invoices"
      );
      expect(inv.length).toBeGreaterThanOrEqual(1);
      expect(inv[0].status).toBe("Pending DRC");
      expect(inv[0].value).toBeNull();
      expect(inv[0].advance).toBe(5000);
    });

    expect(
      scalar("SELECT count(*) FROM cashbook WHERE category_code = 'E11'")
    ).toBeGreaterThanOrEqual(1);
    expect(
      scalar("SELECT count(*) FROM payments WHERE type = 'Advance — Latex'")
    ).toBe(1);
    expect(
      scalar("SELECT count(*) FROM stock_ledger WHERE reason = 'sale'")
    ).toBeGreaterThanOrEqual(1);
  });
});

describe("cash book arithmetic", () => {
  it("evaluates typed arithmetic and stores the result", async () => {
    await login();
    await settle();
    goto("expenses");

    const particulars = await screen.findByPlaceholderText(/particulars/i);
    fireEvent.change(particulars, {
      target: { value: "Tapper wages bonus" },
    });
    const zeros = document.querySelectorAll<HTMLInputElement>(
      'input[placeholder="0"]'
    );
    fireEvent.change(zeros[zeros.length - 1] ?? zeros[0], {
      target: { value: "750*3+175+150" },
    });

    const add = screen.getAllByRole("button", { name: /^add/i }).pop()!;
    fireEvent.click(add);

    await waitFor(() => {
      const exp = scalar<number>(
        "SELECT COALESCE(SUM(expense),0) FROM cashbook WHERE particulars = 'Tapper wages bonus'"
      );
      expect(exp).toBe(2575);
    });
  });
});

describe("masters", () => {
  it("adds a block and shows it in the table", async () => {
    await login();
    await settle();
    goto("masters");
    const addBlock = await screen.findByRole(
      "button",
      { name: /add block/i },
      { timeout: 8000 }
    );
    fireEvent.click(addBlock);
    await waitFor(() => {
      expect(scalar("SELECT count(*) FROM blocks WHERE estate_id = 1")).toBe(5);
    });
  });
});

describe("reports & settings", () => {
  it("writes a master workbook and a JSON backup", async () => {
    await login();
    await settle();
    goto("reports");
    const dl = await screen.findByRole(
      "button",
      { name: /master sheet|download/i },
      { timeout: 8000 }
    );
    fireEvent.click(dl);
    await waitFor(() => {
      expect(
        [...ioFiles().keys()].some(
          (k) => k.toLowerCase().includes("mock-save") || k.endsWith(".xlsx")
        )
      ).toBe(true);
    });

    goto("settings");
    const backup = await screen.findByRole(
      "button",
      { name: /json backup/i },
      { timeout: 8000 }
    );
    fireEvent.click(backup);
    await waitFor(() => {
      expect(ioFiles().size).toBeGreaterThanOrEqual(2);
    });
  });
});

describe("role gating", () => {
  it("hides admin screens from staff", async () => {
    render(<App />);
    await screen.findByLabelText(/password/i);
    fireEvent.change(screen.getByLabelText(/email/i), {
      target: { value: "dailyentry@rubberestate.com" },
    });
    fireEvent.change(screen.getByLabelText(/password/i), {
      target: { value: "ninan123@4" },
    });
    fireEvent.click(screen.getByRole("button", { name: /sign in/i }));
    await screen.findByText(/Rubber estates/i);
    expect(screen.queryByText("Estate setup")).toBeNull();
    expect(screen.queryByText("Entry history")).toBeNull();
    expect(useApp.getState().user?.role).toBe("Staff");
  });
});

describe("buyer ledger — payment types and grouping", () => {
  it("offers the bank advance type, filters rows by type and groups with subtotals", async () => {
    await ensureSeeded();
    run(
      "INSERT INTO buyers (estate_id, name, contact) VALUES ($1,$2,$3)",
      [1, "Kottayam Rubber Traders", ""]
    );
    const buyerId = scalar<number>("SELECT id FROM buyers LIMIT 1");
    run(
      "INSERT INTO invoices (estate_id, invoice_no, date, buyer_id, grade, qty, rate, value, status) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'Final')",
      [1, "INV-9001", "2026-09-01", buyerId, "Latex", 500, 150, 75000]
    );
    for (const p of [
      ["2026-09-02", 20000, "Settlement", "INV-9001"],
      ["2026-09-03", 5000, "Advance — Latex", "INV-9001"],
      ["2026-09-04", 3000, "Advance — Estate expenses", "wages"],
      ["2026-09-05", 7000, "Advance — Bank / Deposit", "RTGS"],
    ]) {
      run(
        "INSERT INTO payments (estate_id, buyer_id, date, amount, type, note) VALUES ($1,$2,$3,$4,$5,$6)",
        [1, buyerId, p[0], p[1], p[2], p[3]]
      );
    }

    await login();
    await settle();
    goto("latex");
    fireEvent.click(await screen.findByRole("button", { name: /^buyer ledger$/i }));

    const buyerSelect = [...screen.getAllByRole("combobox")].find((s) =>
      (s.textContent || "").includes("Select buyer")
    )!;
    fireEvent.change(buyerSelect, { target: { value: String(buyerId) } });

    // #2 — the third advance type is offered alongside the original two.
    const paySelect = [...screen.getAllByRole("combobox")].find((s) =>
      [...(s as HTMLSelectElement).options].some((o) => o.value === "Settlement")
    ) as HTMLSelectElement;
    const payValues = [...paySelect.options].map((o) => o.value);
    expect(payValues).toContain("Settlement");
    expect(payValues).toContain("Advance — Estate expenses");
    expect(payValues).toContain("Advance — Bank / Deposit");

    // #3 — filter chips are offered.
    await screen.findByRole("button", { name: /all types/i });
    const estateChip = screen.getByRole("button", { name: /^estate advance$/i });
    const bankChip = screen.getByRole("button", { name: /^bank advance$/i });
    expect(estateChip).toBeTruthy();
    expect(bankChip).toBeTruthy();

    const allRows = screen.getAllByRole("row").length;
    fireEvent.click(estateChip);
    await waitFor(() => expect(screen.getAllByRole("row").length).toBeLessThan(allRows));
    expect(screen.getByText(/never recalculated/i)).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: /all types/i }));
    await waitFor(() => expect(screen.getAllByRole("row").length).toBe(allRows));

    // #10 — grouping adds a heading and a subtotal per group.
    fireEvent.click(screen.getByRole("button", { name: /group by type/i }));
    await screen.findByText(/grouped by type/i);
    expect(screen.getAllByText(/subtotal —/i).length).toBeGreaterThan(0);
    expect(screen.getByText(/statement total/i)).toBeTruthy();

    // Balances were never recomputed: the running balance still reflects the
    // full history, so outstanding = 75000 - (20000+5000+3000+7000) = 40000.
    expect(screen.getAllByText(/Rs 40,000/).length).toBeGreaterThan(0);
  });
});

describe("stock hub — estate weight vs billed weight", () => {
  it("keeps stock on the estate's scale, bills on the buyer's, less formalin", async () => {
    await ensureSeeded();
    run(
      "INSERT INTO buyers (estate_id, name, contact) VALUES ($1,$2,$3)",
      [1, "Kottayam Rubber Traders", ""]
    );
    const buyerId = scalar<number>("SELECT id FROM buyers LIMIT 1");
    const day = run(
      "INSERT INTO entry_days (estate_id, date) VALUES ($1,$2)",
      [1, "2026-09-21"]
    );
    const row = run(
      "INSERT INTO entry_rows (day_id, block_id, product_mode, status) VALUES ($1,$2,'Latex','Completed')",
      [day.lastInsertId, 1]
    );
    run(
      "INSERT INTO entry_row_barrels (row_id, barrel_id, kg) VALUES ($1,$2,$3)",
      [row.lastInsertId, 1, 50]
    );

    await login();
    await settle();
    goto("latex");
    const pills = await screen.findAllByRole("button", {
      name: /^create sale$/i,
    });
    fireEvent.click(pills[0]);

    const buyerSelect = await screen.findByLabelText(/^buyer$/i);
    fireEvent.change(buyerSelect, { target: { value: String(buyerId) } });

    const barrelsLabel = await screen.findByText("Barrels to sell");
    const sellInput = barrelsLabel
      .closest("div")!
      .parentElement!.querySelector<HTMLInputElement>('input[type="number"]')!;
    fireEvent.change(sellInput, { target: { value: "50" } });

    fireEvent.change(screen.getByLabelText("Rate"), { target: { value: "150" } });
    // #1 — formalin mixed in before it left the estate.
    fireEvent.change(screen.getByLabelText(/formalin weight/i), {
      target: { value: "4" },
    });
    // #11 — what the buyer's own scale read at handover.
    fireEvent.change(screen.getByLabelText(/buyer'?s weight/i), {
      target: { value: "46" },
    });

    // The gap between the two scales is stated before any money is quoted.
    await screen.findByText(
      /Difference: 4\.00 kg short of the estate's 50\.00 kg — billed on the buyer's 46\.00 kg\./
    );

    fireEvent.click(
      screen.getAllByRole("button", { name: /save invoice/i }).pop()!
    );

    await waitFor(() => {
      const inv = rows<{
        qty: number;
        buyer_qty: number | null;
        formalin_kg: number | null;
        value: number | null;
        status: string;
      }>(
        "SELECT qty, buyer_qty, formalin_kg, value, status FROM invoices"
      );
      expect(inv.length).toBeGreaterThanOrEqual(1);
      expect(inv[0].qty).toBe(50);
      expect(inv[0].buyer_qty).toBe(46);
      expect(inv[0].formalin_kg).toBe(4);
      expect(inv[0].status).toBe("Pending DRC");
      expect(inv[0].value).toBeNull();
    });

    // Stock moved by the estate's weight only — the shortfall didn't vanish.
    expect(
      scalar("SELECT qty_delta FROM stock_ledger WHERE reason='sale' ORDER BY id DESC LIMIT 1")
    ).toBe(-50);
    expect(scalar("SELECT COALESCE(SUM(kg),0) FROM invoice_barrels")).toBe(50);

    // The invoice list carries both numbers.
    fireEvent.click(screen.getByRole("button", { name: /^invoices$/i }));
    const billedCell = await screen.findByText(/→ 46\.00 billed/);

    // #11 — a late DRC settles on the billed weight: 46 x 33% x 150 = 2277.
    // The estate's 50 kg would have given 2475, so this proves which weight won.
    // The row that shows both weights is the one still waiting on a DRC.
    const pendingRow = billedCell.closest("tr")!;
    expect(pendingRow.textContent).toContain("Pending DRC");
    const drcInput = pendingRow.querySelector<HTMLInputElement>("input")!;
    fireEvent.change(drcInput, { target: { value: "33" } });
    const setBtn = [...pendingRow.querySelectorAll("button")].find((b) =>
      /^set$/i.test((b.textContent || "").trim())
    )!;
    fireEvent.click(setBtn);

    await waitFor(() => {
      const v = scalar<number | null>(
        "SELECT value FROM invoices ORDER BY id DESC LIMIT 1"
      );
      expect(v).toBe(2277);
    });
    expect(
      scalar("SELECT qty FROM invoices ORDER BY id DESC LIMIT 1")
    ).toBe(50);
  });
});
