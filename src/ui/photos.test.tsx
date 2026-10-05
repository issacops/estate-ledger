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

describe("attaching a photo to a row that already exists", () => {
  // The slip is usually photographed after the invoice is raised, so every
  // hub's invoice list and the purchase register take one in place.
  async function openHub(route: string) {
    await login();
    await settle();
    goto(route);
  }

  /** Waits for the attach control itself — the tables render in stages. */
  const waitForAttach = async () =>
    waitFor(
      () => {
        const b = attachButton();
        expect(b).toBeTruthy();
        return b!;
      },
      { timeout: 8000 }
    );

  const attachButton = () =>
    [...document.querySelectorAll("label")].find(
      (l) => (l.getAttribute("title") || "").startsWith("Invoice") ||
             (l.getAttribute("title") || "").startsWith("Bill")
    );

  it("attaches a photo to an invoice from the list, on any hub", async () => {
    run(
      "INSERT INTO invoices (estate_id, invoice_no, date, grade, qty, rate, value, status) " +
        "VALUES (1,'KAR/L/0001','2026-10-01','Latex',100,180,18000,'Final')"
    );
    await openHub("latex");
    fireEvent.click(screen.getByRole("button", { name: /invoices/i }));

    const cell = await waitForAttach();
    const input = cell.querySelector("input[type=file]") as HTMLInputElement;
    const file = new File(["x"], "slip.jpg", { type: "image/jpeg" });
    Object.defineProperty(input, "files", { value: [file] });
    fireEvent.change(input);

    await waitFor(() =>
      expect(
        rows<{ photo: string | null }>("SELECT photo FROM invoices WHERE invoice_no='KAR/L/0001'")[0]
          ?.photo
      ).toBe("data:image/jpeg;base64,QUJD")
    );
  });

  it("attaches a photo to a purchase bill from the register", async () => {
    run(
      "INSERT INTO purchases (estate_id, bill_no, date, item, qty, unit, rate, value) " +
        "VALUES (1,'KAR/P/0001','2026-10-01','Mixture',10,'kg',30,300)"
    );
    await openHub("purchases");
    // the register opens on Record; the list of bills is its own tab
    fireEvent.click(screen.getByRole("button", { name: /^Purchases$/i }));

    const cell = await waitForAttach();
    const input = cell.querySelector("input[type=file]") as HTMLInputElement;
    const file = new File(["x"], "bill.jpg", { type: "image/jpeg" });
    Object.defineProperty(input, "files", { value: [file] });
    fireEvent.change(input);

    await waitFor(() =>
      expect(
        rows<{ photo: string | null }>("SELECT photo FROM purchases WHERE bill_no='KAR/P/0001'")[0]
          ?.photo
      ).toBe("data:image/jpeg;base64,QUJD")
    );
  });
});

