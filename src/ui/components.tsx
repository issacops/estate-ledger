import React, { useState } from "react";
import { clsx } from "clsx";
import { twMerge } from "tailwind-merge";
import { Camera, ChevronDown } from "lucide-react";

export function cn(...parts: (string | false | null | undefined)[]): string {
  return twMerge(clsx(parts));
}

export function IconChip(props: {
  children: React.ReactNode;
  round?: boolean;
  ink?: boolean;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "icon-chip",
        props.round && "icon-chip-round",
        props.ink && "icon-chip-ink",
        props.className
      )}
    >
      {props.children}
    </span>
  );
}

export function Card(props: {
  children: React.ReactNode;
  className?: string;
  title?: React.ReactNode;
  icon?: React.ReactNode;
  right?: React.ReactNode;
  pad?: boolean;
  tone?: "default" | "butter" | "ink";
}) {
  return (
    <div
      className={cn(
        "card",
        props.tone === "butter" && "card-butter",
        props.tone === "ink" && "card-ink",
        props.className
      )}
    >
      {(props.title || props.right) && (
        <div className="flex items-center justify-between gap-3 px-5 pt-4 pb-2">
          <div className="flex items-center gap-2.5">
            {props.icon && <IconChip ink={props.tone === "ink"}>{props.icon}</IconChip>}
            <div className="font-display text-[15.5px] font-semibold text-inherit">
              {props.title}
            </div>
          </div>
          {props.right}
        </div>
      )}
      <div className={props.pad === false ? "" : "p-5"}>{props.children}</div>
    </div>
  );
}

export function KPI(props: {
  label: string;
  value: React.ReactNode;
  sub?: React.ReactNode;
  tone?: "default" | "good" | "warn" | "bad";
  icon?: React.ReactNode;
  bare?: boolean;
}) {
  const tone =
    props.tone === "good"
      ? "border-ok/30 bg-ok-bg"
      : props.tone === "warn"
        ? "border-warn/30 bg-warn-bg"
        : props.tone === "bad"
          ? "border-danger/30 bg-danger-bg"
          : "border-paper-line bg-paper-card";
  if (props.bare) {
    return (
      <div className="stat-row">
        {props.icon && <IconChip round>{props.icon}</IconChip>}
        <div>
          <div className="kpi-num text-[26px] leading-none text-ink">
            {props.value}
          </div>
          <div className="label mt-1.5">{props.label}</div>
          {props.sub && (
            <div className="mt-0.5 text-[11px] text-ink-soft">{props.sub}</div>
          )}
        </div>
      </div>
    );
  }
  return (
    <div
      className={cn(
        "rounded-[18px] border px-4 py-3.5 shadow-[0_1px_2px_rgba(0,0,0,0.05)]",
        tone
      )}
    >
      <div className="flex items-center gap-2.5">
        {props.icon && <IconChip round>{props.icon}</IconChip>}
        <div className="label">{props.label}</div>
      </div>
      <div className="kpi-num mt-2 text-[24px] leading-tight text-ink">
        {props.value}
      </div>
      {props.sub && (
        <div className="mt-0.5 text-[11px] text-ink-soft">{props.sub}</div>
      )}
    </div>
  );
}

