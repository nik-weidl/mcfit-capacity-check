# McFIT Germany Capacity Map & Smart Forecast

A web application and automated GitHub Actions collector built with **React, Vite, Tailwind CSS, and shadcn/ui** that tracks **all 175 active German McFIT studios across 106 cities**.

Unlike the official McFIT app graph (which only shows today's past hours and returns `0%` for future hours and other days), this app combines:
1. **Live Real-Time Utilization** fetched directly from Magicline's public CORS-enabled studio API (`https://rsg-group.api.magicline.com/connect/v1/studio/{studioId}/utilization`).
2. **Automated Daily History Snapshots** (`public/data/history.json`) collected via GitHub Actions twice a day.
3. **Smart "In X Hours" & Day-of-Week Predictions** that blend historical weekday averages with today's live occupancy trend.

---

## Tech Stack

- **Frontend:** React 18, Vite 5, Tailwind CSS, **shadcn/ui** (Zinc dark theme, `lucide-react` icons, `Inter` + `JetBrains Mono` typography)
- **Map:** Leaflet with keyless official OpenStreetMap tiles (`tile.openstreetmap.org`)
- **Data Collector:** Node.js (`scripts/fetch-capacity.mjs`) + GitHub Actions cron (`.github/workflows/collect-capacity.yml`)

---

## Running Locally

```bash
# Install dependencies
npm install

# Start Vite dev server at http://localhost:3000
npm run dev

# Build static production bundle into ./dist
npm run build

# Manually fetch latest daily snapshot for all 175 German studios
npm run collect
```

---

## Free Deployment on GitHub Pages

1. Push this repository to GitHub.
2. Go to **Settings → Actions → General → Workflow permissions** and enable **Read and write permissions** (so [`.github/workflows/collect-capacity.yml`](./.github/workflows/collect-capacity.yml) can commit updated snapshots to `public/data/history.json`).
3. Go to **Settings → Pages** and set **Source** to **GitHub Actions** (handled automatically by [`.github/workflows/deploy.yml`](./.github/workflows/deploy.yml)).
