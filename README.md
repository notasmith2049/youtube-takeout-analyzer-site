# YouTube Takeout Analyzer — Static Dashboard

Analyze your YouTube watch history from Google Takeout and view it as a beautiful static dashboard.

## How to use

1. **Export your data** from [Google Takeout](https://takeout.google.com/settings/takeout) (select only YouTube data)
2. **Place it** in `Takeout/` folder in this repo
3. **Generate the dashboard:**
   ```bash
   npm install
   node generate-static-site.js
   ```
4. The dashboard is now in `index.html` — open it in a browser or push to GitHub Pages

## What it shows

- **Total views & unique videos** — overview stats
- **Top channels** — bar chart of your most-watched channels
- **Views by month** — activity timeline
- **Channel progression** — how your channel preferences changed over time
- **Top videos** — most-watched videos

## Tech

- Node.js (parsing), Chart.js (visualization), Orbitron + Inter (fonts)
- Fully static — no server needed. Just open index.html in a browser.
