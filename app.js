/**
 * McFIT Germany Studio Capacity Map & Smart Forecast App
 * - Tracks all 175 active German McFIT studios across 106 cities
 * - Interactive Leaflet map with live color-coded capacity pins & "Near Me" GPS finder
 * - Fetches live real-time hourly utilization directly from Magicline's CORS-enabled endpoint:
 *   https://rsg-group.api.magicline.com/connect/v1/studio/{studioId}/utilization
 * - Predicts capacity "In X Hours" and across all 7 weekdays (Mon-Sun) by combining
 *   collected historical snapshots (`data/history.json`) with a studio-calibrated weekday model.
 */

const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const SHORT_DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

const BASE_WEEKDAY_PROFILES = {
  1: [3, 2, 1, 1, 2, 7, 18, 28, 34, 42, 48, 52, 48, 46, 52, 64, 82, 95, 98, 88, 70, 48, 25, 10],
  2: [3, 2, 1, 1, 2, 7, 19, 29, 34, 40, 46, 50, 46, 45, 50, 62, 80, 93, 95, 86, 68, 46, 24, 9],
  3: [3, 2, 1, 1, 2, 7, 18, 27, 33, 39, 45, 49, 45, 44, 49, 60, 77, 90, 92, 83, 65, 44, 22, 9],
  4: [3, 2, 1, 1, 2, 6, 17, 26, 32, 38, 44, 48, 44, 43, 48, 58, 74, 86, 88, 79, 62, 42, 21, 8],
  5: [3, 2, 1, 1, 2, 6, 16, 25, 31, 38, 45, 50, 48, 49, 55, 65, 75, 80, 72, 58, 42, 28, 16, 8],
  6: [5, 3, 2, 1, 1, 3, 8, 15, 26, 42, 58, 70, 74, 72, 68, 62, 55, 48, 40, 32, 22, 14, 9, 6],
  0: [4, 3, 2, 1, 1, 2, 6, 12, 24, 40, 56, 68, 72, 68, 62, 56, 50, 44, 36, 28, 19, 12, 7, 4],
};

const state = {
  studios: [],
  history: { studios: {} },
  liveCache: {}, // studioId -> { items, currentHour, currentPct, fetchedAt }
  selectedCityTab: 'All',
  searchQuery: '',
  sortBy: 'city',
  selectedStudioId: localStorage.getItem('mcfit_selected_studio') || '1858374200', // Default: McFIT München-Schwabing
  favorites: new Set(JSON.parse(localStorage.getItem('mcfit_favorites') || '["1858374200"]')),
  horizonHours: 2,
  selectedDayTab: 'today',
  map: null,
  markersLayer: null,
  markerById: {},
};

function formatStudioName(name) {
  return (name || '').replace(/^KLUB\s+/i, '').replace(/^McFIT\s+/i, '').trim();
}

function saveFavorites() {
  localStorage.setItem('mcfit_favorites', JSON.stringify([...state.favorites]));
  const favCountEl = document.getElementById('fav-count');
  if (favCountEl) favCountEl.textContent = `(${state.favorites.size})`;
}

function getLevelInfo(pct) {
  if (pct < 45) {
    return {
      label: 'LOW',
      cls: 'level-low',
      barCls: 'bar-low',
      hmCls: 'hm-low',
      pinCls: 'pin-low',
    };
  }
  if (pct < 75) {
    return {
      label: 'NORMAL',
      cls: 'level-normal',
      barCls: 'bar-normal',
      hmCls: 'hm-normal',
      pinCls: 'pin-normal',
    };
  }
  return {
    label: 'HIGH',
    cls: 'level-high',
    barCls: 'bar-high',
    hmCls: 'hm-high',
    pinCls: 'pin-high',
  };
}

function getBerlinNow() {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Europe/Berlin',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    weekday: 'short',
    hour12: false,
  }).formatToParts(new Date());

  const map = Object.fromEntries(parts.map((p) => [p.type, p.value]));
  const hour = parseInt(map.hour, 10) % 24;
  const dateStr = `${map.year}-${map.month}-${map.day}`;
  const weekdayMap = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
  const dayOfWeek = weekdayMap[map.weekday] ?? new Date().getDay();
  return { hour, minute: parseInt(map.minute, 10), dateStr, dayOfWeek };
}

