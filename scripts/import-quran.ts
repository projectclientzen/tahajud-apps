/**
 * Imports the Tanzil Uthmani text and the Tanzil page/juz metadata.
 *
 * Outputs:
 *   content/quran/uthmani.json        the six night readings (server API, unchanged)
 *   public/quran/surah-001..114.json  every surah, verbatim, loaded on demand by the reader (static asset)
 *   content/quran/meta.json           surah names + counts, 30 juz starts, 604 page starts (from Tanzil quran-data)
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
export const TANZIL_METADATA_URL = "https://tanzil.net/res/text/metadata/quran-data.js";

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

/**
 * SHA-256 of the two Tanzil source files, pinned here in code (T9 F11). SOURCE.md is written by this same script, so
 * on its own it cannot catch a change: someone could edit the source file and SOURCE.md in one commit, or delete the
 * checksum line. A change to these two constants shows in review, and tests/unit/data/quran-pins.test.ts checks the
 * files on disk against them. Update only together with `--refresh` and the owner's approval.
 */
export const PINNED_TEXT_SHA256 = "6933e133dd56db778c801bf738848454e43648105a151e8d84d86a7cae39ec5f";
export const PINNED_META_SHA256 = "9e9930c592aaa34b5c7a79ff4e99ffdc782263a266090bfe2c49e4ed4bac4ca4";

/**
 * Without `--refresh` the file must equal the pin AND the line in SOURCE.md. A missing line is an error, not a pass.
 * With `--refresh` a different file only warns (the owner approves the new pin before merge).
 */
export function verifySourceChecksum(args: {
  label: string;
  actual: string;
  pinned: string;
  recorded: string | null;
  refresh: boolean;
}): void {
  const { label, actual, pinned, recorded, refresh } = args;
  if (refresh) {
    if (actual !== pinned) console.warn(`WARNING: ${label} changed (${pinned} -> ${actual}). Owner must approve the new pin before merge.`);
    return;
  }
  if (!recorded) {
    throw new Error(`${label}: SOURCE.md has no SHA-256 line. Refusing to import without one (use --refresh to rebuild it).`);
  }
  if (actual !== pinned) throw new Error(`${label} checksum mismatch: pinned ${pinned}, file is ${actual}`);
  if (recorded !== actual) throw new Error(`${label} checksum mismatch: SOURCE.md has ${recorded}, file is ${actual}`);
}

export function readChecksumFromSourceMd(md: string): string | null {
  const m = /SHA-256 file sumber utuh:\s*`([0-9a-f]{64})`/.exec(md);
  return m ? (m[1] as string) : null;
}

// ---- Metadata (surah table, juz and page starts) -------------------------------------------------------------

export interface SurahMetaRecord {
  number: number;
  /** Tanzil transliterated name, copied as is (e.g. "Al-Faatiha"). */
  name: string;
  english: string;
  type: "Meccan" | "Medinan";
  ayahs: number;
  rukus: number;
}
export type AyahRef = readonly [surah: number, ayah: number];
export interface QuranMetadata {
  surahs: SurahMetaRecord[];
  /** Index 0 = juz 1. */
  juz: AyahRef[];
  /** Index 0 = page 1 (Madinah mushaf, 604 pages). */
  pages: AyahRef[];
}

function sectionOf(js: string, name: string): string {
  const start = js.indexOf(`QuranData.${name} = [`);
  if (start < 0) throw new Error(`QuranData.${name} not found in metadata file`);
  const end = js.indexOf("\n];", start);
  if (end < 0) throw new Error(`QuranData.${name} is not terminated`);
  return js.slice(start, end);
}

/**
 * Reads the numbers out of Tanzil's quran-data.js with regular expressions. The file is never executed.
 * Tanzil ends every table with a sentinel row (115:1 for juz and pages, 6236:1 for suras); it is dropped here.
 */
