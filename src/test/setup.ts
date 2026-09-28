class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}

if (!("ResizeObserver" in globalThis)) {
  (globalThis as Record<string, unknown>).ResizeObserver = ResizeObserverStub;
}

const w = window as unknown as {
  matchMedia?: (q: string) => unknown;
};
if (!w.matchMedia) {
  w.matchMedia = (q: string) => ({
    matches: false,
    media: q,
    addEventListener() {},
    removeEventListener() {},
    addListener() {},
    removeListener() {},
    onchange: null,
    dispatchEvent: () => false,
  });
}

import { configure } from "@testing-library/react";
configure({ asyncUtilTimeout: 8000 });
