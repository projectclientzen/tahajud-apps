import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const css = readFileSync(new URL("../../src/app/globals.css", import.meta.url), "utf8");

function block(selector: string): Record<string, string> {
  const start = css.indexOf(selector);
  if (start < 0) throw new Error(`selector not found: ${selector}`);
  const open = css.indexOf("{", start);
  const close = css.indexOf("}", open);
  const vars: Record<string, string> = {};
  for (const m of css.slice(open + 1, close).matchAll(/--([\w-]+):\s*(#[0-9a-fA-F]{6})\s*;/g)) {
    vars[m[1]!] = m[2]!;
  }
  return vars;
}

function luminance(hex: string) {
  const ch = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
  const [r, g, b] = ch.map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4)) as [number, number, number];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

export function contrast(a: string, b: string) {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
}

const themes = {
  light: block(':root[data-theme="light"]'),
  dark: block(':root[data-theme="dark"] {'),
};

const TEXT_TOKENS = ["text", "text-muted", "success", "warning", "error", "info"];
const SURFACES = ["bg", "surface", "surface-2"];

describe.each(Object.entries(themes))("%s theme (WCAG 2.2 AA)", (_name, t) => {
  it.each(TEXT_TOKENS.flatMap((fg) => SURFACES.map((bg) => [fg, bg])))("%s on %s >= 4.5:1", (fg, bg) => {
    expect(contrast(t[fg]!, t[bg]!)).toBeGreaterThanOrEqual(4.5);
  });

  it("button label on primary >= 4.5:1", () => {
    expect(contrast(t["on-primary"]!, t.primary!)).toBeGreaterThanOrEqual(4.5);
  });

  it("status chip text on its soft background >= 4.5:1", () => {
    for (const k of ["success", "warning", "error", "info"]) {
      expect(contrast(t[k]!, t[`${k}-soft`]!), k).toBeGreaterThanOrEqual(4.5);
    }
    expect(contrast(t["text-muted"]!, t["surface-2"]!)).toBeGreaterThanOrEqual(4.5);
  });

  it.each(SURFACES)("control border on %s >= 3:1", (bg) => {
    expect(contrast(t["border-strong"]!, t[bg]!)).toBeGreaterThanOrEqual(3);
  });

  it("focus ring on bg >= 3:1", () => {
    expect(contrast(t.focus!, t.bg!)).toBeGreaterThanOrEqual(3);
  });
});

describe("brand rule", () => {
  it("sage on cream fails AA for text, so it stays decorative (PRD v1.2 §7.2)", () => {
    expect(contrast("#88a189", "#faf7ed")).toBeLessThan(3);
  });
});
