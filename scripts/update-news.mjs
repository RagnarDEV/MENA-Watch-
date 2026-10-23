import { mkdir, writeFile } from 'node:fs/promises';

const OUT = new URL('../data/events.json', import.meta.url);
const DOC_URL = 'https://api.gdeltproject.org/api/v2/doc/doc';
const GEO_URL = 'https://api.gdeltproject.org/api/v2/geo/geo';
const REGION_BBOX = '25,10,65,45'; // Middle East and nearby region: west,south,east,north
const QUERIES = [
  '(Iran OR Israel OR Lebanon OR Syria OR Iraq OR Yemen OR Gaza OR Palestine OR Jordan OR Egypt OR Turkey OR "Red Sea" OR "Persian Gulf") AND (missile OR rocket OR airstrike OR explosion OR drone OR bombing OR attack OR military OR ceasefire OR airspace OR warning)',
  '("Middle East" OR Tehran OR Jerusalem OR Beirut OR Damascus OR Baghdad OR Sanaa OR Gaza) AND (security OR conflict OR strike OR troops OR defense OR defence OR alert OR explosion)'
];
const sourceStatus = {
  gdelt: { enabled: true, status: 'pending', count: 0, note: 'Global news and geographic mentions' },
  acled: { enabled: Boolean(process.env.ACLED_EMAIL && process.env.ACLED_PASSWORD), status: 'not_configured', count: 0, note: 'Requires free myACLED account and API access' },
  nasaFirms: { enabled: Boolean(process.env.NASA_FIRMS_MAP_KEY), status: 'not_configured', count: 0, note: 'Satellite thermal detections; not proof of military activity' },
  reliefWeb: { enabled: Boolean(process.env.RELIEFWEB_APPNAME), status: 'not_configured', count: 0, note: 'Requires approved ReliefWeb appname' },
  openStreetMap: { enabled: true, status: 'ok', count: 0, note: 'Base map/geographic context; not an event feed' }
};

async function fetchResponse(url, label, options = {}) {
  const response = await fetch(url, {
    ...options,
    headers: { 'user-agent': 'MENA-Watch/1.2 (public-source news monitor)', accept: 'application/json,text/csv,*/*', ...(options.headers || {}) },
    signal: AbortSignal.timeout(30000)
  });
  if (!response.ok) throw new Error(`${label}: HTTP ${response.status}`);
  return response;
}
async function fetchJson(url, label, options) {
  const response = await fetchResponse(url, label, options);
  const body = await response.text();
  try { return JSON.parse(body); } catch { throw new Error(`${label}: invalid JSON (${body.slice(0, 120)})`); }
}
function validUrl(value) {
  try { const u = new URL(value); return ['https:', 'http:'].includes(u.protocol) ? u.href : null; }
  catch { return null; }
}
function safeDate(value) {
  if (!value) return null;
  // GDELT commonly emits YYYYMMDDTHHmmssZ, which is not parsed consistently by browsers/Node.
  const compact = String(value).match(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z?$/);
  const normalized = compact ? `${compact[1]}-${compact[2]}-${compact[3]}T${compact[4]}:${compact[5]}:${compact[6]}Z` : value;
  const d = new Date(normalized);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}