export function Gauge(props: {
  value: number;
  max?: number;
  label: string;
  caption?: string;
}) {
  const pct = Math.max(
    0,
    Math.min(1, props.value / (props.max || 100))
  );
  const r = 74;
  const c = 2 * Math.PI * r;
  const arc = 0.75;
  return (
    <div className="relative mx-auto w-[190px]">
      <svg viewBox="0 0 190 190" className="w-full -rotate-[135deg]">
        <defs>
          <linearGradient id="gaugeGrad" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor="#3bb54a" />
            <stop offset="55%" stopColor="#00a651" />
            <stop offset="100%" stopColor="#137a43" />
          </linearGradient>
        </defs>
        <circle
          cx="95"
          cy="95"
          r={r}
          fill="none"
          strokeWidth="17"
          strokeLinecap="round"
          className="gauge-track"
          strokeDasharray={`${c * arc} ${c}`}
        />
        <circle
          cx="95"
          cy="95"
          r={r}
          fill="none"
          stroke="url(#gaugeGrad)"
          strokeWidth="17"
          strokeLinecap="round"
          strokeDasharray={`${c * arc * pct} ${c}`}
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <div className="kpi-num text-[34px] leading-none">
          {Math.round(pct * 100)}%
        </div>
        <div className="label mt-2 max-w-[120px] text-center">{props.label}</div>
        {props.caption && (
          <div className="mt-1 text-[10.5px] text-ink-soft">{props.caption}</div>
        )}
      </div>
    </div>
  );
}

export function Field(props: {
  label: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <label className={cn("block", props.className)}>
      <div className="label mb-1">{props.label}</div>
      {props.children}
    </label>
  );
}

export function Pill(props: {
  active?: boolean;
  onClick?: () => void;
  children: React.ReactNode;
  title?: string;
}) {
  return (
    <button
      type="button"
      title={props.title}
      onClick={props.onClick}
      className={cn("pill", props.active && "active")}
    >
      {props.children}
    </button>
  );
}

export function Badge(props: {
  children: React.ReactNode;
  tone?: "ok" | "warn" | "bad" | "neutral";
}) {
  const map = {
    ok: "bg-ok-bg text-ok border-ok/30",
    warn: "bg-warn-bg text-warn border-warn/30",
    bad: "bg-danger-bg text-danger border-danger/30",
    neutral: "bg-paper-deep text-ink-soft border-paper-line",
  } as const;
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full border px-2 py-0.5 text-[10.5px] font-semibold whitespace-nowrap",
        map[props.tone ?? "neutral"]
      )}
    >
      {props.children}
    </span>
  );
}

export function EmptyState(props: {
  title: string;
  hint?: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="tex-linen flex flex-col items-center justify-center gap-2 rounded-[18px] border border-dashed border-paper-line px-6 py-12 text-center">
      <IconChip round>
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round">
          <path d="M12 5v14M5 12h14" />
        </svg>
      </IconChip>
      <div className="font-display mt-1 text-[15px] text-ink">{props.title}</div>
      {props.hint && (
        <div className="max-w-md text-[12px] text-ink-soft">{props.hint}</div>
      )}
      {props.action && <div className="mt-2">{props.action}</div>}
    </div>
  );
}

export function Modal(props: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: React.ReactNode;
  width?: number;
  icon?: React.ReactNode;
}) {
  if (!props.open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-auto bg-ink/35 p-6 no-print backdrop-blur-[2px]">
      <div
        role="dialog"
        aria-modal="true"
        aria-label={props.title}
        className="card mt-8 w-full"
        style={{ maxWidth: props.width ?? 640, boxShadow: "var(--shadow-pop)" }}
      >
        <div className="flex items-center justify-between px-5 pt-4 pb-2">
          <div className="flex items-center gap-2.5">
            {props.icon && <IconChip>{props.icon}</IconChip>}
            <div className="font-display text-[15.5px] font-semibold">
              {props.title}
            </div>
          </div>
          <button className="btn btn-ghost" aria-label="Close" onClick={props.onClose}>
            ✕
          </button>
        </div>
        <div className="p-5">{props.children}</div>
      </div>
    </div>
  );
}

