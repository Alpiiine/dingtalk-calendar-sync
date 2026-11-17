// One sync pass. Stateless apart from the small `state` object the host persists.
//
//   DingTalk ──(busy mirror)──▶ Google "DingTalk" calendar ──▶ Calendly checks it for conflicts
//   DingTalk ◀──(bookings)──── Google primary calendar     ◀── Calendly adds bookings to it
//
// Loop safety: events written into DingTalk get a UID starting with UID_PREFIX and are never
// mirrored back; mirror events in Google carry the private property dtsync=1 and are never pushed.
//
// Privacy: `state` holds ids, hashes, etags and times only — never titles, descriptions or guests.
// `log(safe, detailed)` gets two versions of each line: `safe` carries no event text and is what
// hosts print and keep; `detailed` (titles included) is only for debug mode. `safe` may be null
// for lines that exist in debug mode only.
import { parseEvents, buildEvent, parseDate } from './ical.js';
import { occurrences } from './rrule.js';
import { toUtcMs } from './tz.js';
import { t } from './i18n.js';

const DAY = 86400000;
export const UID_PREFIX = 'd7c0ffee';

async function sha(text) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** DingTalk only accepts UUID-shaped UIDs; the fixed first group marks the event as ours. */
const newUid = () => `${UID_PREFIX}-${crypto.randomUUID().slice(9)}`;

const pad = (n) => String(n).padStart(2, '0');
function toGoogleTime(v, defaultTz) {
  const day = `${v.y}-${pad(v.m)}-${pad(v.d)}`;
  if (v.kind === 'date') return { date: day };
  const dateTime = `${day}T${pad(v.H)}:${pad(v.M)}:${pad(v.S)}`;
  return v.kind === 'utc' ? { dateTime: `${dateTime}Z` } : { dateTime, timeZone: v.tzid || defaultTz };
}

function fromGoogleTime(t) {
  if (t.date) return parseDate(t.date.replace(/-/g, ''));
  return parseDate(new Date(t.dateTime).toISOString().replace(/[-:]/g, '').slice(0, 15) + 'Z');
}

const htmlToText = (s = '') => s
  .replace(/<br\s*\/?>(\r?\n)?/gi, '\n').replace(/<\/(p|div|li)>/gi, '\n').replace(/<[^>]+>/g, '')
  .replace(/&nbsp;/g, ' ').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&')
  .replace(/\n{3,}/g, '\n\n').trim();

const short = (id) => `#${String(id).slice(-6)}`;
const when = (t0) => t0?.dateTime || t0?.date || '';

/** Read DingTalk: events in the window plus every recurring series that started before it. */
async function readDingTalk({ cfg, caldav, state, now, log }) {
  const winStart = now - DAY, winEnd = now + cfg.horizonDays * DAY;
  const windowItems = await caldav.query(winStart, winEnd);
  const past = await caldav.query(now - cfg.lookbackDays * DAY, winStart, { data: false });

  // The past is only scanned for recurring series. Per event the state remembers the etag and
  // whether it recurs ("r"), so one-off past events are downloaded once and never again. The
  // recurring ones are fetched on every full read instead of being kept: no event text at rest.
  const hist = {}, unknown = [], recurring = [];
  for (const it of past) {
    const known = state.hist[it.href];
    if (known && known.etag === it.etag) {
      const r = known.r || known.ics; // "ics" is what versions before 1.1 stored
      hist[it.href] = { etag: known.etag, ...(r ? { r: 1 } : {}) };
      if (r) recurring.push(it.href);
    } else unknown.push(it.href);
  }
  const fetched = new Map();
  for (const it of await caldav.multiget([...unknown.slice(0, cfg.historyBatch), ...recurring])) {
    const r = /^RRULE[:;]/m.test(it.ics);
    hist[it.href] = { etag: it.etag, ...(r ? { r: 1 } : {}) };
    if (r) fetched.set(it.href, it.ics);
  }
  state.hist = hist;
  state.histPending = unknown.some((h) => !hist[h]);
  if (state.histPending) log(`history scan: ${unknown.filter((h) => !hist[h]).length} past events still to inspect`);

  const resources = new Map(fetched);
  for (const it of windowItems) if (it.ics) resources.set(it.href, it.ics);

  const own = new Map(), busy = [];
  for (const ics of resources.values()) {
    const events = parseEvents(ics);
    if (events.some((e) => e.uid.toLowerCase().startsWith(UID_PREFIX))) {
      for (const e of events) own.set(e.uid.toLowerCase(), e);
      continue;
    }
    for (const o of occurrences(events, winStart, winEnd, cfg.defaultTz)) {
      if (o.ev.transp === 'TRANSPARENT') continue;
      if (state.self && o.ev.attendees.some((a) => a.email === state.self && a.partstat === 'DECLINED')) continue;
      busy.push(o);
    }
  }
  // Events we created are organised by the account owner: that tells us who "self" is.
  const mine = [...own.values()].find((e) => e.organizer);
  if (mine) state.self = mine.organizer;
  return { own, busy, winStart, winEnd };
}