function normalizeArticle(a) {
  const url = validUrl(a.url || a.source_url);
  if (!url || !a.title) return null;
  let domain = a.domain;
  if (!domain) { try { domain = new URL(url).hostname.replace(/^www\./, ''); } catch {} }
  return {
    id: String(a.id || url), title: String(a.title).slice(0, 500), url,
    domain: String(domain || '').slice(0, 120), seendate: safeDate(a.seendate || a.publishedAt || a.date),
    language: a.language || 'Unknown', sourcecountry: a.sourcecountry || a.country || null,
    tone: Number.isFinite(Number(a.tone)) ? Number(a.tone) : null,
    category: a.category || 'Public report', sourceCount: Number(a.sourceCount || 1),
    verification: a.verification || 'unverified', provider: a.provider || 'GDELT Project',
    summary: String(a.summary || a.description || '').slice(0, 1200),
    latitude: Number.isFinite(Number(a.latitude)) ? Number(a.latitude) : null,
    longitude: Number.isFinite(Number(a.longitude)) ? Number(a.longitude) : null
  };
}
function validFeature(f) {
  const c = f?.geometry?.coordinates;
  return f?.geometry?.type === 'Point' && Array.isArray(c) && c.length >= 2 &&
    Number.isFinite(Number(c[0])) && Number.isFinite(Number(c[1])) && Math.abs(Number(c[0])) <= 180 && Math.abs(Number(c[1])) <= 90;
}
function csvRows(text) {
  const lines = text.trim().split(/\r?\n/);
  if (lines.length < 2) return [];
  const parseLine = line => {
    const out = []; let value = ''; let quoted = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (ch === '"' && line[i + 1] === '"' && quoted) { value += '"'; i++; }
      else if (ch === '"') quoted = !quoted;
      else if (ch === ',' && !quoted) { out.push(value); value = ''; }
      else value += ch;
    }
    out.push(value); return out;
  };
  const headers = parseLine(lines[0]).map(x => x.trim());
  return lines.slice(1).map(line => {
    const vals = parseLine(line); return Object.fromEntries(headers.map((h, i) => [h, vals[i] ?? '']));
  });
}
function addPoint(features, { lat, lon, name, url, provider, category, time, details }) {
  const latitude = Number(lat), longitude = Number(lon);
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude) || Math.abs(latitude) > 90 || Math.abs(longitude) > 180) return;
  features.push({ type: 'Feature', geometry: { type: 'Point', coordinates: [longitude, latitude] }, properties: {
    name: String(name || category || 'Public-source event').slice(0, 180), url: validUrl(url), provider,
    category: category || 'Public report', time: safeDate(time), details: String(details || '').slice(0, 800), verification: provider === 'ACLED' ? 'documented_dataset_event' : provider === 'NASA FIRMS' ? 'satellite_thermal_detection_not_confirmed_incident' : 'unverified_public_report'
  }});
}

async function collectGdelt(articlesByUrl, geoByKey, errors) {
  let articleCount = 0, geoCount = 0;
  for (let i = 0; i < QUERIES.length; i++) {
    const params = new URLSearchParams({ query: QUERIES[i], mode: 'ArtList', format: 'json', maxrecords: '75', sort: 'DateDesc', timespan: '24h' });
    try {
      const data = await fetchJson(`${DOC_URL}?${params}`, `GDELT articles query ${i + 1}`);
      for (const raw of (Array.isArray(data.articles) ? data.articles : [])) {
        const a = normalizeArticle({ ...raw, provider: 'GDELT Project' });
        if (a && !articlesByUrl.has(a.url.toLowerCase())) { articlesByUrl.set(a.url.toLowerCase(), a); articleCount++; }
      }
    } catch (e) { errors.push(String(e.message || e)); }
  }
  const geoQuery = '(Iran OR Israel OR Lebanon OR Syria OR Iraq OR Yemen OR Gaza OR Palestine OR Jordan OR Egypt OR Turkey OR "Red Sea" OR "Persian Gulf") AND (missile OR rocket OR airstrike OR explosion OR drone OR attack OR military OR conflict)';
  try {
    const params = new URLSearchParams({ query: geoQuery, mode: 'PointData', format: 'GeoJSON', timespan: '24h', maxpoints: '250' });
    const geo = await fetchJson(`${GEO_URL}?${params}`, 'GDELT geographic mentions');
    if (geo?.type === 'FeatureCollection' && Array.isArray(geo.features)) {
      for (const f of geo.features.filter(validFeature).slice(0, 250)) {
        const coords = f.geometry.coordinates.slice(0, 2).map(Number), p = f.properties || {};
        const name = String(p.name || p.location || p.label || 'Reported geographic mention').slice(0, 180);
        const url = validUrl(p.url); const key = `${coords[0].toFixed(4)},${coords[1].toFixed(4)}|${name.toLowerCase()}`;
        if (!geoByKey.has(key)) geoByKey.set(key, { type: 'Feature', geometry: { type: 'Point', coordinates: coords }, properties: { name, url, count: Number.isFinite(Number(p.count)) ? Number(p.count) : null, verification: 'geographic_mention_only', provider: 'GDELT Project', category: 'News location mention' } });
      }
    }
    geoCount = geoByKey.size;
  } catch (e) { errors.push(String(e.message || e)); }
  sourceStatus.gdelt.status = articleCount || geoCount ? 'ok' : 'empty';
  sourceStatus.gdelt.count = articleCount + geoCount;
}