function computeStudioScaleFactor(studioId, liveHoursArray, currentDow) {
  const studioHist = state.history.studios?.[studioId]?.days || {};
  let observedSum = 0;
  let baseSum = 0;

  for (const [dateStr, hours] of Object.entries(studioHist)) {
    const d = new Date(`${dateStr}T12:00:00Z`);
    const dow = Number.isNaN(d.getTime()) ? currentDow : d.getUTCDay();
    const baseProfile = BASE_WEEKDAY_PROFILES[dow] || BASE_WEEKDAY_PROFILES[1];
    hours.forEach((val, h) => {
      if (typeof val === 'number' && val > 0 && h >= 7 && h <= 21) {
        observedSum += val;
        baseSum += baseProfile[h];
      }
    });
  }

  if (Array.isArray(liveHoursArray)) {
    const baseProfile = BASE_WEEKDAY_PROFILES[currentDow] || BASE_WEEKDAY_PROFILES[1];
    liveHoursArray.forEach((val, h) => {
      if (typeof val === 'number' && val > 0 && h >= 7 && h <= 21) {
        observedSum += val;
        baseSum += baseProfile[h];
      }
    });
  }

  if (baseSum < 30) return 1.0;
  const rawRatio = observedSum / baseSum;
  return Math.max(0.55, Math.min(1.45, rawRatio));
}

function getStudioWeekdayCurve(studioId, targetDow, liveHoursToday, currentDow) {
  const scale = computeStudioScaleFactor(studioId, liveHoursToday, currentDow);
  const baseProfile = BASE_WEEKDAY_PROFILES[targetDow] || BASE_WEEKDAY_PROFILES[1];
  const studioHist = state.history.studios?.[studioId]?.days || {};

  const matchingDays = [];
  for (const [dateStr, hours] of Object.entries(studioHist)) {
    const d = new Date(`${dateStr}T12:00:00Z`);
    if (!Number.isNaN(d.getTime()) && d.getUTCDay() === targetDow && Array.isArray(hours)) {
      matchingDays.push(hours);
    }
  }

  return baseProfile.map((baseVal, hour) => {
    const calibratedBase = Math.min(100, Math.max(2, Math.round(baseVal * scale)));
    const recordedVals = matchingDays
      .map((arr) => arr[hour])
      .filter((v) => typeof v === 'number' && v !== null);

    if (recordedVals.length === 0) {
      return calibratedBase;
    }

    const avgRecorded = recordedVals.reduce((a, b) => a + b, 0) / recordedVals.length;
    const histWeight = Math.min(0.85, recordedVals.length * 0.35);
    return Math.min(
      100,
      Math.max(1, Math.round(avgRecorded * histWeight + calibratedBase * (1 - histWeight)))
    );
  });
}

function buildTodaySeriesAndPredictions(studioId) {
  const { hour: berlinHour, dateStr, dayOfWeek } = getBerlinNow();
  const liveEntry = state.liveCache[studioId];
  const histDay = state.history.studios?.[studioId]?.days?.[dateStr] || new Array(24).fill(null);

  const liveHours = new Array(24).fill(null);
  let activeHour = berlinHour;

  if (liveEntry && Array.isArray(liveEntry.items)) {
    const currentIdx = liveEntry.items.findIndex((i) => i.isCurrent === true);
    if (currentIdx >= 0) activeHour = currentIdx;
    liveEntry.items.forEach((item, idx) => {
      if (idx <= activeHour && typeof item.percentage === 'number') {
        liveHours[idx] = item.percentage;
      }
    });
  } else {
    histDay.forEach((val, idx) => {
      if (typeof val === 'number') liveHours[idx] = val;
    });
  }

  const typicalCurve = getStudioWeekdayCurve(studioId, dayOfWeek, liveHours, dayOfWeek);

  let recentActual = 0;
  let recentTypical = 0;
  for (let h = Math.max(6, activeHour - 2); h <= activeHour; h++) {
    if (typeof liveHours[h] === 'number' && typicalCurve[h] > 0) {
      recentActual += liveHours[h];
      recentTypical += typicalCurve[h];
    }
  }

  const rawTrendMultiplier = recentTypical > 15 ? recentActual / recentTypical : 1.0;
  const clampedTrend = Math.max(0.72, Math.min(1.32, rawTrendMultiplier));

  const hours = [];
  for (let h = 0; h < 24; h++) {
    const isPastOrCurrent = h <= activeHour && typeof liveHours[h] === 'number';
    if (isPastOrCurrent) {
      hours.push({
        hour: h,
        percentage: liveHours[h],
        typical: typicalCurve[h],
        isCurrent: h === activeHour,
        isForecast: false,
      });
    } else {
      const hoursAhead = Math.max(1, h - activeHour);
      const decay = Math.max(0.25, Math.exp(-0.18 * (hoursAhead - 1)));
      const effectiveMultiplier = 1 + (clampedTrend - 1) * decay;
      const predicted = Math.min(
        100,
        Math.max(2, Math.round(typicalCurve[h] * effectiveMultiplier))
      );
      hours.push({
        hour: h,
        percentage: predicted,
        typical: typicalCurve[h],
        isCurrent: false,
        isForecast: true,
      });
    }
  }

  return {
    activeHour,
    dayOfWeek,
    dateStr,
    trendMultiplier: clampedTrend,
    hours,
    typicalCurve,
  };
}