function bookingToIcs(e, uid, cfg) {
  const lines = [];
  if (e.location) lines.push(`${t(cfg.lang, 'event.where')}: ${e.location}`);
  if (e.hangoutLink) lines.push(`${t(cfg.lang, 'event.meet')}: ${e.hangoutLink}`);
  const guests = (e.attendees || []).filter((a) => !a.self).map((a) => (a.displayName ? `${a.displayName} <${a.email}>` : a.email));
  if (guests.length) lines.push(`${t(cfg.lang, 'event.with')}: ${guests.join(', ')}`);
  const text = htmlToText(e.description).slice(0, 4000);
  if (text) lines.push('', text);
  lines.push('', t(cfg.lang, 'event.footer'));
  return buildEvent({
    uid, summary: `${cfg.pushPrefix}${e.summary || t(cfg.lang, 'event.busy')}`, description: lines.join('\n').trim(),
    location: e.location, start: fromGoogleTime(e.start), end: fromGoogleTime(e.end),
  });
}

/** Google (Calendly bookings) -> DingTalk. Changes are applied as delete + create, never as an edit. */
async function pushBookings({ cfg, caldav, google, state, now, log, act, room, stats, dt }) {
  const fields = 'id,status,summary,description,location,start,end,hangoutLink,creator/email,organizer/email,' +
    'attendees(self,responseStatus,email,displayName),extendedProperties/private';
  const source = await google.list(cfg.sourceCalendarId, { timeMin: now, timeMax: now + cfg.horizonDays * DAY, fields });
  const wanted = new Map();
  for (const e of source) {
    if (e.status === 'cancelled' || !e.start || !e.end) continue;
    if (e.extendedProperties?.private?.dtsync) continue;
    if (e.attendees?.some((a) => a.self && a.responseStatus === 'declined')) continue;
    const haystack = [e.summary, e.description, e.location, e.creator?.email, e.organizer?.email].filter(Boolean).join('\n');
    if (cfg.pushMatch.test(haystack)) wanted.set(e.id, e);
  }

  const create = async (gid, e, hash, tries = 0) => {
    const uid = newUid();
    await act(`DingTalk + booking ${short(gid)} ${when(e.start)}`, `DingTalk + "${e.summary}" ${when(e.start)}`,
      () => caldav.create(uid, bookingToIcs(e, uid, cfg)));
    state.pushed[gid] = { uid, hash, at: now, end: Date.parse(e.end.dateTime || e.end.date), ...(tries ? { tries } : {}) };
  };

  for (const [gid, e] of wanted) {
    try {
      const hash = (await sha(JSON.stringify([e.summary, e.start, e.end, e.location, e.description, e.hangoutLink,
        (e.attendees || []).map((a) => a.email)]))).slice(0, 16);
      const p = state.pushed[gid];
      if (!p) {
        if (!room(1)) break;
        await create(gid, e, hash);
        stats.pushed++;
      } else if (p.hash !== hash) {
        if (!room(2)) break;
        await act(`DingTalk - (replace) booking ${short(gid)}`, `DingTalk - (replace) "${e.summary}"`, () => caldav.remove(p.uid));
        await create(gid, e, hash);
        stats.replaced++;
      } else if (dt) {
        if (dt.own.has(p.uid)) p.ok = true;
        else if (!p.ok && now - p.at > cfg.confirmMinutes * 60000) {
          // Never showed up in DingTalk: try again under a new UID, a couple of times at most.
          if ((p.tries || 0) < 2) {
            if (!room(1)) break;
            await create(gid, e, hash, (p.tries || 0) + 1);
            stats.retried++;
          } else if (!p.failed) {
            p.failed = true;
            stats.errors++;
            log(`ERROR: booking ${short(gid)} ${when(e.start)} did not appear in DingTalk after 3 attempts`,
              `ERROR: "${e.summary}" ${when(e.start)} did not appear in DingTalk after 3 attempts`);
          }
        }
        // p.ok but no longer present => it was deleted inside DingTalk; leave it deleted.
      }
    } catch (err) {
      stats.errors++;
      log(`ERROR pushing booking ${short(gid)}: ${err.message}`, `ERROR pushing "${e.summary}": ${err.message}`);
    }
  }

  for (const [gid, p] of Object.entries(state.pushed)) {
    if (wanted.has(gid)) continue;
    try {
      if (p.end > now) { // cancelled or rescheduled away; past bookings simply age out
        if (!room(1)) break;
        await act(`DingTalk - booking ${short(gid)}`, null, () => caldav.remove(p.uid));
        stats.removed++;
      }
      delete state.pushed[gid];
    } catch (err) {
      stats.errors++;
      log(`ERROR removing ${p.uid}: ${err.message}`);
    }
  }

  // DingTalk answers 204 to a DELETE that arrives before the event is readable over CalDAV
  // (about a minute after its creation) and then keeps the event. So deletions are verified:
  // any upcoming event of ours that no booking refers to any more is removed again.
  if (dt) {
    const live = new Set(Object.values(state.pushed).map((p) => p.uid));
    for (const [uid, ev] of dt.own) {
      if (live.has(uid) || toUtcMs(ev.end || ev.start, cfg.defaultTz) <= now) continue;
      try {
        if (!room(1)) break;
        await act(`DingTalk - (leftover) ${short(uid)}`, `DingTalk - (leftover) "${ev.summary || ''}" ${uid}`, () => caldav.remove(uid));
        stats.removed++;
      } catch (err) {
        stats.errors++;
        log(`ERROR removing leftover ${uid}: ${err.message}`);
      }
    }
  }
}

