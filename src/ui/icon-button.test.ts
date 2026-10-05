import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

// Tailwind's reset makes every svg display:block, so an icon only centres in
// its button if the button centres it explicitly. jsdom does not apply the
// stylesheet, so the rule itself is what we can check.
describe("icon-only buttons", () => {
  const css = readFileSync(resolve(__dirname, "../index.css"), "utf8");
  const block = /\.btn-icon\s*\{([^}]*)\}/.exec(css)?.[1] ?? "";

  it("centre their icon both ways", () => {
    expect(block).toMatch(/display:\s*inline-flex/);
    expect(block).toMatch(/align-items:\s*center/);
    expect(block).toMatch(/justify-content:\s*center/);
  });

  it("keep their square size", () => {
    expect(block).toMatch(/width:\s*36px/);
    expect(block).toMatch(/height:\s*36px/);
  });
});
