# MENA Watch

A bilingual, static GitHub Pages dashboard for public-source reporting about security-related news in the Middle East.

## Data source and verification

- Articles and geographic mentions are collected from the public GDELT DOC and GEO APIs.
- Each article links to the original publisher where available.
- The project does not invent fallback/sample events. Before the first successful workflow run, the feed is empty by design.
- GDELT is a news aggregation source, not independent verification. Geographic points are reported mentions, not confirmed incident coordinates.
- No tactical aircraft tracking or operational targeting features are provided.

## Publish with GitHub Pages

1. Upload the contents of this folder to the root of a GitHub repository.
2. In **Settings → Pages**, select **Deploy from a branch**, branch `main`, folder `/ (root)`.
3. In **Settings → Actions → General → Workflow permissions**, allow **Read and write permissions** so the workflow can commit `data/events.json`.
4. Open **Actions → Update public-source news feed → Run workflow**.
5. Check the workflow log. A successful data collection prints the number of records written. If the source returns no records or fails, the workflow is marked failed and no invented events are inserted.

## Update cadence

GitHub Actions is scheduled every five minutes. Scheduled workflows are best-effort and may start late; the browser refreshes the published JSON every minute, which does not mean the underlying source data is refreshed every minute.

## Map

The map uses CARTO's dark raster tiles based on OpenStreetMap data. Keep the attribution visible and review the current provider terms and usage limits before substantial or commercial traffic.

## Files

- `index.html`: responsive Arabic/English interface, dark map, filters and feed.
- `scripts/update-news.mjs`: collects and normalizes real GDELT reports.
- `.github/workflows/update-news.yml`: scheduled/manual collection and publishing.
- `data/events.json`: published data; intentionally empty until a live collection succeeds.

## Multi-source data feeds (free tiers / credentials)

The collector supports five sources. GDELT and the dark OpenStreetMap-derived base map work without API secrets. Optional feeds are skipped safely until their credentials are added; no demo or fabricated events are inserted.

Add these under **GitHub repository → Settings → Secrets and variables → Actions → New repository secret**:

- `NASA_FIRMS_MAP_KEY`: request a free key at https://firms.modaps.eosdis.nasa.gov/api/map_key/ . NASA points are satellite thermal detections, not confirmed military incidents.
- `RELIEFWEB_APPNAME`: first request and obtain an approved appname using https://apidoc.reliefweb.int/ . ReliefWeb requires this approval for every API request.
- `ACLED_EMAIL` and `ACLED_PASSWORD`: myACLED login credentials. ACLED API access is subject to its account approval, access rules, and terms. Do not put credentials directly in source files.

OpenStreetMap provides geographic data; the dark tile style currently comes from CARTO. Keep the map attribution visible and respect tile-provider usage policies.

After adding any secrets, open **Actions → Update MENA Watch public-source data → Run workflow**. The scheduled workflow also runs every five minutes on a best-effort basis. GitHub does not guarantee exact schedule timing.

### Data integrity notes

- GDELT article coverage and map mentions are not independent verification.
- ACLED events may be delayed and require approved API access.
- NASA FIRMS detections can be caused by fires and other thermal anomalies; they are not proof of an attack.
- ReliefWeb is focused on humanitarian reports and is not a live military feed.
- OpenStreetMap is a map source, not an event/news source.
