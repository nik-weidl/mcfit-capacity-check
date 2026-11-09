import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Moon, Sun } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { TabsList, TabsTrigger } from '@/components/ui/tabs';
import { NativeSelect } from '@/components/ui/select';
import { GymMap } from '@/components/GymMap';
import {
  DAY_NAMES,
  SHORT_DAYS,
  formatStudioName,
  getLevelInfo,
  getBerlinNow,
  getStudioWeekdayCurve,
  buildTodaySeriesAndPredictions,
  getStudioCurrentPct,
} from '@/lib/capacityModel';
import { cn } from '@/lib/utils';

const DAY_TABS = [
  { id: 'today', label: 'Today' },
  { id: '1', label: 'Mon' },
  { id: '2', label: 'Tue' },
  { id: '3', label: 'Wed' },
  { id: '4', label: 'Thu' },
  { id: '5', label: 'Fri' },
  { id: '6', label: 'Sat' },
  { id: '0', label: 'Sun' },
];

const HORIZONS = [1, 2, 3, 4, 6];

/**
 * Generates a periodic, C2-continuous uniform cubic B-spline SVG path (`M ... C ...`)
 * that wraps seamlessly across the left and right edges for the desktop horizontal chart.
 */
function buildSmoothCurvePath(values, width = 2400, height = 300, wrap = true) {
  if (!values || values.length === 0) return '';
  const n = values.length;
  const stepX = width / n;

  const getPt = (idx) => {
    const clampedOrWrappedIdx = wrap
      ? ((idx % n) + n) % n
      : Math.max(0, Math.min(n - 1, idx));
    const val = Math.max(1, Math.min(99, values[clampedOrWrappedIdx]));
    return {
      x: idx * stepX + stepX / 2,
      y: height - (val / 100) * height,
    };
  };

  const startIdx = -1;
  const endIdx = n;

  const knot = (i) => {
    const pPrev = getPt(i - 1);
    const pCurr = getPt(i);
    const pNext = getPt(i + 1);
    return {
      x: (pPrev.x + 4 * pCurr.x + pNext.x) / 6,
      y: (pPrev.y + 4 * pCurr.y + pNext.y) / 6,
    };
  };

  const first = knot(startIdx);
  let d = `M ${first.x.toFixed(1)},${first.y.toFixed(1)}`;

  for (let i = startIdx; i < endIdx; i++) {
    const pCurr = getPt(i);
    const pNext = getPt(i + 1);
    const cp1x = (4 * pCurr.x + 2 * pNext.x) / 6;
    const cp1y = (4 * pCurr.y + 2 * pNext.y) / 6;
    const cp2x = (2 * pCurr.x + 4 * pNext.x) / 6;
    const cp2y = (2 * pCurr.y + 4 * pNext.y) / 6;
    const end = knot(i + 1);
    d += ` C ${cp1x.toFixed(1)},${cp1y.toFixed(1)} ${cp2x.toFixed(1)},${cp2y.toFixed(1)} ${end.x.toFixed(1)},${end.y.toFixed(1)}`;
  }

  return d;
}

/**
 * Generates a vertical C2-continuous uniform cubic B-spline SVG path (`M ... C ...`)
 * flowing top-to-bottom across horizontal bars for the mobile vertical timeline chart.
 */
function buildSmoothVerticalCurvePath(values, width = 300, height = 1800) {
  if (!values || values.length === 0) return '';
  const n = values.length;
  const stepY = height / n;

  const getPt = (idx) => {
    const clampedIdx = Math.max(0, Math.min(n - 1, idx));
    const val = Math.max(1, Math.min(99, values[clampedIdx]));
    return {
      x: (val / 100) * width,
      y: idx * stepY + stepY / 2,
    };
  };

  const startIdx = -1;
  const endIdx = n;

  const knot = (i) => {
    const pPrev = getPt(i - 1);
    const pCurr = getPt(i);
    const pNext = getPt(i + 1);
    return {
      x: (pPrev.x + 4 * pCurr.x + pNext.x) / 6,
      y: (pPrev.y + 4 * pCurr.y + pNext.y) / 6,
    };
  };

  const first = knot(startIdx);
  let d = `M ${first.x.toFixed(1)},${first.y.toFixed(1)}`;

  for (let i = startIdx; i < endIdx; i++) {
    const pCurr = getPt(i);
    const pNext = getPt(i + 1);
    const cp1x = (4 * pCurr.x + 2 * pNext.x) / 6;
    const cp1y = (4 * pCurr.y + 2 * pNext.y) / 6;
    const cp2x = (2 * pCurr.x + 4 * pNext.x) / 6;
    const cp2y = (2 * pCurr.y + 4 * pNext.y) / 6;
    const end = knot(i + 1);
    d += ` C ${cp1x.toFixed(1)},${cp1y.toFixed(1)} ${cp2x.toFixed(1)},${cp2y.toFixed(1)} ${end.x.toFixed(1)},${end.y.toFixed(1)}`;
  }

  return d;
}

