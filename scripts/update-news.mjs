import { mkdir, writeFile } from 'node:fs/promises';

const OUT = new URL('../data/events.json', import.meta.url);
const DOC_URL = 'https://api.gdeltproject.org/api/v2/doc/doc';
const GEO_URL = 'https://api.gdeltproject.org/api/v2/geo/geo';
// Keep queries broad enough to retrieve real reports, but limited to the requested region and topic.
const QUERIES = [
  '(Iran OR Israel OR Lebanon OR Syria OR Iraq OR Yemen OR Gaza OR Palestine OR Jordan OR Egypt OR Turkey OR "Red Sea" OR "Persian Gulf") AND (missile OR rocket OR airstrike OR explosion OR drone OR bombing OR attack OR military OR ceasefire OR airspace OR warning)',
  '("Middle East" OR Tehran OR Jerusalem OR Beirut OR Damascus OR Baghdad OR Sanaa OR Gaza) AND (security OR conflict OR strike OR troops OR defense OR defence OR alert OR explosion)'
];

async function fetchJson(url, label) {
  const response = await fetch(url, {
    headers: { 'user-agent': 'MENA-Watch/1.1 (public-source news monitor)', accept: 'application/json' },
    signal: AbortSignal.timeout(25000)
  });
  if (!response.ok) throw new Error(`${label}: HTTP ${response.status}`);
  const text = await response.text();
  try { return JSON.parse(text); }
  catch { throw new Error(`${label}: response was not valid JSON (${text.slice(0, 100)})`); }
}
function validUrl(value) {
  try { const u = new URL(value); return ['https:', 'http:'].includes(u.protocol) ? u.href : null; }
  catch { return null; }
}
function normalizeArticle(a) {
  const url = validUrl(a.url);
  if (!url || !a.title) return null;
  let domain = a.domain;
  if (!domain) { try { domain = new URL(url).hostname.replace(/^www\./, ''); } catch {} }
  return {
    title: String(a.title).slice(0, 500), url,
    domain: String(domain || '').slice(0, 120),
    seendate: a.seendate || null,
    language: a.language || 'Unknown',
    sourcecountry: a.sourcecountry || null,
    tone: Number.isFinite(Number(a.tone)) ? Number(a.tone) : null,
    category: 'Public report', sourceCount: 1,
    verification: 'unverified', provider: 'GDELT Project'
  };
}
function validFeature(f) {
  const c = f?.geometry?.coordinates;
  return f?.geometry?.type === 'Point' && Array.isArray(c) && c.length >= 2 &&
    Number.isFinite(c[0]) && Number.isFinite(c[1]) && Math.abs(c[0]) <= 180 && Math.abs(c[1]) <= 90;
}
async function main() {
  const now = new Date().toISOString();
  const articlesByUrl = new Map();
  const geoByKey = new Map();
  const errors = [];
  // Run two independent query variants: one failing query does not erase successful results from the other.
  for (let i = 0; i < QUERIES.length; i++) {
    const query = QUERIES[i];
    const params = new URLSearchParams({ query, mode: 'ArtList', format: 'json', maxrecords: '75', sort: 'DateDesc', timespan: '24h' });
    try {
      const data = await fetchJson(`${DOC_URL}?${params}`, `GDELT articles query ${i + 1}`);
      for (const raw of (Array.isArray(data.articles) ? data.articles : [])) {
        const a = normalizeArticle(raw);
        if (a && !articlesByUrl.has(a.url.toLowerCase())) articlesByUrl.set(a.url.toLowerCase(), a);
      }
    } catch (e) { errors.push(String(e.message || e)); }
  }
  // Geo endpoint returns mentions extracted from coverage; these are NOT verified incident locations.
  const geoQuery = '(Iran OR Israel OR Lebanon OR Syria OR Iraq OR Yemen OR Gaza OR Palestine OR Jordan OR Egypt OR Turkey OR "Red Sea" OR "Persian Gulf") AND (missile OR rocket OR airstrike OR explosion OR drone OR attack OR military OR conflict)';
  const geoParams = new URLSearchParams({ query: geoQuery, mode: 'PointData', format: 'GeoJSON', timespan: '24h', maxpoints: '250' });
  try {
    const geo = await fetchJson(`${GEO_URL}?${geoParams}`, 'GDELT geographic mentions');
    if (geo?.type === 'FeatureCollection' && Array.isArray(geo.features)) {
      for (const f of geo.features.filter(validFeature).slice(0, 250)) {
        const coords = f.geometry.coordinates.slice(0, 2).map(Number);
        const props = f.properties || {};
        const name = String(props.name || props.location || props.label || 'Reported geographic mention').slice(0, 180);
        const url = validUrl(props.url);
        const key = `${coords[0].toFixed(4)},${coords[1].toFixed(4)}|${name.toLowerCase()}`;
        if (!geoByKey.has(key)) geoByKey.set(key, {
          type: 'Feature', geometry: { type: 'Point', coordinates: coords },
          properties: { name, url, count: Number.isFinite(Number(props.count)) ? Number(props.count) : null, verification: 'geographic_mention_only', provider: 'GDELT Project' }
        });
      }
    } else errors.push('GDELT geographic endpoint returned no GeoJSON FeatureCollection.');
  } catch (e) { errors.push(String(e.message || e)); }

  const articles = [...articlesByUrl.values()].sort((a, b) => Date.parse(b.seendate || 0) - Date.parse(a.seendate || 0)).slice(0, 150);
  const geoFeatures = [...geoByKey.values()].slice(0, 250);
  const successCount = (articles.length ? 1 : 0) + (geoFeatures.length ? 1 : 0);
  const payload = {
    schemaVersion: 2, generatedAt: now, provider: 'GDELT Project',
    status: successCount === 2 ? 'ok' : successCount === 1 ? 'partial' : 'limited',
    sourceQueries: QUERIES.length, errors, articles, geoFeatures,
    limitations: [
      'GDELT aggregates public news coverage; it does not independently verify claims.',
      'Map points are geographic mentions extracted from reports, not confirmed incident coordinates.',
      'The article source link and publication/seen time should be checked before sharing.',
      'GitHub Actions scheduling is best-effort and is not a real-time alerting guarantee.'
    ]
  };
  await mkdir(new URL('../data/', import.meta.url), { recursive: true });
  await writeFile(OUT, JSON.stringify(payload, null, 2) + '\n');
  console.log(`Wrote ${articles.length} real article records and ${geoFeatures.length} geographic mentions. Status=${payload.status}; errors=${errors.length}`);
  if (!successCount) {
    console.error('No live data returned by GDELT queries. The dataset is marked limited; no sample events were inserted.');
    process.exitCode = 1;
  }
}
main().catch(async error => {
  console.error(error);
  const fallback = {
    schemaVersion: 2, generatedAt: new Date().toISOString(), provider: 'GDELT Project', status: 'limited',
    errors: [String(error.message || error)], articles: [], geoFeatures: [],
    limitations: ['Data collection failed. This file contains no fabricated or fallback news.']
  };
  await writeFile(OUT, JSON.stringify(fallback, null, 2) + '\n');
  process.exitCode = 1;
});
