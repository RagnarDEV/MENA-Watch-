import { mkdir, writeFile } from 'node:fs/promises';

const OUT = new URL('../data/events.json', import.meta.url);
const REGION_QUERY = '(Iran OR Israel OR Lebanon OR Syria OR Iraq OR Yemen OR Gaza OR Palestine OR Jordan OR Egypt OR Turkey OR "Persian Gulf" OR "Red Sea" OR "Middle East")';
const SECURITY_QUERY = '(military OR missile OR rocket OR airstrike OR attack OR explosion OR drone OR bombing OR "air defense" OR "air defence" OR alert OR warning OR ceasefire OR conflict OR troops OR strike OR security)';
const DOC_URL = 'https://api.gdeltproject.org/api/v2/doc/doc';
const GEO_URL = 'https://api.gdeltproject.org/api/v2/geo/geo';

async function fetchJson(url, label) {
  const response = await fetch(url, { headers: { 'user-agent': 'MENA-Watch/1.0 (public-source research dashboard)' }, signal: AbortSignal.timeout(25000) });
  if (!response.ok) throw new Error(`${label}: HTTP ${response.status}`);
  return response.json();
}
function validUrl(value) { try { const u = new URL(value); return ['https:', 'http:'].includes(u.protocol) ? u.href : null; } catch { return null; } }
function normalizeDate(value) {
  if (!value) return null;
  // GDELT commonly uses YYYYMMDDTHHMMSSZ rather than an ISO date string.
  const raw = String(value);
  const compact = raw.match(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z?$/);
  const parsed = compact ? new Date(`${compact[1]}-${compact[2]}-${compact[3]}T${compact[4]}:${compact[5]}:${compact[6]}Z`) : new Date(raw);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}
function normalizeArticle(a) {
  const url = validUrl(a.url); if (!url || !a.title) return null;
  let domain = a.domain; if (!domain) { try { domain = new URL(url).hostname.replace(/^www\./, ''); } catch {} }
  return { title: String(a.title).slice(0, 500), url, domain: String(domain || '').slice(0, 120), seendate: normalizeDate(a.seendate), language: a.language || 'Unknown', sourcecountry: a.sourcecountry || null, tone: Number.isFinite(Number(a.tone)) ? Number(a.tone) : null, category: 'Public report', sourceCount: 1 };
}
async function main() {
  const now = new Date().toISOString();
  const query = `${REGION_QUERY} AND ${SECURITY_QUERY}`;
  const docParams = new URLSearchParams({ query, mode: 'ArtList', format: 'json', maxrecords: '100', sort: 'HybridRel', timespan: '24h' });
  const geoParams = new URLSearchParams({ query, mode: 'PointData', format: 'GeoJSON', timespan: '24h', maxpoints: '250' });
  let articles = [], geoFeatures = [], errors = [];
  try {
    const data = await fetchJson(`${DOC_URL}?${docParams}`, 'GDELT articles');
    articles = (data.articles || []).map(normalizeArticle).filter(Boolean);
    const seen = new Set(); articles = articles.filter(a => { const k = a.url.toLowerCase(); if (seen.has(k)) return false; seen.add(k); return true; });
  } catch (e) { errors.push(String(e.message || e)); }
  try {
    const geo = await fetchJson(`${GEO_URL}?${geoParams}`, 'GDELT geographic mentions');
    if (geo && geo.type === 'FeatureCollection' && Array.isArray(geo.features)) {
      geoFeatures = geo.features.filter(f => f?.geometry?.type === 'Point' && Array.isArray(f.geometry.coordinates) && f.geometry.coordinates.length >= 2 && f.geometry.coordinates.slice(0, 2).every(Number.isFinite) && Math.abs(f.geometry.coordinates[0]) <= 180 && Math.abs(f.geometry.coordinates[1]) <= 90).slice(0, 250).map(f => ({ type: 'Feature', geometry: { type: 'Point', coordinates: f.geometry.coordinates.slice(0, 2) }, properties: { name: String(f.properties?.name || f.properties?.location || 'Reported geographic mention').slice(0, 180), url: validUrl(f.properties?.url), count: Number.isFinite(Number(f.properties?.count)) ? Number(f.properties.count) : null } }));
    }
  } catch (e) { errors.push(String(e.message || e)); }
  const payload = { schemaVersion: 1, generatedAt: now, provider: 'GDELT Project', status: articles.length || geoFeatures.length ? 'ok' : 'limited', errors, articles, geoFeatures, limitations: ['Aggregated news is not independent verification.', 'Map features are geographic mentions from GDELT, not confirmed incident coordinates.', 'Data freshness depends on source publication and the GitHub Actions schedule.'] };
  await mkdir(new URL('../data/', import.meta.url), { recursive: true });
  await writeFile(OUT, JSON.stringify(payload, null, 2) + '\n');
  console.log(`Wrote ${articles.length} articles and ${geoFeatures.length} geographic mentions. Status=${payload.status}; errors=${errors.length}`);
  // A successful workflow can publish a valid empty/partial dataset; the page shows the limitations explicitly.
}
main().catch(async error => {
  console.error(error);
  const fallback = { schemaVersion: 1, generatedAt: new Date().toISOString(), provider: 'GDELT Project', status: 'limited', errors: [String(error.message || error)], articles: [], geoFeatures: [], limitations: ['Data collection failed; no live data is implied.'] };
  await writeFile(OUT, JSON.stringify(fallback, null, 2) + '\n');
  process.exitCode = 1;
});
