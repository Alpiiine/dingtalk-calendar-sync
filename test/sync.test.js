import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseEvents, buildEvent, parseDate } from '../src/ical.js';
import { occurrences } from '../src/rrule.js';
import { toUtcMs } from '../src/tz.js';
import { DingTalkCalDAV, parseMultistatus } from '../src/caldav.js';
import { GoogleCalendar, googleAuth } from '../src/google.js';
import { runSync, UID_PREFIX } from '../src/sync.js';
import { FakeDingTalk, FakeGoogle, ics } from './helpers.mjs';

const DAY = 86400000;
const NOW = Date.UTC(2026, 10, 14, 21, 0, 0); // Sat 14 Nov 2026 21:00 UTC
const iso = (o) => new Date(toUtcMs(o.start)).toISOString();

// Verbatim from calendar.dingtalk.com: a weekly series with one deleted and one moved instance.
const REAL_SERIES = [
  'BEGIN:VCALENDAR', 'BEGIN:VEVENT', 'CREATED:20261114T211245Z', 'DTSTAMP:20261114T211245Z',
  'ORGANIZER;CN=testaccount:mailto:xz0-p83j649ea@dingtalk.com',
  'ATTENDEE;CN=testaccount;ROLE=REQ-PARTICIPANT;PARTSTAT=ACCEPTED:mailto:xz0-p83j649ea@dingtalk.com',
  'SUMMARY:[T] native weekly recurring', 'DESCRIPTION:this is an event with dingtalk meeting\\, location',
  'RRULE:FREQ=WEEKLY;INTERVAL=1;BYDAY=SA', 'EXDATE:20261121T210000Z', 'LOCATION:8F London',
  'DTSTART;TZID=Europe/London:20261114T210000', 'DTEND;TZID=Europe/London:20261114T220000',
  'UID:MTRiWEI3anVnMDlQekdDaUxQczlMQT09', 'BEGIN:VALARM', 'ACTION:DISPLAY', 'DESCRIPTION:x', 'TRIGGER:-PT15M', 'END:VALARM', 'END:VEVENT',
  'BEGIN:VEVENT', 'SUMMARY:[T] native weekly recurring', 'DTSTART;TZID=Europe/London:20261114T210000',
  'DTEND;TZID=Europe/London:20261114T220000', 'RECURRENCE-ID:20261114T210000Z', 'UID:MTRiWEI3anVnMDlQekdDaUxQczlMQT09', 'END:VEVENT',
  'BEGIN:VEVENT', 'SUMMARY:[T] native weekly recurring EDITED', 'DTSTART;TZID=Europe/London:20261128T181500',
  'DTEND;TZID=Europe/London:20261128T191500', 'RECURRENCE-ID:20261128T210000Z', 'UID:MTRiWEI3anVnMDlQekdDaUxQczlMQT09', 'END:VEVENT',
  'END:VCALENDAR', '',
].join('\r\n');

const cfg = (over = {}) => ({
  sourceCalendarId: 'me@example.com', mirrorCalendarId: 'mirror', pushMatch: /calendly\.com/i, pushPrefix: '',
  mirrorTitles: true, horizonDays: 60, lookbackDays: 730, historyBatch: 300, fullSyncMinutes: 15, confirmMinutes: 10, verifyMinutes: 2,
  defaultTz: 'Asia/Shanghai', lang: 'en', maxWrites: 0, debug: false, dryRun: false, ...over,
});

function setup({ lagMs = 0 } = {}) {
  const clock = { now: NOW };
  const dt = new FakeDingTalk({ clock: () => clock.now, lagMs });
  const caldav = new DingTalkCalDAV({ username: 'u_test', password: 'x', fetch: dt.fetch });
  const google = new FakeGoogle();
  const state = {};
  const logs = [];
  const debugLogs = [];
  const run = (over) => runSync({
    cfg: cfg(over), caldav, google, state, now: clock.now,
    log: (safe, detailed) => { if (safe) logs.push(safe); debugLogs.push(detailed || safe); },
  });
  const tick = (minutes = 1) => { clock.now += minutes * 60000; };
  return { dt, google, state, logs, debugLogs, run, tick, clock };
}

