import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import {
  PINNED_META_SHA256,
  PINNED_TEXT_SHA256,
  readChecksumFromSourceMd,
  sha256Hex,
  verifySourceChecksum,
} from "../../../scripts/import-quran";

const dir = join(process.cwd(), "content", "quran");
const A = "a".repeat(64);
const B = "b".repeat(64);

describe("T9 F11: the Tanzil source checksums are pinned in code", () => {
  it("the source files on disk match the pins", () => {
    expect(sha256Hex(readFileSync(join(dir, "source", "quran-uthmani.txt")))).toBe(PINNED_TEXT_SHA256);
    expect(sha256Hex(readFileSync(join(dir, "source", "quran-data.js")))).toBe(PINNED_META_SHA256);
  });

  it("SOURCE.md records the same values as the pins", () => {
    const md = readFileSync(join(dir, "SOURCE.md"), "utf8");
    expect(readChecksumFromSourceMd(md)).toBe(PINNED_TEXT_SHA256);
    expect(/SHA-256 file metadata:\s*`([0-9a-f]{64})`/.exec(md)?.[1]).toBe(PINNED_META_SHA256);
  });

  it("passes when file, pin and SOURCE.md agree", () => {
    expect(() => verifySourceChecksum({ label: "x", actual: A, pinned: A, recorded: A, refresh: false })).not.toThrow();
  });

  it("fails when the SOURCE.md line is missing instead of skipping the check", () => {
    expect(() => verifySourceChecksum({ label: "x", actual: A, pinned: A, recorded: null, refresh: false })).toThrow(/no SHA-256 line/);
  });

  it("fails when file and SOURCE.md were changed together but the pin was not", () => {
    expect(() => verifySourceChecksum({ label: "x", actual: B, pinned: A, recorded: B, refresh: false })).toThrow(/pinned/);
  });

  it("fails when SOURCE.md differs from a file that equals the pin", () => {
    expect(() => verifySourceChecksum({ label: "x", actual: A, pinned: A, recorded: B, refresh: false })).toThrow(/SOURCE\.md has/);
  });

  it("--refresh only warns about a changed file, and does not need an old line", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(() => verifySourceChecksum({ label: "x", actual: B, pinned: A, recorded: null, refresh: true })).not.toThrow();
    expect(warn).toHaveBeenCalledOnce();
    warn.mockRestore();
  });
});
