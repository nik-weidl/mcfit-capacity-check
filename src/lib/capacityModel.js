export const DAY_NAMES = [
  'Sunday',
  'Monday',
  'Tuesday',
  'Wednesday',
  'Thursday',
  'Friday',
  'Saturday',
];
export const SHORT_DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

export const BASE_WEEKDAY_PROFILES = {
  1: [3, 2, 1, 1, 2, 7, 18, 28, 34, 42, 48, 52, 48, 46, 52, 64, 82, 95, 98, 88, 70, 48, 25, 10],
  2: [3, 2, 1, 1, 2, 7, 19, 29, 34, 40, 46, 50, 46, 45, 50, 62, 80, 93, 95, 86, 68, 46, 24, 9],
  3: [3, 2, 1, 1, 2, 7, 18, 27, 33, 39, 45, 49, 45, 44, 49, 60, 77, 90, 92, 83, 65, 44, 22, 9],
  4: [3, 2, 1, 1, 2, 6, 17, 26, 32, 38, 44, 48, 44, 43, 48, 58, 74, 86, 88, 79, 62, 42, 21, 8],
  5: [3, 2, 1, 1, 2, 6, 16, 25, 31, 38, 45, 50, 48, 49, 55, 65, 75, 80, 72, 58, 42, 28, 16, 8],
  6: [5, 3, 2, 1, 1, 3, 8, 15, 26, 42, 58, 70, 74, 72, 68, 62, 55, 48, 40, 32, 22, 14, 9, 6],
  0: [4, 3, 2, 1, 1, 2, 6, 12, 24, 40, 56, 68, 72, 68, 62, 56, 50, 44, 36, 28, 19, 12, 7, 4],
};

export function formatStudioName(name) {
  return (name || '').replace(/^KLUB\s+/i, '').replace(/^McFIT\s+/i, '').trim();
}

export function getLevelInfo(pct) {
  if (pct < 45) {
    return {
      textClass: 'text-emerald-700 dark:text-emerald-400',
      barClass: 'bg-emerald-600 dark:bg-emerald-500',
      hmClass: 'bg-emerald-100 text-emerald-950 dark:bg-emerald-950/80 dark:text-emerald-200',
      pinCls: 'pin-low',
    };
  }
  if (pct < 75) {
    return {
      textClass: 'text-amber-700 dark:text-amber-400',
      barClass: 'bg-amber-500',
      hmClass: 'bg-amber-100 text-amber-950 dark:bg-amber-950/80 dark:text-amber-200',
      pinCls: 'pin-normal',
    };
  }
  return {
    textClass: 'text-rose-700 dark:text-rose-400',
    barClass: 'bg-rose-600 dark:bg-rose-500',
    hmClass: 'bg-rose-100 text-rose-950 dark:bg-rose-950/80 dark:text-rose-200',
    pinCls: 'pin-high',
  };
}

