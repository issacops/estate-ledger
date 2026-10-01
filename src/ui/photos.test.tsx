import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, fireEvent, cleanup, waitFor } from "@testing-library/react";
import { toast } from "sonner";
import "../i18n";
import App from "../app/App";
import { resetDb, rows, scalar, run } from "../test/fakes/db";
import { ensureSeeded } from "../db/seed";
import { useApp } from "../app/store";

// Fix list #4: the attach control compresses to a JPEG data URL. jsdom has no
// canvas, so the real `compressImage` would return "" and hide the wiring we
// want to prove — swap it for a deterministic data URL.
vi.mock("../io/photo", () => ({
  compressImage: vi.fn(async () => "data:image/jpeg;base64,QUJD"),
}));

const PHOTO = "data:image/jpeg;base64,QUJD";

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

function attachPhoto(input: HTMLInputElement) {
  fireEvent.change(input, {
    target: {
      files: [new File(["x"], "bill.jpg", { type: "image/jpeg" })],
    },
  });
}

beforeEach(async () => {
  cleanup();
  toast.dismiss(); // sonner replays leftover toasts across remounts
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

describe("fix list #4 — photos on invoices and purchase bills", () => {
  it("saves an attached photo with the invoice and shows it in the list", async () => {
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
    const pills = await screen.findAllByRole("button", { name: /^create sale$/i });
    fireEvent.click(pills[0]);

    const buyerSelect = await screen.findByLabelText(/^buyer$/i);
    fireEvent.change(buyerSelect, { target: { value: String(buyerId) } });

    const barrelsLabel = await screen.findByText("Barrels to sell");
    const sellInput = barrelsLabel
      .closest("div")!
      .parentElement!.querySelector<HTMLInputElement>('input[type="number"]')!;
    fireEvent.change(sellInput, { target: { value: "50" } });

    fireEvent.change(screen.getByLabelText("Rate"), { target: { value: "150" } });

    const fileInput = document.querySelector<HTMLInputElement>(
      'input[type="file"]'
    )!;
    attachPhoto(fileInput);
    expect((await screen.findByText("Replace photo")).textContent).toBeTruthy();

    fireEvent.click(screen.getAllByRole("button", { name: /save invoice/i }).pop()!);

    await waitFor(() => {
      expect(
        rows<{ photo: string | null }>("SELECT photo FROM invoices")[0]?.photo
      ).toBe(PHOTO);
    });

    // saving leaves you on Create sale — open the list to see the detail view
    fireEvent.click(screen.getByRole("button", { name: /^invoices$/i }));
    const imgs = document.querySelectorAll<HTMLImageElement>(
      'table img[src^="data:image/jpeg"]'
    );
    expect(imgs.length).toBeGreaterThanOrEqual(1);
  });

  it("saves an attached photo with the purchase bill and shows it in the list", async () => {
    await login();
    await settle();
    goto("purchases");

    const item = await screen.findByLabelText(/item/i);
    fireEvent.change(item, { target: { value: "Fertiliser" } });
    fireEvent.change(screen.getByLabelText(/qty/i), { target: { value: "4" } });
    fireEvent.change(screen.getByLabelText(/rate/i), { target: { value: "250" } });

    const fileInput = document.querySelector<HTMLInputElement>(
      'input[type="file"]'
    )!;
    attachPhoto(fileInput);
    await screen.findByText("Replace photo");

    fireEvent.click(screen.getByRole("button", { name: /save/i }));

    await waitFor(() => {
      expect(
        rows<{ photo: string | null }>("SELECT photo FROM purchases")[0]?.photo
      ).toBe(PHOTO);
    });

    fireEvent.click(screen.getByRole("button", { name: /^purchases$/i }));
    await waitFor(() => {
      expect(
        document.querySelectorAll<HTMLImageElement>(
          'table img[src^="data:image/jpeg"]'
        ).length
      ).toBeGreaterThanOrEqual(1);
    });
  });
});
