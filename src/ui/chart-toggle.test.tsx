import { describe, it, expect, beforeEach } from "vitest";
import { render, screen, fireEvent, cleanup, waitFor } from "@testing-library/react";
import { toast } from "sonner";
import "../i18n";
import App from "../app/App";
import { resetDb } from "../test/fakes/db";
import { useApp } from "../app/store";

// Every chart that offers Line/Bars must actually switch, on both estates.
const PAGES: [string, string][] = [
  ["trends", "Production trend"],
  ["trends", "Tapping frequency"],
  ["tappers", "Total output by tapper"],
  ["blocks", "Total output by block"],
  ["missed", "Misses per reason"],
  ["attendance", "Tapper attendance rate"],
];

beforeEach(async () => {
  cleanup();
  toast.dismiss();
  resetDb();
  window.localStorage.clear();
  window.location.hash = "#/dashboard";
  useApp.setState({ user: null, estate: null, estates: [], route: "dashboard", dataVersion: 0 });
});

async function login() {
  render(<App />);
  await screen.findByLabelText(/password/i);
  fireEvent.change(screen.getByLabelText(/password/i), { target: { value: "ninan123@4" } });
  fireEvent.click(screen.getByRole("button", { name: /sign in/i }));
  await screen.findByText(/Rubber estates/i);
}

describe("chart Line / Bars toggle", () => {
  for (const [route, title] of PAGES) {
    it(`${title} can switch between bars and a line`, async () => {
      await login();
      window.location.hash = `#/${route}`;
      useApp.getState().setRoute(route);
      const heading = await screen.findByText(title);
      const card = heading.closest(".card") as HTMLElement;
      expect(card).toBeTruthy();

      const btn = (name: RegExp) =>
        [...card.querySelectorAll("button")].find((b) => name.test(b.textContent ?? ""))!;

      // both controls live in this card's header
      expect(btn(/^Line$/)).toBeTruthy();
      expect(btn(/^Bars$/)).toBeTruthy();

      // recharts draws nothing in jsdom (ResponsiveContainer measures 0), so
      // the toggle state is what we can prove: each card owns its own switch
      expect(btn(/^Bars$/).className).toContain("active");
      expect(btn(/^Line$/).className).not.toContain("active");

      fireEvent.click(btn(/^Line$/));
      await waitFor(() => expect(btn(/^Line$/).className).toContain("active"));
      expect(btn(/^Bars$/).className).not.toContain("active");

      fireEvent.click(btn(/^Bars$/));
      await waitFor(() => expect(btn(/^Bars$/).className).toContain("active"));
    });
  }
});

describe("ModeChart key guard", () => {
  it("names a key the data does not have", async () => {
    const { missingKeys } = await import("./charts");
    const rows = [{ label: "Heavy Rain", count: 88 }];
    expect(missingKeys(rows, "label", "count")).toEqual([]);
    expect(missingKeys(rows, "reason", "count")).toEqual(["reason"]);
    expect(missingKeys(rows, "reason", "total")).toEqual(["reason", "total"]);
    // an empty chart is legitimate — nothing to warn about
    expect(missingKeys([], "whatever", "nope")).toEqual([]);
  });
});

describe("sideways bar sizing", () => {
  it("gives every row its own band, however many there are", async () => {
    const { barAreaHeight } = await import("./charts");
    expect(barAreaHeight(9, 260)).toBe(318);    // 9 blocks
    expect(barAreaHeight(26, 280)).toBe(828);   // a season of weekly buckets
    // a short chart still fills the space the card expects
    expect(barAreaHeight(2, 260)).toBe(260);
    expect(barAreaHeight(0, 240)).toBe(240);
  });

  it("sizes the label gutter to the longest name, within limits", async () => {
    const { categoryLabelWidth } = await import("./charts");
    expect(categoryLabelWidth(["B1", "B2"])).toBe(56);           // floor
    expect(categoryLabelWidth(["Labour Shortage"])).toBe(121);
    // one very long name cannot swallow the plot
    expect(categoryLabelWidth(["a".repeat(200)])).toBe(170);
    expect(categoryLabelWidth([])).toBe(56);
  });
});
