import { record } from "./index";

/**
 * Global interaction capture — "every touch": clicks, value changes, form
 * submits, route changes, page errors and console.error output are queued
 * into the audit trail. Installed once per document.
 */

let installed = false;

function describe(el: Element | null): string {
  if (!el) return "";
  const tag = el.tagName.toLowerCase();
  const named =
    el.getAttribute("aria-label") ||
    el.getAttribute("title") ||
    (el as HTMLInputElement).name ||
    el.id ||
    el.getAttribute("placeholder");
  const text = (el.textContent || "").replace(/\s+/g, " ").trim().slice(0, 60);
  const key = named || text;
  return key ? `${tag}(${key})` : tag;
}

function changeDetail(
  el: HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement
): string {
  const field =
    el.getAttribute("aria-label") ||
    el.name ||
    el.id ||
    el.getAttribute("placeholder") ||
    el.tagName.toLowerCase();
  if (el instanceof HTMLInputElement) {
    if (el.type === "password") return `${field}=[hidden]`;
    if (el.type === "file")
      return `${field}=${el.files?.[0]?.name ?? "(none)"}`;
    if (el.type === "checkbox" || el.type === "radio")
      return `${field}=${el.checked}`;
    return `${field}=${el.value.slice(0, 120)}`;
  }
  return `${field}=${el.value.slice(0, 120)}`;
}

function fmtArgs(args: unknown[]): string {
  return args
    .map((a) => {
      if (a instanceof Error) return `${a.name}: ${a.message}`;
      if (typeof a === "object" && a !== null) {
        try {
          return JSON.stringify(a).slice(0, 200);
        } catch {
          return "[object]";
        }
      }
      return String(a);
    })
    .join(" ")
    .slice(0, 400);
}

export function installAuditCapture(): void {
  if (installed) return;
  installed = true;

  document.addEventListener(
    "click",
    (e) => {
      const target =
        (e.target as Element | null)?.closest?.(
          "button, a[href], [role=button], input, select, textarea, label"
        ) ?? (e.target as Element | null);
      void record({ action: "ui_click", detail: describe(target), source: "ui" });
    },
    true
  );

  document.addEventListener(
    "change",
    (e) => {
      const el = e.target as
        | HTMLInputElement
        | HTMLSelectElement
        | HTMLTextAreaElement
        | null;
      if (!el || typeof (el as Element).tagName !== "string") return;
      void record({
        action: "ui_change",
        detail: changeDetail(el),
        source: "ui",
      });
    },
    true
  );

  document.addEventListener(
    "submit",
    (e) => {
      void record({
        action: "ui_submit",
        detail: describe(e.target as Element) || "form",
        source: "ui",
      });
    },
    true
  );

  window.addEventListener("hashchange", () => {
    void record({
      action: "ui_navigate",
      detail: window.location.hash || "#/",
      source: "ui",
    });
  });

  window.addEventListener("error", (e) => {
    void record({
      action: "error",
      detail: `${e.message} (${e.filename ?? ""}:${e.lineno ?? 0})`,
      source: "system",
    });
  });

  window.addEventListener("unhandledrejection", (e) => {
    const r: unknown = e.reason;
    void record({
      action: "unhandled_rejection",
      detail:
        r instanceof Error
          ? `${r.name}: ${r.message}`
          : String(r).slice(0, 300),
      source: "system",
    });
  });

  const original = console.error;
  let lastErrorDetail = "";
  console.error = ((...args: unknown[]) => {
    const detail = fmtArgs(args);
    // Collapse bursts (charts often log the same warning per render).
    if (detail !== lastErrorDetail) {
      lastErrorDetail = detail;
      void record({ action: "console_error", detail, source: "console" });
    }
    original.apply(console, args);
  }) as typeof console.error;
}
