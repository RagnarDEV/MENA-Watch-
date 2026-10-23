
import { mkdir, writeFile } from "node:fs/promises";

const OUT = new URL("../data/events.json", import.meta.url);
const DOC_URL = "https://api.gdeltproject.org/api/v2/doc/doc";
const GEO_URL = "https://api.gdeltproject.org/api/v2/geo/geo";

const QUERIES = [
  '(Iran OR Israel OR Lebanon OR Syria OR Iraq OR Yemen OR Gaza OR Palestine OR Jordan OR Egypt OR Turkey OR "Red Sea" OR "Persian Gulf") AND (missile OR rocket OR airstrike OR explosion OR drone OR bombing OR attack OR military OR ceasefire OR airspace OR warning)',
  '("Middle East" OR Tehran OR Jerusalem OR Beirut OR Damascus OR Baghdad OR Sanaa OR Gaza) AND (security OR conflict OR strike OR troops OR defense OR defence OR alert OR explosion)'
];

async function fetchJSON(url, label) {
  const response = await fetch(url, {
    headers: {
      "user-agent": "MENA-Watch/1.2",
      accept: "application/json"
    },
    signal: AbortSignal.timeout(25000)
  });

  const body = await response.text();

  if (!response.ok) {
    throw new Error(`${label}: HTTP ${response.status}: ${body.slice(0, 180)}`);
  }

  try {
    return JSON.parse(body);
  } catch {
    throw new Error(`${label}: response was not JSON: ${body.slice(0, 180)}`);
  }
}

function validURL(value) {
  try {
    const url = new URL(value);
    return ["https:", "http:"].includes(url.protocol)
      ? url.href
      : null;
  } catch {
    return null;
  }
}

function normalizeArticle(raw) {
  const url = validURL(raw?.url);
  if (!url || !raw?.title) return null;

  let domain = raw.domain || "";

  if (!domain) {
    try {
      domain = new URL(url).hostname.replace(/^www\./, "");
    } catch {}
  }

  return {
    title: String(raw.title).slice(0, 500),
    url,
    domain: String(domain).slice(0, 120),
    seendate: raw.seendate || null,
    language: raw.language || "Unknown",
    sourcecountry: raw.sourcecountry || null,
    tone: Number.isFinite(Number(raw.tone))
      ? Number(raw.tone)
      : null,
    category: "Public report",
    sourceCount: 1,
    verification: "unverified",
    provider: "GDELT Project"
  };
}

function validFeature(feature) {
  const coordinates = feature?.geometry?.coordinates;

  return (
    feature?.geometry?.type === "Point" &&
    Array.isArray(coordinates) &&
    coordinates.length >= 2 &&
    Number.isFinite(Number(coordinates[0])) &&
    Number.isFinite(Number(coordinates[1])) &&
    Math.abs(Number(coordinates[0])) <= 180 &&
    Math.abs(Number(coordinates[1])) <= 90
  );
}

async function saveData(data) {
  await mkdir(new URL("../data/", import.meta.url), {
    recursive: true
  });

  await writeFile(
    OUT,
    JSON.stringify(data, null, 2) + "\n"
  );
}