async function fetchLiveStudioUtilization(studioId) {
  try {
    const res = await fetch(
      `https://rsg-group.api.magicline.com/connect/v1/studio/${studioId}/utilization`
    );
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    if (Array.isArray(data?.items)) {
      const currentIdx = data.items.findIndex((i) => i.isCurrent === true);
      const currentPct =
        currentIdx >= 0 ? data.items[currentIdx].percentage : data.items[0]?.percentage ?? null;
      state.liveCache[studioId] = {
        items: data.items,
        currentHour: currentIdx >= 0 ? currentIdx : getBerlinNow().hour,
        currentPct,
        fetchedAt: new Date(),
      };
      return true;
    }
  } catch (err) {
    console.warn(`Live API fetch fallback to snapshot for ${studioId}:`, err.message);
  }
  return false;
}

function getFilteredStudios() {
  const q = state.searchQuery.trim().toLowerCase();
  const list = state.studios.filter((s) => {
    if (state.selectedCityTab === 'Favorites' && !state.favorites.has(s.id)) {
      return false;
    }
    if (state.selectedCityTab !== 'All' && state.selectedCityTab !== 'Favorites') {
      if (s.city !== state.selectedCityTab) return false;
    }
    if (q) {
      const hay = `${s.name} ${s.city} ${s.street} ${s.zipCode}`.toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });

  if (state.sortBy === 'lowest-now') {
    list.sort((a, b) => (getStudioCurrentPct(a.id) ?? 999) - (getStudioCurrentPct(b.id) ?? 999));
  } else if (state.sortBy === 'highest-now') {
    list.sort((a, b) => (getStudioCurrentPct(b.id) ?? -1) - (getStudioCurrentPct(a.id) ?? -1));
  } else if (state.sortBy === 'lowest-2h') {
    list.sort((a, b) => {
      const pA = buildTodaySeriesAndPredictions(a.id);
      const pB = buildTodaySeriesAndPredictions(b.id);
      const vA = pA.hours[(pA.activeHour + 2) % 24]?.percentage ?? 999;
      const vB = pB.hours[(pB.activeHour + 2) % 24]?.percentage ?? 999;
      return vA - vB;
    });
  }
  return list;
}

async function prefetchVisibleCityStudios() {
  const filtered = getFilteredStudios();
  if (filtered.length === 0 || filtered.length > 25) return;

  await Promise.allSettled(
    filtered.map(async (s) => {
      if (!state.liveCache[s.id]) {
        try {
          const res = await fetch(
            `https://rsg-group.api.magicline.com/connect/v1/studio/${s.id}/utilization`
          );
          if (res.ok) {
            const data = await res.json();
            if (Array.isArray(data?.items)) {
              const currentIdx = data.items.findIndex((i) => i.isCurrent === true);
              state.liveCache[s.id] = {
                items: data.items,
                currentHour: currentIdx >= 0 ? currentIdx : getBerlinNow().hour,
                currentPct: currentIdx >= 0 ? data.items[currentIdx].percentage : null,
                fetchedAt: new Date(),
              };
            }
          }
        } catch {
          // Ignore single prefetch error
        }
      }
    })
  );
  renderStudioGrid();
  renderMapMarkers({ fitBounds: false });
}

function getStudioCurrentPct(studioId) {
  if (state.liveCache[studioId] && typeof state.liveCache[studioId].currentPct === 'number') {
    return state.liveCache[studioId].currentPct;
  }
  const { hour, dateStr } = getBerlinNow();
  const snap = state.history.studios?.[studioId]?.days?.[dateStr];
  if (Array.isArray(snap)) {
    for (let h = hour; h >= 0; h--) {
      if (typeof snap[h] === 'number') return snap[h];
    }
  }
  // Fallback to most recent recorded date in history.json
  const daysObj = state.history.studios?.[studioId]?.days;
  if (daysObj) {
    const keys = Object.keys(daysObj).sort();
    const lastDay = daysObj[keys[keys.length - 1]];
    if (Array.isArray(lastDay)) {
      for (let h = 23; h >= 0; h--) {
        if (typeof lastDay[h] === 'number') return lastDay[h];
      }
    }
  }
  return null;
}

/**
 * Initialize Leaflet Map with official keyless OpenStreetMap tiles
 * Uses a CSS filter (`dark-osm-tiles`) on the tile layer for dark mode so NO external commercial API key is ever needed.
 */
function initMap() {
  if (!window.L) return;
  const map = window.L.map('gym-map', {
    center: [51.1657, 10.4515], // Center of Germany
    zoom: 6,
    zoomControl: true,
  });

  const osmDark = window.L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution:
      '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
    maxZoom: 19,
    className: 'dark-osm-tiles',
  });

  const osmLight = window.L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution:
      '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
    maxZoom: 19,
  });

  osmDark.addTo(map);
  window.L.control
    .layers(
      {
        'OpenStreetMap Dark': osmDark,
        'OpenStreetMap Light': osmLight,
      },
      null,
      { position: 'topright' }
    )
    .addTo(map);

  state.map = map;
  state.markersLayer = window.L.layerGroup().addTo(map);

  map.on('zoomend', () => {
    renderMapMarkers({ fitBounds: false });
  });
}