const booking = (id, start, end, extra = {}) => ({
  id, summary: 'Intro call: Ada and IT Test', start: { dateTime: start }, end: { dateTime: end },
  description: 'Event Name: Intro call\n\nNeed to make changes to this event?\nCancel: https://calendly.com/cancellations/abc\n\nPowered by Calendly.com',
  attendees: [{ email: 'me@example.com', self: true, responseStatus: 'accepted' }, { email: 'ada@client.com', displayName: 'Ada' }],
  ...extra,
});

test('ical: parses DingTalk output, folded lines and escapes', () => {
  const [master, first, moved] = parseEvents(REAL_SERIES);
  assert.equal(master.rrule, 'FREQ=WEEKLY;INTERVAL=1;BYDAY=SA');
  assert.equal(master.description, 'this is an event with dingtalk meeting, location');
  assert.deepEqual(master.start, { y: 2026, m: 11, d: 14, H: 21, M: 0, S: 0, kind: 'local', tzid: 'Europe/London' });
  assert.equal(master.exdates[0].kind, 'utc');
  assert.equal(first.recurrenceId.kind, 'utc');
  assert.equal(moved.summary, '[T] native weekly recurring EDITED');
  assert.equal(master.attendees[0].partstat, 'ACCEPTED');

  const built = buildEvent({
    uid: 'd7c0ffee-0000-4000-8000-000000000000', summary: 'Long, title; with 中文 ' + 'x'.repeat(100),
    description: 'line1\nline2', start: parseDate('20261120T100000Z'), end: parseDate('20261120T103000Z'),
  });
  assert.ok(built.split('\r\n').every((l) => l.length <= 75));
  const [back] = parseEvents(built);
  assert.equal(back.summary, 'Long, title; with 中文 ' + 'x'.repeat(100));
  assert.equal(back.description, 'line1\nline2');
  assert.ok(!/ATTENDEE|ORGANIZER/.test(built), 'must not carry invitees');
});

test('rrule: real DingTalk series — EXDATE removed, edited instance moved, DST-safe', () => {
  const evs = parseEvents(REAL_SERIES);
  const occ = occurrences(evs, NOW - DAY, NOW + 30 * DAY).sort((a, b) => toUtcMs(a.start) - toUtcMs(b.start));
  assert.deepEqual(occ.map(iso), [
    '2026-11-14T21:00:00.000Z', // first instance (also present as an identical override)
    '2026-11-28T18:15:00.000Z', // moved instance; 21 Nov is an EXDATE
    '2026-12-05T21:00:00.000Z',
    '2026-12-12T21:00:00.000Z',
  ]);
  assert.equal(occ[1].ev.summary, '[T] native weekly recurring EDITED');
  // Next summer the same series is at 21:00 London = 20:00 UTC.
  const summer = occurrences(evs, Date.UTC(2027, 6, 1), Date.UTC(2027, 6, 8));
  assert.deepEqual(summer.map(iso), ['2027-07-03T20:00:00.000Z']);
});

