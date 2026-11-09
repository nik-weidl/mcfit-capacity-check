#!/usr/bin/env node
/**
 * McFIT Capacity Collector (All German McFIT Studios)
 *
 * - Fetches all active German McFIT studios from Magicline's public connect API.
 * - Each call to `/connect/v1/studio/{id}/utilization` returns ALL 24 hourly slots
 *   for the current day at once.
 * - Automatically skips and filters out legacy/closed studio entries (HTTP 403/404).
 * - Uses polite batched concurrency (5 requests per batch, 150ms pause) so collecting
 *   all ~165+ German McFIT studios finishes in ~5 seconds.
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(__dirname, '..', 'data');
const STUDIOS_FILE = path.join(DATA_DIR, 'studios.json');
const HISTORY_FILE = path.join(DATA_DIR, 'history.json');

const STUDIO_LIST_URL =
  'https://rsg-group.api.magicline.com/connect/v1/studio?studioTags=AKTIV-391B8025C1714FB9B15BB02F2F8AC0B2';

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function normalizeCity(studio) {
  const rawCity = (studio.address?.city || '').trim();
  const name = (studio.studioName || '').trim();
  if (/münchen|muenchen|munich/i.test(rawCity) || /münchen|muenchen|munich/i.test(name)) {
    return 'München';
  }
  if (/berlin/i.test(rawCity) || /berlin/i.test(name)) {
    return 'Berlin';
  }
  if (/hamburg/i.test(rawCity) || /hamburg/i.test(name)) {
    return 'Hamburg';
  }
  if (/köln|koeln|cologne/i.test(rawCity) || /köln|koeln/i.test(name)) {
    return 'Köln';
  }
  if (/frankfurt/i.test(rawCity)) {
    return 'Frankfurt am Main';
  }
  return rawCity || 'Other';
}

function isGermanMcFit(studio) {
  const country = studio.address?.countryCodeAlpha2 || '';
  const name = studio.studioName || '';
  return country === 'DE' && /mcfit/i.test(name);
}

async function fetchJson(url) {
  const res = await fetch(url, {
    headers: {
      Accept: 'application/json',
      'User-Agent': 'mcfit-capacity-check/1.0 (personal gym planner)',
    },
  });
  if (!res.ok) {
    const err = new Error(`HTTP ${res.status} for ${url}`);
    err.status = res.status;
    throw err;
  }
  return res.json();
}

async function main() {
  await fs.mkdir(DATA_DIR, { recursive: true });

  console.log('Fetching studio list from Magicline public endpoint...');
  const rawStudios = await fetchJson(STUDIO_LIST_URL);

  const candidateStudios = rawStudios
    .filter((s) => isGermanMcFit(s))
    .map((s) => {
      const city = normalizeCity(s);
      return {
        id: String(s.id),
        name: (s.studioName || '').trim(),
        city,
        cityGroup: city,
        street: `${(s.address?.street || '').trim()} ${(s.address?.houseNumber || '').trim()}`.trim(),
        zipCode: (s.address?.zipCode || '').trim(),
        countryCode: s.address?.countryCodeAlpha2 || 'DE',
        lat: s.address?.latitude ?? null,
        lng: s.address?.longitude ?? null,
        tracked: true,
      };
    })
    .sort((a, b) => {
      const cityCmp = a.city.localeCompare(b.city, 'de');
      if (cityCmp !== 0) return cityCmp;
      return a.name.localeCompare(b.name, 'de');
    });

  console.log(`Found ${candidateStudios.length} German McFIT studio candidates. Checking live utilization...`);

  // Load existing history if present
  let history = {
    lastUpdated: null,
    studios: {},
  };
  try {
    const existing = await fs.readFile(HISTORY_FILE, 'utf8');
    history = JSON.parse(existing);
  } catch {
    // Fresh history file
  }

  // Determine today's date in Europe/Berlin timezone (YYYY-MM-DD)
  const berlinDateStr = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Berlin',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());

  console.log(`Collecting utilization for ${berlinDateStr} (Europe/Berlin)...`);

  const activeStudios = [];
  const inactiveIds = new Set();
  const BATCH_SIZE = 5;

  for (let i = 0; i < candidateStudios.length; i += BATCH_SIZE) {
    const batch = candidateStudios.slice(i, i + BATCH_SIZE);
    await Promise.all(
      batch.map(async (studio) => {
        try {
          const utilUrl = `https://rsg-group.api.magicline.com/connect/v1/studio/${studio.id}/utilization`;
          const data = await fetchJson(utilUrl);
          const items = Array.isArray(data?.items) ? data.items : [];

          if (!history.studios[studio.id]) {
            history.studios[studio.id] = {
              name: studio.name,
              city: studio.city,
              days: {},
            };
          } else {
            history.studios[studio.id].city = studio.city;
          }

          const existingDay =
            history.studios[studio.id].days[berlinDateStr] || new Array(24).fill(null);

          const currentIdx = items.findIndex((item) => item.isCurrent === true);
          const maxValidHour = currentIdx >= 0 ? currentIdx : 23;

          items.forEach((item, idx) => {
            const hour = parseInt((item.startTime || '00:00:00').slice(0, 2), 10);
            if (hour >= 0 && hour < 24 && idx <= maxValidHour) {
              if (typeof item.percentage === 'number') {
                existingDay[hour] = item.percentage;
              }
            }
          });

          history.studios[studio.id].days[berlinDateStr] = existingDay;

          // Keep at most 90 days per studio
          const dayKeys = Object.keys(history.studios[studio.id].days).sort();
          if (dayKeys.length > 90) {
            for (const oldKey of dayKeys.slice(0, dayKeys.length - 90)) {
              delete history.studios[studio.id].days[oldKey];
            }
          }

          activeStudios.push(studio);
        } catch (err) {
          if (err.status === 403 || err.status === 404) {
            inactiveIds.add(studio.id);
            delete history.studios[studio.id];
          } else {
            console.warn(`Warning: Temporary error for ${studio.id} (${studio.name}): ${err.message}`);
            activeStudios.push(studio);
          }
        }
      })
    );
    await sleep(150);
  }

  activeStudios.sort((a, b) => {
    const cityCmp = a.city.localeCompare(b.city, 'de');
    if (cityCmp !== 0) return cityCmp;
    return a.name.localeCompare(b.name, 'de');
  });

  await fs.writeFile(STUDIOS_FILE, JSON.stringify(activeStudios, null, 2), 'utf8');

  history.lastUpdated = new Date().toISOString();
  await fs.writeFile(HISTORY_FILE, JSON.stringify(history, null, 2), 'utf8');

  console.log(
    `Done! Saved ${activeStudios.length} active German McFIT studios across ${new Set(activeStudios.map((s) => s.city)).size} cities (filtered out ${inactiveIds.size} closed/legacy entries).`
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
