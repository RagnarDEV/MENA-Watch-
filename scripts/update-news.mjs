import { mkdir, writeFile } from "node:fs/promises";

const OUT = new URL("../data/events.json", import.meta.url);

const DOC_URL = "https://api.gdeltproject.org/api/v2/doc/doc";
const GEO_URL = "https://api.gdeltproject.org/api/v2/geo/geo";

const REGION =
  '(Iran OR Israel OR Lebanon OR Syria OR Iraq OR Yemen OR Gaza OR Palestine OR Jordan OR Egypt OR Turkey OR "Middle East")';

const SECURITY =
  '(military OR missile OR rocket OR drone OR airstrike OR explosion OR attack OR alert OR warning OR conflict)';

async function fetchJSON(url) {
  const res = await fetch(url, {
    signal: AbortSignal.timeout(25000),
    headers: {
      "User-Agent": "MENA-Watch/1.1"
    }
  });

  if (!res.ok) throw new Error(`HTTP ${res.status}`);

  return res.json();
}

function safeURL(url) {
  try {
    return new URL(url).href;
  } catch {
    return null;
  }
}

async function run() {
  const now = new Date().toISOString();

  const payload = {
    schemaVersion: 1,
    generatedAt: now,
    provider: "GDELT",
    status: "limited",
    errors: [],
    articles: [],
    geoFeatures: []
  };

  try {
    const doc = await fetchJSON(
      `${DOC_URL}?query=${encodeURIComponent(
        REGION + " AND " + SECURITY
      )}&mode=ArtList&format=json&maxrecords=100&timespan=24h`
    );

    payload.articles =
      (doc.articles || [])
        .filter(a => a.title && safeURL(a.url))
        .map(a => ({
          title: a.title,
          url: safeURL(a.url),
          domain: a.domain || "",
          seendate: a.seendate || null
        }));
  } catch (e) {
    payload.errors.push("Articles: " + e.message);
  }

  try {
    const geo = await fetchJSON(
      `${GEO_URL}?query=${encodeURIComponent(
        REGION + " AND " + SECURITY
      )}&mode=PointData&format=GeoJSON&timespan=24h&maxpoints=250`
    );

    payload.geoFeatures = geo.features || [];
  } catch (e) {
    payload.errors.push("Geo: " + e.message);
  }

  if (payload.articles.length || payload.geoFeatures.length) {
    payload.status = "ok";
  }

  await mkdir(new URL("../data/", import.meta.url), { recursive: true });

  await writeFile(OUT, JSON.stringify(payload, null, 2));

  console.log(
    `Articles=${payload.articles.length} Geo=${payload.geoFeatures.length}`
  );
}

run().catch(async err => {
  await mkdir(new URL("../data/", import.meta.url), { recursive: true });

  await writeFile(
    OUT,
    JSON.stringify(
      {
        schemaVersion: 1,
        generatedAt: new Date().toISOString(),
        provider: "GDELT",
        status: "limited",
        errors: [String(err.message || err)],
        articles: [],
        geoFeatures: []
      },
      null,
      2
    )
  );

  console.error(err);

  process.exit(0);
});