test('rrule: daily/weekday/monthly/yearly, COUNT, UNTIL, intervals', () => {
  const ev = (rule, start = 'DTSTART:20260105T090000Z', end = 'DTEND:20260105T093000Z') => parseEvents(ics(['UID:x', start, end, `RRULE:${rule}`]));
  const days = (rule, from, to, ...dt) => occurrences(ev(rule, ...dt), Date.parse(from), Date.parse(to)).map((o) => iso(o).slice(0, 10));
  assert.deepEqual(days('FREQ=DAILY;COUNT=3', '2026-01-01', '2026-02-01'), ['2026-01-05', '2026-01-06', '2026-01-07']);
  assert.deepEqual(days('FREQ=DAILY;COUNT=3', '2026-01-07', '2026-02-01'), ['2026-01-07'], 'COUNT counts from the start, not the window');
  assert.deepEqual(days('FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR', '2026-11-13', '2026-11-18'), ['2026-11-13', '2026-11-16', '2026-11-17']);
  assert.deepEqual(days('FREQ=WEEKLY;INTERVAL=2;BYDAY=MO,WE', '2026-01-05', '2026-01-25'), ['2026-01-05', '2026-01-07', '2026-01-19', '2026-01-21']);
  assert.deepEqual(days('FREQ=DAILY;UNTIL=20260107T090000Z', '2026-01-01', '2026-02-01'), ['2026-01-05', '2026-01-06', '2026-01-07']);
  assert.deepEqual(days('FREQ=MONTHLY', '2026-10-01', '2027-01-01', 'DTSTART:20260131T090000Z', 'DTEND:20260131T100000Z'), ['2026-10-31', '2026-12-31'], 'short months are skipped');
  assert.deepEqual(days('FREQ=MONTHLY;BYDAY=2TU', '2026-11-01', '2027-01-01'), ['2026-11-10', '2026-12-08']);
  assert.deepEqual(days('FREQ=MONTHLY;BYDAY=-1FR', '2026-11-01', '2027-01-01'), ['2026-11-27', '2026-12-25']);
  assert.deepEqual(days('FREQ=MONTHLY;BYMONTHDAY=-1', '2026-02-01', '2026-04-01'), ['2026-02-28', '2026-03-31']);
  assert.deepEqual(days('FREQ=YEARLY', '2027-01-01', '2029-01-01'), ['2027-01-05', '2028-01-05']);
  const allDay = occurrences(parseEvents(ics(['UID:y', 'DTSTART;VALUE=DATE:20261101', 'DTEND;VALUE=DATE:20261102', 'RRULE:FREQ=WEEKLY'])), NOW, NOW + 15 * DAY);
  assert.deepEqual(allDay.map((o) => `${o.start.kind} ${o.start.m}/${o.start.d}`), ['date 11/15', 'date 11/22', 'date 11/29']);
});

test('caldav: multistatus parsing handles entities and missing items', () => {
  const xml = '<?xml version="1.0"?><D:multistatus xmlns:D="DAV:"><D:response><D:href>/dav/u/primary/abc%40google.com</D:href><D:propstat><D:prop><D:getetag>"1"</D:getetag><C:calendar-data xmlns:C="urn:ietf:params:xml:ns:caldav">BEGIN:VCALENDAR&#13;\nX:a&amp;b&#13;\n</C:calendar-data></D:prop><D:status>HTTP/1.1 200 OK</D:status></D:propstat></D:response><D:response><D:href>/dav/u/primary/gone</D:href><D:status>HTTP/1.1 404 Not Found</D:status></D:response></D:multistatus>';
  const [a, b] = parseMultistatus(xml);
  assert.equal(a.ics, 'BEGIN:VCALENDAR\r\nX:a&b\r\n');
  assert.equal(a.etag, '"1"');
  assert.equal(b.ok, false);
});