async function collectAcled(articlesByUrl, features, errors) {
  const email = process.env.ACLED_EMAIL, password = process.env.ACLED_PASSWORD;
  if (!email || !password) return;
  try {
    const body = new URLSearchParams({ username: email, password, grant_type: 'password', client_id: 'acled', scope: 'authenticated' });
    const auth = await fetchJson('https://acleddata.com/oauth/token', 'ACLED authentication', { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body });
    if (!auth.access_token) throw new Error('ACLED authentication returned no access token');
    const params = new URLSearchParams({ '_format': 'json', limit: '500', region: 'Middle East', fields: 'event_id_cnty|event_date|event_type|sub_event_type|country|admin1|location|latitude|longitude|source|notes|fatalities|timestamp', _sort: 'event_date', _order: 'desc' });
    const data = await fetchJson(`https://acleddata.com/api/acled/read?${params}`, 'ACLED events', { headers: { authorization: `Bearer ${auth.access_token}` } });
    const rows = Array.isArray(data.data) ? data.data : [];
    for (const e of rows) {
      const title = `${e.event_type || 'Conflict event'}${e.location ? ` — ${e.location}` : ''}${e.country ? `, ${e.country}` : ''}`;
      const url = `https://acleddata.com/`;
      const a = normalizeArticle({ id: `acled-${e.event_id_cnty || `${e.event_date}-${e.location}`}`, title, url, domain: 'acleddata.com', date: e.event_date, country: e.country, category: e.event_type || 'Conflict event', provider: 'ACLED', summary: `${e.notes || ''}${e.fatalities != null ? ` Reported fatalities: ${e.fatalities}.` : ''} Source: ${e.source || 'ACLED dataset'}`, latitude: e.latitude, longitude: e.longitude, verification: 'documented_dataset_event' });
      if (a) articlesByUrl.set(`acled:${a.id}`, a);
      addPoint(features, { lat: e.latitude, lon: e.longitude, name: title, url, provider: 'ACLED', category: e.event_type, time: e.event_date, details: `${e.notes || ''}${e.fatalities != null ? ` Reported fatalities: ${e.fatalities}.` : ''}` });
    }
    sourceStatus.acled.status = 'ok'; sourceStatus.acled.count = rows.length;
  } catch (e) { sourceStatus.acled.status = 'error'; errors.push(String(e.message || e)); }
}

async function collectNasa(features, errors) {
  const key = process.env.NASA_FIRMS_MAP_KEY;
  if (!key) return;
  try {
    const url = `https://firms.modaps.eosdis.nasa.gov/api/area/csv/${encodeURIComponent(key)}/VIIRS_SNPP_NRT/${REGION_BBOX}/2`;
    const response = await fetchResponse(url, 'NASA FIRMS');
    const rows = csvRows(await response.text());
    for (const r of rows.slice(0, 1000)) {
      const time = r.acq_date && r.acq_time ? `${r.acq_date}T${String(r.acq_time).padStart(4, '0').slice(0, 2)}:${String(r.acq_time).padStart(4, '0').slice(2, 4)}:00Z` : r.acq_date;
      addPoint(features, { lat: r.latitude, lon: r.longitude, name: `NASA thermal detection (${r.confidence || 'confidence unknown'})`, provider: 'NASA FIRMS', category: 'Satellite thermal detection', time, details: `Satellite: ${r.satellite || 'unknown'}; confidence: ${r.confidence || 'unknown'}; fire radiative power: ${r.frp || 'unknown'}. A thermal anomaly does not establish a military event.` });
    }
    sourceStatus.nasaFirms.status = 'ok'; sourceStatus.nasaFirms.count = rows.length;
  } catch (e) { sourceStatus.nasaFirms.status = 'error'; errors.push(String(e.message || e)); }
}