/**
 * Renders interactive capacity pins on the Leaflet map
 */
function renderMapMarkers({ fitBounds = false } = {}) {
  if (!state.map || !state.markersLayer) return;
  state.markersLayer.clearLayers();
  state.markerById = {};

  const filtered = getFilteredStudios();
  const bounds = [];

  if (fitBounds && filtered.length > 0) {
    for (const s of filtered) {
      if (typeof s.lat === 'number' && typeof s.lng === 'number') {
        bounds.push([s.lat, s.lng]);
      }
    }
    if (bounds.length === 1) {
      state.map.setView(bounds[0], 13, { animate: true });
    } else if (bounds.length > 1) {
      state.map.fitBounds(bounds, { padding: [32, 32], maxZoom: 13 });
    }
  }

  const currentZoom = state.map.getZoom() || 6;
  const showCompactDots = currentZoom <= 7 && filtered.length > 15;

  for (const s of filtered) {
    if (typeof s.lat !== 'number' || typeof s.lng !== 'number') continue;
    const pct = getStudioCurrentPct(s.id);
    const lvl = getLevelInfo(pct ?? 35);
    const isSelected = s.id === state.selectedStudioId;

    const usePill = isSelected || !showCompactDots;
    const icon = usePill
      ? window.L.divIcon({
          className: '',
          html: `<div class="mcfit-map-pin ${lvl.pinCls} ${isSelected ? 'pin-selected' : ''}">${pct !== null ? `${pct}%` : '•'}</div>`,
          iconSize: [42, 22],
          iconAnchor: [21, 11],
        })
      : window.L.divIcon({
          className: '',
          html: `<div class="mcfit-map-dot ${lvl.pinCls}" title="${s.name}: ${pct !== null ? `${pct}%` : '--%'}"></div>`,
          iconSize: [14, 14],
          iconAnchor: [7, 7],
        });

    const marker = window.L.marker([s.lat, s.lng], {
      icon,
      zIndexOffset: isSelected ? 1000 : 0,
    });
    const todayPred = buildTodaySeriesAndPredictions(s.id);
    const in2hHour = (todayPred.activeHour + 2) % 24;
    const in2hPct = todayPred.hours[in2hHour]?.percentage ?? '--';

    marker.bindPopup(`
      <div>
        <div class="popup-title">${formatStudioName(s.name)}</div>
        <div class="popup-addr">${s.street}, ${s.zipCode} ${s.city}</div>
        <div class="popup-metrics">
          <span class="level-badge ${lvl.cls}">${pct !== null ? `${pct}%` : '--%'}</span>
          <span style="color: var(--forecast-blue); font-weight: 700;">+2h: ~${in2hPct}%</span>
        </div>
      </div>
    `);

    marker.on('click', async () => {
      await selectStudio(s.id, { panMap: false });
    });

    marker.addTo(state.markersLayer);
    state.markerById[s.id] = marker;
  }
}

