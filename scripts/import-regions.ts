/**
 * Saves a snapshot of EQuran.id provinces and regencies/cities.
 * Run: pnpm import:regions
 * Server-side tool only. Sends province names, nothing else.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const BASE = "https://equran.id/api/v2/shalat";
const HEADERS = { "user-agent": "tahajud-tracker-regions/0.1", "content-type": "application/json" };

async function call(path: string, body?: unknown): Promise<string[]> {
  const res = await fetch(`${BASE}${path}`, {
    method: body ? "POST" : "GET",
    headers: HEADERS,
    ...(body ? { body: JSON.stringify(body) } : {}),
    signal: AbortSignal.timeout(8000),
  });
  if (!res.ok) throw new Error(`EQuran ${path}: HTTP ${res.status}`);
  const json = (await res.json()) as { code?: number; data?: unknown };
  if (json.code !== 200 || !Array.isArray(json.data) || !json.data.every((x) => typeof x === "string")) {
    throw new Error(`EQuran ${path}: unexpected response shape`);
  }
  return json.data as string[];
}

async function main(): Promise<void> {
  const provinces = await call("/provinsi");
  const regions: Record<string, string[]> = {};
  for (const p of provinces) {
    regions[p] = await call("/kabkota", { provinsi: p });
    await new Promise((r) => setTimeout(r, 150));
  }
  const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
  const out = join(root, "content", "regions", "equran-regions.json");
  mkdirSync(dirname(out), { recursive: true });
  const total = Object.values(regions).reduce((n, l) => n + l.length, 0);
  writeFileSync(
    out,
    JSON.stringify(
      {
        source: "https://equran.id/api/v2/shalat",
        attribution: "Bimas Islam Kemenag RI via EQuran.id",
        fetched_at: new Date().toISOString(),
        limitation:
          "API memuat 34 provinsi. Provinsi pemekaran Papua 2022 tidak ada. User di wilayah itu memilih kab/kota terdekat dalam daftar atau jadwal manual.",
        provinces,
        regions,
      },
      null,
      2,
    ) + "\n",
  );
  console.log(`OK: ${provinces.length} provinces, ${total} regencies/cities`);
}

main().catch((e) => {
  console.error(String(e instanceof Error ? e.message : e));
  process.exit(1);
});