export default function App() {
  const [theme, setTheme] = useState(
    () => localStorage.getItem('mcfit_theme') || 'light'
  );
  const [isDesktop, setIsDesktop] = useState(() =>
    typeof window !== 'undefined' ? window.matchMedia('(min-width: 1024px)').matches : true
  );
  const [studios, setStudios] = useState([]);
  const [history, setHistory] = useState({ studios: {} });
  const [liveCache, setLiveCache] = useState({});
  const [selectedStudioId, setSelectedStudioId] = useState(
    () => localStorage.getItem('mcfit_selected_studio') || '1858374200'
  );
  const [selectedCity, setSelectedCity] = useState('All');
  const [searchQuery, setSearchQuery] = useState('');
  const [sortBy, setSortBy] = useState('city');
  const [horizonHours, setHorizonHours] = useState(2);
  const [selectedDayTab, setSelectedDayTab] = useState('today');
  const [fitBoundsTrigger, setFitBoundsTrigger] = useState(0);

  useEffect(() => {
    const mq = window.matchMedia('(min-width: 1024px)');
    const handler = (e) => setIsDesktop(e.matches);
    setIsDesktop(mq.matches);
    mq.addEventListener('change', handler);
    return () => mq.removeEventListener('change', handler);
  }, []);

  useEffect(() => {
    document.documentElement.classList.toggle('dark', theme === 'dark');
    localStorage.setItem('mcfit_theme', theme);
  }, [theme]);

  const fetchLiveStudio = useCallback(async (studioId) => {
    try {
      const res = await fetch(
        `https://rsg-group.api.magicline.com/connect/v1/studio/${studioId}/utilization`
      );
      if (!res.ok) return;
      const data = await res.json();
      if (Array.isArray(data?.items)) {
        const currentIdx = data.items.findIndex((i) => i.isCurrent === true);
        const currentPct =
          currentIdx >= 0 ? data.items[currentIdx].percentage : data.items[0]?.percentage ?? null;
        setLiveCache((prev) => ({
          ...prev,
          [studioId]: {
            items: data.items,
            currentHour: currentIdx >= 0 ? currentIdx : getBerlinNow().hour,
            currentPct,
            fetchedAt: new Date(),
          },
        }));
      }
    } catch {
      // Fallback to snapshot
    }
  }, []);

  useEffect(() => {
    let mounted = true;
    Promise.allSettled([
      fetch('./data/studios.json').then((r) => r.json()),
      fetch('./data/history.json').then((r) => r.json()),
    ]).then(([sRes, hRes]) => {
      if (!mounted) return;
      if (sRes.status === 'fulfilled' && Array.isArray(sRes.value)) {
        setStudios(sRes.value);
        if (!sRes.value.some((s) => s.id === selectedStudioId) && sRes.value.length > 0) {
          setSelectedStudioId(sRes.value[0].id);
        }
      }
      if (hRes.status === 'fulfilled' && hRes.value) {
        setHistory(hRes.value);
      }
    });
    return () => {
      mounted = false;
    };
  }, []);

  useEffect(() => {
    if (selectedStudioId) {
      fetchLiveStudio(selectedStudioId);
    }
  }, [selectedStudioId, fetchLiveStudio]);

  const citiesWithCounts = useMemo(() => {
    const counts = {};
    for (const s of studios) {
      counts[s.city] = (counts[s.city] || 0) + 1;
    }
    return Object.keys(counts)
      .sort((a, b) => a.localeCompare(b, 'de'))
      .map((city) => ({ city, count: counts[city] }));
  }, [studios]);

  const filteredStudios = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    const list = studios.filter((s) => {
      if (selectedCity !== 'All' && s.city !== selectedCity) return false;
      if (q) {
        const hay = `${s.name} ${s.city} ${s.street} ${s.zipCode}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });

    if (sortBy === 'lowest-now') {
      list.sort(
        (a, b) =>
          (getStudioCurrentPct(a.id, history, liveCache) ?? 999) -
          (getStudioCurrentPct(b.id, history, liveCache) ?? 999)
      );
    } else if (sortBy === 'highest-now') {
      list.sort(
        (a, b) =>
          (getStudioCurrentPct(b.id, history, liveCache) ?? -1) -
          (getStudioCurrentPct(a.id, history, liveCache) ?? -1)
      );
    } else if (sortBy === 'lowest-2h') {
      list.sort((a, b) => {
        const pA = buildTodaySeriesAndPredictions(a.id, history, liveCache);
        const pB = buildTodaySeriesAndPredictions(b.id, history, liveCache);
        const vA = pA.hours[(pA.activeHour + 2) % 24]?.percentage ?? 999;
        const vB = pB.hours[(pB.activeHour + 2) % 24]?.percentage ?? 999;
        return vA - vB;
      });
    }
    return list;
  }, [studios, selectedCity, searchQuery, sortBy, history, liveCache]);

  useEffect(() => {
    if (filteredStudios.length === 0 || filteredStudios.length > 25) return;
    filteredStudios.forEach((s) => {
      if (!liveCache[s.id]) {
        fetchLiveStudio(s.id);
      }
    });
  }, [filteredStudios, liveCache, fetchLiveStudio]);

  const activeStudio = useMemo(
    () => studios.find((s) => s.id === selectedStudioId) || studios[0] || null,
    [studios, selectedStudioId]
  );

  const todayModel = useMemo(() => {
    if (!activeStudio) return null;
    return buildTodaySeriesAndPredictions(activeStudio.id, history, liveCache);
  }, [activeStudio, history, liveCache]);

  const handleSelectStudio = useCallback((id) => {
    setSelectedStudioId(id);
    localStorage.setItem('mcfit_selected_studio', id);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }, []);

  const handleLocateMe = () => {
    if (!navigator.geolocation) return;
    navigator.geolocation.getCurrentPosition((pos) => {
      const { latitude, longitude } = pos.coords;
      let nearest = null;
      let minDist = Infinity;
      for (const s of studios) {
        if (typeof s.lat === 'number' && typeof s.lng === 'number') {
          const d = Math.hypot(s.lat - latitude, s.lng - longitude);
          if (d < minDist) {
            minDist = d;
            nearest = s;
          }
        }
      }
      if (nearest) {
        setSelectedCity('All');
        handleSelectStudio(nearest.id);
      }
    });
  };

  const handleRefresh = async () => {
    if (!activeStudio) return;
    await fetchLiveStudio(activeStudio.id);
  };

  if (!activeStudio || !todayModel) {
    return (
      <div className="flex min-h-screen items-center justify-center text-sm text-foreground">
        Loading studios...
      </div>
    );
  }

  const currentSlot = todayModel.hours[todayModel.activeHour] || todayModel.hours[0];
  const currentLvl = getLevelInfo(currentSlot.percentage);
  const diffVsTypical = currentSlot.percentage - currentSlot.typical;
  const dayShort = SHORT_DAYS[todayModel.dayOfWeek];

  const targetHour = (todayModel.activeHour + horizonHours) % 24;
  const isTomorrow = todayModel.activeHour + horizonHours >= 24;
  const targetDow = isTomorrow ? (todayModel.dayOfWeek + 1) % 7 : todayModel.dayOfWeek;
  const tomorrowCurve = getStudioWeekdayCurve(
    activeStudio.id,
    targetDow,
    history,
    todayModel.hours.map((h) => (h.isForecast ? null : h.percentage)),
    todayModel.dayOfWeek
  );
  const predictedPct = isTomorrow
    ? tomorrowCurve[targetHour]
    : todayModel.hours[targetHour].percentage;
  const deltaFromNow = predictedPct - currentSlot.percentage;
  const typicalAtTarget = isTomorrow
    ? tomorrowCurve[targetHour]
    : todayModel.typicalCurve[targetHour];

  const workoutHours = todayModel.hours.filter(
    (h) => h.hour >= Math.max(6, todayModel.activeHour) && h.hour <= 22
  );
  const pool = workoutHours.length > 0 ? workoutHours : todayModel.hours.slice(6, 23);
  const bestSlot = [...pool].sort((a, b) => a.percentage - b.percentage)[0];
  const peakSlot = [...todayModel.hours.slice(6, 23)].sort(
    (a, b) => b.percentage - a.percentage
  )[0];

  const displayHours =
    selectedDayTab === 'today'
      ? todayModel.hours
      : getStudioWeekdayCurve(
          activeStudio.id,
          parseInt(selectedDayTab, 10),
          history,
          todayModel.hours.map((h) => (h.isForecast ? null : h.percentage)),
          todayModel.dayOfWeek
        ).map((pct, h) => ({
          hour: h,
          percentage: pct,
          typical: pct,
          isCurrent: false,
          isForecast: false,
        }));

  // Active gym hours (06:00 to 23:00) for the mobile vertical horizontal-bar timeline
  const mobileHours = displayHours.slice(6, 24);

  const chartTitle =
    selectedDayTab === 'today'
      ? `Today (${DAY_NAMES[todayModel.dayOfWeek]})`
      : DAY_NAMES[parseInt(selectedDayTab, 10)];

  return (
    <div className="min-h-screen w-full max-w-[100vw] overflow-x-hidden bg-background text-foreground">
      {/* Top Navbar */}
      <header className="sticky top-0 z-50 border-b border-border bg-background">
        <div className="container flex h-16 items-center justify-between gap-2 lg:h-14">
          <h1 className="truncate text-base font-bold tracking-tight sm:text-lg lg:text-base">
            McFIT Capacity
          </h1>
          <div className="flex shrink-0 items-center gap-2">
            <Button variant="outline" size="sm" onClick={handleLocateMe}>
              Near Me
            </Button>
            <Button variant="outline" size="sm" onClick={handleRefresh}>
              Refresh
            </Button>
            <Button
              variant="outline"
              size="icon"
              onClick={() => setTheme((t) => (t === 'light' ? 'dark' : 'light'))}
              title={theme === 'light' ? 'Switch to dark mode' : 'Switch to light mode'}
              aria-label="Toggle theme"
            >
              {theme === 'light' ? (
                <Moon className="h-4 w-4" />
              ) : (
                <Sun className="h-4 w-4" />
              )}
            </Button>
          </div>
        </div>
      </header>

      <main className="container min-w-0 space-y-5 py-4 md:space-y-10 md:py-8">
        {/* MAIN FEATURE: Studio Capacity, Forecast & Graph */}
        <Card className="min-w-0 overflow-hidden p-0 md:p-4">
          <CardHeader className="flex min-w-0 flex-col gap-4 pb-5 lg:flex-row lg:items-start lg:justify-between lg:pb-8">
            <div className="min-w-0">
              <h2 className="truncate text-2xl font-extrabold tracking-tight sm:text-3xl md:text-4xl">
                {formatStudioName(activeStudio.name)}
              </h2>
              <p className="mt-1 truncate text-xs font-medium text-muted-foreground sm:text-sm">
                {activeStudio.street}, {activeStudio.zipCode} {activeStudio.city}
              </p>
            </div>

            <TabsList className="grid h-auto w-full grid-cols-4 gap-2 lg:inline-flex lg:w-auto lg:flex-wrap lg:gap-1">
              {DAY_TABS.map((tab) => (
                <TabsTrigger
                  key={tab.id}
                  active={selectedDayTab === tab.id}
                  onClick={() => setSelectedDayTab(tab.id)}
                  className="w-full lg:w-auto"
                >
                  {tab.label}
                </TabsTrigger>
              ))}
            </TabsList>
          </CardHeader>

          <CardContent className="min-w-0 space-y-7 md:space-y-12">
            {/* Hero KPI Section */}
            <div className="space-y-4 lg:space-y-0">
              <div className="grid grid-cols-2 gap-4 lg:grid-cols-3 lg:gap-12">
                {/* 1. Live Now */}
                <div className="flex min-w-0 flex-col justify-between space-y-1 md:space-y-2">
                  <span className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
                    Now ({String(currentSlot.hour).padStart(2, '0')}:00)
                  </span>
                  <div
                    className={cn(
                      'text-4xl font-black tracking-tight tabular-nums sm:text-5xl md:text-6xl',
                      currentLvl.textClass
                    )}
                  >
                    {currentSlot.percentage}%
                  </div>
                  <span className="truncate text-xs font-medium text-muted-foreground sm:text-sm">
                    {Math.abs(diffVsTypical) <= 3
                      ? `Typical ${dayShort}: ${currentSlot.typical}%`
                      : `${diffVsTypical > 0 ? `+${diffVsTypical}%` : `${diffVsTypical}%`} vs. ${dayShort} (${currentSlot.typical}%)`}
                  </span>
                </div>

                {/* 2. In X Hours Forecast */}
                <div className="flex min-w-0 flex-col justify-between space-y-1 md:space-y-2">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
                      In +{horizonHours}h ({String(targetHour).padStart(2, '0')}:00)
                    </span>
                    {/* Desktop inline horizon buttons */}
                    <div className="hidden items-center gap-1.5 lg:flex">
                      {HORIZONS.map((h) => (
                        <button
                          key={h}
                          type="button"
                          onClick={() => setHorizonHours(h)}
                          className={cn(
                            'h-8 rounded px-3 text-xs font-bold tabular-nums transition-colors',
                            horizonHours === h
                              ? 'bg-primary text-primary-foreground'
                              : 'bg-secondary text-foreground/80 hover:text-foreground'
                          )}
                        >
                          +{h}h
                        </button>
                      ))}
                    </div>
                  </div>
                  <div className="text-4xl font-black tracking-tight text-indigo-700 tabular-nums dark:text-indigo-400 sm:text-5xl md:text-6xl">
                    {predictedPct}%
                  </div>
                  <span className="truncate text-xs font-medium text-muted-foreground sm:text-sm">
                    {deltaFromNow >= 0 ? `+${deltaFromNow}%` : `${deltaFromNow}%`} vs. now &middot;
                    Typ. {typicalAtTarget}%
                  </span>
                </div>

                {/* 3. Best & Peak Windows */}
                <div className="col-span-2 grid grid-cols-2 gap-4 border-t border-border pt-4 lg:col-span-1 lg:flex lg:flex-col lg:justify-between lg:gap-6 lg:border-t-0 lg:pt-0">
                  <div className="min-w-0 space-y-0.5">
                    <span className="block text-xs font-bold uppercase tracking-wider text-muted-foreground">
                      Best Time
                    </span>
                    <span className="block truncate text-lg font-extrabold text-emerald-700 tabular-nums dark:text-emerald-400 md:text-2xl">
                      {bestSlot
                        ? `${String(bestSlot.hour).padStart(2, '0')}:00 (${bestSlot.percentage}%)`
                        : '--'}
                    </span>
                  </div>
                  <div className="min-w-0 space-y-0.5">
                    <span className="block text-xs font-bold uppercase tracking-wider text-muted-foreground">
                      Peak Rush
                    </span>
                    <span className="block truncate text-lg font-extrabold text-rose-700 tabular-nums dark:text-rose-400 md:text-2xl">
                      {peakSlot
                        ? `${String(peakSlot.hour).padStart(2, '0')}:00 (${peakSlot.percentage}%)`
                        : '--'}
                    </span>
                  </div>
                </div>
              </div>

              {/* Mobile / Touch Full-Width Horizon Selector Bar (< lg) */}
              <div className="grid grid-cols-5 gap-2 pt-1 lg:hidden">
                {HORIZONS.map((h) => (
                  <button
                    key={h}
                    type="button"
                    onClick={() => setHorizonHours(h)}
                    className={cn(
                      'flex h-11 min-h-[44px] touch-manipulation items-center justify-center rounded-md border text-sm font-bold tabular-nums transition-colors',
                      horizonHours === h
                        ? 'border-foreground bg-primary text-primary-foreground'
                        : 'border-border bg-secondary text-foreground/90'
                    )}
                  >
                    +{h}h
                  </button>
                ))}
              </div>
            </div>

            {/* CHART SECTION */}
            <div className="min-w-0 space-y-4">
              <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between">
                <h3 className="text-base font-bold tracking-tight">{chartTitle}</h3>
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 text-xs font-semibold text-foreground/85 sm:gap-5">
                  <span className="flex items-center gap-1.5">
                    <span className="h-2.5 w-2.5 rounded-sm bg-emerald-600 dark:bg-emerald-500" /> &lt;45%
                  </span>
                  <span className="flex items-center gap-1.5">
                    <span className="h-2.5 w-2.5 rounded-sm bg-amber-500" /> 45–74%
                  </span>
                  <span className="flex items-center gap-1.5">
                    <span className="h-2.5 w-2.5 rounded-sm bg-rose-600 dark:bg-rose-500" /> &ge;75%
                  </span>
                  <span className="flex items-center gap-1.5">
                    <span className="h-2.5 w-2.5 rounded-sm bg-indigo-600 dark:bg-indigo-500" />{' '}
                    Forecast
                  </span>
                  <span className="flex items-center gap-1.5">
                    <span className="h-0.5 w-3 bg-foreground" /> Typical
                  </span>
                </div>
              </div>

              {/* MOBILE / TABLET GRAPH (< lg): Vertical Timeline of Horizontal Bars (06:00–23:00) + Vertical Typical Curve */}
              <div className="grid w-full min-w-0 grid-cols-[44px_minmax(0,1fr)_42px] items-stretch gap-2.5 lg:hidden">
                {/* Left Column: Hours */}
                <div className="flex flex-col">
                  {mobileHours.map((slot) => {
                    const isTarget =
                      selectedDayTab === 'today' && !isTomorrow && slot.hour === targetHour;
                    return (
                      <button
                        key={slot.hour}
                        type="button"
                        onClick={() => {
                          if (selectedDayTab === 'today' && slot.hour > todayModel.activeHour) {
                            setHorizonHours(slot.hour - todayModel.activeHour);
                          }
                        }}
                        className={cn(
                          'flex h-9 min-h-[36px] touch-manipulation items-center text-left font-mono text-xs font-medium tabular-nums text-foreground/85 sm:h-10 sm:text-sm',
                          slot.isCurrent && 'font-black text-foreground',
                          isTarget && 'font-black text-indigo-700 dark:text-indigo-300'
                        )}
                      >
                        {String(slot.hour).padStart(2, '0')}:00
                      </button>
                    );
                  })}
                </div>

                {/* Middle Column: Horizontal Bars + Overlaid Smooth Vertical Typical Curve */}
                <div className="relative flex min-w-0 flex-col overflow-hidden">
                  <svg
                    viewBox="0 0 300 1800"
                    preserveAspectRatio="none"
                    className="pointer-events-none absolute inset-0 z-20 h-full w-full overflow-hidden"
                  >
                    <path
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      vectorEffect="non-scaling-stroke"
                      className="text-foreground"
                      d={buildSmoothVerticalCurvePath(
                        mobileHours.map((slot) => slot.typical),
                        300,
                        1800
                      )}
                    />
                  </svg>

                  {mobileHours.map((slot) => {
                    const lvl = getLevelInfo(slot.percentage);
                    const isTarget =
                      selectedDayTab === 'today' && !isTomorrow && slot.hour === targetHour;
                    const widthPct = Math.max(3, Math.min(100, slot.percentage));

                    return (
                      <button
                        key={slot.hour}
                        type="button"
                        onClick={() => {
                          if (selectedDayTab === 'today' && slot.hour > todayModel.activeHour) {
                            setHorizonHours(slot.hour - todayModel.activeHour);
                          }
                        }}
                        aria-label={`${String(slot.hour).padStart(2, '0')}:00 capacity ${slot.percentage}%`}
                        className="flex h-9 min-h-[36px] w-full min-w-0 touch-manipulation items-center py-1.5 sm:h-10"
                      >
                        <div className="relative flex h-full w-full items-center bg-secondary">
                          <div
                            className={cn(
                              'h-full',
                              slot.isForecast
                                ? 'bg-indigo-600/80 dark:bg-indigo-500/80'
                                : lvl.barClass,
                              slot.isCurrent && 'outline outline-2 outline-foreground',
                              isTarget && 'outline outline-2 outline-primary'
                            )}
                            style={{ width: `${widthPct}%` }}
                          />
                        </div>
                      </button>
                    );
                  })}
                </div>

                {/* Right Column: Percentages */}
                <div className="flex flex-col">
                  {mobileHours.map((slot) => {
                    const isTarget =
                      selectedDayTab === 'today' && !isTomorrow && slot.hour === targetHour;
                    return (
                      <button
                        key={slot.hour}
                        type="button"
                        onClick={() => {
                          if (selectedDayTab === 'today' && slot.hour > todayModel.activeHour) {
                            setHorizonHours(slot.hour - todayModel.activeHour);
                          }
                        }}
                        className={cn(
                          'flex h-9 min-h-[36px] touch-manipulation items-center justify-end font-mono text-xs font-semibold tabular-nums text-foreground/85 sm:h-10 sm:text-sm',
                          slot.isCurrent && 'font-black text-foreground',
                          isTarget && 'font-black text-indigo-700 dark:text-indigo-300'
                        )}
                      >
                        {slot.percentage}%
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* DESKTOP CHART (lg+): Full 24-Hour Horizontal Bar Chart with Smooth Typical Curve */}
              <div className="relative hidden w-full min-w-0 lg:block">
                <svg
                  viewBox="0 0 2400 300"
                  preserveAspectRatio="none"
                  className="pointer-events-none absolute inset-x-0 top-8 z-20 h-[300px] w-full overflow-hidden"
                >
                  <path
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2.5"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    vectorEffect="non-scaling-stroke"
                    className="text-foreground"
                    d={buildSmoothCurvePath(displayHours.map((slot) => slot.typical))}
                  />
                </svg>

                <div className="grid w-full grid-cols-[repeat(24,minmax(0,1fr))] items-end overflow-hidden border-b border-border pt-2">
                  {displayHours.map((slot) => {
                    const lvl = getLevelInfo(slot.percentage);
                    const isTarget =
                      selectedDayTab === 'today' && !isTomorrow && slot.hour === targetHour;
                    const heightPct = Math.max(4, Math.min(100, slot.percentage));

                    return (
                      <div
                        key={slot.hour}
                        onClick={() => {
                          if (selectedDayTab === 'today' && slot.hour > todayModel.activeHour) {
                            setHorizonHours(slot.hour - todayModel.activeHour);
                          }
                        }}
                        title={`${String(slot.hour).padStart(2, '0')}:00 — ${slot.isForecast ? 'Forecast' : 'Actual'}: ${slot.percentage}% (Typical: ${slot.typical}%)`}
                        className="flex min-w-0 cursor-pointer flex-col items-center justify-end px-[3px]"
                      >
                        <span
                          className={cn(
                            'mb-2 h-4 font-mono text-xs font-semibold leading-4 tabular-nums text-foreground/80',
                            slot.isCurrent && 'font-black text-foreground',
                            isTarget && 'font-black text-indigo-700 dark:text-indigo-300'
                          )}
                        >
                          {slot.percentage}%
                        </span>

                        <div className="relative flex h-[300px] w-full items-end bg-secondary">
                          <div
                            className={cn(
                              'w-full',
                              slot.isForecast
                                ? 'bg-indigo-600/80 dark:bg-indigo-500/80'
                                : lvl.barClass,
                              slot.isCurrent && 'outline outline-2 outline-foreground',
                              isTarget && 'outline outline-2 outline-primary'
                            )}
                            style={{ height: `${heightPct}%` }}
                          />
                        </div>

                        <span
                          className={cn(
                            'py-2 font-mono text-xs font-medium tabular-nums text-foreground/80',
                            slot.isCurrent && 'font-black text-foreground'
                          )}
                        >
                          {String(slot.hour).padStart(2, '0')}
                        </span>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Studio Finder Card (Map disabled on mobile viewports < lg) */}
        <Card className="min-w-0 overflow-hidden p-0 md:p-4">
          <CardHeader className="min-w-0 pb-4 md:pb-6">
            <div className="flex min-w-0 flex-col gap-2.5 lg:flex-row lg:flex-wrap lg:items-center lg:gap-3">
              <div className="w-full min-w-0 lg:order-2 lg:min-w-[200px] lg:flex-1">
                <Input
                  type="search"
                  placeholder="Search studio, street, or ZIP..."
                  value={searchQuery}
                  onChange={(e) => {
                    setSearchQuery(e.target.value);
                    setFitBoundsTrigger((n) => n + 1);
                  }}
                />
              </div>

              <div className="grid w-full min-w-0 grid-cols-1 gap-2.5 sm:grid-cols-2 lg:order-1 lg:flex lg:w-auto">
                <NativeSelect
                  value={selectedCity}
                  onChange={(e) => {
                    setSelectedCity(e.target.value);
                    setFitBoundsTrigger((n) => n + 1);
                  }}
                  aria-label="Select city"
                  className="lg:w-48"
                >
                  <option value="All">All Cities ({studios.length})</option>
                  {citiesWithCounts.map(({ city, count }) => (
                    <option key={city} value={city}>
                      {city} ({count})
                    </option>
                  ))}
                </NativeSelect>

                <NativeSelect
                  value={sortBy}
                  onChange={(e) => setSortBy(e.target.value)}
                  aria-label="Sort studios"
                  className="lg:w-40"
                >
                  <option value="city">City / Name</option>
                  <option value="lowest-now">Quietest Now</option>
                  <option value="lowest-2h">Quietest +2h</option>
                  <option value="highest-now">Busiest Now</option>
                </NativeSelect>
              </div>
            </div>
          </CardHeader>

          <CardContent className="min-w-0">
            <div className="grid min-w-0 grid-cols-1 gap-6 lg:grid-cols-[1.5fr_1fr]">
              {isDesktop && (
                <div className="hidden min-w-0 lg:block">
                  <GymMap
                    studios={filteredStudios}
                    selectedStudioId={selectedStudioId}
                    history={history}
                    liveCache={liveCache}
                    onSelectStudio={handleSelectStudio}
                    fitBoundsTrigger={fitBoundsTrigger}
                    theme={theme}
                  />
                </div>
              )}

              <div className="flex h-[380px] w-full min-w-0 flex-col gap-2 overflow-y-auto pr-1 sm:h-[460px]">
                {filteredStudios.map((s) => {
                  const pct = getStudioCurrentPct(s.id, history, liveCache);
                  const lvl = pct !== null ? getLevelInfo(pct) : null;
                  const isSelected = s.id === selectedStudioId;
                  const shortName = formatStudioName(s.name);
                  const subText = shortName.toLowerCase().includes(s.city.toLowerCase())
                    ? s.street
                    : `${s.street} (${s.city})`;

                  return (
                    <button
                      key={s.id}
                      type="button"
                      onClick={() => handleSelectStudio(s.id)}
                      className={cn(
                        'flex min-h-[54px] w-full min-w-0 touch-manipulation items-center justify-between gap-3 rounded-md border px-4 py-3 text-left transition-colors lg:min-h-0 lg:py-2.5',
                        isSelected
                          ? 'border-foreground bg-primary text-primary-foreground'
                          : 'border-border bg-card hover:bg-secondary'
                      )}
                    >
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-sm font-bold">{shortName}</div>
                        <div
                          className={cn(
                            'truncate text-xs font-medium',
                            isSelected ? 'text-primary-foreground/85' : 'text-muted-foreground'
                          )}
                        >
                          {subText}
                        </div>
                      </div>
                      <span
                        className={cn(
                          'shrink-0 font-mono text-sm font-extrabold tabular-nums',
                          isSelected
                            ? 'text-primary-foreground'
                            : lvl
                              ? lvl.textClass
                              : 'text-muted-foreground'
                        )}
                      >
                        {pct !== null ? `${pct}%` : '--%'}
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Weekly Overview Card */}
        <Card className="min-w-0 overflow-hidden p-0 md:p-4">
          <CardHeader className="min-w-0 pb-4 md:pb-5">
            <CardTitle className="text-base sm:text-lg">Weekly Overview</CardTitle>
          </CardHeader>
          <CardContent className="min-w-0">
            {/* MOBILE / TABLET WEEKLY VIEW (< lg): Compact 7-Day Time-of-Day Breakdown */}
            <div className="min-w-0 space-y-2 lg:hidden">
              <div className="grid grid-cols-[56px_repeat(3,minmax(0,1fr))] gap-2 px-0.5 text-xs font-bold uppercase tracking-wider text-muted-foreground">
                <span>Day</span>
                <span className="text-center">06–12h</span>
                <span className="text-center">12–17h</span>
                <span className="text-center">17–22h</span>
              </div>
              {[1, 2, 3, 4, 5, 6, 0].map((dow) => {
                const isToday = dow === todayModel.dayOfWeek;
                const liveObserved = todayModel.hours.map((h) =>
                  h.isForecast ? null : h.percentage
                );
                const curve = getStudioWeekdayCurve(
                  activeStudio.id,
                  dow,
                  history,
                  liveObserved,
                  todayModel.dayOfWeek
                );
                const avgRange = (start, end) => {
                  const slice = curve.slice(start, end);
                  return Math.round(slice.reduce((a, b) => a + b, 0) / slice.length);
                };
                const morningPct = avgRange(6, 12);
                const afternoonPct = avgRange(12, 17);
                const eveningPct = avgRange(17, 22);

                return (
                  <div
                    key={dow}
                    onClick={() => {
                      setSelectedDayTab(String(dow));
                      window.scrollTo({ top: 0, behavior: 'smooth' });
                    }}
                    className="grid min-w-0 cursor-pointer touch-manipulation grid-cols-[56px_repeat(3,minmax(0,1fr))] items-center gap-2"
                  >
                    <button
                      type="button"
                      className={cn(
                        'flex h-11 min-h-[44px] touch-manipulation items-center justify-center rounded-md border text-sm font-bold',
                        isToday
                          ? 'border-foreground bg-primary text-primary-foreground'
                          : 'border-border bg-secondary text-foreground'
                      )}
                    >
                      {SHORT_DAYS[dow]}
                    </button>
                    {[morningPct, afternoonPct, eveningPct].map((pct, idx) => {
                      const lvl = getLevelInfo(pct);
                      return (
                        <div
                          key={idx}
                          className={cn(
                            'flex h-11 min-h-[44px] min-w-0 items-center justify-center rounded-md font-mono text-sm font-bold tabular-nums',
                            lvl.hmClass
                          )}
                        >
                          {pct}%
                        </div>
                      );
                    })}
                  </div>
                );
              })}
            </div>

            {/* DESKTOP WEEKLY VIEW (lg+): Full 18-Hour Heatmap Matrix */}
            <div className="hidden w-full min-w-0 grid-cols-[56px_repeat(18,minmax(0,1fr))] gap-1.5 overflow-hidden lg:grid">
              <div className="py-1.5 text-center font-mono text-xs font-bold text-foreground/80" />
              {Array.from({ length: 18 }, (_, i) => i + 6).map((h) => (
                <div
                  key={h}
                  className="py-1.5 text-center font-mono text-xs font-bold text-foreground/85"
                >
                  {String(h).padStart(2, '0')}
                </div>
              ))}

              {[1, 2, 3, 4, 5, 6, 0].map((dow) => {
                const isToday = dow === todayModel.dayOfWeek;
                const liveObserved = todayModel.hours.map((h) =>
                  h.isForecast ? null : h.percentage
                );
                const curve = getStudioWeekdayCurve(
                  activeStudio.id,
                  dow,
                  history,
                  liveObserved,
                  todayModel.dayOfWeek
                );

                return (
                  <React.Fragment key={dow}>
                    <button
                      type="button"
                      onClick={() => setSelectedDayTab(String(dow))}
                      className={cn(
                        'flex items-center rounded px-2.5 py-2 text-left text-xs font-bold transition-colors',
                        isToday
                          ? 'bg-primary text-primary-foreground'
                          : 'bg-secondary text-foreground hover:bg-primary/40'
                      )}
                    >
                      {SHORT_DAYS[dow]}
                    </button>
                    {Array.from({ length: 18 }, (_, i) => i + 6).map((h) => {
                      const pct = curve[h];
                      const lvl = getLevelInfo(pct);
                      return (
                        <div
                          key={h}
                          title={`${DAY_NAMES[dow]} ${String(h).padStart(2, '0')}:00 — ~${pct}%`}
                          className={cn(
                            'rounded py-2 text-center font-mono text-xs font-bold tabular-nums',
                            lvl.hmClass
                          )}
                        >
                          {pct}%
                        </div>
                      );
                    })}
                  </React.Fragment>
                );
              })}
            </div>
          </CardContent>
        </Card>
      </main>
    </div>
  );
}