test('mirror: DingTalk busy time (incl. old recurring series) lands in the Google mirror', async () => {
  const { dt, google, state, logs, debugLogs, run, tick } = setup();
  dt.appPut('single', ics(['UID:single', 'SUMMARY:Design review', 'DTSTART;TZID=Asia/Shanghai:20261117T100000', 'DTEND;TZID=Asia/Shanghai:20261117T110000']));
  dt.appPut('allday', ics(['UID:allday', 'SUMMARY:Offsite', 'DTSTART;VALUE=DATE:20261118', 'DTEND;VALUE=DATE:20261119']));
  dt.appPut('free', ics(['UID:free', 'SUMMARY:FYI', 'TRANSP:TRANSPARENT', 'DTSTART:20261119T100000Z', 'DTEND:20261119T110000Z']));
  dt.appPut('old-weekly', ics(['UID:old-weekly', 'SUMMARY:Standup', 'RRULE:FREQ=WEEKLY;BYDAY=MO', 'DTSTART;TZID=Asia/Shanghai:20250106T093000', 'DTEND;TZID=Asia/Shanghai:20250106T100000']));
  dt.appPut('past', ics(['UID:past', 'SUMMARY:Old meeting', 'DTSTART:20260301T100000Z', 'DTEND:20260301T110000Z']));

  await run({ horizonDays: 10 });
  assert.deepEqual(google.titles('mirror'), [
    'Design review @ 2026-11-17T10:00:00', 'Offsite @ 2026-11-18',
    'Standup @ 2026-11-16T09:30:00', 'Standup @ 2026-11-23T09:30:00',
  ]);
  const ev = [...google.cal('mirror').values()][0];
  assert.equal(ev.extendedProperties.private.dtsync, '1');
  assert.equal(ev.transparency, 'opaque');
  assert.match(ev.id, /^dt[0-9a-f]{40}$/);

  // Second pass: nothing changed -> no REPORTs at all, no Google writes.
  dt.calls.length = 0; google.writes.length = 0; tick();
  await run({ horizonDays: 10 });
  assert.deepEqual(dt.calls, ['PROPFIND']);
  assert.deepEqual(google.writes, []);

  // Privacy: neither the saved state nor the normal log lines contain any event text.
  assert.doesNotMatch(JSON.stringify(state), /Standup|Design review|Offsite|RRULE|SUMMARY/);
  assert.doesNotMatch(logs.join('\n'), /Standup|Design review|Offsite/);
  assert.match(debugLogs.join('\n'), /Google \+ "Design review" 2026-11-17T10:00:00/, 'debug lines do carry titles');
  assert.deepEqual(state.hist['/dav/u_test/primary/old-weekly'], { etag: dt.items.get('old-weekly').etag, r: 1 });

  // Edit + delete inside DingTalk propagate. One-off past events are not downloaded again;
  // the recurring series is, because its text is no longer kept between passes.
  dt.appPut('single', ics(['UID:single', 'SUMMARY:Design review', 'DTSTART;TZID=Asia/Shanghai:20261117T140000', 'DTEND;TZID=Asia/Shanghai:20261117T150000']));
  dt.appDelete('allday');
  dt.calls.length = 0; dt.multigets.length = 0; tick();
  await run({ horizonDays: 10 });
  assert.deepEqual([...new Set(dt.calls)], ['PROPFIND', 'REPORT query', 'REPORT query-etags', 'REPORT multiget']);
  assert.deepEqual(dt.multigets, [['old-weekly']], 'only the recurring series is fetched again');
  assert.deepEqual(google.titles('mirror'), ['Design review @ 2026-11-17T14:00:00', 'Standup @ 2026-11-16T09:30:00', 'Standup @ 2026-11-23T09:30:00']);

  tick(20); await run({ horizonDays: 10, mirrorTitles: false });
  assert.ok(google.titles('mirror').every((t) => t.startsWith('Busy (DingTalk) @')), 'privacy mode hides titles');
});

test('bookings: Calendly events are created in DingTalk; reschedule = delete + new UID; cancel = delete', async () => {
  const { dt, google, state, run, tick } = setup();
  google.add('me@example.com', booking('g1', '2026-11-20T10:00:00Z', '2026-11-20T10:30:00Z', { location: 'https://zoom.us/j/1' }));
  google.add('me@example.com', { id: 'g2', summary: 'Dentist', start: { dateTime: '2026-11-20T15:00:00Z' }, end: { dateTime: '2026-11-20T16:00:00Z' } });

  await run();
  assert.deepEqual(dt.summaries(), ['Intro call: Ada and IT Test']);
  const [uid1] = [...dt.items.keys()];
  assert.ok(uid1.startsWith(UID_PREFIX));
  const stored = parseEvents(dt.items.get(uid1).ics)[0];
  assert.match(stored.description, /Where: https:\/\/zoom\.us\/j\/1/); // LOCATION itself is dropped by DingTalk
  assert.match(stored.description, /With: Ada <ada@client\.com>/);
  assert.equal(toUtcMs(stored.start), Date.parse('2026-11-20T10:00:00Z'));

  tick(); await run();
  assert.equal(dt.items.size, 1, 'idempotent');
  assert.deepEqual(google.titles('mirror'), [], 'our own DingTalk event is not mirrored back');

  // Reschedule in Calendly -> Google event time changes.
  google.cal('me@example.com').get('g1').start = { dateTime: '2026-11-21T09:00:00Z' };
  google.cal('me@example.com').get('g1').end = { dateTime: '2026-11-21T09:30:00Z' };
  tick(); await run();
  const [uid2] = [...dt.items.keys()];
  assert.equal(dt.items.size, 1);
  assert.notEqual(uid2, uid1, 'DingTalk ignores edits, so the event is replaced under a new UID');
  assert.equal(toUtcMs(parseEvents(dt.items.get(uid2).ics)[0].start), Date.parse('2026-11-21T09:00:00Z'));

  // Cancel.
  google.cal('me@example.com').delete('g1');
  tick(); await run();
  assert.equal(dt.items.size, 0);
  assert.deepEqual(state.pushed, {});
});

