import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup, waitFor } from "@testing-library/react";
import { Confirm } from "./components";
import { ErrorBoundary } from "./ErrorBoundary";

afterEach(cleanup);

describe("Confirm", () => {
  it("runs the handler once however many times the button is clicked", async () => {
    let release!: () => void;
    const slow = new Promise<void>((r) => (release = r));
    const onConfirm = vi.fn(() => slow);
    render(
      <Confirm open title="Delete" message="Sure?" confirmLabel="Yes" onConfirm={onConfirm} onCancel={() => {}} />
    );
    const btn = screen.getByRole("button", { name: "Yes" });
    fireEvent.click(btn);
    fireEvent.click(btn);
    fireEvent.click(btn);
    expect(onConfirm).toHaveBeenCalledTimes(1);
    expect((btn as HTMLButtonElement).disabled).toBe(true);
    release();
    await waitFor(() => expect((btn as HTMLButtonElement).disabled).toBe(false));
  });

  it("is exposed to assistive tech as a dialog with a labelled close button", () => {
    render(<Confirm open title="Delete day" message="Sure?" onConfirm={() => {}} onCancel={() => {}} />);
    expect(screen.getByRole("dialog", { name: "Delete day" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Close" })).toBeTruthy();
  });
});

describe("ErrorBoundary", () => {
  it("shows a recovery panel instead of a blank screen when a page throws", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const Boom = () => {
      throw new Error("kaboom");
    };
    render(
      <ErrorBoundary>
        <Boom />
      </ErrorBoundary>
    );
    expect(screen.getByRole("alert")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Reload app" })).toBeTruthy();
    spy.mockRestore();
  });

  it("renders children untouched when nothing throws", () => {
    render(
      <ErrorBoundary>
        <p>fine</p>
      </ErrorBoundary>
    );
    expect(screen.getByText("fine")).toBeTruthy();
  });
});