async function selectStudio(studioId, { panMap = true } = {}) {
  state.selectedStudioId = studioId;
  localStorage.setItem('mcfit_selected_studio', studioId);

  const studio = state.studios.find((s) => s.id === studioId);
  if (panMap && studio && state.map && typeof studio.lat === 'number') {
    state.map.setView([studio.lat, studio.lng], Math.max(state.map.getZoom(), 12), {
      animate: true,
    });
  }

  renderStudioGrid();
  renderMapMarkers({ fitBounds: false });
  if (state.markerById[studioId]) {
    state.markerById[studioId].openPopup();
  }

  await fetchLiveStudioUtilization(studioId);
  renderStudioGrid();
  renderMapMarkers({ fitBounds: false });
  if (state.markerById[studioId]) {
    state.markerById[studioId].openPopup();
  }
  renderDashboard();
}

function populateCityDropdown() {
  const select = document.getElementById('city-select');
  if (!select) return;

  const cityCounts = {};
  for (const s of state.studios) {
    cityCounts[s.city] = (cityCounts[s.city] || 0) + 1;
  }

  const cities = Object.keys(cityCounts).sort((a, b) => a.localeCompare(b, 'de'));
  select.innerHTML =
    `<option value="All">All Cities (${state.studios.length})</option>` +
    cities.map((c) => `<option value="${c}">${c} (${cityCounts[c]})</option>`).join('');
}

function renderStudioGrid() {
  const grid = document.getElementById('studio-grid');
  const filtered = getFilteredStudios();

  if (filtered.length === 0) {
    grid.innerHTML = `<p style="color: var(--text-muted); font-size: 0.85rem; padding: 0.5rem;">No matching studios.</p>`;
    return;
  }

  grid.innerHTML = filtered
    .map((s) => {
      const pct = getStudioCurrentPct(s.id);
      const isFav = state.favorites.has(s.id);
      const activeCls = s.id === state.selectedStudioId ? 'active' : '';
      let badgeHtml = `<span class="chip-badge" style="color:var(--text-muted)">--%</span>`;
      if (typeof pct === 'number') {
        const lvl = getLevelInfo(pct);
        badgeHtml = `<span class="chip-badge ${lvl.cls}">${pct}%</span>`;
      }
      const shortName = formatStudioName(s.name);
      const subText = shortName.toLowerCase().includes(s.city.toLowerCase())
        ? s.street
        : `${s.street} (${s.city})`;
      return `
        <button class="studio-chip ${activeCls}" data-studio-id="${s.id}">
          <div class="chip-info">
            <div class="chip-name">${isFav ? '&#9733; ' : ''}${shortName}</div>
            <div class="chip-sub">${subText}</div>
          </div>
          ${badgeHtml}
        </button>
      `;
    })
    .join('');

  grid.querySelectorAll('.studio-chip').forEach((btn) => {
    btn.addEventListener('click', () => {
      const id = btn.getAttribute('data-studio-id');
      selectStudio(id, { panMap: true });
    });
  });
}