async function main() {
  const generatedAt = new Date().toISOString();
  const articles = new Map();
  const geoFeatures = new Map();
  const errors = [];

  // جلب الأخبار من استعلامين مستقلين
  for (let i = 0; i < QUERIES.length; i++) {
    const params = new URLSearchParams({
      query: QUERIES[i],
      mode: "ArtList",
      format: "json",
      maxrecords: "75",
      sort: "DateDesc",
      timespan: "24h"
    });

    try {
      const result = await fetchJSON(
        `${DOC_URL}?${params}`,
        `GDELT articles query ${i + 1}`
      );

      for (const raw of Array.isArray(result.articles)
        ? result.articles
        : []) {
        const article = normalizeArticle(raw);

        if (article && !articles.has(article.url.toLowerCase())) {
          articles.set(article.url.toLowerCase(), article);
        }
      }
    } catch (error) {
      errors.push(String(error.message || error));
    }
  }

  // بيانات الخريطة: إشارات جغرافية من التقارير وليست إثباتًا لموقع حادث
  const geoQuery =
    '(Iran OR Israel OR Lebanon OR Syria OR Iraq OR Yemen OR Gaza OR Palestine OR Jordan OR Egypt OR Turkey OR "Red Sea" OR "Persian Gulf") AND (missile OR rocket OR airstrike OR explosion OR drone OR attack OR military OR conflict)';

  const geoParams = new URLSearchParams({
    query: geoQuery,
    mode: "PointData",
    format: "GeoJSON",
    timespan: "24h",
    maxpoints: "250"
  });

  try {
    const result = await fetchJSON(
      `${GEO_URL}?${geoParams}`,
      "GDELT geographic mentions"
    );

    if (
      result?.type !== "FeatureCollection" ||
      !Array.isArray(result.features)
    ) {
      throw new Error("GDELT did not return a GeoJSON FeatureCollection");
    }

    for (const feature of result.features.filter(validFeature).slice(0, 250)) {
      const coordinates = feature.geometry.coordinates
        .slice(0, 2)
        .map(Number);

      const properties = feature.properties || {};
      const name = String(
        properties.name ||
        properties.location ||
        properties.label ||
        "Geographic mention"
      ).slice(0, 180);

      const key =
        `${coordinates[0].toFixed(4)},` +
        `${coordinates[1].toFixed(4)}|${name.toLowerCase()}`;

      if (!geoFeatures.has(key)) {
        geoFeatures.set(key, {
          type: "Feature",
          geometry: {
            type: "Point",
            coordinates
          },
          properties: {
            name,
            url: validURL(properties.url),
            count: Number.isFinite(Number(properties.count))
              ? Number(properties.count)
              : null,
            verification: "geographic_mention_only",
            provider: "GDELT Project"
          }
        });
      }
    }
  } catch (error) {
    errors.push(String(error.message || error));
  }

  const articleList = [...articles.values()]
    .sort((a, b) => {
      const dateA = Date.parse(a.seendate || "") || 0;
      const dateB = Date.parse(b.seendate || "") || 0;
      return dateB - dateA;
    })
    .slice(0, 150);

  const geoList = [...geoFeatures.values()].slice(0, 250);

  const hasArticles = articleList.length > 0;
  const hasGeo = geoList.length > 0;

  const status =
    hasArticles && hasGeo
      ? "ok"
      : hasArticles || hasGeo
        ? "partial"
        : "limited";

  await saveData({
    schemaVersion: 2,
    generatedAt,
    provider: "GDELT Project",
    status,
    sourceQueries: QUERIES.length,
    errors,
    articles: articleList,
    geoFeatures: geoList,
    limitations: [
      "GDELT aggregates public reports and does not independently verify claims.",
      "Map points are geographic mentions, not confirmed incident coordinates.",
      "Check the original source before sharing a claim.",
      "GitHub Actions scheduling is not real-time."
    ]
  });

  console.log(`Update time: ${generatedAt}`);
  console.log(`Articles: ${articleList.length}`);
  console.log(`Geographic mentions: ${geoList.length}`);
  console.log(`Status: ${status}`);

  for (const error of errors) {
    console.error(`SOURCE ERROR: ${error}`);
  }

  // أخطاء مزوّد الأخبار تُسجّل في الملف ولا تتسبب وحدها بفشل المهمة
}

main().catch(async error => {
  const message = String(error?.message || error);

  console.error("Collector failed:", message);

  await saveData({
    schemaVersion: 2,
    generatedAt: new Date().toISOString(),
    provider: "GDELT Project",
    status: "limited",
    errors: [message],
    articles: [],
    geoFeatures: [],
    limitations: [
      "Collection failed. No fabricated or placeholder news was inserted."
    ]
  });
});