test('bookings: a create that never shows up is retried; one deleted in DingTalk stays deleted', async () => {
  const { dt, google, state, run, tick } = setup();
  google.add('me@example.com', booking('g1', '2026-11-20T10:00:00Z', '2026-11-20T10:30:00Z'));
  dt.dropNextCreate = true;
  await run();
  assert.equal(dt.items.size, 0);
  tick(5); await run();
  assert.equal(dt.items.size, 0, 'still inside the confirmation window');
  tick(16); await run();
  assert.equal(dt.items.size, 1, 'retried under a fresh UID');
  tick(16); await run();
  assert.equal(state.pushed.g1.ok, true);

  dt.appDelete([...dt.items.keys()][0]); // user removes it in DingTalk
  tick(16); await run();
  tick(16); await run();
  assert.equal(dt.items.size, 0, 'not resurrected');
});

test('bookings: past ones age out without being deleted; read lag does not duplicate', async () => {
  const { dt, google, run, tick } = setup({ lagMs: 90000 });
  google.add('me@example.com', booking('g1', '2026-11-14T21:30:00Z', '2026-11-14T22:00:00Z'));
  await run();
  tick(); await run(); // not yet visible over CalDAV
  assert.equal(dt.items.size, 1);
  tick(120); await run();
  assert.equal(dt.items.size, 1, 'finished meetings stay in DingTalk');
});

test('safety: a suddenly empty DingTalk answer does not wipe the mirror in one pass', async () => {
  const { dt, google, logs, run, tick } = setup();
  for (let i = 0; i < 8; i++) dt.appPut(`e${i}`, ics([`UID:e${i}`, `SUMMARY:E${i}`, `DTSTART:202611${16 + i}T100000Z`, `DTEND:202611${16 + i}T110000Z`]));
  await run();
  assert.equal(google.cal('mirror').size, 8);
  for (let i = 0; i < 8; i++) dt.appDelete(`e${i}`);
  tick(); await run();
  assert.equal(google.cal('mirror').size, 8, 'held back');
  assert.ok(logs.some((l) => /holding back/.test(l)));
  tick(); await run();
  assert.equal(google.cal('mirror').size, 0, 'applied once confirmed');
});

test('dry run writes nothing', async () => {
  const { dt, google, run } = setup();
  dt.appPut('single', ics(['UID:single', 'SUMMARY:A', 'DTSTART:20261117T100000Z', 'DTEND:20261117T110000Z']));
  google.add('me@example.com', booking('g1', '2026-11-20T10:00:00Z', '2026-11-20T10:30:00Z'));
  await run({ dryRun: true });
  assert.equal(dt.items.size, 1);
  assert.equal(google.cal('mirror').size, 0);
});