function renderDashboard() {
  const studio =
    state.studios.find((s) => s.id === state.selectedStudioId) || state.studios[0];
  if (!studio) return;

  document.getElementById('active-studio-name').textContent = formatStudioName(studio.name);
  document.getElementById('active-studio-address').textContent =
    `${studio.street}, ${studio.zipCode} ${studio.city}`;

  const favBtn = document.getElementById('fav-toggle-btn');
  const isFav = state.favorites.has(studio.id);
  favBtn.innerHTML = isFav ? '&#9733; Pinned' : '&#9734; Pin';
  favBtn.classList.toggle('is-fav', isFav);

  const liveInfo = state.liveCache[studio.id];
  document.getElementById('last-updated-text').textContent = liveInfo?.fetchedAt
    ? `Updated ${liveInfo.fetchedAt.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`
    : '';

  const todayModel = buildTodaySeriesAndPredictions(studio.id);
  const currentSlot = todayModel.hours[todayModel.activeHour] || todayModel.hours[0];
  const currentLvl = getLevelInfo(currentSlot.percentage);

  // 1. Live KPI Card
  const liveBadge = document.getElementById('live-level-badge');
  liveBadge.textContent = currentLvl.label;
  liveBadge.className = `level-badge ${currentLvl.cls}`;

  document.getElementById('live-percentage').textContent = `${currentSlot.percentage}%`;
  const nextH = (currentSlot.hour + 1) % 24;
  document.getElementById('live-hour-label').textContent =
    `${String(currentSlot.hour).padStart(2, '0')}:00–${String(nextH).padStart(2, '0')}:00`;

  const diffVsTypical = currentSlot.percentage - currentSlot.typical;
  const dayName = SHORT_DAYS[todayModel.dayOfWeek];
  const diffSign = diffVsTypical > 0 ? `+${diffVsTypical}%` : `${diffVsTypical}%`;
  document.getElementById('live-vs-typical').textContent =
    Math.abs(diffVsTypical) <= 3
      ? `Typical ${dayName}: ${currentSlot.typical}%`
      : `${diffSign} vs. typical ${dayName} (${currentSlot.typical}%)`;

  // 2. Forecast Card
  const targetHour = (todayModel.activeHour + state.horizonHours) % 24;
  const isTomorrow = todayModel.activeHour + state.horizonHours >= 24;
  const targetDow = isTomorrow ? (todayModel.dayOfWeek + 1) % 7 : todayModel.dayOfWeek;
  const tomorrowCurve = getStudioWeekdayCurve(
    studio.id,
    targetDow,
    todayModel.hours.map((h) => (h.isForecast ? null : h.percentage)),
    todayModel.dayOfWeek
  );

  const predictedPct = isTomorrow
    ? tomorrowCurve[targetHour]
    : todayModel.hours[targetHour].percentage;

  document.getElementById('predicted-percentage').textContent = `${predictedPct}%`;
  document.getElementById('predicted-time-label').textContent =
    `${String(targetHour).padStart(2, '0')}:00${isTomorrow ? ' (+1d)' : ''}`;

  const deltaFromNow = predictedPct - currentSlot.percentage;
  const trendBadge = document.getElementById('predicted-trend-badge');
  if (deltaFromNow >= 6) {
    trendBadge.textContent = `↗ +${deltaFromNow}%`;
    trendBadge.style.color = 'var(--high)';
  } else if (deltaFromNow <= -6) {
    trendBadge.textContent = `↘ ${deltaFromNow}%`;
    trendBadge.style.color = 'var(--low)';
  } else {
    trendBadge.textContent = `→ ${deltaFromNow >= 0 ? '+' : ''}${deltaFromNow}%`;
    trendBadge.style.color = 'var(--normal)';
  }

  const typicalAtTarget = isTomorrow ? tomorrowCurve[targetHour] : todayModel.typicalCurve[targetHour];
  document.getElementById('predicted-explanation').textContent =
    `Typical ${SHORT_DAYS[targetDow]} ${String(targetHour).padStart(2, '0')}:00: ${typicalAtTarget}%`;

  // 3. Today's Windows Card
  const workoutHours = todayModel.hours.filter(
    (h) => h.hour >= Math.max(6, todayModel.activeHour) && h.hour <= 22
  );
  const pool = workoutHours.length > 0 ? workoutHours : todayModel.hours.slice(6, 23);
  const bestSlot = [...pool].sort((a, b) => a.percentage - b.percentage)[0];
  const peakSlot = [...todayModel.hours.slice(6, 23)].sort(
    (a, b) => b.percentage - a.percentage
  )[0];

  if (bestSlot) {
    document.getElementById('best-window-text').textContent =
      `${String(bestSlot.hour).padStart(2, '0')}:00–${String(bestSlot.hour + 1).padStart(2, '0')}:00 (${bestSlot.percentage}%)`;
  }
  if (peakSlot) {
    document.getElementById('peak-window-text').textContent =
      `${String(peakSlot.hour).padStart(2, '0')}:00–${String(peakSlot.hour + 1).padStart(2, '0')}:00 (${peakSlot.percentage}%)`;
  }

  renderHourlyChart(studio, todayModel, targetHour, isTomorrow);
  renderWeeklyHeatmap(studio, todayModel);
}

