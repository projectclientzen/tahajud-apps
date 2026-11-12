import { describe, expect, it } from "vitest";
import { resolveTheme, themeInitScript } from "@/lib/theme";

const at = (h: number, m = 0) => h * 60 + m;

describe("resolveTheme", () => {
  it("explicit light/dark wins over system", () => {
    expect(resolveTheme("light", true, at(2))).toBe("light");
    expect(resolveTheme("dark", false, at(12))).toBe("dark");
  });

  it("system follows the OS", () => {
    expect(resolveTheme("system", true, at(12))).toBe("dark");
    expect(resolveTheme(null, false, at(2))).toBe("light");
  });

  it("auto-night is dark from 18:00 to 04:59", () => {
    expect(resolveTheme("auto-night", false, at(17, 59))).toBe("light");
    expect(resolveTheme("auto-night", false, at(18))).toBe("dark");
    expect(resolveTheme("auto-night", false, at(2, 30))).toBe("dark");
    expect(resolveTheme("auto-night", false, at(4, 59))).toBe("dark");
    expect(resolveTheme("auto-night", false, at(5))).toBe("light");
  });

  it("init script is self-contained", () => {
    expect(themeInitScript).toContain("localStorage");
    expect(() => new Function(themeInitScript)).not.toThrow();
  });
});
