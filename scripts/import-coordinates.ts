/**
 * Fetches regency/city coordinates from Wikidata (CC0) and matches them to the EQuran region list.
 * Run: NODE_USE_ENV_PROXY=1 NODE_EXTRA_CA_CERTS=/root/.ccr/ca-bundle.crt pnpm import:coordinates
 * Server-side tool only. Sends a fixed SPARQL query, no user data.
 * Writes content/regions/wikidata-coordinates.json (raw) and content/regions/crosscheck-coordinates.json (matched).
 */
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  MANUAL_QID_OVERRIDES,
  buildCrosscheck,
  matchRegions,
  parseSparqlBindings,
} from "../src/server/prayer/coordinates";

const ENDPOINT = "https://query.wikidata.org/sparql";
const UA = "tahajud-tracker-coordinates/0.1 (one-off import; CC0 data)";

const MAIN_QUERY = `SELECT ?item ?itemLabel ?type ?coord ?kode ?bps ?provLabel WHERE {
  VALUES ?type { wd:Q3191695 wd:Q3199141 }
  ?item wdt:P31 ?type ; wdt:P17 wd:Q252 .
  OPTIONAL { ?item wdt:P625 ?coord }
  OPTIONAL { ?item wdt:P2588 ?kode }
  OPTIONAL { ?item wdt:P1588 ?bps }
  OPTIONAL { ?item wdt:P131+ ?prov . ?prov wdt:P31 wd:Q5098 }
  SERVICE wikibase:label { bd:serviceParam wikibase:language "id,en" . }
}`;

function manualQuery(qids: string[]): string {
  return `SELECT ?item ?itemLabel ?type ?coord ?kode ?bps ?provLabel WHERE {
  VALUES ?item { ${qids.map((q) => `wd:${q}`).join(" ")} }
  BIND(wd:Q3199141 AS ?type)
  OPTIONAL { ?item wdt:P625 ?coord }
  OPTIONAL { ?item wdt:P2588 ?kode }
  OPTIONAL { ?item wdt:P1588 ?bps }
  SERVICE wikibase:label { bd:serviceParam wikibase:language "id,en" . }
}`;
}

async function sparql(query: string): Promise<Record<string, { value: string } | undefined>[]> {
  const res = await fetch(`${ENDPOINT}?format=json&query=${encodeURIComponent(query)}`, {
    headers: { "user-agent": UA, accept: "application/sparql-results+json" },
    signal: AbortSignal.timeout(60_000),
  });
  if (!res.ok) throw new Error(`Wikidata SPARQL: HTTP ${res.status}`);
  const json = (await res.json()) as { results?: { bindings?: unknown } };
  if (!Array.isArray(json.results?.bindings)) throw new Error("Wikidata SPARQL: unexpected response shape");
  return json.results.bindings as Record<string, { value: string }>[];
}

async function main(): Promise<void> {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
  const dir = join(root, "content", "regions");
  const equran = JSON.parse(readFileSync(join(dir, "equran-regions.json"), "utf8")) as {
    regions: Record<string, string[]>;
  };
  const fetchedAt = new Date().toISOString();

  const main = parseSparqlBindings(await sparql(MAIN_QUERY));
  const manualQids = [...new Set(Object.values(MANUAL_QID_OVERRIDES).map((o) => o.qid))];
  const manual = parseSparqlBindings(await sparql(manualQuery(manualQids)));

  writeFileSync(
    join(dir, "wikidata-coordinates.json"),
    JSON.stringify(
      {
        source: "https://www.wikidata.org (SPARQL endpoint https://query.wikidata.org/sparql)",
        license: "CC0 1.0 (Wikidata structured data)",
        fetched_at: fetchedAt,
        query: MAIN_QUERY,
        manual_override_query: manualQuery(manualQids),
        properties: {
          P625: "coordinate location",
          P2588: "administrative code of Indonesia (Kemendagri)",
          P1588: "Statistics Indonesia area code (BPS)",
        },
        counts: { items: main.items.length, skipped: main.skipped.length },
        skipped: main.skipped,
        items: main.items,
        manual_items: manual.items,
      },
      null,
      2,
    ) + "\n",
  );

  const matches = matchRegions(equran.regions, main.items, manual.items);
  writeFileSync(join(dir, "crosscheck-coordinates.json"), JSON.stringify(buildCrosscheck(matches, fetchedAt), null, 2) + "\n");

  const count = (s: string) => matches.filter((m) => m.status === s).length;
  console.log(
    `OK: wikidata items=${main.items.length} skipped=${main.skipped.length} | equran=${matches.length} matched=${count("matched")} ambiguous=${count("ambiguous")} unmatched=${count("unmatched")}`,
  );
}

main().catch((e) => {
  console.error(String(e instanceof Error ? e.message : e));
  process.exit(1);
});
