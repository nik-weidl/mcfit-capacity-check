import React, { useEffect, useRef } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import {
  formatStudioName,
  getLevelInfo,
  getStudioCurrentPct,
  buildTodaySeriesAndPredictions,
} from '@/lib/capacityModel';

export function GymMap({
  studios,
  selectedStudioId,
  history,
  liveCache,
  onSelectStudio,
  fitBoundsTrigger,
}) {
  const containerRef = useRef(null);
  const mapRef = useRef(null);
  const markersLayerRef = useRef(null);
  const markerByIdRef = useRef({});

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;

    const map = L.map(containerRef.current, {
      center: [51.1657, 10.4515],
      zoom: 6,
      zoomControl: true,
    });

    const osmDark = L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution:
        '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
      maxZoom: 19,
      className: 'dark-osm-tiles',
    });

    const osmLight = L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution:
        '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
      maxZoom: 19,
    });

    osmDark.addTo(map);
    L.control
      .layers(
        {
          'OpenStreetMap Dark': osmDark,
          'OpenStreetMap Light': osmLight,
        },
        null,
        { position: 'topright' }
      )
      .addTo(map);

    const markersLayer = L.layerGroup().addTo(map);
    mapRef.current = map;
    markersLayerRef.current = markersLayer;

    return () => {
      map.remove();
      mapRef.current = null;
    };
  }, []);

  // Fit bounds when filter changes
  useEffect(() => {
    const map = mapRef.current;
    if (!map || studios.length === 0) return;
    const bounds = studios
      .filter((s) => typeof s.lat === 'number' && typeof s.lng === 'number')
      .map((s) => [s.lat, s.lng]);

    if (bounds.length === 1) {
      map.setView(bounds[0], 13, { animate: true });
    } else if (bounds.length > 1) {
      map.fitBounds(bounds, { padding: [32, 32], maxZoom: 13 });
    }
  }, [fitBoundsTrigger]);

  // Render markers and listen for zoom changes
  useEffect(() => {
    const map = mapRef.current;
    const layer = markersLayerRef.current;
    if (!map || !layer) return;

    const drawMarkers = () => {
      layer.clearLayers();
      markerByIdRef.current = {};
      const currentZoom = map.getZoom() || 6;
      const showCompactDots = currentZoom <= 7 && studios.length > 15;

      for (const s of studios) {
        if (typeof s.lat !== 'number' || typeof s.lng !== 'number') continue;
        const pct = getStudioCurrentPct(s.id, history, liveCache);
        const lvl = getLevelInfo(pct ?? 35);
        const isSelected = s.id === selectedStudioId;

        const usePill = isSelected || !showCompactDots;
        const icon = usePill
          ? L.divIcon({
              className: '',
              html: `<div class="mcfit-map-pin ${lvl.pinCls} ${isSelected ? 'pin-selected' : ''}">${pct !== null ? `${pct}%` : '•'}</div>`,
              iconSize: [42, 22],
              iconAnchor: [21, 11],
            })
          : L.divIcon({
              className: '',
              html: `<div class="mcfit-map-dot ${lvl.pinCls}" title="${s.name}: ${pct !== null ? `${pct}%` : '--%'}"></div>`,
              iconSize: [13, 13],
              iconAnchor: [6, 6],
            });

        const marker = L.marker([s.lat, s.lng], {
          icon,
          zIndexOffset: isSelected ? 1000 : 0,
        });

        const todayPred = buildTodaySeriesAndPredictions(s.id, history, liveCache);
        const in2hHour = (todayPred.activeHour + 2) % 24;
        const in2hPct = todayPred.hours[in2hHour]?.percentage ?? '--';

        marker.bindPopup(`
          <div style="min-width: 170px;">
            <div style="font-weight: 800; font-size: 0.9rem; margin-bottom: 2px;">${formatStudioName(s.name)}</div>
            <div style="font-size: 0.75rem; color: #a1a1aa; margin-bottom: 6px;">${s.street}, ${s.zipCode} ${s.city}</div>
            <div style="display: flex; gap: 0.65rem; align-items: center; font-size: 0.8rem; font-weight: 700; font-family: 'JetBrains Mono', monospace;">
              <span style="color: ${pct < 45 ? '#34d399' : pct < 75 ? '#fbbf24' : '#f87171'};">${pct !== null ? `${pct}%` : '--%'}</span>
              <span style="color: #38bdf8;">+2h: ~${in2hPct}%</span>
            </div>
          </div>
        `);

        marker.on('click', () => {
          onSelectStudio(s.id);
        });

        marker.addTo(layer);
        markerByIdRef.current[s.id] = marker;
      }
    };

    drawMarkers();
    map.on('zoomend', drawMarkers);
    return () => {
      map.off('zoomend', drawMarkers);
    };
  }, [studios, selectedStudioId, history, liveCache, onSelectStudio]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !selectedStudioId) return;
    const studio = studios.find((s) => s.id === selectedStudioId);
    if (studio && typeof studio.lat === 'number' && typeof studio.lng === 'number') {
      map.setView([studio.lat, studio.lng], Math.max(map.getZoom() || 6, 12), {
        animate: true,
      });
      const marker = markerByIdRef.current[selectedStudioId];
      if (marker) marker.openPopup();
    }
  }, [selectedStudioId]);

  return (
    <div className="relative h-[460px] w-full overflow-hidden rounded-xl border border-border bg-zinc-950">
      <div ref={containerRef} className="h-full w-full" />
    </div>
  );
}
