import assert from "node:assert/strict";
import test from "node:test";
import { collect, fetchJSON, normalizeArticle, parseRSS, QUERY } from "./update-news.mjs";

function response(status, body, headers = {}) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: new Headers(headers),
    async text() { return body; }
  };
}

test("normalizes valid articles and rejects unsafe URLs", () => {
  assert.equal(normalizeArticle({ title: "A", url: "https://example.com/a" }).domain, "example.com");
  assert.equal(normalizeArticle({ title: "A", url: "javascript:alert(1)" }), null);
  assert.equal(normalizeArticle({ url: "https://example.com/a" }), null);
});

test("retries a rate-limited GDELT response and returns JSON", async () => {
  let calls = 0;
  const data = await fetchJSON("https://example.test", "test", async () => {
    calls += 1;
    if (calls === 1) return response(429, "slow down", { "retry-after": "0" });
    return response(200, JSON.stringify({ ok: true }));
  });
  assert.deepEqual(data, { ok: true });
  assert.equal(calls, 2);
});

test("parses RSS fallback items and safely decodes XML", () => {
  const articles = parseRSS(`<?xml version="1.0"?><rss><channel>
    <item><title><![CDATA[Security &amp; regional update]]></title>
      <link>https://news.google.com/rss/articles/example</link>
      <pubDate>Sat, 24 Oct 2026 00:00:00 GMT</pubDate>
      <source url="https://example.com">Example News</source>
    </item>
    <item><title>No link</title></item>
  </channel></rss>`);
  assert.equal(articles.length, 1);
  assert.equal(articles[0].title, "Security & regional update");
  assert.equal(articles[0].domain, "Example News");
});

test("collects a non-empty feed from one bounded query", async () => {
  let requestedUrl = "";
  const data = await collect({
    fetchImpl: async url => {
      requestedUrl = String(url);
      return response(200, JSON.stringify({
        articles: [
          { title: "Second", url: "https://example.com/2", seendate: "2026-10-24T00:00:00Z", language: "English" },
          { title: "First", url: "https://example.com/1", seendate: "2026-10-23T00:00:00Z", language: "Arabic" },
          { title: "Duplicate", url: "https://example.com/2", seendate: "2026-10-24T00:00:00Z", language: "English" }
        ]
      }));
    },
    now: new Date("2026-10-24T01:00:00Z")
  });

  assert.match(requestedUrl, /mode=ArtList/);
  assert.match(requestedUrl, /timespan=24h/);
  assert.match(requestedUrl, /format=json/);
  assert.equal(new URL(requestedUrl).searchParams.get("query"), QUERY);
  assert.equal(data.status, "ok");
  assert.equal(data.articles.length, 2);
  assert.equal(data.articles[0].title, "Second");
  assert.equal(data.geoFeatures.length, 0);
  assert.equal(data.geoStatus, "unavailable");
});

test("fails on an empty source result instead of publishing an empty feed", async () => {
  await assert.rejects(
    collect({ fetchImpl: async () => response(200, JSON.stringify({ articles: [] })) }),
    /returned no usable articles/
  );
});

console.log("MENA-Watch collector tests passed");
