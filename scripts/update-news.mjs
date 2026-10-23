import { mkdir, writeFile } from "node:fs/promises";

const OUT = new URL("../data/events.json", import.meta.url);
const DOC_URL = "https://api.gdeltproject.org/api/v2/doc/doc";
const RSS_URL = "https://news.google.com/rss/search";

// GDELT rate-limits the DOC API. Keep this as one request per run rather than
// firing several broad queries back-to-back and turning a temporary 429 into an
// empty published feed.
export const QUERY =
  '(Iran OR Israel OR Lebanon OR Syria OR Iraq OR Yemen OR Gaza OR Palestine OR Jordan OR Egypt OR Turkey OR "Red Sea" OR "Persian Gulf" OR "Middle East" OR Tehran OR Jerusalem OR Beirut OR Damascus OR Baghdad OR Sanaa) AND (missile OR rocket OR airstrike OR explosion OR drone OR bombing OR attack OR military OR ceasefire OR airspace OR warning OR security OR conflict OR strike OR troops OR defense OR defence OR alert)';

const MAX_ARTICLES = 150;
const MAX_RETRIES = 2;
const RETRY_DELAY_MS = 6500;
const RSS_QUERY = "Middle East (Iran OR Israel OR Lebanon OR Syria OR Iraq OR Yemen OR Gaza) (security OR conflict OR strike OR military OR explosion)";

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

function retryDelay(response, attempt) {
  const retryAfter = Number(response.headers.get("retry-after"));
  if (Number.isFinite(retryAfter) && retryAfter >= 0) {
    return Math.min(30000, Math.max(RETRY_DELAY_MS, retryAfter * 1000));
  }
  return Math.min(30000, RETRY_DELAY_MS * (attempt + 1));
}

export async function fetchJSON(url, label, fetchImpl = fetch) {
  let lastError;

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt += 1) {
    try {
      const response = await fetchImpl(url, {
        headers: {
          "user-agent": "MENA-Watch/1.3 (+https://github.com/RagnarDEV/MENA-Watch-)",
          accept: "application/json"
        },
        signal: AbortSignal.timeout(25000)
      });
      const body = await response.text();

      if (!response.ok) {
        const error = new Error(`${label}: HTTP ${response.status}: ${body.slice(0, 180)}`);
        error.status = response.status;
        if ((response.status === 429 || response.status >= 500) && attempt < MAX_RETRIES) {
          await sleep(retryDelay(response, attempt));
          lastError = error;
          continue;
        }
        throw error;
      }

      try {
        return JSON.parse(body);
      } catch {
        throw new Error(`${label}: response was not JSON: ${body.slice(0, 180)}`);
      }
    } catch (error) {
      lastError = error;
      if (error?.name === "AbortError" && attempt < MAX_RETRIES) {
        await sleep(RETRY_DELAY_MS * (attempt + 1));
        continue;
      }
      if (error?.status && error.status !== 429 && error.status < 500) throw error;
      if (attempt < MAX_RETRIES && !error?.status) {
        await sleep(RETRY_DELAY_MS * (attempt + 1));
        continue;
      }
    }
  }

  throw lastError || new Error(`${label}: request failed`);
}

async function fetchText(url, label, fetchImpl = fetch) {
  const response = await fetchImpl(url, {
    headers: {
      "user-agent": "MENA-Watch/1.3 (+https://github.com/RagnarDEV/MENA-Watch-)",
      accept: "application/rss+xml, application/xml, text/xml"
    },
    signal: AbortSignal.timeout(25000)
  });
  const body = await response.text();
  if (!response.ok) {
    throw new Error(`${label}: HTTP ${response.status}: ${body.slice(0, 180)}`);
  }
  return body;
}

function decodeXML(value) {
  return String(value || "")
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .trim();
}

function xmlTag(block, name) {
  const match = block.match(new RegExp(`<${name}[^>]*>([\\s\\S]*?)<\\/${name}>`, "i"));
  return decodeXML(match?.[1]);
}

export function parseRSS(xml) {
  const articles = [];
  for (const item of xml.match(/<item[\s\S]*?<\/item>/gi) || []) {
    const url = validURL(xmlTag(item, "link"));
    const title = xmlTag(item, "title");
    if (!url || !title) continue;
    const sourceMatch = item.match(/<source\b[^>]*>([\s\S]*?)<\/source>/i);
    const source = decodeXML(sourceMatch?.[1]);
    let domain = "";
    try {
      domain = new URL(url).hostname.replace(/^www\\./, "");
    } catch {}
    articles.push({
      title,
      url,
      domain: source || domain,
      seendate: xmlTag(item, "pubDate") || null,
      language: "English",
      sourcecountry: null,
      tone: null
    });
  }
  return articles;
}

function validURL(value) {
  try {
    const url = new URL(value);
    return ["https:", "http:"].includes(url.protocol) ? url.href : null;
  } catch {
    return null;
  }
}

