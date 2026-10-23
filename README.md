# MENA Watch

A bilingual (Arabic/English) static dashboard for public-source security and military-related reporting across the Middle East. It is an awareness/news aggregation tool, not an operational intelligence system.

## Features
- Responsive dark dashboard with Arabic/English interface.
- Interactive Leaflet map displaying only geographic mention features returned by GDELT.
- Public news feed with original-source links, search, language filter and timestamps.
- Explicit limitations: a geographic mention is not a verified incident coordinate; aggregated reporting is not independent verification.
- GitHub Actions collection workflow and a static JSON dataset. The page refreshes its view every 60 seconds; data collection is scheduled every 5 minutes, subject to GitHub scheduling delays.

## Deploy with GitHub Pages
1. Create a repository, for example `mena-watch`.
2. Upload all files preserving their paths.
3. Open **Settings → Pages** and choose **Deploy from a branch**, branch `main`, folder `/ (root)`; save.
4. Open **Actions** and enable workflows if GitHub asks.
5. Run **Update public-source news feed → Run workflow** once manually.
6. Wait for the workflow to finish and for Pages to publish. Open the Pages URL.

If the repository is private, Pages availability depends on your GitHub plan. A public repository is the simplest free setup.

## Important workflow permission
The workflow commits `data/events.json` back into the repository. In **Settings → Actions → General → Workflow permissions**, enable **Read and write permissions**. If your repository rules prohibit direct pushes to `main`, adjust the rules or change the workflow to publish artifacts another way.

## Update cadence
The web page checks the published JSON every minute, but that does **not** mean the source data is updated every minute. GitHub Actions schedules are best-effort and can be delayed; this workflow runs every five minutes. Do not change this to every minute expecting reliable one-minute updates.

## Data provider and map
- GDELT Project: https://www.gdeltproject.org/
- GDELT DOC API: https://blog.gdeltproject.org/gdelt-2-0-api-debuts/
- OpenStreetMap attribution: https://www.openstreetmap.org/copyright
- Leaflet: https://leafletjs.com/

Review each provider's terms and rate limits before relying on this for sustained public traffic. The feed may be incomplete or noisy. Article metadata does not independently establish truth. The map uses geographic mentions supplied by GDELT; it does not claim to locate a reported incident precisely.

## Safety and accuracy scope
This first version does not track individual military aircraft or publish tactical routes/positions. It is limited to public reporting and broad geographic mentions. Never use the dashboard as an emergency alert service or as the sole basis for safety decisions.
