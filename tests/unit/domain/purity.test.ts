import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    return statSync(p).isDirectory() ? files(p) : p.endsWith(".ts") ? [p] : [];
  });
}

describe("src/domain stays pure TypeScript", () => {
  const all = files("src/domain");
  it("has files to check", () => expect(all.length).toBeGreaterThan(15));

  it("imports no React, Next, or browser UI packages", () => {
    const bad = /from\s+["'](react|react-dom|next|next\/[^"']*|@radix-ui\/[^"']*|lucide-react)["']/;
    for (const f of all) expect(readFileSync(f, "utf8"), f).not.toMatch(bad);
  });

  it("has no hidden clock: no Date.now(), no new Date() without arguments", () => {
    for (const f of all) {
      const src = readFileSync(f, "utf8");
      expect(src, f).not.toMatch(/Date\.now\(\)/);
      expect(src, f).not.toMatch(/new Date\(\s*\)/);
    }
  });

  it("does not reach into src/data, src/app or src/components", () => {
    for (const f of all) expect(readFileSync(f, "utf8"), f).not.toMatch(/from\s+["']@\/(data|app|components)/);
  });
});