export function normalizeArticle(raw) {
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
    tone: Number.isFinite(Number(raw.tone)) ? Number(raw.tone) : null,
    category: "Public report",
    sourceCount: 1,
    verification: "unverified",
    provider: "GDELT Project"
  };
}

async function saveData(data) {
  await mkdir(new URL("../data/", import.meta.url), { recursive: true });
  await writeFile(OUT, JSON.stringify(data, null, 2) + "\n");
}

function buildDocURL() {
  const params = new URLSearchParams({
    query: QUERY,
    mode: "ArtList",
    format: "json",
    maxrecords: String(MAX_ARTICLES),
    sort: "DateDesc",
    timespan: "24h"
  });
  return `${DOC_URL}?${params}`;
}

function buildRSSURL() {
  return `${RSS_URL}?${new URLSearchParams({
    q: RSS_QUERY,
    hl: "en-US",
    gl: "US",
    ceid: "US:en"
  })}`;
}

async function collectRSS({ fetchImpl, now }) {
  const xml = await fetchText(buildRSSURL(), "Google News RSS", fetchImpl);
  const articles = new Map();
  for (const raw of parseRSS(xml)) {
    const article = normalizeArticle(raw);
    if (article && !articles.has(article.url.toLowerCase())) {
      articles.set(article.url.toLowerCase(), article);
    }
  }
  const articleList = [...articles.values()]
    .sort((a, b) => (Date.parse(b.seendate || "") || 0) - (Date.parse(a.seendate || "") || 0))
    .slice(0, MAX_ARTICLES);
  if (!articleList.length) {
    throw new Error("Google News RSS: the source returned no usable articles");
  }
  return {
    schemaVersion: 3,
    generatedAt: now.toISOString(),
    provider: "Google News RSS (fallback)",
    status: "ok",
    sourceQueries: 1,
    errors: [],
    articles: articleList,
    geoFeatures: [],
    geoStatus: "unavailable",
    limitations: [
      "Google News RSS is used as a fallback when GDELT is rate-limited or unavailable.",
      "RSS results are public reports and are not independently verified.",
      "The GDELT GEO 2.0 endpoint is currently unavailable; map mentions are disabled.",
      "Check the original source before sharing a claim.",
      "GitHub Actions scheduling is not real-time."
    ]
  };
}

export async function collect({ fetchImpl = fetch, now = new Date() } = {}) {
  let result;
  try {
    result = await fetchJSON(buildDocURL(), "GDELT articles", fetchImpl);
  } catch (gdeltError) {
    // GitHub-hosted runners often share an egress IP and GDELT may return 429
    // indefinitely. Fall back to a public RSS search instead of publishing an
    // empty dataset or failing the entire update job.
    try {
      return await collectRSS({ fetchImpl, now });
    } catch (rssError) {
      throw new Error(`GDELT failed (${gdeltError.message}); RSS fallback failed (${rssError.message})`);
    }
  }
  const articles = new Map();

  for (const raw of Array.isArray(result.articles) ? result.articles : []) {
    const article = normalizeArticle(raw);
    if (article && !articles.has(article.url.toLowerCase())) {
      articles.set(article.url.toLowerCase(), article);
    }
  }

  const articleList = [...articles.values()]
    .sort((a, b) => (Date.parse(b.seendate || "") || 0) - (Date.parse(a.seendate || "") || 0))
    .slice(0, MAX_ARTICLES);

  if (!articleList.length) {
    throw new Error("GDELT articles: the source returned no usable articles");
  }

  return {
    schemaVersion: 3,
    generatedAt: now.toISOString(),
    provider: "GDELT Project",
    status: "ok",
    sourceQueries: 1,
    errors: [],
    articles: articleList,
    // The legacy GEO 2.0 endpoint currently responds with 404. Do not call it
    // on every workflow run or let its outage hide otherwise valid articles.
    geoFeatures: [],
    geoStatus: "unavailable",
    limitations: [
      "GDELT aggregates public reports and does not independently verify claims.",
      "The GDELT GEO 2.0 endpoint is currently unavailable; map mentions are disabled until a supported replacement is configured.",
      "Check the original source before sharing a claim.",
      "GitHub Actions scheduling is not real-time."
    ]
  };
}

export async function main() {
  const data = await collect();
  await saveData(data);
  console.log(`Update time: ${data.generatedAt}`);
  console.log(`Articles: ${data.articles.length}`);
  console.log("Geographic mentions: 0 (GEO API unavailable)");
  console.log(`Status: ${data.status}`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch(error => {
    console.error("Collector failed:", error?.message || error);
    // Do not overwrite a previously good feed with an empty file. A failed
    // workflow is safer and makes the last successful dataset remain visible.
    process.exitCode = 1;
  });
}
