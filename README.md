# MENA Watch

A bilingual, static GitHub Pages dashboard for public-source reporting about security-related news in the Middle East.

## Data source and verification

- Articles are collected from the public GDELT DOC API. The legacy GDELT GEO 2.0 endpoint currently returns 404, so geographic mentions are disabled rather than allowing a map failure to hide valid articles.
- Each article links to the original publisher where available.
- The project does not invent fallback/sample events. Before the first successful workflow run, the feed is empty by design.
- GDELT is a news aggregation source, not independent verification. Geographic points are reported mentions, not confirmed incident coordinates.
- No tactical aircraft tracking or operational targeting features are provided.

## Publish with GitHub Pages

1. Upload the contents of this folder to the root of a GitHub repository.
2. In **Settings → Pages**, select **Deploy from a branch**, branch `main`, folder `/ (root)`.
3. In **Settings → Actions → General → Workflow permissions**, allow **Read and write permissions** so the workflow can commit `data/events.json`.
4. Open **Actions → Update public-source news feed → Run workflow**.
5. Check the workflow log. A successful data collection prints the number of records written. The collector uses one bounded DOC query with rate-limit retries. If the source returns no records or fails, the workflow is marked failed, the previous good dataset is preserved, and no invented events are inserted.

## Update cadence

GitHub Actions is scheduled every five minutes. Scheduled workflows are best-effort and may start late; the browser refreshes the published JSON every minute, which does not mean the underlying source data is refreshed every minute.

## Map

The map uses Esri's dark raster tiles with the required attribution. Keep the attribution visible and review the current provider terms and usage limits before substantial or commercial traffic.

## Files

- `index.html`: responsive Arabic/English interface, dark map, filters and feed.
- `scripts/update-news.mjs`: collects and normalizes real GDELT reports with rate-limit handling and failure protection.
- `scripts/update-news.test.mjs`: regression tests for throttling, validation, deduplication and empty-feed protection.
- `.github/workflows/update-news.yml`: scheduled/manual collection and publishing.
- `data/events.json`: published data; intentionally empty until a live collection succeeds.
