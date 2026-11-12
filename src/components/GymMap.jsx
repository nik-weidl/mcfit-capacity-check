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
  theme = 'light',
}) {
  const containerRef = useRef(null);
  const mapRef = useRef(null);
  const tileLayerRef = useRef(null);
  const markersLayerRef = useRef(null);
  const markerByIdRef = useRef({});
  const studioIdsKeyRef = useRef('');
  const lastCompactDotsRef = useRef(null);
  const lastCenteredIdRef = useRef(null);

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;

    const map = L.map(containerRef.current, {
      center: [51.1657, 10.4515],
      zoom: 6,
      zoomControl: true,
    });

    const markersLayer = L.layerGroup().addTo(map);
    mapRef.current = map;
    markersLayerRef.current = markersLayer;

    return () => {
      map.remove();
      mapRef.current = null;
    };
  }, []);

  // Automatically sync minimalist Light Gray / Dark Gray canvas tiles with theme
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    if (tileLayerRef.current) {
      map.removeLayer(tileLayerRef.current);
    }

    const baseService =
      theme === 'dark' ? 'Canvas/World_Dark_Gray_Base' : 'Canvas/World_Light_Gray_Base';
    const refService =
      theme === 'dark' ? 'Canvas/World_Dark_Gray_Reference' : 'Canvas/World_Light_Gray_Reference';

    const baseLayer = L.tileLayer(
      `https://server.arcgisonline.com/ArcGIS/rest/services/${baseService}/MapServer/tile/{z}/{y}/{x}`,
      {
        attribution: 'Tiles &copy; Esri, HERE, Garmin, &copy; OpenStreetMap contributors',
        maxZoom: 16,
      }
    );

    const labelLayer = L.tileLayer(
      `https://server.arcgisonline.com/ArcGIS/rest/services/${refService}/MapServer/tile/{z}/{y}/{x}`,
      {
        maxZoom: 16,
        pane: 'tilePane',
      }
    );

    const group = L.layerGroup([baseLayer, labelLayer]).addTo(map);
    tileLayerRef.current = group;
  }, [theme]);

  // Fit bounds when filter changes
  useEffect(() => {
    const map = mapRef.current;
    if (!map || fitBoundsTrigger === 0 || studios.length === 0) return;
    const bounds = studios
      .filter((s) => typeof s.lat === 'number' && typeof s.lng === 'number')
      .map((s) => [s.lat, s.lng]);

    if (bounds.length === 1) {
      map.setView(bounds[0], 13, { animate: true });
    } else if (bounds.length > 1) {
      map.fitBounds(bounds, { padding: [32, 32], maxZoom: 13 });
    }
  }, [fitBoundsTrigger]);

  // Render or incrementally update markers and listen for zoom changes
  useEffect(() => {
    const map = mapRef.current;
    const layer = markersLayerRef.current;
    if (!map || !layer) return;

    const validStudios = studios.filter(
      (s) => typeof s.lat === 'number' && typeof s.lng === 'number'
    );
    const idsKey = validStudios.map((s) => s.id).join(',');

    const syncMarkers = () => {
      const currentZoom = map.getZoom() || 6;
      const showCompactDots = currentZoom <= 7 && validStudios.length > 15;
      const structureChanged =
        idsKey !== studioIdsKeyRef.current || showCompactDots !== lastCompactDotsRef.current;

      if (structureChanged) {
        layer.clearLayers();
        markerByIdRef.current = {};
        studioIdsKeyRef.current = idsKey;
        lastCompactDotsRef.current = showCompactDots;
      }

      for (const s of validStudios) {
        const pct = getStudioCurrentPct(s.id, history, liveCache);
        const lvl = getLevelInfo(pct ?? 35);
        const isSelected = s.id === selectedStudioId;
        const usePill = isSelected || !showCompactDots;

        const todayPred = buildTodaySeriesAndPredictions(s.id, history, liveCache);
        const in2hHour = (todayPred.activeHour + 2) % 24;
        const in2hPct = todayPred.hours[in2hHour]?.percentage ?? '--';
        const sig = `${pct}|${in2hPct}|${isSelected ? 1 : 0}|${usePill ? 1 : 0}`;

        const existing = markerByIdRef.current[s.id];
        if (existing && existing._sig === sig) {
          continue;
        }

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

        const popupHtml = `
          <div style="min-width: 170px;">
            <div style="font-weight: 800; font-size: 0.9rem; margin-bottom: 2px;">${formatStudioName(s.name)}</div>
            <div style="font-size: 0.75rem; opacity: 0.7; margin-bottom: 6px;">${s.street}, ${s.zipCode} ${s.city}</div>
            <div style="display: flex; gap: 0.65rem; align-items: center; font-size: 0.82rem; font-weight: 700; font-variant-numeric: tabular-nums;">
              <span style="color: ${pct !== null && pct < 45 ? '#10b981' : pct !== null && pct < 75 ? '#d97706' : '#e11d48'};">${pct !== null ? `${pct}%` : '--%'}</span>
              <span style="color: #0284c7;">+2h: ~${in2hPct}%</span>
            </div>
          </div>
        `;

        if (existing) {
          existing.setIcon(icon);
          existing.setZIndexOffset(isSelected ? 1000 : 0);
          existing.setPopupContent(popupHtml);
          existing._sig = sig;
        } else {
          const marker = L.marker([s.lat, s.lng], {
            icon,
            zIndexOffset: isSelected ? 1000 : 0,
          });
          marker._sig = sig;
          marker.bindPopup(popupHtml);
          marker.on('click', () => {
            onSelectStudio(s.id);
          });
          marker.addTo(layer);
          markerByIdRef.current[s.id] = marker;
        }
      }
    };

    syncMarkers();
    map.on('zoomend', syncMarkers);
    return () => {
      map.off('zoomend', syncMarkers);
    };
  }, [studios, selectedStudioId, history, liveCache, onSelectStudio]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !selectedStudioId || studios.length === 0) return;
    if (lastCenteredIdRef.current === selectedStudioId) return;
    const studio = studios.find((s) => s.id === selectedStudioId);
    if (studio && typeof studio.lat === 'number' && typeof studio.lng === 'number') {
      lastCenteredIdRef.current = selectedStudioId;
      map.setView([studio.lat, studio.lng], Math.max(map.getZoom() || 6, 12), {
        animate: true,
      });
      const marker = markerByIdRef.current[selectedStudioId];
      if (marker) marker.openPopup();
    }
  }, [selectedStudioId, studios]);

  return (
    <div className="relative h-[300px] w-full overflow-hidden rounded-lg border border-border bg-secondary sm:h-[460px]">
      <div ref={containerRef} className="h-full w-full" />
    </div>
  );
}
