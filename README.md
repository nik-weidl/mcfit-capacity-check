# McFIT Germany Capacity Map & Smart Forecast

A lightweight, zero-backend static web application and automated GitHub Actions collector that tracks **all 175 active German McFIT studios across 106 cities**.

Unlike the official McFIT app graph (which only shows today's past hours and returns `0%` for future hours and other days), this app combines:
1. **Live Real-Time Utilization** fetched directly from Magicline's public CORS-enabled studio API (`https://rsg-group.api.magicline.com/connect/v1/studio/{studioId}/utilization`).
2. **Automated Daily History Snapshots** (`data/history.json`) collected via GitHub Actions twice a day.
3. **Smart "In X Hours" & Day-of-Week Predictions** that blend historical weekday averages with today's live occupancy trend.
