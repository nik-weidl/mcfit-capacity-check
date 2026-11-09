import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Navigation, RefreshCw, Search } from 'lucide-react';
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

export default function App() {
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
  const [isRefreshing, setIsRefreshing] = useState(false);

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

  // Prefetch live percentages when viewing a city (<= 25 studios)
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
    setIsRefreshing(true);
    await fetchLiveStudio(activeStudio.id);
    setIsRefreshing(false);
  };

  if (!activeStudio || !todayModel) {
    return (
      <div className="flex min-h-screen items-center justify-center text-sm text-muted-foreground">
        Loading studios...
      </div>
    );
  }

  const currentSlot = todayModel.hours[todayModel.activeHour] || todayModel.hours[0];
  const currentLvl = getLevelInfo(currentSlot.percentage);
  const nextH = (currentSlot.hour + 1) % 24;
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

  const chartTitle =
    selectedDayTab === 'today'
      ? `Today (${DAY_NAMES[todayModel.dayOfWeek]})`
      : DAY_NAMES[parseInt(selectedDayTab, 10)];

  return (
    <div className="min-h-screen bg-background text-foreground">
      {/* Top Navbar */}
      <header className="sticky top-0 z-50 border-b border-border/80 bg-background/85 backdrop-blur-md">
        <div className="container flex h-14 items-center justify-between">
          <h1 className="text-base font-bold tracking-tight">McFIT Capacity</h1>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={handleLocateMe}>
              <Navigation className="h-3.5 w-3.5" />
              Near Me
            </Button>
            <Button variant="outline" size="sm" onClick={handleRefresh}>
              <RefreshCw className={cn('h-3.5 w-3.5', isRefreshing && 'animate-spin')} />
              Refresh
            </Button>
          </div>
        </div>
      </header>

      <main className="container space-y-6 py-6">
        {/* MAIN FEATURE: Enlarged Hero Studio Capacity, Forecast & 24h Graph */}
        <Card className="border-border/90 shadow-lg">
          <CardHeader className="flex flex-col gap-4 pb-4 md:flex-row md:items-start md:justify-between">
            <div>
              <h2 className="text-2xl font-extrabold tracking-tight md:text-3xl">
                {formatStudioName(activeStudio.name)}
              </h2>
              <p className="mt-1 text-sm text-muted-foreground">
                {activeStudio.street}, {activeStudio.zipCode} {activeStudio.city}
              </p>
            </div>

            <TabsList className="flex-wrap h-auto">
              {DAY_TABS.map((tab) => (
                <TabsTrigger
                  key={tab.id}
                  active={selectedDayTab === tab.id}
                  onClick={() => setSelectedDayTab(tab.id)}
                >
                  {tab.label}
                </TabsTrigger>
              ))}
            </TabsList>
          </CardHeader>

          <CardContent className="space-y-6">
            {/* Hero KPI Strip */}
            <div className="grid grid-cols-1 gap-6 rounded-xl border border-border bg-secondary/40 p-5 md:grid-cols-3">
              {/* 1. Live Now */}
              <div className="flex flex-col justify-between space-y-1">
                <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  Now ({String(currentSlot.hour).padStart(2, '0')}:00–
                  {String(nextH).padStart(2, '0')}:00)
                </span>
                <div
                  className={cn(
                    'font-mono text-5xl font-extrabold tracking-tight tabular-nums md:text-6xl',
                    currentLvl.textClass
                  )}
                >
                  {currentSlot.percentage}%
                </div>
                <span className="text-xs text-muted-foreground">
                  {Math.abs(diffVsTypical) <= 3
                    ? `Typical ${dayShort}: ${currentSlot.typical}%`
                    : `${diffVsTypical > 0 ? `+${diffVsTypical}%` : `${diffVsTypical}%`} vs. typical ${dayShort} (${currentSlot.typical}%)`}
                </span>
              </div>

              {/* 2. In X Hours Forecast */}
              <div className="flex flex-col justify-between space-y-1 border-y border-border py-4 md:border-x md:border-y-0 md:px-6 md:py-0">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                    In +{horizonHours}h ({String(targetHour).padStart(2, '0')}:00
                    {isTomorrow ? ' +1d' : ''})
                  </span>
                  <div className="flex items-center gap-1">
                    {HORIZONS.map((h) => (
                      <button
                        key={h}
                        type="button"
                        onClick={() => setHorizonHours(h)}
                        className={cn(
                          'rounded px-2 py-0.5 font-mono text-xs font-bold transition-colors',
                          horizonHours === h
                            ? 'bg-sky-400 text-zinc-950'
                            : 'bg-background text-muted-foreground hover:text-foreground border border-border'
                        )}
                      >
                        +{h}h
                      </button>
                    ))}
                  </div>
                </div>
                <div className="font-mono text-5xl font-extrabold tracking-tight text-sky-400 tabular-nums md:text-6xl">
                  {predictedPct}%
                </div>
                <span className="text-xs text-muted-foreground">
                  {deltaFromNow >= 0 ? `+${deltaFromNow}%` : `${deltaFromNow}%`} vs. now &middot;
                  Typical {SHORT_DAYS[targetDow]}: {typicalAtTarget}%
                </span>
              </div>

              {/* 3. Best & Peak Windows */}
              <div className="flex flex-col justify-center gap-3.5">
                <div>
                  <span className="block text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                    Best Time Today
                  </span>
                  <span className="font-mono text-xl font-bold text-emerald-400 tabular-nums">
                    {bestSlot
                      ? `${String(bestSlot.hour).padStart(2, '0')}:00–${String(bestSlot.hour + 1).padStart(2, '0')}:00 (${bestSlot.percentage}%)`
                      : '--'}
                  </span>
                </div>
                <div>
                  <span className="block text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                    Peak Rush
                  </span>
                  <span className="font-mono text-xl font-bold text-rose-400 tabular-nums">
                    {peakSlot
                      ? `${String(peakSlot.hour).padStart(2, '0')}:00–${String(peakSlot.hour + 1).padStart(2, '0')}:00 (${peakSlot.percentage}%)`
                      : '--'}
                  </span>
                </div>
              </div>
            </div>

            {/* Enlarged 24-Hour Interactive Bar Chart */}
            <div className="space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h3 className="text-base font-semibold tracking-tight">{chartTitle}</h3>
                <div className="flex flex-wrap items-center gap-4 text-xs text-muted-foreground">
                  <span className="flex items-center gap-1.5">
                    <span className="h-2.5 w-2.5 rounded-sm bg-emerald-500" /> &lt;45%
                  </span>
                  <span className="flex items-center gap-1.5">
                    <span className="h-2.5 w-2.5 rounded-sm bg-amber-500" /> 45–74%
                  </span>
                  <span className="flex items-center gap-1.5">
                    <span className="h-2.5 w-2.5 rounded-sm bg-rose-500" /> &ge;75%
                  </span>
                  <span className="flex items-center gap-1.5">
                    <span className="h-2.5 w-2.5 rounded-sm border border-dashed border-sky-400 bg-sky-400/30" />{' '}
                    Forecast
                  </span>
                  <span className="flex items-center gap-1.5">
                    <span className="h-1 w-2.5 rounded-full bg-white/75" /> Typical
                  </span>
                </div>
              </div>

              <div className="grid w-full grid-cols-[repeat(24,minmax(0,1fr))] items-end gap-1.5 overflow-hidden border-b border-border pt-2">
                {displayHours.map((slot) => {
                  const lvl = getLevelInfo(slot.percentage);
                  const isTarget =
                    selectedDayTab === 'today' && !isTomorrow && slot.hour === targetHour;
                  const heightPct = Math.max(4, Math.min(100, slot.percentage));
                  const typicalBottomPct = Math.max(2, Math.min(98, slot.typical));

                  return (
                    <div
                      key={slot.hour}
                      onClick={() => {
                        if (selectedDayTab === 'today' && slot.hour > todayModel.activeHour) {
                          setHorizonHours(slot.hour - todayModel.activeHour);
                        }
                      }}
                      title={`${String(slot.hour).padStart(2, '0')}:00 — ${slot.isForecast ? 'Forecast' : 'Actual'}: ${slot.percentage}% (Typical: ${slot.typical}%)`}
                      className="group flex min-w-0 cursor-pointer flex-col items-center justify-end"
                    >
                      <span
                        className={cn(
                          'mb-1.5 font-mono text-[11px] font-bold leading-none tabular-nums text-muted-foreground',
                          slot.isCurrent && 'text-primary font-extrabold',
                          isTarget && 'text-sky-400 font-extrabold'
                        )}
                      >
                        {slot.percentage}%
                      </span>

                      <div className="relative flex h-[300px] w-full items-end rounded-t-md bg-secondary/35">
                        <div
                          className="pointer-events-none absolute left-[10%] right-[10%] z-10 h-[3px] rounded-full bg-white/75"
                          style={{ bottom: `${typicalBottomPct}%` }}
                        />
                        <div
                          className={cn(
                            'w-full rounded-t-md transition-all duration-200 group-hover:brightness-110',
                            slot.isForecast
                              ? 'border border-dashed border-sky-400 bg-sky-400/35'
                              : lvl.barClass,
                            slot.isCurrent &&
                              'ring-2 ring-primary shadow-[0_0_14px_rgba(250,204,21,0.35)]',
                            isTarget &&
                              'ring-2 ring-sky-400 shadow-[0_0_14px_rgba(56,189,248,0.35)]'
                          )}
                          style={{ height: `${heightPct}%` }}
                        />
                      </div>

                      <span
                        className={cn(
                          'py-1.5 font-mono text-[11px] tabular-nums text-muted-foreground',
                          slot.isCurrent && 'font-extrabold text-primary'
                        )}
                      >
                        {String(slot.hour).padStart(2, '0')}
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Map & Studio Finder Card */}
        <Card>
          <CardHeader className="pb-4">
            <div className="flex flex-wrap items-center gap-3">
              <NativeSelect
                value={selectedCity}
                onChange={(e) => {
                  setSelectedCity(e.target.value);
                  setFitBoundsTrigger((n) => n + 1);
                }}
                aria-label="Select city"
              >
                <option value="All">All Cities ({studios.length})</option>
                {citiesWithCounts.map(({ city, count }) => (
                  <option key={city} value={city}>
                    {city} ({count})
                  </option>
                ))}
              </NativeSelect>

              <div className="relative min-w-[220px] flex-1">
                <Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
                <Input
                  type="search"
                  placeholder="Search studio, street, or ZIP..."
                  value={searchQuery}
                  onChange={(e) => {
                    setSearchQuery(e.target.value);
                    setFitBoundsTrigger((n) => n + 1);
                  }}
                  className="pl-9"
                />
              </div>

              <NativeSelect
                value={sortBy}
                onChange={(e) => setSortBy(e.target.value)}
                aria-label="Sort studios"
              >
                <option value="city">City / Name</option>
                <option value="lowest-now">Quietest Now</option>
                <option value="lowest-2h">Quietest +2h</option>
                <option value="highest-now">Busiest Now</option>
              </NativeSelect>
            </div>
          </CardHeader>

          <CardContent>
            <div className="grid grid-cols-1 gap-4 lg:grid-cols-[1.5fr_1fr]">
              <GymMap
                studios={filteredStudios}
                selectedStudioId={selectedStudioId}
                history={history}
                liveCache={liveCache}
                onSelectStudio={handleSelectStudio}
                fitBoundsTrigger={fitBoundsTrigger}
              />

              <div className="flex h-[460px] flex-col gap-1.5 overflow-y-auto pr-1">
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
                        'flex items-center justify-between gap-3 rounded-lg border px-3.5 py-2.5 text-left transition-colors',
                        isSelected
                          ? 'border-primary bg-primary/10 text-foreground'
                          : 'border-border bg-secondary/40 hover:bg-secondary/80'
                      )}
                    >
                      <div className="min-w-0">
                        <div className="truncate text-sm font-semibold">{shortName}</div>
                        <div className="truncate text-xs text-muted-foreground">{subText}</div>
                      </div>
                      <span
                        className={cn(
                          'shrink-0 font-mono text-sm font-extrabold tabular-nums',
                          lvl ? lvl.textClass : 'text-muted-foreground'
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

        {/* Weekly Overview Heatmap */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Weekly Overview</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid w-full grid-cols-[56px_repeat(18,minmax(0,1fr))] gap-1 overflow-hidden">
              <div className="py-1.5 text-center font-mono text-xs font-semibold text-muted-foreground" />
              {Array.from({ length: 18 }, (_, i) => i + 6).map((h) => (
                <div
                  key={h}
                  className="py-1.5 text-center font-mono text-xs font-semibold text-muted-foreground"
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
                      className="flex items-center rounded-md bg-secondary/60 px-2 py-1.5 text-left text-xs font-bold hover:ring-1 hover:ring-primary"
                    >
                      {SHORT_DAYS[dow]}
                      {isToday ? ' •' : ''}
                    </button>
                    {Array.from({ length: 18 }, (_, i) => i + 6).map((h) => {
                      const pct = curve[h];
                      const lvl = getLevelInfo(pct);
                      return (
                        <div
                          key={h}
                          title={`${DAY_NAMES[dow]} ${String(h).padStart(2, '0')}:00 — ~${pct}%`}
                          className={cn(
                            'rounded-md py-1.5 text-center font-mono text-xs font-semibold tabular-nums',
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