export function getBerlinNow() {
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

export function computeStudioScaleFactor(studioId, history, liveHoursArray, currentDow) {
  const studioHist = history?.studios?.[studioId]?.days || {};
  let observedSum = 0;
  let baseSum = 0;
  let recordedCount = 0;

  for (const [dateStr, hours] of Object.entries(studioHist)) {
    const d = new Date(`${dateStr}T12:00:00Z`);
    const dow = Number.isNaN(d.getTime()) ? currentDow : d.getUTCDay();
    const baseProfile = BASE_WEEKDAY_PROFILES[dow] || BASE_WEEKDAY_PROFILES[1];
    hours.forEach((val, h) => {
      if (typeof val === 'number' && h >= 7 && h <= 21) {
        recordedCount += 1;
        if (val > 0) {
          observedSum += val;
          baseSum += baseProfile[h];
        }
      }
    });
  }

  if (Array.isArray(liveHoursArray)) {
    const baseProfile = BASE_WEEKDAY_PROFILES[currentDow] || BASE_WEEKDAY_PROFILES[1];
    liveHoursArray.forEach((val, h) => {
      if (typeof val === 'number' && h >= 7 && h <= 21) {
        recordedCount += 1;
        if (val > 0) {
          observedSum += val;
          baseSum += baseProfile[h];
        }
      }
    });
  }

  if (recordedCount > 5 && observedSum === 0) return 0;
  if (baseSum < 20) return 0.5;
  const rawRatio = observedSum / baseSum;
  return Math.max(0.15, Math.min(1.45, rawRatio));
}

export function getStudioWeekdayCurve(studioId, targetDow, history, liveHoursToday, currentDow) {
  const studioScale = computeStudioScaleFactor(studioId, history, liveHoursToday, currentDow);
  const baseProfile = BASE_WEEKDAY_PROFILES[targetDow] || BASE_WEEKDAY_PROFILES[1];
  const studioHist = history?.studios?.[studioId]?.days || {};
  const { dateStr: todayDateStr } = getBerlinNow();

  // Sort matching past weekdays newest-first (so index 0 is the most recent recorded occurrence, e.g. yesterday)
  const matchingPastDays = Object.entries(studioHist)
    .filter(([dateStr, hours]) => {
      if (dateStr === todayDateStr || !Array.isArray(hours)) return false;
      const d = new Date(`${dateStr}T12:00:00Z`);
      return !Number.isNaN(d.getTime()) && d.getUTCDay() === targetDow;
    })
    .sort(([a], [b]) => b.localeCompare(a))
    .map(([, hours]) => hours);

  // Compute a weekday-specific scale factor if we have partial hours recorded for this weekday
  let dowObsSum = 0;
  let dowBaseSum = 0;
  matchingPastDays.forEach((arr) => {
    arr.forEach((v, h) => {
      if (typeof v === 'number' && v > 0 && h >= 6 && h <= 22) {
        dowObsSum += v;
        dowBaseSum += baseProfile[h];
      }
    });
  });
  const effectiveScale =
    dowBaseSum >= 20 ? Math.max(0.12, Math.min(1.45, dowObsSum / dowBaseSum)) : studioScale;

  return baseProfile.map((baseVal, hour) => {
    const calibratedBase = Math.min(100, Math.max(0, Math.round(baseVal * effectiveScale)));

    // Recency-weighted average of actual recorded values: most recent week gets weight 1.0, then 0.7, 0.49...
    let weightedSum = 0;
    let weightTotal = 0;
    let count = 0;

    matchingPastDays.forEach((arr, weeksAgoIdx) => {
      const v = arr[hour];
      if (typeof v === 'number' && v !== null) {
        const w = Math.pow(0.7, weeksAgoIdx);
        weightedSum += v * w;
        weightTotal += w;
        count += 1;
      }
    });

    if (count > 0) {
      // Use 100% of the actual recorded studio values when present
      return Math.min(100, Math.max(0, Math.round(weightedSum / weightTotal)));
    }

    return calibratedBase;
  });
}

export function buildWeekdaySeries(studioId, targetDow, history, todayModel) {
  const liveObserved = todayModel.hours.map((h) => (h.isForecast ? null : h.percentage));
  const curve = getStudioWeekdayCurve(
    studioId,
    targetDow,
    history,
    liveObserved,
    todayModel.dayOfWeek
  );

  const studioHist = history?.studios?.[studioId]?.days || {};
  const { dateStr: todayDateStr } = getBerlinNow();

  // Find the most recent recorded day for this weekday
  const latestMatch = Object.entries(studioHist)
    .filter(([dateStr, hours]) => {
      if (dateStr === todayDateStr || !Array.isArray(hours)) return false;
      const d = new Date(`${dateStr}T12:00:00Z`);
      return !Number.isNaN(d.getTime()) && d.getUTCDay() === targetDow;
    })
    .sort(([a], [b]) => b.localeCompare(a))[0];

  const latestHours = latestMatch ? latestMatch[1] : null;

  return curve.map((typicalPct, h) => {
    const recordedVal =
      latestHours && typeof latestHours[h] === 'number' ? latestHours[h] : null;
    const isSameAsToday =
      targetDow === todayModel.dayOfWeek && typeof liveObserved[h] === 'number';
    const actualVal = recordedVal !== null ? recordedVal : isSameAsToday ? liveObserved[h] : null;

    return {
      hour: h,
      percentage: actualVal !== null ? actualVal : typicalPct,
      typical: typicalPct,
      isCurrent: false,
      isForecast: actualVal === null,
    };
  });
}

export function buildTodaySeriesAndPredictions(studioId, history, liveCache) {
  const { hour: berlinHour, dateStr, dayOfWeek } = getBerlinNow();
  const liveEntry = liveCache[studioId];
  const histDay = history?.studios?.[studioId]?.days?.[dateStr] || new Array(24).fill(null);

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

  const typicalCurve = getStudioWeekdayCurve(studioId, dayOfWeek, history, liveHours, dayOfWeek);

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
      const predicted =
        typicalCurve[h] === 0
          ? 0
          : Math.min(100, Math.max(1, Math.round(typicalCurve[h] * effectiveMultiplier)));
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

export function getStudioCurrentPct(studioId, history, liveCache) {
  if (liveCache[studioId] && typeof liveCache[studioId].currentPct === 'number') {
    return liveCache[studioId].currentPct;
  }
  const { hour, dateStr } = getBerlinNow();
  const snap = history?.studios?.[studioId]?.days?.[dateStr];
  if (Array.isArray(snap)) {
    for (let h = hour; h >= 0; h--) {
      if (typeof snap[h] === 'number') return snap[h];
    }
  }
  const daysObj = history?.studios?.[studioId]?.days;
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