async function collectReliefWeb(articlesByUrl, errors) {
  const appname = process.env.RELIEFWEB_APPNAME;
  if (!appname) return;
  try {
    const url = `https://api.reliefweb.int/v2/reports?appname=${encodeURIComponent(appname)}`;
    const data = await fetchJson(url, 'ReliefWeb reports', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ limit: 50, profile: 'list', sort: ['date:created:desc'], query: { value: 'Middle East OR Iraq OR Iran OR Israel OR Lebanon OR Syria OR Yemen OR Palestine' } }) });
    const rows = Array.isArray(data.data) ? data.data : [];
    for (const item of rows) {
      const f = item.fields || {}, url = validUrl(f.url); if (!url) continue;
      const a = normalizeArticle({ id: `reliefweb-${item.id}`, title: f.title || 'ReliefWeb report', url, domain: 'reliefweb.int', date: f.date?.created, country: (f.country || []).map(x => x.name).join(', '), category: 'Humanitarian situation report', provider: 'ReliefWeb', summary: f.body || '' });
      if (a) articlesByUrl.set(a.url.toLowerCase(), a);
    }
    sourceStatus.reliefWeb.status = 'ok'; sourceStatus.reliefWeb.count = rows.length;
  } catch (e) { sourceStatus.reliefWeb.status = 'error'; errors.push(String(e.message || e)); }
}

async function main() {
  const now = new Date().toISOString();
  const articlesByUrl = new Map(), geoByKey = new Map(), features = [], errors = [];
  await Promise.allSettled([
    collectGdelt(articlesByUrl, geoByKey, errors),
    collectAcled(articlesByUrl, features, errors),
    collectNasa(features, errors),
    collectReliefWeb(articlesByUrl, errors)
  ]);
  const articles = [...articlesByUrl.values()].sort((a, b) => Date.parse(b.seendate || 0) - Date.parse(a.seendate || 0)).slice(0, 300);
  const allFeatures = [...geoByKey.values(), ...features].filter(validFeature);
  const configured = Object.values(sourceStatus).filter(s => s.enabled).length;
  const active = Object.values(sourceStatus).filter(s => s.status === 'ok').length;
  const status = articles.length || allFeatures.length ? (active >= configured ? 'ok' : 'partial') : 'limited';
  const payload = {
    schemaVersion: 3, generatedAt: now, provider: 'MENA Watch multi-source collector', status,
    sourceStatus, errors, articles, geoFeatures: allFeatures.slice(0, 1500),
    limitations: [
      'GDELT aggregates public news and extracts geographic mentions; it does not independently verify claims.',
      'ACLED requires account credentials and API access approved by ACLED; events are dataset records and may be delayed.',
      'NASA FIRMS points are satellite thermal detections, not proof of explosions or military activity.',
      'ReliefWeb requires a pre-approved appname and provides humanitarian reports, not tactical intelligence.',
      'OpenStreetMap provides geographic map data only; the current dark tile style is supplied by CARTO.',
      'Source availability, update latency, and licensing terms differ. No source guarantees real-time coverage.'
    ]
  };
  await mkdir(new URL('../data/', import.meta.url), { recursive: true });
  await writeFile(OUT, JSON.stringify(payload, null, 2) + '\n');
  console.log(`Wrote ${articles.length} articles and ${allFeatures.length} map features. Status=${status}; active sources=${active}/${configured}; errors=${errors.length}`);
  // Keep the workflow successful if optional providers are unavailable; never insert fabricated records.
  if (!articles.length && !allFeatures.length) console.warn('No live records were returned. Empty data is retained; no sample events were inserted.');
}
main().catch(async error => {
  console.error(error);
  const fallback = { schemaVersion: 3, generatedAt: new Date().toISOString(), provider: 'MENA Watch multi-source collector', status: 'limited', sourceStatus, errors: [String(error.message || error)], articles: [], geoFeatures: [], limitations: ['Data collection failed. No fabricated or fallback news is included.'] };
  await writeFile(OUT, JSON.stringify(fallback, null, 2) + '\n');
  process.exitCode = 1;
});
