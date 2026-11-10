# McFIT Germany Capacity Map & Smart Forecast

A web application and automated GitHub Actions collector built with **React, Vite, Tailwind CSS, and shadcn/ui** that tracks **all 175 active German McFIT studios across 106 cities**.

Unlike the official McFIT app graph (which only shows today's past hours and returns `0%` for future hours and other days), this app combines:
1. **Live Real-Time Utilization** fetched directly from Magicline's public CORS-enabled studio API (`https://rsg-group.api.magicline.com/connect/v1/studio/{studioId}/utilization`).
2. **Automated Daily History Snapshots** (`public/data/history.json`) collected via GitHub Actions twice a day (retaining up to 90 days per studio).
3. **Smart "In X Hours" & Day-of-Week Predictions** that blend historical weekday curves with today's live occupancy trend.

## How Predictions Work

Forecasts in `src/lib/capacityModel.js` are calculated in three steps:

1. **Weekday Baseline ("Typical" Curve):**
   - For each hour of a weekday (`Mon`–`Sun`), the model takes a **recency-weighted average** of past recorded weeks for that studio (`0.7^weeksAgo`, giving last week the highest weight).
   - If a weekday or hour has no recorded history yet, it falls back to a standard weekday gym profile scaled by that studio's observed busyness ratio.
2. **Live Trend Multiplier:**
   - Compares the **last 3 hours of live capacity** today against the studio's typical baseline for those same hours (clamped between `0.72x` and `1.32x`) to detect whether the studio is currently quieter or busier than normal.
3. **Future Hour Projection with Decay:**
   - Multiplies the typical curve for upcoming hours by today's live trend offset, using exponential decay so near-term predictions (`+1h`, `+2h`) strongly reflect current conditions while later hours (`+4h`, `+6h`) gradually revert toward the studio's typical curve.

## Development

```bash
npm install
npm run dev       # Start local dev server
npm run collect   # Fetch latest snapshot for all 175 studios into public/data/
npm run build     # Build static site into dist/
```