/** DingTalk -> Google mirror calendar: make the mirror equal to the expanded busy list. */
async function reconcileMirror({ cfg, google, state, log, act, room, stats, dt }) {
  const desired = new Map();
  for (const o of dt.busy) {
    const start = toGoogleTime(o.start, cfg.defaultTz), end = toGoogleTime(o.end, cfg.defaultTz);
    const summary = cfg.mirrorTitles ? o.ev.summary || t(cfg.lang, 'event.busy') : t(cfg.lang, 'event.busyDingTalk');
    const location = cfg.mirrorTitles ? o.ev.location : undefined;
    const [idHash, h] = await Promise.all([sha(o.key), sha(JSON.stringify([summary, start, end, location]))]);
    const id = `dt${idHash.slice(0, 40)}`;
    desired.set(id, {
      id, summary, start, end, ...(location ? { location } : {}),
      description: t(cfg.lang, 'event.mirrorNote'),
      transparency: 'opaque', visibility: 'private', reminders: { useDefault: false, overrides: [] },
      extendedProperties: { private: { dtsync: '1', h: h.slice(0, 16) } },
    });
  }
  const existing = await google.list(cfg.mirrorCalendarId, {
    timeMin: dt.winStart, timeMax: dt.winEnd, privateProperty: 'dtsync=1', fields: 'id,extendedProperties/private',
  });
  const have = new Map(existing.map((e) => [e.id, e.extendedProperties?.private?.h]));
  // How many busy blocks Google holds right now: a number for the setup page, no event text.
  state.busy = have.size;

  for (const [id, body] of desired) {
    if (have.get(id) === body.extendedProperties.private.h) continue;
    if (!room(1)) return; // the rest, and any removals, wait for the next pass
    const exists = have.has(id);
    try {
      await act(`Google ${exists ? '~' : '+'} busy block ${short(id)} ${when(body.start)}`,
        `Google ${exists ? '~' : '+'} "${body.summary}" ${when(body.start)}`,
        () => google.upsert(cfg.mirrorCalendarId, body, { exists }));
      stats.mirrored++;
      if (!exists && !cfg.dryRun) state.busy++;
    } catch (err) {
      stats.errors++;
      log(`ERROR mirroring busy block ${short(id)}: ${err.message}`, `ERROR mirroring "${body.summary}": ${err.message}`);
    }
  }

  const stale = [...have.keys()].filter((id) => !desired.has(id));
  // A glitchy (empty) DingTalk answer must not open up the whole calendar for booking:
  // large removals have to be seen on two consecutive passes before they are applied.
  if (stale.length > 5 && stale.length > have.size / 2 && !state.purgeArmed) {
    state.purgeArmed = true;
    state.recheck = true;
    log(`holding back removal of ${stale.length}/${have.size} mirror events until confirmed by the next pass`);
    return;
  }
  state.purgeArmed = false;
  for (const id of stale) {
    if (!room(1)) return;
    try {
      await act(`Google - busy block ${short(id)}`, null, () => google.remove(cfg.mirrorCalendarId, id));
      stats.unmirrored++;
      if (!cfg.dryRun) state.busy--;
    } catch (err) { stats.errors++; log(`ERROR removing busy block ${short(id)}: ${err.message}`); }
  }
}

