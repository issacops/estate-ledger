import { useSyncExternalStore, type ReactNode } from "react";
import { Printer } from "lucide-react";
import { toast } from "sonner";
import { cn } from "./components";

/**
 * One way to print anything.
 *
 * A document is rendered into a hidden host. For the moment of printing the
 * rest of the app is hidden and the host shown, so only the document comes out
 * on paper. On screen the host is never visible, and the print-only styles do
 * nothing unless the page is actually being printed.
 *
 * Why not just call window.print() on the page: the desktop webview prints
 * through a command, not the browser, and the page itself is a sidebar, charts
 * and controls — not something anyone wants on A4.
 */

let current: ReactNode = null;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => listeners.delete(l);
};

export function PrintHost() {
  const doc = useSyncExternalStore(subscribe, () => current);
  return <div className="print-host">{doc}</div>;
}

/** Waits a beat so the document is in the page before it is printed. */
const settle = () => new Promise<void>((r) => window.setTimeout(r, 120));

export async function printDocument(node: ReactNode, title?: string): Promise<boolean> {
  current = node;
  emit();
  await settle();

  const previousTitle = document.title;
  // the title becomes the file name when someone chooses "Save as PDF"
  if (title) document.title = title;
  document.body.dataset.printing = "1";

  let finished = false;
  const done = () => {
    if (finished) return;
    finished = true;
    delete document.body.dataset.printing;
    document.title = previousTitle;
    window.removeEventListener("afterprint", done);
    window.removeEventListener("focus", onFocus);
  };
  // some webviews never fire afterprint; the window regaining focus after the
  // dialog closes is the next best signal
  const onFocus = () => window.setTimeout(done, 400);
  window.addEventListener("afterprint", done);
  window.setTimeout(() => window.addEventListener("focus", onFocus), 1500);

  try {
    await window.print();
    return true;
  } catch (err) {
    console.error(err);
    done();
    toast.error("Could not open the print dialog");
    return false;
  }
}

export function PrintButton(props: {
  title: string;
  render: () => ReactNode;
  documentTitle?: string;
  label?: string;
  className?: string;
}) {
  return (
    <button
      type="button"
      title={props.title}
      aria-label={props.title}
      className={cn(
        props.label ? "btn btn-secondary" : "btn-icon !h-8 !w-8",
        props.className
      )}
      onClick={() => void printDocument(props.render(), props.documentTitle ?? props.title)}
    >
      <Printer size={14} />
      {props.label}
    </button>
  );
}