function renderHourlyChart(studio, todayModel, targetHour, isTomorrow) {
  const chartEl = document.getElementById('hourly-chart');
  const titleEl = document.getElementById('chart-title');

  let displayHours = [];
  if (state.selectedDayTab === 'today') {
    titleEl.textContent = `Today (${DAY_NAMES[todayModel.dayOfWeek]})`;
    displayHours = todayModel.hours;
  } else {
    const dow = parseInt(state.selectedDayTab, 10);
    const curve = getStudioWeekdayCurve(
      studio.id,
      dow,
      todayModel.hours.map((h) => (h.isForecast ? null : h.percentage)),
      todayModel.dayOfWeek
    );
    titleEl.textContent = DAY_NAMES[dow];
    displayHours = curve.map((pct, h) => ({
      hour: h,
      percentage: pct,
      typical: pct,
      isCurrent: false,
      isForecast: false,
    }));
  }

  chartEl.innerHTML = displayHours
    .map((slot) => {
      const lvl = getLevelInfo(slot.percentage);
      const isTarget =
        state.selectedDayTab === 'today' && !isTomorrow && slot.hour === targetHour;
      const colClasses = [
        'hour-col',
        slot.isCurrent ? 'is-current' : '',
        isTarget ? 'is-target-horizon' : '',
      ]
        .filter(Boolean)
        .join(' ');

      const barClass = slot.isForecast ? 'bar-forecast' : lvl.barCls;
      const heightPct = Math.max(4, Math.min(100, slot.percentage));
      const typicalBottomPct = Math.max(2, Math.min(98, slot.typical));

      return `
        <div class="${colClasses}" data-hour="${slot.hour}" title="${String(slot.hour).padStart(2, '0')}:00 — ${slot.isForecast ? 'Predicted' : 'Actual'}: ${slot.percentage}% (Typical: ${slot.typical}%)">
          <span class="hour-val">${slot.percentage}%</span>
          <div class="bar-track">
            <div class="typical-marker" style="bottom: ${typicalBottomPct}%;"></div>
            <div class="hour-bar ${barClass}" style="height: ${heightPct}%;"></div>
          </div>
          <span class="hour-time">${String(slot.hour).padStart(2, '0')}</span>
        </div>
      `;
    })
    .join('');

  chartEl.querySelectorAll('.hour-col').forEach((col) => {
    col.addEventListener('click', () => {
      const clickedH = parseInt(col.getAttribute('data-hour'), 10);
      if (state.selectedDayTab === 'today' && clickedH > todayModel.activeHour) {
        state.horizonHours = clickedH - todayModel.activeHour;
        document.querySelectorAll('.horizon-pill').forEach((p) => {
          p.classList.toggle('active', parseInt(p.dataset.hours, 10) === state.horizonHours);
        });
        renderDashboard();
      }
    });
  });
}

function renderWeeklyHeatmap(studio, todayModel) {
  const hmEl = document.getElementById('weekly-heatmap');
  const hoursRange = Array.from({ length: 18 }, (_, i) => i + 6);
  const orderedDays = [1, 2, 3, 4, 5, 6, 0];

  let html = `<div class="hm-cell hm-header"></div>`;
  for (const h of hoursRange) {
    html += `<div class="hm-cell hm-header">${String(h).padStart(2, '0')}</div>`;
  }

  const liveObserved = todayModel.hours.map((h) => (h.isForecast ? null : h.percentage));

  for (const dow of orderedDays) {
    const isToday = dow === todayModel.dayOfWeek;
    const curve = getStudioWeekdayCurve(studio.id, dow, liveObserved, todayModel.dayOfWeek);

    html += `
      <div class="hm-cell hm-day-label" data-dow="${dow}" title="Click to inspect ${DAY_NAMES[dow]} curve">
        <span>${SHORT_DAYS[dow]}${isToday ? ' •' : ''}</span>
      </div>
    `;

    for (const h of hoursRange) {
      const pct = curve[h];
      const lvl = getLevelInfo(pct);
      html += `<div class="hm-cell ${lvl.hmCls}" title="${DAY_NAMES[dow]} ${String(h).padStart(2, '0')}:00 — ~${pct}%">${pct}%</div>`;
    }
  }

  hmEl.innerHTML = html;

  hmEl.querySelectorAll('.hm-day-label').forEach((rowBtn) => {
    rowBtn.addEventListener('click', () => {
      const dow = rowBtn.getAttribute('data-dow');
      state.selectedDayTab = dow;
      document.querySelectorAll('.day-btn').forEach((b) => {
        b.classList.toggle('active', b.getAttribute('data-day') === dow);
      });
      renderDashboard();
    });
  });
}

function setCityFilter(cityVal) {
  state.selectedCityTab = cityVal;
  document.querySelectorAll('.city-tab').forEach((t) => {
    t.classList.toggle('active', t.getAttribute('data-city') === cityVal);
  });
  const select = document.getElementById('city-select');
  if (select && [...select.options].some((o) => o.value === cityVal)) {
    select.value = cityVal;
  } else if (select && cityVal === 'Favorites') {
    select.value = 'All';
  }
  renderStudioGrid();
  renderMapMarkers({ fitBounds: true });
  prefetchVisibleCityStudios();
}