export function Confirm(props: {
  open: boolean;
  title: string;
  message: string;
  confirmLabel?: string;
  danger?: boolean;
  onConfirm: () => void | Promise<void>;
  onCancel: () => void;
}) {
  // One click, one run: a second click while the handler is still working
  // (e.g. a delete that reverses stock) must not run it again.
  const [busy, setBusy] = useState(false);
  const run = async () => {
    if (busy) return;
    setBusy(true);
    try {
      await props.onConfirm();
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal open={props.open} onClose={props.onCancel} title={props.title} width={440}>
      <p className="text-[13px] text-ink-light">{props.message}</p>
      <div className="mt-4 flex justify-end gap-2">
        <button className="btn btn-secondary" onClick={props.onCancel}>
          Cancel
        </button>
        <button
          className={cn("btn", props.danger ? "btn-danger" : "btn-primary")}
          disabled={busy}
          onClick={run}
        >
          {props.confirmLabel ?? "Confirm"}
        </button>
      </div>
    </Modal>
  );
}

export function Table(props: {
  headers: (string | React.ReactNode)[];
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("overflow-x-auto", props.className)}>
      <table className="register-table">
        <thead>
          <tr>
            {props.headers.map((h, i) => (
              <th key={i}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>{props.children}</tbody>
      </table>
    </div>
  );
}

export function Th(props: { children?: React.ReactNode }) {
  return <th>{props.children}</th>;
}

export function Td(props: {
  children?: React.ReactNode;
  className?: string;
  colSpan?: number;
}) {
  return (
    <td className={props.className} colSpan={props.colSpan}>
      {props.children}
    </td>
  );
}

export function PageHeader(props: {
  title: string;
  eyebrow?: React.ReactNode;
  subtitle?: React.ReactNode;
  right?: React.ReactNode;
}) {
  return (
    <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
      <div>
        {props.eyebrow && <div className="label mb-1.5">{props.eyebrow}</div>}
        <h1 className="font-display text-[26px] leading-tight font-semibold tracking-tight text-ink">
          {props.title}
        </h1>
        {props.subtitle && (
          <div className="mt-1 text-[12px] text-ink-soft">{props.subtitle}</div>
        )}
      </div>
      <div className="flex flex-wrap items-center gap-2">{props.right}</div>
    </div>
  );
}

/** Small square preview of an attached photo; renders nothing when absent. */
export function PhotoThumb(props: {
  dataUrl: string | null;
  size?: number;
  className?: string;
}) {
  if (!props.dataUrl) return null;
  const size = props.size ?? 36;
  return (
    <img
      src={props.dataUrl}
      alt=""
      width={size}
      height={size}
      className={cn(
        "rounded-[6px] border border-paper-line object-cover",
        props.className
      )}
      style={{ width: size, height: size }}
    />
  );
}

/**
 * Fix list #4 — the daily register's attach-a-photo control, reused on
 * invoices and purchase bills. The image is stored as a compressed JPEG data
 * URL, exactly like `entry_days.photo`, and is deliberately not gated behind
 * the estate's `photos` profile flag: the fix list asks for it on both estates.
 */
export function PhotoField(props: {
  label: string;
  value: string | null;
  onChange: (dataUrl: string | null) => void;
  className?: string;
}) {
  return (
    <div className={cn("flex flex-wrap items-center gap-3", props.className)}>
      <label className="btn btn-secondary cursor-pointer">
        <Camera size={14} />
        {props.value ? "Replace photo" : props.label}
        <input
          type="file"
          accept="image/*"
          className="hidden"
          onChange={async (e) => {
            const f = e.target.files?.[0];
            if (!f) return;
            const { compressImage } = await import("../io/photo");
            const dataUrl = await compressImage(f);
            props.onChange(dataUrl || null);
          }}
        />
      </label>
      {props.value && (
        <>
          <PhotoThumb dataUrl={props.value} size={44} />
          <button
            type="button"
            className="text-danger text-[12px]"
            onClick={() => props.onChange(null)}
          >
            Clear
          </button>
        </>
      )}
    </div>
  );
}

/**
 * The attach-a-photo control for a table cell — the bill or invoice slip
 * photographed on the phone, kept against the row it belongs to.
 *
 * An empty cell shows a dashed placeholder you can click, rather than a dash
 * that gives no hint anything can be added. A filled one shows the thumbnail;
 * clicking it opens the photo full size, with Replace and Remove beneath.
 */
export function PhotoCell(props: {
  value: string | null;
  onChange: (dataUrl: string | null) => void | Promise<void>;
  label?: string;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  const pick = async (file: File | undefined) => {
    if (!file) return;
    setBusy(true);
    try {
      const { compressImage } = await import("../io/photo");
      const dataUrl = await compressImage(file);
      await props.onChange(dataUrl || null);
    } finally {
      setBusy(false);
    }
  };

  if (!props.value) {
    return (
      <label
        className={cn(
          "inline-flex h-8 w-8 cursor-pointer items-center justify-center rounded-[6px]",
          "border border-dashed border-paper-line text-ink-soft",
          "hover:border-rust hover:text-rust",
          props.disabled && "pointer-events-none opacity-40"
        )}
        title={props.label ?? "Attach a photo"}
      >
        {busy ? <span className="text-[10px]">…</span> : <Camera size={14} />}
        <input
          type="file"
          accept="image/*"
          className="hidden"
          disabled={props.disabled}
          onChange={(e) => void pick(e.target.files?.[0])}
        />
      </label>
    );
  }

  return (
    <>
      <button
        type="button"
        title="View photo"
        onClick={() => setOpen(true)}
        className="block"
      >
        <PhotoThumb dataUrl={props.value} size={32} />
      </button>
      <Modal open={open} onClose={() => setOpen(false)} title={props.label ?? "Photo"} width={640}>
        <img
          src={props.value}
          alt=""
          className="max-h-[60vh] w-full rounded-lg border border-paper-line object-contain"
        />
        <div className="mt-3 flex items-center gap-2">
          <label className="btn btn-secondary cursor-pointer">
            <Camera size={14} /> Replace
            <input
              type="file"
              accept="image/*"
              className="hidden"
              onChange={(e) => void pick(e.target.files?.[0])}
            />
          </label>
          <button
            type="button"
            className="btn btn-danger"
            onClick={async () => {
              await props.onChange(null);
              setOpen(false);
            }}
          >
            Remove
          </button>
        </div>
      </Modal>
    </>
  );
}

/**
 * A card whose body folds away. The header always shows the title and a short
 * summary, so a long table can sit closed beneath the charts and still say
 * what is inside it.
 */
export function CollapsibleCard(props: {
  title: string;
  /** Shown beside the title whether open or closed, e.g. "269 invoices". */
  summary?: React.ReactNode;
  defaultOpen?: boolean;
  /** Keep the body showing and drop the toggle — for an empty table, where
   *  there is nothing to fold away and the empty message is the content. */
  forceOpen?: boolean;
  right?: React.ReactNode;
  className?: string;
  pad?: boolean;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(props.defaultOpen ?? false);
  const shown = open || !!props.forceOpen;
  return (
    <Card
      className={props.className}
      pad={false}
      title={
        <button
          type="button"
          className="flex items-center gap-2 text-left"
          aria-expanded={shown}
          disabled={props.forceOpen}
          onClick={() => setOpen((o) => !o)}
        >
          <ChevronDown
            size={16}
            className={cn("shrink-0 transition-transform", !shown && "-rotate-90")}
          />
          <span>{props.title}</span>
          {props.summary && (
            <span className="text-[12px] font-normal text-ink-soft">{props.summary}</span>
          )}
        </button>
      }
      right={
        <div className="flex items-center gap-2">
          {props.right}
          {!props.forceOpen && (
            <button
              type="button"
              className="btn btn-secondary"
              onClick={() => setOpen((o) => !o)}
            >
              {open ? "Hide" : "Show"}
            </button>
          )}
        </div>
      }
    >
      {shown && <div className={props.pad === false ? "" : "p-5"}>{props.children}</div>}
    </Card>
  );
}
