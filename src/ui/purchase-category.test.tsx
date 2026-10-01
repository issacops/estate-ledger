import { describe, it, expect, beforeEach } from "vitest";
import { render, screen, fireEvent, cleanup, waitFor, within } from "@testing-library/react";
import "../i18n";
import App from "../app/App";
import { resetDb, scalar, run } from "../test/fakes/db";
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

/** Climb from a text node to the ancestor Card that matches `pred`. */
function cardAround(el: Element, pred: (n: Element) => boolean): Element {
  let node: Element | null = el;
  while (node && !pred(node)) node = node.parentElement;
  if (!node) throw new Error("no matching card");
  return node;
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

describe("fix list #5 — purchase categories", () => {
  it("offers the four seeded categories, saves one on the bill, and totals them", async () => {
    run(
      "INSERT INTO vendors (estate_id, name, contact) VALUES ($1,$2,$3)",
      [1, "Kerala Agro Traders", ""]
    );
    const vendorId = scalar<number>("SELECT id FROM vendors LIMIT 1");

    await login();
    await settle();
    goto("purchases");

    const catSelect = await screen.findByLabelText("Category", {}, { timeout: 8000 });
    const opts = [...catSelect.querySelectorAll("option")].map(
      (o) => o.textContent || ""
    );
    expect(opts).toHaveLength(4);
    expect(opts.join("|")).toContain("P1 — Fertiliser");
    expect(opts.join("|")).toContain("P2 — Weedicide");
    expect(opts.join("|")).toContain("P3 — Tools");
    expect(opts.join("|")).toContain("P4 — Other");

    fireEvent.change(catSelect, { target: { value: "P2" } });
    fireEvent.change(screen.getByLabelText("Vendor"), {
      target: { value: String(vendorId) },
    });
    fireEvent.change(screen.getByLabelText("Item"), {
      target: { value: "Weedicide" },
    });
    fireEvent.change(screen.getByLabelText("Qty"), { target: { value: "3" } });
    fireEvent.change(screen.getByLabelText("Rate"), { target: { value: "400" } });
    fireEvent.click(screen.getByRole("button", { name: /save/i }));

    await waitFor(() => {
      expect(
        scalar<string>("SELECT category_code FROM purchases ORDER BY id DESC LIMIT 1")
      ).toBe("P2");
    });

    fireEvent.click(screen.getByRole("button", { name: /^purchases$/i }));
    // the item name and the category label are both on the row
    const seen = await screen.findAllByText("Weedicide");
    expect(seen.length).toBeGreaterThanOrEqual(2);

    fireEvent.click(screen.getByRole("button", { name: /^summary$/i }));
    const card = cardAround(
      await screen.findByText("Spend by category"),
      (n) => !!n.querySelector("table")
    );
    expect(card.textContent).toContain("Weedicide");
    expect(card.textContent).toMatch(/1,?200/);
  });

  it("lets Ninan add his own category in Estate setup and use it straight away", async () => {
    await login();
    await settle();
    goto("masters");

    const title = await screen.findByText("Purchase categories", {}, { timeout: 8000 });
    const card = cardAround(title, (n) => !!n.querySelector("button"));
    fireEvent.click(within(card as HTMLElement).getByRole("button", { name: /add/i }));

    await waitFor(() => {
      expect(
        scalar<string>(
          "SELECT code FROM config_lists WHERE kind='purchaseCat' ORDER BY id DESC LIMIT 1"
        )
      ).toBe("P5");
    });

    goto("purchases");
    const catSelect = await screen.findByLabelText("Category", {}, { timeout: 8000 });
    expect(catSelect.querySelectorAll("option").length).toBe(5);
  });
});
