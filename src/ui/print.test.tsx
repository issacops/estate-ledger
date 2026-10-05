import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup, waitFor, act } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { toast } from "sonner";
import "../i18n";
import App from "../app/App";
import { PrintHost, printDocument } from "./print";
import { resetDb, run } from "../test/fakes/db";
import { ensureSeeded } from "../db/seed";
import { ioFiles } from "../test/fakes/plugin-fs";
import { useApp } from "../app/store";

describe("printing permission", () => {
  it("is granted, because on macOS window.print() is a command that is refused without it", () => {
    const cap = JSON.parse(
      readFileSync(resolve(__dirname, "../../src-tauri/capabilities/default.json"), "utf8")
    );
    expect(cap.permissions).toContain("core:webview:allow-print");
  });
});

describe("printDocument", () => {
  let printSpy: ReturnType<typeof vi.fn>;
  beforeEach(() => {
    cleanup();
    printSpy = vi.fn(async () => undefined);
    (window as unknown as { print: unknown }).print = printSpy;
    delete document.body.dataset.printing;
    document.title = "Estate Ledger";
  });
  afterEach(() => {
    delete document.body.dataset.printing;
  });

  it("puts the document in the host, then prints with the app hidden", async () => {
    render(<PrintHost />);
    expect(document.querySelector(".print-host")!.textContent).toBe("");

    let seen = "";
    printSpy.mockImplementation(async () => {
      // at the moment of printing the page is switched over to the document
      seen = document.body.dataset.printing ?? "";
    });
    await act(async () => {
      await printDocument(<div>Receipt No 12</div>, "Receipt 12");
    });
    expect(document.querySelector(".print-host")!.textContent).toContain("Receipt No 12");
    expect(seen).toBe("1");
    expect(printSpy).toHaveBeenCalledTimes(1);
  });

  it("names the page for the PDF file, then puts the title back when printing ends", async () => {
    render(<PrintHost />);
    let during = "";
    printSpy.mockImplementation(async () => {
      during = document.title;
    });
    await act(async () => {
      await printDocument(<div>x</div>, "Invoice KAR-INV-0003");
    });
    expect(during).toBe("Invoice KAR-INV-0003");
    act(() => {
      window.dispatchEvent(new Event("afterprint"));
    });
    expect(document.title).toBe("Estate Ledger");
    expect(document.body.dataset.printing).toBeUndefined();
  });

  it("says so, and restores the page, when the print dialog cannot open", async () => {
    const err = vi.spyOn(toast, "error").mockImplementation(() => "");
    render(<PrintHost />);
    printSpy.mockRejectedValue(new Error("not allowed by ACL"));
    let ok = true;
    await act(async () => {
      ok = await printDocument(<div>x</div>, "Doc");
    });
    expect(ok).toBe(false);
    expect(err).toHaveBeenCalledWith("Could not open the print dialog");
    expect(document.body.dataset.printing).toBeUndefined();
    expect(document.title).toBe("Estate Ledger");
    err.mockRestore();
  });

  it("replaces the previous document rather than stacking them", async () => {
    render(<PrintHost />);
    await act(async () => {
      await printDocument(<div>first</div>);
      await printDocument(<div>second</div>);
    });
    const host = document.querySelector(".print-host")!;
    expect(host.textContent).toContain("second");
    expect(host.textContent).not.toContain("first");
  });
});

describe("weekly statement — Print and Download", () => {
  beforeEach(async () => {
    cleanup();
    toast.dismiss();
    resetDb();
    ioFiles().clear();
    window.localStorage.clear();
    window.location.hash = "#/dashboard";
    useApp.setState({ user: null, estate: null, estates: [], route: "dashboard", dataVersion: 0 });
    await ensureSeeded();
    (window as unknown as { print: unknown }).print = vi.fn(async () => undefined);
    const d = new Date();
    const iso = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    run(
      "INSERT INTO cashbook (estate_id, date, particulars, category_code, sub, income, expense) VALUES (1,$1,'Latex sale','E11','',5000,0)",
      [iso]
    );
  });

  async function open() {
    render(<App />);
    await screen.findByLabelText(/password/i);
    fireEvent.change(screen.getByLabelText(/password/i), { target: { value: "ninan123@4" } });
    fireEvent.click(screen.getByRole("button", { name: /sign in/i }));
    await screen.findByText(/Rubber estates/i);
    window.location.hash = "#/expenses";
    useApp.getState().setRoute("expenses");
    await screen.findByText("Weekly statement");
  }

  it("Print sends the register to the printer, and not the page around it", async () => {
    await open();
    const card = screen.getByText("Weekly statement").closest(".card") as HTMLElement;
    fireEvent.click([...card.querySelectorAll("button")].find((b) => b.textContent?.includes("Print"))!);
    await waitFor(() => expect(window.print).toHaveBeenCalled());
    const host = document.querySelector(".print-host")!;
    expect(host.textContent).toContain("Weekly Income & Expenses Register");
    expect(host.textContent).toContain("Latex sale");
    expect(host.textContent).not.toContain("Category totals");
  });

  it("Download writes the register out as a spreadsheet", async () => {
    await open();
    const card = screen.getByText("Weekly statement").closest(".card") as HTMLElement;
    fireEvent.click([...card.querySelectorAll("button")].find((b) => b.textContent?.includes("Download"))!);
    await waitFor(() => expect([...ioFiles().keys()].some((k) => /_Week_Statement_.*\.xlsx$/.test(k))).toBe(true));
    const bytes = [...ioFiles().entries()].find(([k]) => /Statement/.test(k))![1];
    expect(bytes.byteLength).toBeGreaterThan(1000);
  });
});
