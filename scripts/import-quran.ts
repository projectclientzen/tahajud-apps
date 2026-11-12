/**
 * Imports the Tanzil Uthmani text for the surahs the app needs.
 *
 * Run: pnpm import:quran            (use committed source file, verify checksum)
 *      pnpm import:quran --refresh  (download again from tanzil.net)
 *
 * The verse text is copied byte for byte from the downloaded file. Nothing is
 * typed, normalised or corrected here. If the download fails the script stops.
 */
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const TANZIL_DOWNLOAD_URL =
  "https://tanzil.net/pub/download/index.php?quranType=uthmani&outType=txt-2&marks=true&sajdah=true&tatweel=true&agree=true";
export const TANZIL_PAGE_URL = "https://tanzil.net/download/";
export const TANZIL_LICENSE_URL = "https://tanzil.net/docs/Text_License";

/** surah number -> inclusive verse range to keep (null = all verses). */
export const WANTED: Record<number, { from: number; to: number } | null> = {
  18: null,
  36: null,
  55: null,
  56: null,
  65: { from: 2, to: 3 },
  67: null,
};

export const EXPECTED_COUNTS: Record<number, number> = {
  18: 110,
  36: 83,
  55: 78,
  56: 96,
  65: 2,
  67: 30,
};

export interface VerseRecord {
  surah: number;
  ayah: number;
  text: string;
}

const VERSE_LINE = /^(\d{1,3})\|(\d{1,3})\|(.+)$/;

export function sha256Hex(data: Buffer | string): string {
  return createHash("sha256").update(data).digest("hex");
}

/** Parses every verse line of the source file. Text is kept exactly as written. */
export function parseSource(content: string): VerseRecord[] {
  const out: VerseRecord[] = [];
  for (const line of content.split("\n")) {
    const m = VERSE_LINE.exec(line);
    if (!m) continue;
    out.push({ surah: Number(m[1]), ayah: Number(m[2]), text: m[3] as string });
  }
  return out;
}

export function selectWanted(all: VerseRecord[]): VerseRecord[] {
  return all.filter((v) => {
    const range = WANTED[v.surah];
    if (range === undefined) return false;
    if (range === null) return true;
    return v.ayah >= range.from && v.ayah <= range.to;
  });
}

/** Returns the copyright block from the source file, unchanged. */
export function extractLicenseBlock(content: string): string {
  const start = content.indexOf("# PLEASE DO NOT REMOVE OR CHANGE THIS COPYRIGHT BLOCK");
  if (start < 0) throw new Error("Tanzil copyright block not found in source file");
  return content.slice(start).trimEnd();
}

export function extractVersionLine(content: string): string {
  const m = /^#\s+(Tanzil Quran Text \([^)]*\))\s*$/m.exec(content);
  if (!m) throw new Error("Tanzil version line not found in source file");
  return m[1] as string;
}

export function verifyCounts(selected: VerseRecord[]): void {
  for (const [surah, expected] of Object.entries(EXPECTED_COUNTS)) {
    const n = selected.filter((v) => v.surah === Number(surah)).length;
    if (n !== expected) throw new Error(`Surah ${surah}: expected ${expected} verses, got ${n}`);
  }
}

export function readChecksumFromSourceMd(md: string): string | null {
  const m = /SHA-256 file sumber utuh:\s*`([0-9a-f]{64})`/.exec(md);
  return m ? (m[1] as string) : null;
}

export function buildSourceMd(args: {
  version: string;
  sha256: string;
  downloadedOn: string;
  license: string;
  verseCount: number;
}): string {
  return `# Sumber teks Qur'an

Teks ayat di \`uthmani.json\` disalin apa adanya dari file Tanzil. Jangan diedit tangan.
Perubahan hanya lewat \`pnpm import:quran --refresh\` dan harus disetujui owner.

- Sumber: Tanzil Project, ${args.version}
- Halaman unduh: ${TANZIL_PAGE_URL}
- URL unduh: ${TANZIL_DOWNLOAD_URL}
- Halaman lisensi: ${TANZIL_LICENSE_URL}
- Tanggal unduh: ${args.downloadedOn}
- File sumber utuh: \`source/quran-uthmani.txt\`
- SHA-256 file sumber utuh: \`${args.sha256}\`
- Jumlah ayat di uthmani.json: ${args.verseCount}
- Ayat yang diambil: surah 18, 36, 55, 56, 67 (semua ayat) dan 65:2-3

## Atribusi

Teks Qur'an: Tanzil Project (https://tanzil.net), lisensi Creative Commons Attribution 3.0.
Tampilkan sumber dan tautan ke tanzil.net di Reader (akhir surah).

## Teks lisensi (disalin dari akhir file sumber, tanpa perubahan)

\`\`\`
${args.license}
\`\`\`
`;
}

async function download(): Promise<Buffer> {
  const res = await fetch(TANZIL_DOWNLOAD_URL);
  if (!res.ok) throw new Error(`Tanzil download failed: HTTP ${res.status}`);
  return Buffer.from(await res.arrayBuffer());
}

async function main(): Promise<void> {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
  const dir = join(root, "content", "quran");
  const sourcePath = join(dir, "source", "quran-uthmani.txt");
  const mdPath = join(dir, "SOURCE.md");
  const refresh = process.argv.includes("--refresh");
  mkdirSync(dirname(sourcePath), { recursive: true });

  let buf: Buffer;
  let downloadedOn = new Date().toISOString().slice(0, 10);
  if (refresh || !existsSync(sourcePath)) {
    buf = await download();
    writeFileSync(sourcePath, buf);
  } else {
    buf = readFileSync(sourcePath);
    const prev = existsSync(mdPath) ? /Tanggal unduh: (\S+)/.exec(readFileSync(mdPath, "utf8")) : null;
    if (prev) downloadedOn = prev[1] as string;
  }

  const sha256 = sha256Hex(buf);
  const prevSha = existsSync(mdPath) ? readChecksumFromSourceMd(readFileSync(mdPath, "utf8")) : null;
  if (!refresh && prevSha && prevSha !== sha256) {
    throw new Error(`Checksum mismatch: SOURCE.md has ${prevSha}, file is ${sha256}`);
  }
  if (refresh && prevSha && prevSha !== sha256) {
    console.warn(`WARNING: source changed (${prevSha} -> ${sha256}). Owner must approve before merge.`);
  }

  const text = buf.toString("utf8");
  const selected = selectWanted(parseSource(text));
  verifyCounts(selected);

  writeFileSync(
    join(dir, "uthmani.json"),
    JSON.stringify({ source: "tanzil-uthmani", sha256, verses: selected }, null, 2) + "\n",
  );
  writeFileSync(
    mdPath,
    buildSourceMd({
      version: extractVersionLine(text),
      sha256,
      downloadedOn,
      license: extractLicenseBlock(text),
      verseCount: selected.length,
    }),
  );
  console.log(`OK: ${selected.length} verses, sha256 ${sha256}`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((err) => {
    console.error(String(err instanceof Error ? err.message : err));
    process.exit(1);
  });
}