export function parseQuranData(js: string): QuranMetadata {
  const surahRe = /\[(\d+),\s*(\d+),\s*(\d+),\s*(\d+),\s*'[^']*',\s*"([^"]*)",\s*'([^']*)',\s*'(Meccan|Medinan)'\]/g;
  const surahs: SurahMetaRecord[] = [];
  for (const m of sectionOf(js, "Sura").matchAll(surahRe)) {
    surahs.push({
      number: surahs.length + 1,
      name: m[5] as string,
      english: m[6] as string,
      type: m[7] as "Meccan" | "Medinan",
      ayahs: Number(m[2]),
      rukus: Number(m[4]),
    });
  }
  const pairs = (name: string): AyahRef[] => {
    const out: AyahRef[] = [];
    for (const m of sectionOf(js, name).matchAll(/\[(\d+),\s*(\d+)\]/g)) out.push([Number(m[1]), Number(m[2])]);
    return out;
  };
  const juz = pairs("Juz");
  const pages = pairs("Page");
  const last = (a: AyahRef[]) => a[a.length - 1];
  if (last(juz)?.[0] !== 115) throw new Error("Juz table has no sentinel row");
  if (last(pages)?.[0] !== 115) throw new Error("Page table has no sentinel row");
  return { surahs, juz: juz.slice(0, -1), pages: pages.slice(0, -1) };
}

export function verifyMetadata(meta: QuranMetadata): void {
  if (meta.surahs.length !== 114) throw new Error(`Expected 114 surahs, got ${meta.surahs.length}`);
  const total = meta.surahs.reduce((n, s) => n + s.ayahs, 0);
  if (total !== 6236) throw new Error(`Expected 6236 ayahs, got ${total}`);
  if (meta.juz.length !== 30) throw new Error(`Expected 30 juz, got ${meta.juz.length}`);
  if (meta.pages.length !== 604) throw new Error(`Expected 604 pages, got ${meta.pages.length}`);
  for (const list of [meta.juz, meta.pages]) {
    if (list[0]![0] !== 1 || list[0]![1] !== 1) throw new Error("First entry must start at 1:1");
    list.forEach(([s, a], i) => {
      const count = meta.surahs[s - 1]?.ayahs ?? 0;
      if (a < 1 || a > count) throw new Error(`Entry ${i + 1} (${s}:${a}) is outside the surah`);
      const prev = list[i - 1];
      if (prev && (s < prev[0] || (s === prev[0] && a <= prev[1]))) throw new Error(`Entry ${i + 1} is not increasing`);
    });
  }
}

export interface SurahFile {
  surah: number;
  sha256: string;
  verses: { ayah: number; text: string }[];
}

/** Splits the parsed source into one record per surah. Text is passed through untouched. */
export function buildSurahFiles(all: VerseRecord[], sha256: string, meta: QuranMetadata): SurahFile[] {
  return meta.surahs.map((s) => {
    const verses = all
      .filter((v) => v.surah === s.number)
      .sort((a, b) => a.ayah - b.ayah)
      .map((v) => ({ ayah: v.ayah, text: v.text }));
    if (verses.length !== s.ayahs) throw new Error(`Surah ${s.number}: expected ${s.ayahs} verses, got ${verses.length}`);
    verses.forEach((v, i) => {
      if (v.ayah !== i + 1) throw new Error(`Surah ${s.number}: ayah ${i + 1} missing`);
    });
    return { surah: s.number, sha256, verses };
  });
}

export const surahFileName = (n: number): string => `surah-${String(n).padStart(3, "0")}.json`;

export function buildSourceMd(args: {
  version: string;
  sha256: string;
  downloadedOn: string;
  license: string;
  verseCount: number;
  metadata?: { sha256: string; downloadedOn: string; header: string };
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

${args.metadata ? metadataSection(args.metadata) : ""}
## Atribusi

Teks Qur'an: Tanzil Project (https://tanzil.net), lisensi Creative Commons Attribution 3.0.
Tampilkan sumber dan tautan ke tanzil.net di Reader (akhir surah).

## Teks lisensi (disalin dari akhir file sumber, tanpa perubahan)

\`\`\`
${args.license}
\`\`\`
`;
}

function metadataSection(m: { sha256: string; downloadedOn: string; header: string }): string {
  return `
## Metadata halaman dan juz (meta.json, public/quran/)

- Sumber: Tanzil Quran Metadata, \`quran-data.js\`
- URL unduh: ${TANZIL_METADATA_URL}
- Tanggal unduh: ${m.downloadedOn}
- File sumber utuh: \`source/quran-data.js\`
- SHA-256 file metadata: \`${m.sha256}\`
- Lisensi: Creative Commons Attribution 3.0 (header file, disalin di bawah)
- Isi yang dipakai: tabel surah (nama latin, jumlah ayat), awal 30 juz, awal 604 halaman (Mushaf Madinah). Hanya angka yang dibaca, file tidak dieksekusi
- \`content/quran/meta.json\` dibuat oleh \`pnpm import:quran\`. Jangan diedit tangan
- \`public/quran/surah-001.json\` sampai \`surah-114.json\`: seluruh ayat dari file sumber utuh, satu file per surah, teks tidak diubah

\`\`\`
${m.header}
\`\`\`
`;
}

/** The copyright header of the metadata file (leading // lines), unchanged. */
export function extractMetadataHeader(js: string): string {
  const lines: string[] = [];
  for (const l of js.split("\n")) {
    if (l.startsWith("//")) lines.push(l.trimEnd());
    else if (l.trim() === "" && lines.length === 0) continue;
    else break;
  }
  if (lines.length === 0) throw new Error("Metadata copyright header not found");
  return lines.join("\n");
}

async function download(): Promise<Buffer> {
  const res = await fetch(TANZIL_DOWNLOAD_URL);
  if (!res.ok) throw new Error(`Tanzil download failed: HTTP ${res.status}`);
  return Buffer.from(await res.arrayBuffer());
}

async function downloadMetadata(): Promise<Buffer> {
  const res = await fetch(TANZIL_METADATA_URL);
  if (!res.ok) throw new Error(`Tanzil metadata download failed: HTTP ${res.status}`);
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

  // Metadata file: same checksum discipline as the text file.
  const metaSrcPath = join(dir, "source", "quran-data.js");
  let metaBuf: Buffer;
  let metaDownloadedOn = new Date().toISOString().slice(0, 10);
  const prevMd = existsSync(mdPath) ? readFileSync(mdPath, "utf8") : "";
  if (refresh || !existsSync(metaSrcPath)) {
    metaBuf = await downloadMetadata();
    writeFileSync(metaSrcPath, metaBuf);
  } else {
    metaBuf = readFileSync(metaSrcPath);
    const prev = /File sumber utuh: `source\/quran-data\.js`/.test(prevMd)
      ? /Metadata halaman[\s\S]*?Tanggal unduh: (\S+)/.exec(prevMd)
      : null;
    if (prev) metaDownloadedOn = prev[1] as string;
  }
  const metaSha = sha256Hex(metaBuf);
  const prevMetaSha = /SHA-256 file metadata:\s*`([0-9a-f]{64})`/.exec(prevMd)?.[1] ?? null;
  verifySourceChecksum({ label: "quran-data.js", actual: metaSha, pinned: PINNED_META_SHA256, recorded: prevMetaSha, refresh });
  const metaJs = metaBuf.toString("utf8");
  const metadata = parseQuranData(metaJs);
  verifyMetadata(metadata);

  const sha256 = sha256Hex(buf);
  const prevSha = existsSync(mdPath) ? readChecksumFromSourceMd(readFileSync(mdPath, "utf8")) : null;
  verifySourceChecksum({ label: "quran-uthmani.txt", actual: sha256, pinned: PINNED_TEXT_SHA256, recorded: prevSha, refresh });

  const text = buf.toString("utf8");
  const selected = selectWanted(parseSource(text));
  verifyCounts(selected);

  const allVerses = parseSource(text);
  const surahFiles = buildSurahFiles(allVerses, sha256, metadata);
  const publicDir = join(root, "public", "quran");
  mkdirSync(publicDir, { recursive: true });
  for (const f of surahFiles) writeFileSync(join(publicDir, surahFileName(f.surah)), JSON.stringify(f) + "\n");
  writeFileSync(
    join(dir, "meta.json"),
    JSON.stringify(
      { source: "tanzil-quran-data", sha256: metaSha, textSha256: sha256, ...metadata },
      null,
      0,
    ) + "\n",
  );

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
      metadata: { sha256: metaSha, downloadedOn: metaDownloadedOn, header: extractMetadataHeader(metaJs) },
    }),
  );
  console.log(`OK: ${selected.length} verses (six readings), ${allVerses.length} verses in public/quran, sha256 ${sha256}, metadata sha256 ${metaSha}`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((err) => {
    console.error(String(err instanceof Error ? err.message : err));
    process.exit(1);
  });
}
