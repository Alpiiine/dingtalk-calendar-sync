// Recurrence expansion.
//
// DingTalk's CalDAV server neither expands recurring events nor matches their later
// instances in a time-range query, so the bridge has to do it. A recurring resource looks like:
//   VEVENT (master)   RRULE + EXDATE (deleted instances, in UTC)
//   VEVENT (override) RECURRENCE-ID (in UTC) for every edited instance
// Everything is computed in the master's own wall-clock frame, so "every Saturday 21:00
// Europe/London" stays at 21:00 across DST changes.
import { parseDate, naiveMs, fromNaiveMs } from './ical.js';
import { toUtcMs, inFrameOf } from './tz.js';

const DAY = 86400000;
const DOW = { SU: 0, MO: 1, TU: 2, WE: 3, TH: 4, FR: 5, SA: 6 };
const MAX_STEPS = 20000;

export function parseRule(rrule) {
  const r = { interval: 1 };
  for (const part of rrule.replace(/^RRULE:/i, '').split(';')) {
    const [k, v = ''] = part.split('=');
    switch (k.toUpperCase()) {
      case 'FREQ': r.freq = v.toUpperCase(); break;
      case 'INTERVAL': r.interval = Math.max(1, parseInt(v, 10) || 1); break;
      case 'COUNT': r.count = parseInt(v, 10); break;
      case 'UNTIL': r.until = parseDate(v); break;
      case 'WKST': r.wkst = DOW[v.toUpperCase()]; break;
      case 'BYMONTH': r.byMonth = v.split(',').map(Number); break;
      case 'BYMONTHDAY': r.byMonthDay = v.split(',').map(Number); break;
      case 'BYSETPOS': r.bySetPos = v.split(',').map(Number); break;
      case 'BYDAY':
        r.byDay = v.split(',').map((s) => {
          const m = /^([+-]?\d+)?(SU|MO|TU|WE|TH|FR|SA)$/i.exec(s.trim());
          return m ? { n: m[1] ? parseInt(m[1], 10) : 0, dow: DOW[m[2].toUpperCase()] } : null;
        }).filter(Boolean);
        break;
    }
  }
  return r;
}

const daysInMonth = (y, m) => new Date(Date.UTC(y, m, 0)).getUTCDate(); // m is 1-based

/** Day-of-month candidates for one month under BYMONTHDAY / BYDAY / BYSETPOS (or the start's own day). */
function monthDays(rule, y, m, startDay) {
  const dim = daysInMonth(y, m);
  let days;
  if (rule.byMonthDay) {
    days = rule.byMonthDay.map((d) => (d < 0 ? dim + 1 + d : d));
  } else if (rule.byDay) {
    days = [];
    for (const { n, dow } of rule.byDay) {
      const matches = [];
      for (let d = 1; d <= dim; d++) if (new Date(Date.UTC(y, m - 1, d)).getUTCDay() === dow) matches.push(d);
      if (n > 0) days.push(matches[n - 1]);
      else if (n < 0) days.push(matches[matches.length + n]);
      else days.push(...matches);
    }
  } else {
    days = [startDay];
  }
  days = [...new Set(days.filter((d) => d >= 1 && d <= dim))].sort((a, b) => a - b);
  if (rule.bySetPos && (rule.byDay || rule.byMonthDay)) {
    days = rule.bySetPos.map((p) => (p > 0 ? days[p - 1] : days[days.length + p])).filter((d) => d !== undefined);
    days.sort((a, b) => a - b);
  }
  return days;
}