/**
 * Run one pass. `state` is mutated in place; persist it afterwards (even when this throws).
 * Returns counters describing what changed.
 */
export async function runSync({ cfg, caldav, google, state, now = Date.now(), log = () => {} }) {
  state.pushed ??= {};
  state.hist ??= {};
  const stats = { pushed: 0, replaced: 0, removed: 0, retried: 0, mirrored: 0, unmirrored: 0, errors: 0, full: false, partial: false };
  const pre = cfg.dryRun ? '[dry-run] ' : '';
  // Hosts with a cap on outgoing requests (Workers free plan) limit the calendar writes per pass.
  let writesLeft = cfg.maxWrites > 0 && !cfg.dryRun ? cfg.maxWrites : Infinity;
  const act = async (safe, detailed, fn) => {
    log(pre + safe, pre + (detailed || safe));
    if (cfg.dryRun) return;
    writesLeft--;
    await fn();
  };
  /** Is there room for `n` more writes in this pass? If not, the next pass picks up where this one stopped. */
  const room = (n) => {
    if (writesLeft >= n) return true;
    if (!stats.partial) log(`write limit of ${cfg.maxWrites} per pass reached; continuing on the next pass`);
    stats.partial = true;
    state.recheck = true;
    return false;
  };

  // DingTalk is only read in full when its collection tag moved (or periodically, as the window slides).
  const ctag = await caldav.ctag();
  const due = now - (state.fullAt || 0) >= cfg.fullSyncMinutes * 60000;
  let dt = null;
  const verify = state.verifyAt && now >= state.verifyAt;
  if (ctag !== state.ctag || due || verify || state.histPending || state.recheck) {
    state.recheck = false;
    if (verify) delete state.verifyAt;
    dt = await readDingTalk({ cfg, caldav, state, now, log });
    stats.full = true;
  }

  await pushBookings({ cfg, caldav, google, state, now, log, act, room, stats, dt });
  // Whatever was just written is re-read once DingTalk's read lag has passed.
  if (stats.pushed + stats.replaced + stats.removed + stats.retried > 0) state.verifyAt = now + cfg.verifyMinutes * 60000;
  if (dt) {
    await reconcileMirror({ cfg, google, state, log, act, room, stats, dt });
    if (!cfg.dryRun) { state.ctag = ctag; state.fullAt = now; }
    log(null, `full read: ${dt.busy.length} busy occurrences, ${dt.own.size} bridge-made events in DingTalk, ${Object.keys(state.hist).length} past events tracked`);
  }
  return stats;
}