describe("cash book receipts", () => {
  it("attaches a photo to a weekly cash book row", async () => {
    // a row inside the week the page opens on
    const today = new Date();
    const iso = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(
      today.getDate()
    ).padStart(2, "0")}`;
    run(
      "INSERT INTO cashbook (estate_id, date, particulars, category_code, sub, income, expense) " +
        "VALUES (1,$1,'Tapper wages','E1','Wages',0,5400)",
      [iso]
    );

    await login();
    await settle();
    goto("expenses");

    const cell = await waitFor(
      () => {
        const b = [...document.querySelectorAll("label")].find(
          (l) => (l.getAttribute("title") || "") === "Tapper wages"
        );
        expect(b).toBeTruthy();
        return b!;
      },
      { timeout: 8000 }
    );

    const input = cell.querySelector("input[type=file]") as HTMLInputElement;
    Object.defineProperty(input, "files", {
      value: [new File(["x"], "receipt.jpg", { type: "image/jpeg" })],
    });
    fireEvent.change(input);

    await waitFor(() =>
      expect(
        rows<{ photo: string | null }>(
          "SELECT photo FROM cashbook WHERE particulars='Tapper wages'"
        )[0]?.photo
      ).toBe("data:image/jpeg;base64,QUJD")
    );
  });
});

describe("vendor payment slips", () => {
  const vendorSetup = () => {
    const v = run("INSERT INTO vendors (estate_id, name) VALUES (1,'Agro Centre')").lastInsertId;
    run(
      "INSERT INTO purchases (estate_id, bill_no, date, vendor_id, item, qty, unit, rate, value) " +
        "VALUES (1,'KAR/P/0001','2026-10-01',$1,'Mixture',10,'kg',30,300)",
      [v]
    );
    const cb = run(
      "INSERT INTO cashbook (estate_id, date, particulars, category_code, sub, income, expense, source_ref) " +
        "VALUES (1,'2026-10-02','Vendor payment — Agro Centre','E10','Agro Centre',0,300,'vendor_payment')"
    ).lastInsertId;
    const vp = run(
      "INSERT INTO vendor_payments (estate_id, vendor_id, date, amount, note, cashbook_id) " +
        "VALUES (1,$1,'2026-10-02',300,'Cheque 4411',$2)",
      [v, cb]
    ).lastInsertId;
    return { v, cb, vp };
  };

  it("attaches a slip to a payment from the vendor ledger, and the cash book row follows", async () => {
    const { v, cb, vp } = vendorSetup();
    await login();
    await settle();
    goto("purchases");
    fireEvent.click(await screen.findByRole("button", { name: /^Vendor ledger$/i }));
    const select = await waitFor(() => {
      const sel = [...document.querySelectorAll("select")].find((x) =>
        [...x.options].some((o) => o.textContent === "Agro Centre")
      );
      expect(sel).toBeTruthy();
      return sel!;
    });
    fireEvent.change(select, { target: { value: String(v) } });

    const cell = await waitFor(
      () => {
        const l = [...document.querySelectorAll("label")].find((x) =>
          (x.getAttribute("title") || "").startsWith("Payment")
        );
        expect(l).toBeTruthy();
        return l!;
      },
      { timeout: 8000 }
    );
    const input = cell.querySelector("input[type=file]") as HTMLInputElement;
    Object.defineProperty(input, "files", {
      value: [new File(["x"], "slip.jpg", { type: "image/jpeg" })],
    });
    fireEvent.change(input);

    await waitFor(() =>
      expect(
        rows<{ photo: string | null }>("SELECT photo FROM vendor_payments WHERE id=$1", [vp])[0]?.photo
      ).toBe("data:image/jpeg;base64,QUJD")
    );
    // the same payment in the cash book carries the slip too
    expect(
      rows<{ photo: string | null }>("SELECT photo FROM cashbook WHERE id=$1", [cb])[0]?.photo
    ).toBe("data:image/jpeg;base64,QUJD");
  });

  it("keeps a slip attached while recording the payment", async () => {
    const v = run("INSERT INTO vendors (estate_id, name) VALUES (1,'Agro Centre')").lastInsertId;
    await login();
    await settle();
    goto("purchases");
    fireEvent.click(await screen.findByRole("button", { name: /^Vendor ledger$/i }));
    const select = await waitFor(() => {
      const sel = [...document.querySelectorAll("select")].find((x) =>
        [...x.options].some((o) => o.textContent === "Agro Centre")
      );
      expect(sel).toBeTruthy();
      return sel!;
    });
    fireEvent.change(select, { target: { value: String(v) } });
    fireEvent.click((await screen.findAllByRole("button", { name: /record payment/i }))[0]);

    const amount = (await screen.findAllByRole("textbox")).find(
      (el) => (el as HTMLInputElement).closest("label")?.textContent?.includes("Amount")
    ) as HTMLInputElement;
    fireEvent.change(amount, { target: { value: "500" } });
    const fileInput = [...document.querySelectorAll<HTMLInputElement>("input[type=file]")].pop()!;
    Object.defineProperty(fileInput, "files", {
      value: [new File(["x"], "slip.jpg", { type: "image/jpeg" })],
    });
    fireEvent.change(fileInput);
    fireEvent.click(await screen.findByRole("button", { name: /^save$/i }));

    await waitFor(() =>
      expect(
        rows<{ photo: string | null }>("SELECT photo FROM vendor_payments")[0]?.photo
      ).toBe("data:image/jpeg;base64,QUJD")
    );
    expect(
      rows<{ photo: string | null }>("SELECT photo FROM cashbook WHERE source_ref='vendor_payment'")[0]?.photo
    ).toBe("data:image/jpeg;base64,QUJD");
  });
});

describe("buyer payment slips", () => {
  it("attaches a slip to a buyer payment from the ledger, and the cash book row follows", async () => {
    const buyer = run("INSERT INTO buyers (estate_id, name) VALUES (1,'Pala Traders')").lastInsertId;
    const cb = run(
      "INSERT INTO cashbook (estate_id, date, particulars, category_code, sub, income, expense, source_ref) " +
        "VALUES (1,'2026-10-02','Settlement — Pala Traders','E11','Pala Traders',5000,0,'buyer_payment')"
    ).lastInsertId;
    const pay = run(
      "INSERT INTO payments (estate_id, buyer_id, date, amount, type, note, cashbook_id) " +
        "VALUES (1,$1,'2026-10-02',5000,'Settlement','NEFT 8812',$2)",
      [buyer, cb]
    ).lastInsertId;

    await login();
    await settle();
    goto("latex");
    fireEvent.click(await screen.findByRole("button", { name: /^Buyer ledger$/i }));
    const select = await waitFor(() => {
      const sel = [...document.querySelectorAll("select")].find((x) =>
        [...x.options].some((o) => o.textContent === "Pala Traders")
      );
      expect(sel).toBeTruthy();
      return sel!;
    });
    fireEvent.change(select, { target: { value: String(buyer) } });

    const cell = await waitFor(
      () => {
        const l = [...document.querySelectorAll("label")].find((x) =>
          (x.getAttribute("title") || "").startsWith("Settlement")
        );
        expect(l).toBeTruthy();
        return l!;
      },
      { timeout: 8000 }
    );
    const input = cell.querySelector("input[type=file]") as HTMLInputElement;
    Object.defineProperty(input, "files", {
      value: [new File(["x"], "slip.jpg", { type: "image/jpeg" })],
    });
    fireEvent.change(input);

    await waitFor(() =>
      expect(
        rows<{ photo: string | null }>("SELECT photo FROM payments WHERE id=$1", [pay])[0]?.photo
      ).toBe("data:image/jpeg;base64,QUJD")
    );
    expect(
      rows<{ photo: string | null }>("SELECT photo FROM cashbook WHERE id=$1", [cb])[0]?.photo
    ).toBe("data:image/jpeg;base64,QUJD");
  });
});

describe("statement photos", () => {
  const iso = (d: Date) =>
    `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

  async function openStatement() {
    await login();
    await settle();
    goto("expenses");
    await screen.findByText("Weekly statement");
  }

  const statementCell = () =>
    [...document.querySelectorAll("label")].find((l) =>
      /^(Week|Month) of /.test(l.getAttribute("title") || "")
    ) as HTMLElement | undefined;

  const attach = async () => {
    const cell = await waitFor(() => {
      const c = statementCell();
      expect(c).toBeTruthy();
      return c!;
    });
    const input = cell.querySelector("input[type=file]") as HTMLInputElement;
    Object.defineProperty(input, "files", {
      value: [new File(["x"], "page.jpg", { type: "image/jpeg" })],
    });
    fireEvent.change(input);
  };

  it("keeps a photo against the week, separate from the month", async () => {
    await openStatement();
    await attach();
    await waitFor(() =>
      expect(rows<{ kind: string }>("SELECT kind FROM statement_photos").map((r) => r.kind)).toEqual(["week"])
    );

    // the month has none of its own yet
    fireEvent.click(screen.getByRole("button", { name: "Month" }));
    await screen.findByText("Monthly statement");
    await waitFor(() => expect(statementCell()?.getAttribute("title")).toMatch(/^Month of /));
    expect(document.body.textContent).toContain("No photo of the written statement yet");

    await attach();
    await waitFor(() =>
      expect(
        rows<{ kind: string }>("SELECT kind FROM statement_photos ORDER BY kind").map((r) => r.kind)
      ).toEqual(["month", "week"])
    );
  });

  it("replaces rather than duplicates when a photo is attached twice", async () => {
    await openStatement();
    await attach();
    await waitFor(() => expect(rows("SELECT id FROM statement_photos")).toHaveLength(1));
    // replace: the control is now the thumbnail, so write through the same upsert
    run(
      "INSERT INTO statement_photos (estate_id, kind, period_start, photo) VALUES (1,'week','2000-01-03','a') " +
        "ON CONFLICT(estate_id, kind, period_start) DO UPDATE SET photo=excluded.photo"
    );
    run(
      "INSERT INTO statement_photos (estate_id, kind, period_start, photo) VALUES (1,'week','2000-01-03','b') " +
        "ON CONFLICT(estate_id, kind, period_start) DO UPDATE SET photo=excluded.photo"
    );
    expect(rows<{ photo: string }>("SELECT photo FROM statement_photos WHERE period_start='2000-01-03'")).toEqual([
      { photo: "b" },
    ]);
  });

  it("covers the whole month with the cash brought forward", async () => {
    const t = new Date();
    const monthStart = new Date(t.getFullYear(), t.getMonth(), 1);
    const lastMonth = new Date(t.getFullYear(), t.getMonth() - 1, 15);
    run(
      "INSERT INTO cashbook (estate_id, date, particulars, category_code, sub, income, expense) VALUES (1,$1,'Old sale','E11','',1000,0)",
      [iso(lastMonth)]
    );
    run(
      "INSERT INTO cashbook (estate_id, date, particulars, category_code, sub, income, expense) VALUES (1,$1,'Early sale','E11','',500,0)",
      [iso(monthStart)]
    );
    await openStatement();
    fireEvent.click(screen.getByRole("button", { name: "Month" }));
    await screen.findByText("Monthly statement");
    const reg = document.querySelector(".weekly-statement")!;
    await waitFor(() => expect(reg.textContent).toContain("Early sale"));
    expect(reg.textContent).toContain("Monthly Income & Expenses Register");
    // last month's receipt is not in this month's list, but its cash is carried in
    expect(reg.textContent).not.toContain("Old sale");
    expect(reg.textContent).toContain("Opening balance");
    expect(reg.textContent).toContain("1,000.00");
  });
});