test('google: service-account JWT auth and upsert-over-existing', async () => {
  const { privateKey } = await crypto.subtle.generateKey({ name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' }, true, ['sign', 'verify']);
  const der = Buffer.from(await crypto.subtle.exportKey('pkcs8', privateKey)).toString('base64');
  const sa = { client_email: 'bot@p.iam.gserviceaccount.com', private_key: `-----BEGIN PRIVATE KEY-----\n${der.match(/.{1,64}/g).join('\n')}\n-----END PRIVATE KEY-----\n` };
  const seen = [];
  const fetch = async (url, init) => {
    seen.push(`${init.method} ${new URL(url).pathname}`);
    if (url.includes('oauth2')) {
      const jwt = new URLSearchParams(init.body).get('assertion').split('.');
      const claims = JSON.parse(Buffer.from(jwt[1], 'base64url').toString());
      assert.equal(claims.iss, sa.client_email);
      assert.equal(jwt.length, 3);
      return Response.json({ access_token: 'tok', expires_in: 3600 });
    }
    assert.equal(init.headers.Authorization, 'Bearer tok');
    if (init.method === 'POST') return new Response('{"error":"duplicate"}', { status: 409 });
    return Response.json({});
  };
  const g = new GoogleCalendar({ getToken: googleAuth({ serviceAccount: JSON.stringify(sa) }, { fetch }), fetch });
  await g.upsert('mirror', { id: 'dtabc', summary: 'x' });
  await g.upsert('mirror', { id: 'dtabc', summary: 'x' });
  assert.deepEqual(seen, ['POST /token', 'POST /calendar/v3/calendars/mirror/events', 'PUT /calendar/v3/calendars/mirror/events/dtabc',
    'POST /calendar/v3/calendars/mirror/events', 'PUT /calendar/v3/calendars/mirror/events/dtabc'], 'token is cached');
});

test('google: list paginates and sends the expected query', async () => {
  const urls = [];
  const fetch = async (url) => {
    urls.push(new URL(url));
    return Response.json(urls.length === 1 ? { items: [{ id: 'a' }], nextPageToken: 'p2' } : { items: [{ id: 'b' }] });
  };
  const g = new GoogleCalendar({ getToken: async () => 'tok', fetch });
  const items = await g.list('me@example.com', { timeMin: NOW, timeMax: NOW + DAY, privateProperty: 'dtsync=1', fields: 'id' });
  assert.deepEqual(items.map((e) => e.id), ['a', 'b']);
  assert.equal(urls[0].pathname, '/calendar/v3/calendars/me%40example.com/events');
  assert.equal(urls[0].searchParams.get('singleEvents'), 'true');
  assert.equal(urls[0].searchParams.get('privateExtendedProperty'), 'dtsync=1');
  assert.equal(urls[0].searchParams.get('timeMin'), '2026-11-14T21:00:00.000Z');
  assert.equal(urls[1].searchParams.get('pageToken'), 'p2');
});

test('config: parsing and defaults', async () => {
  const { loadConfig } = await import('../src/config.js');
  const c = loadConfig({ DINGTALK_USERNAME: 'u', DINGTALK_PASSWORD: 'p', GOOGLE_SOURCE_CALENDAR: 'a', GOOGLE_MIRROR_CALENDAR: 'b', MIRROR_TITLES: 'false', HORIZON_DAYS: '30' });
  assert.equal(c.horizonDays, 30);
  assert.equal(c.mirrorTitles, false);
  assert.ok(c.pushMatch.test('Cancel: https://calendly.com/cancellations/x'));
  assert.ok(!c.pushMatch.test('Dentist'));
  assert.throws(() => loadConfig({}), /Missing configuration/);
});

test('bookings: cancel/reschedule inside the read-lag window still converges (deletes are verified)', async () => {
  const { dt, google, run, tick } = setup({ lagMs: 90000 });
  google.add('me@example.com', booking('g1', '2026-11-20T10:00:00Z', '2026-11-20T10:30:00Z'));
  await run();
  // Rescheduled 30 s later: the DELETE of the first copy is swallowed by DingTalk.
  google.cal('me@example.com').get('g1').start = { dateTime: '2026-11-21T09:00:00Z' };
  google.cal('me@example.com').get('g1').end = { dateTime: '2026-11-21T09:30:00Z' };
  tick(0.5); await run();
  assert.equal(dt.items.size, 2, 'old copy survived its DELETE');
  tick(3); await run();
  assert.equal(dt.items.size, 1, 'leftover removed once it became readable');
  assert.equal(toUtcMs(parseEvents([...dt.items.values()][0].ics)[0].start), Date.parse('2026-11-21T09:00:00Z'));

  // Booked and cancelled within the lag.
  google.add('me@example.com', booking('g2', '2026-11-22T10:00:00Z', '2026-11-22T10:30:00Z'));
  tick(1); await run();
  google.cal('me@example.com').delete('g2');
  tick(0.5); await run();
  assert.equal(dt.items.size, 2);
  tick(3); await run();
  assert.equal(dt.items.size, 1);
});

test('state written by versions before 1.1 (event text kept in "ics") is cleaned up on the next full read', async () => {
  const { dt, google, state, run } = setup();
  dt.appPut('old-weekly', ics(['UID:old-weekly', 'SUMMARY:Standup', 'RRULE:FREQ=WEEKLY;BYDAY=MO', 'DTSTART;TZID=Asia/Shanghai:20250106T093000', 'DTEND;TZID=Asia/Shanghai:20250106T100000']));
  state.hist = { '/dav/u_test/primary/old-weekly': { etag: dt.items.get('old-weekly').etag, ics: dt.items.get('old-weekly').ics } };
  await run({ horizonDays: 10 });
  assert.deepEqual(google.titles('mirror'), ['Standup @ 2026-11-16T09:30:00', 'Standup @ 2026-11-23T09:30:00']);
  assert.doesNotMatch(JSON.stringify(state), /Standup|ics/);
});

test('write limit: a large first sync is spread over several passes and still converges', async () => {
  const { dt, google, logs, run, tick } = setup();
  for (let i = 0; i < 9; i++) dt.appPut(`e${i}`, ics([`UID:e${i}`, `SUMMARY:E${i}`, `DTSTART:202611${16 + i}T100000Z`, `DTEND:202611${16 + i}T110000Z`]));
  google.add('me@example.com', booking('g1', '2026-11-20T10:00:00Z', '2026-11-20T10:30:00Z'));
  const first = await run({ maxWrites: 4 });
  assert.equal(first.partial, true);
  assert.equal(dt.items.size + google.cal('mirror').size, 9 + 4, 'exactly four writes: the booking and three busy blocks');
  assert.ok(logs.some((l) => /write limit of 4/.test(l)));
  dt.calls.length = 0; tick(); await run({ maxWrites: 4 });
  assert.ok(dt.calls.includes('REPORT query'), 'the next pass reads DingTalk again without waiting 15 minutes');
  tick(); const third = await run({ maxWrites: 4 });
  assert.equal(google.cal('mirror').size, 9);
  assert.equal(third.partial, false);
  google.writes.length = 0; tick(); await run({ maxWrites: 4 });
  assert.deepEqual(google.writes, [], 'settled');
});

test('event text follows the chosen language', async () => {
  const { dt, google, run } = setup();
  dt.appPut('single', ics(['UID:single', 'SUMMARY:设计评审', 'DTSTART:20261117T100000Z', 'DTEND:20261117T110000Z']));
  google.add('me@example.com', booking('g1', '2026-11-20T10:00:00Z', '2026-11-20T10:30:00Z', { location: 'Room 1' }));
  await run({ lang: 'zh', mirrorTitles: false });
  assert.deepEqual(google.titles('mirror'), ['忙碌（钉钉） @ 2026-11-17T10:00:00Z']);
  const stored = parseEvents([...dt.items.values()].find((v) => /d7c0ffee/.test(v.ics)).ics)[0];
  assert.match(stored.description, /地点: Room 1/);
  assert.match(stored.description, /参与人: Ada <ada@client\.com>/);
  assert.match(stored.description, /由 dtsync 从 Google 日历同步/);
});