function bindEvents() {
  // Studio sort selector
  const sortSelect = document.getElementById('studio-sort');
  if (sortSelect) {
    sortSelect.addEventListener('change', (e) => {
      state.sortBy = e.target.value;
      renderStudioGrid();
    });
  }
  // Favorites filter toggle
  const favFilterBtn = document.getElementById('fav-filter-btn');
  if (favFilterBtn) {
    favFilterBtn.addEventListener('click', () => {
      const next = state.selectedCityTab === 'Favorites' ? 'All' : 'Favorites';
      setCityFilter(next);
    });
  }

  // Full 106-city dropdown
  const citySelect = document.getElementById('city-select');
  if (citySelect) {
    citySelect.addEventListener('change', (e) => {
      setCityFilter(e.target.value);
    });
  }

  // Search box
  const searchInput = document.getElementById('studio-search');
  searchInput.addEventListener('input', (e) => {
    state.searchQuery = e.target.value;
    renderStudioGrid();
    renderMapMarkers({ fitBounds: true });
  });

  // Favorite button
  document.getElementById('fav-toggle-btn').addEventListener('click', () => {
    const id = state.selectedStudioId;
    if (state.favorites.has(id)) {
      state.favorites.delete(id);
    } else {
      state.favorites.add(id);
    }
    saveFavorites();
    renderStudioGrid();
    renderDashboard();
  });

  // Center on map button
  document.getElementById('center-map-btn').addEventListener('click', () => {
    const studio = state.studios.find((s) => s.id === state.selectedStudioId);
    if (studio && state.map && typeof studio.lat === 'number') {
      state.map.setView([studio.lat, studio.lng], 14, { animate: true });
      if (state.markerById[studio.id]) {
        state.markerById[studio.id].openPopup();
      }
      document.getElementById('gym-map').scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  });

  // "Near Me" GPS Locator
  document.getElementById('locate-me-btn').addEventListener('click', () => {
    if (!navigator.geolocation) {
      alert('Geolocation is not supported by your browser.');
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const { latitude, longitude } = pos.coords;
        let nearest = null;
        let minDist = Infinity;
        for (const s of state.studios) {
          if (typeof s.lat === 'number' && typeof s.lng === 'number') {
            const d = Math.hypot(s.lat - latitude, s.lng - longitude);
            if (d < minDist) {
              minDist = d;
              nearest = s;
            }
          }
        }
        if (nearest) {
          state.selectedCityTab = 'All';
          document.querySelectorAll('.city-tab').forEach((t) => {
            t.classList.toggle('active', t.getAttribute('data-city') === 'All');
          });
          selectStudio(nearest.id, { panMap: true });
        }
      },
      () => {
        alert('Could not retrieve your location. Please use the map or city selector.');
      }
    );
  });

  // Horizon pills (+1h, +2h, +3h, +4h, +6h)
  document.querySelectorAll('.horizon-pill').forEach((pill) => {
    pill.addEventListener('click', () => {
      state.horizonHours = parseInt(pill.getAttribute('data-hours'), 10);
      document.querySelectorAll('.horizon-pill').forEach((p) => p.classList.remove('active'));
      pill.classList.add('active');
      renderDashboard();
    });
  });

  // Day selector tabs
  document.querySelectorAll('.day-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      state.selectedDayTab = btn.getAttribute('data-day');
      document.querySelectorAll('.day-btn').forEach((b) => b.classList.remove('active'));
      btn.classList.add('active');
      renderDashboard();
    });
  });

  // Manual live refresh
  document.getElementById('refresh-btn').addEventListener('click', async () => {
    await fetchLiveStudioUtilization(state.selectedStudioId);
    renderStudioGrid();
    renderMapMarkers({ fitBounds: false });
    renderDashboard();
  });
}

async function init() {
  saveFavorites();
  initMap();
  bindEvents();

  const [studiosRes, historyRes] = await Promise.allSettled([
    fetch('./data/studios.json').then((r) => r.json()),
    fetch('./data/history.json').then((r) => r.json()),
  ]);

  if (studiosRes.status === 'fulfilled' && Array.isArray(studiosRes.value)) {
    state.studios = studiosRes.value;
  }
  if (historyRes.status === 'fulfilled' && historyRes.value) {
    state.history = historyRes.value;
  }

  if (!state.studios.some((s) => s.id === state.selectedStudioId) && state.studios.length > 0) {
    state.selectedStudioId = state.studios[0].id;
  }

  populateCityDropdown();
  renderStudioGrid();
  renderMapMarkers({ fitBounds: true });
  renderDashboard();

  await fetchLiveStudioUtilization(state.selectedStudioId);
  renderStudioGrid();
  renderMapMarkers({ fitBounds: false });
  renderDashboard();
}

init();