/** Yields naive start times of a rule, in order, beginning near `fromNaive` (unless COUNT forces a full walk). */
function* instances(rule, start, fromNaive) {
  const s0 = naiveMs(start);
  const tod = s0 - Date.UTC(start.y, start.m - 1, start.d);
  const { freq, interval } = rule;
  const skipTo = (periodMs) => (rule.count ? 0 : Math.max(0, Math.floor((fromNaive - s0) / (periodMs * interval)) - 1));

  if (freq === 'DAILY') {
    const days = rule.byDay && new Set(rule.byDay.map((b) => b.dow));
    for (let k = skipTo(DAY), g = 0; g < MAX_STEPS; k++, g++) {
      const t = s0 + k * interval * DAY;
      const dt = new Date(t);
      if (days && !days.has(dt.getUTCDay())) continue;
      if (rule.byMonth && !rule.byMonth.includes(dt.getUTCMonth() + 1)) continue;
      yield t;
    }
  } else if (freq === 'WEEKLY') {
    const wkst = rule.wkst ?? 1;
    const day0 = Date.UTC(start.y, start.m - 1, start.d);
    const weekStart = day0 - ((new Date(day0).getUTCDay() - wkst + 7) % 7) * DAY;
    const dows = (rule.byDay ? rule.byDay.map((b) => b.dow) : [new Date(day0).getUTCDay()])
      .map((d) => (d - wkst + 7) % 7).sort((a, b) => a - b);
    for (let k = skipTo(7 * DAY), g = 0; g < MAX_STEPS; k++, g++) {
      for (const off of dows) {
        const t = weekStart + k * interval * 7 * DAY + off * DAY + tod;
        if (t >= s0) yield t;
      }
    }
  } else if (freq === 'MONTHLY' || freq === 'YEARLY') {
    const yearly = freq === 'YEARLY';
    const k0 = skipTo((yearly ? 366 : 31) * DAY);
    for (let k = k0, g = 0; g < MAX_STEPS; k++, g++) {
      let months;
      if (yearly) {
        const y = start.y + k * interval;
        months = (rule.byMonth || [start.m]).slice().sort((a, b) => a - b).map((m) => [y, m]);
      } else {
        const idx = start.y * 12 + (start.m - 1) + k * interval;
        const y = Math.floor(idx / 12), m = (idx % 12) + 1;
        if (rule.byMonth && !rule.byMonth.includes(m)) continue;
        months = [[y, m]];
      }
      for (const [y, m] of months) {
        for (const d of monthDays(rule, y, m, start.d)) {
          const t = Date.UTC(y, m - 1, d) + tod;
          if (t >= s0) yield t;
        }
      }
    }
  }
}

/**
 * Expand the VEVENTs of one calendar resource into concrete occurrences overlapping
 * [winStart, winEnd) (UTC ms). Returns [{ key, start, end, ev }].
 */
export function occurrences(events, winStart, winEnd, defaultTz = 'UTC') {
  const out = [];
  const overlaps = (start, end) => toUtcMs(end, defaultTz) > winStart && toUtcMs(start, defaultTz) < winEnd;
  const endOf = (ev) => {
    if (ev.end) return ev.end;
    const dur = ev.durationMs ?? (ev.start.kind === 'date' ? DAY : 0);
    return fromNaiveMs(naiveMs(ev.start) + dur, ev.start);
  };
  const byUid = new Map();
  for (const ev of events) {
    if (!byUid.has(ev.uid)) byUid.set(ev.uid, []);
    byUid.get(ev.uid).push(ev);
  }

  for (const [uid, group] of byUid) {
    const master = group.find((e) => !e.recurrenceId);
    const overrides = group.filter((e) => e.recurrenceId);
    const frame = master?.start ?? overrides[0].start;
    const ridKey = (e) => inFrameOf(e.recurrenceId, frame, defaultTz);

    // Edited instances carry their own times; emit them directly.
    const overridden = new Set();
    for (const o of overrides) {
      const t = ridKey(o);
      overridden.add(t);
      if (o.status === 'CANCELLED') continue;
      const end = endOf(o);
      if (overlaps(o.start, end)) out.push({ key: `${uid}|${new Date(t).toISOString()}`, start: o.start, end, ev: o });
    }
    if (!master || master.status === 'CANCELLED') continue;

    const mEnd = endOf(master);
    const rule = master.rrule ? parseRule(master.rrule) : null;
    if (!rule || !['DAILY', 'WEEKLY', 'MONTHLY', 'YEARLY'].includes(rule.freq)) {
      if (overlaps(master.start, mEnd)) out.push({ key: uid, start: master.start, end: mEnd, ev: master });
      continue;
    }

    const dur = naiveMs(mEnd) - naiveMs(master.start);
    const exdates = new Set(master.exdates.map((x) => inFrameOf(x, master.start, defaultTz)));
    let until = Infinity;
    if (rule.until) {
      until = rule.until.kind === 'date' && master.start.kind !== 'date'
        ? Date.UTC(rule.until.y, rule.until.m - 1, rule.until.d, 23, 59, 59)
        : inFrameOf(rule.until, master.start, defaultTz);
    }
    const fromNaive = winStart - 2 * DAY - dur, toNaive = winEnd + 2 * DAY; // naive vs UTC differ by < 1 day
    let n = 0, steps = 0;
    for (const t of instances(rule, master.start, fromNaive)) {
      if (++steps > MAX_STEPS || t > until || t > toNaive) break;
      if (rule.count && ++n > rule.count) break;
      if (t < fromNaive || exdates.has(t) || overridden.has(t)) continue;
      const start = fromNaiveMs(t, master.start), end = fromNaiveMs(t + dur, master.start);
      if (overlaps(start, end)) out.push({ key: `${uid}|${new Date(t).toISOString()}`, start, end, ev: master });
    }
  }
  return out;
}
