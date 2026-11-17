// Timezone maths via Intl (built into Node, Workers, Deno, Bun) — no tz database to ship.
import { naiveMs } from './ical.js';

const fmtCache = new Map();
function fmt(tzid) {
  let f = fmtCache.get(tzid);
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', {
      timeZone: tzid, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit',
    });
    fmtCache.set(tzid, f);
  }
  return f;
}

/** UTC instant -> the wall-clock time in `tzid`, expressed as naive ms. */
export function utcToNaive(ms, tzid) {
  const p = {};
  for (const { type, value } of fmt(tzid).formatToParts(new Date(ms))) p[type] = +value;
  return Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
}

/** Wall-clock naive ms in `tzid` -> UTC instant (two passes settle DST edges). */
export function naiveToUtc(naive, tzid) {
  let guess = naive - (utcToNaive(naive, tzid) - naive);
  guess = naive - (utcToNaive(guess, tzid) - guess);
  return guess;
}

/** Absolute UTC ms for an iCalendar date value. Floating times use `defaultTz`. */
export function toUtcMs(v, defaultTz = 'UTC') {
  const n = naiveMs(v);
  if (v.kind === 'utc') return n;
  try {
    return naiveToUtc(n, v.tzid || defaultTz);
  } catch {
    return n; // unknown TZID: treat as UTC rather than dropping the event
  }
}

/** Express date value `v` as naive ms in the frame of `like` (used to match EXDATE / RECURRENCE-ID). */
export function inFrameOf(v, like, defaultTz = 'UTC') {
  if (v.kind === 'date' || like.kind === 'date') return Date.UTC(v.y, v.m - 1, v.d);
  if (like.kind === 'utc') return toUtcMs(v, defaultTz);
  const tz = like.tzid || defaultTz;
  if (v.kind === 'local' && (v.tzid || defaultTz) === tz) return naiveMs(v);
  return utcToNaive(toUtcMs(v, defaultTz), tz);
}
