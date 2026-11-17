// Tests of the whole app: saved settings, the HTTP API behind the setup page, status and debug mode.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../src/app.js';
import { seal, open } from '../src/crypto.js';
import { applyChanges } from '../src/settings.js';
import { LOCALES, t, pickLang } from '../src/i18n.js';
import { page } from '../src/ui.js';
import { FakeDingTalk, FakeGoogleHttp, MemoryStore, makeServiceAccountKey, routeFetch, ics } from './helpers.mjs';

const NOW = Date.UTC(2026, 10, 14, 21, 0, 0);
const PASSWORD = 'correct horse battery';
const KEY = await makeServiceAccountKey();
const silent = { log() {}, error() {} };

function setup({ env = {}, mirrorRole = 'writer' } = {}) {
  const clock = { now: NOW };
  const dt = new FakeDingTalk({ password: 'caldav-secret', clock: () => clock.now });
  const google = new FakeGoogleHttp({ 'me@example.com': { summary: 'Me', role: 'reader' }, 'mirror@group.calendar.google.com': { summary: 'DingTalk', role: mirrorRole } });
  const store = new MemoryStore();
  const console_ = { lines: [], log(m) { this.lines.push(m); }, error(m) { this.lines.push(m); } };
  const app = createApp({ store, env: { ADMIN_PASSWORD: PASSWORD, ...env }, platform: 'cloudflare', fetch: routeFetch(dt, google), now: () => clock.now, logger: console_ });
  const call = async (method, path, body, password = PASSWORD) => {
    const res = await app.handle(new Request(`https://bridge.test${path}`, {
      method, headers: { Authorization: `Bearer ${password}`, 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined,
    }));
    return { status: res.status, data: await res.json().catch(() => null), res };
  };
  return { app, dt, google, store, clock, call, logs: console_.lines };
}

const GOOD = {
  DINGTALK_USERNAME: 'u_test', DINGTALK_PASSWORD: 'caldav-secret', GOOGLE_SERVICE_ACCOUNT_JSON: KEY,
  GOOGLE_SOURCE_CALENDAR: 'me@example.com', GOOGLE_MIRROR_CALENDAR: 'mirror@group.calendar.google.com',
};
const BOOKING = {
  id: 'g1', summary: 'Intro call: Ada and IT Test', start: { dateTime: '2026-11-20T10:00:00Z' }, end: { dateTime: '2026-11-20T10:30:00Z' },
  description: 'Cancel: https://calendly.com/cancellations/abc',
};

test('crypto: sealed settings open only with the same password', async () => {
  const sealed = await seal({ DINGTALK_PASSWORD: 'p@ss' }, 'admin-one');
  assert.doesNotMatch(sealed, /p@ss/);
  assert.deepEqual(await open(sealed, 'admin-one'), { DINGTALK_PASSWORD: 'p@ss' });
  await assert.rejects(open(sealed, 'admin-two'));
});

test('settings: validation and keeping secrets', () => {
  const first = applyChanges({}, { DINGTALK_USERNAME: ' u ', DINGTALK_PASSWORD: 'p', HORIZON_DAYS: '30', GOOGLE_SERVICE_ACCOUNT_JSON: KEY });
  assert.equal(first.next.DINGTALK_USERNAME, 'u');
  const second = applyChanges(first.next, { DINGTALK_PASSWORD: '', HORIZON_DAYS: '', PUSH_MATCH: null });
  assert.equal(second.next.DINGTALK_PASSWORD, 'p', 'an empty secret field keeps the saved secret');
  assert.equal(second.next.HORIZON_DAYS, undefined, 'an empty plain field goes back to the default');
  assert.deepEqual(applyChanges({}, { HORIZON_DAYS: '0', PUSH_MATCH: '(', DEFAULT_TZ: 'Mars/Base', GOOGLE_SERVICE_ACCOUNT_JSON: '{"a":1}' }).errors,
    { GOOGLE_SERVICE_ACCOUNT_JSON: 'badKey', PUSH_MATCH: 'badPattern', HORIZON_DAYS: 'badDays', DEFAULT_TZ: 'badTimeZone' });
  assert.deepEqual(applyChanges({}, { LOOKBACK_DAYS: '0', FULL_SYNC_MINUTES: '1.5', MAX_WRITES: '-1' }).errors,
    { LOOKBACK_DAYS: 'badValue', FULL_SYNC_MINUTES: 'badValue', MAX_WRITES: 'badValue' });
  assert.deepEqual(applyChanges({}, { LOOKBACK_DAYS: '365', FULL_SYNC_MINUTES: '30', MAX_WRITES: '0' }).next,
    { LOOKBACK_DAYS: '365', FULL_SYNC_MINUTES: '30', MAX_WRITES: '0' });
  assert.equal(applyChanges({}, { GOOGLE_SOURCE_CALENDAR: 'a', GOOGLE_MIRROR_CALENDAR: 'a' }).errors.GOOGLE_MIRROR_CALENDAR, 'sameCalendar');
  assert.equal(applyChanges({}, { ADMIN_PASSWORD: 'x', DEBUG: '1' }).next.ADMIN_PASSWORD, undefined, 'only known settings can be saved');
});

test('i18n: every language defines the same messages with the same placeholders', () => {
  const holes = (s) => (s.match(/\{\w+\}/g) || []).sort().join();
  const en = LOCALES.en.messages;
  for (const [code, locale] of Object.entries(LOCALES)) {
    assert.ok(locale.name && locale.tag, `${code}: has a name and a tag`);
    assert.doesNotThrow(() => new Intl.DateTimeFormat([locale.tag, locale.dates || locale.tag]), `${code}: the tags are valid`);
    assert.equal(pickLang(locale.tag), code, `${code}: found by its own tag`);
    assert.deepEqual(Object.keys(locale.messages).sort(), Object.keys(en).sort(), `${code}: same keys as en`);
    for (const [k, v] of Object.entries(en)) assert.equal(holes(locale.messages[k]), holes(v), `${code}: placeholders of ${k}`);
    assert.equal(applyChanges({}, { DTSYNC_LANG: code }).next.DTSYNC_LANG, code, `${code}: can be chosen for event text`);
  }
  assert.equal(applyChanges({}, { DTSYNC_LANG: 'xx' }).errors.DTSYNC_LANG, 'badValue');
  assert.equal(t('zh', 'event.busyDingTalk'), '忙碌（钉钉）');
  assert.equal(t('fr', 'event.busy'), 'Busy');
  assert.equal(pickLang(undefined, 'zh_CN.UTF-8'), 'zh');
  assert.equal(pickLang('zh-Hant-TW'), 'zh');
  assert.equal(pickLang('EN_us'), 'en');
  assert.equal(pickLang('', 'C', 'de_DE'), 'en');
});

test('page: served with a strict content policy and without any settings in it', async () => {
  const { app, call } = setup();
  await call('POST', '/api/settings', { values: GOOD });
  const res = await app.handle(new Request('https://bridge.test/'));
  const html = await res.text();
  const nonce = /script-src 'nonce-([0-9a-f]+)'/.exec(res.headers.get('Content-Security-Policy'))[1];
  assert.ok(html.includes(`<script type="module" nonce="${nonce}">`), 'the script carries the nonce');
  assert.ok(html.includes(`<style nonce="${nonce}">`), 'the styles carry the nonce');
  assert.doesNotMatch(html, /__DTSYNC_/, 'every placeholder of the built page is filled in');
  assert.doesNotMatch(html, /caldav-secret|u_test|me@example\.com|PRIVATE KEY/);
  assert.doesNotMatch(html, /<(script|link|img)\b[^>]*\b(src|href)=["']?https?:/, 'nothing is loaded from elsewhere');
  const boot = JSON.parse(/<script type="application\/json" id="boot">([\s\S]*?)<\/script>/.exec(html)[1]);
  assert.equal(boot.platform, 'cloudflare');
  assert.deepEqual(boot.locales, LOCALES, 'every language comes with the page, with its name for the menu');
  assert.ok(boot.locales.en.messages['s1.title'] && boot.locales.en.messages['check.dingtalk.ok'], 'the page text and the connection checks');
  const other = page({ nonce: 'abc', platform: 'node', version: '0' });
  assert.equal(other.split('nonce="abc"').length, 3, 'the nonce is on the script and the style, nowhere else');
});

test('api: closed without an admin password, and to the wrong one', async () => {
  const open_ = setup({ env: { ADMIN_PASSWORD: 'short' } });
  assert.equal((await open_.call('GET', '/api/state')).status, 503, 'passwords under 8 characters do not count');
  const { call } = setup();
  assert.equal((await call('GET', '/api/state', null, 'wrong password')).status, 401);
  assert.equal((await call('POST', '/api/reset', {}, '')).status, 401);
  assert.equal((await call('GET', '/api/state')).status, 200);
});

test('session: the page signs in once and holds a cookie that only its own requests can use', async () => {
  const { app, clock } = setup();
  const send = (method, path, { body, cookie, headers = {} } = {}) => app.handle(new Request(`https://bridge.test${path}`, {
    method, headers: { 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}), ...headers }, body: body ? JSON.stringify(body) : undefined,
  }));
  const own = { 'X-Dtsync': '1', 'Sec-Fetch-Site': 'same-origin' };

  let res = await send('POST', '/api/login', { body: { password: 'wrong password' } });
  assert.equal(res.status, 401);
  assert.equal(res.headers.get('Set-Cookie'), null, 'a wrong password gets no session');

  res = await send('POST', '/api/login', { body: { password: PASSWORD } });
  assert.equal(res.status, 200);
  assert.equal((await res.json()).missing.length, 5, 'signing in answers with the state of the page');
  const set = res.headers.get('Set-Cookie');
  assert.match(set, /^dtsync_session=\d+\.[\w-]{43}; Path=\/api; HttpOnly; SameSite=Strict; Secure$/, 'scripts cannot read it, other sites cannot send it, it ends with the browser');
  assert.doesNotMatch(set, new RegExp(PASSWORD), 'the cookie is not the password');
  const cookie = set.split(';')[0];

  assert.equal((await send('GET', '/api/state', { cookie, headers: own })).status, 200);
  assert.equal((await (await send('GET', '/api/ping', { cookie, headers: own })).json()).signedIn, true, 'a reload or a second tab is still signed in');
  assert.equal((await (await send('GET', '/api/ping', { headers: own })).json()).signedIn, false);

  // The cookie alone is not enough: a request another site could cause is refused.
  assert.equal((await send('POST', '/api/reset', { cookie, body: {} })).status, 401, 'without the header of the page');
  assert.equal((await send('POST', '/api/reset', { cookie, body: {}, headers: { 'X-Dtsync': '1', 'Sec-Fetch-Site': 'cross-site' } })).status, 401, 'from another site');
  assert.equal((await send('POST', '/api/reset', { cookie, body: {}, headers: { 'X-Dtsync': '1', 'Sec-Fetch-Site': 'same-site' } })).status, 401, 'from another port or subdomain');
  assert.equal((await send('GET', '/api/state', { cookie: `${cookie.slice(0, -1)}${cookie.endsWith('A') ? 'B' : 'A'}`, headers: own })).status, 401, 'a changed token');
  const later = cookie.replace(/=\d+/, (m) => `=${Number(m.slice(1)) + 3600000}`);
  assert.equal((await send('GET', '/api/state', { cookie: later, headers: own })).status, 401, 'a token with its lifetime edited');

  // A page that stays open keeps its session; one that is left alone runs out after twelve hours.
  clock.now += 5 * 3600000;
  assert.equal((await send('GET', '/api/state', { cookie, headers: own })).headers.get('Set-Cookie'), null, 'no new cookie in the first half of its life');
  clock.now += 2 * 3600000;
  res = await send('GET', '/api/state', { cookie, headers: own });
  const renewed = res.headers.get('Set-Cookie').split(';')[0];
  assert.notEqual(renewed, cookie);
  clock.now += 6 * 3600000;
  assert.equal((await send('GET', '/api/state', { cookie, headers: own })).status, 401, 'the first session has run out');
  assert.equal((await send('GET', '/api/state', { cookie: renewed, headers: own })).status, 200);

  res = await send('POST', '/api/logout', { cookie: renewed, headers: own });
  assert.match(res.headers.get('Set-Cookie'), /^dtsync_session=; .*Max-Age=0$/, 'signing out makes the browser forget the session');

  // A session of one admin password is worth nothing under another, and plain http gets no Secure flag.
  const other = createApp({ store: new MemoryStore(), env: { ADMIN_PASSWORD: 'a different password' }, platform: 'node', now: () => clock.now, logger: silent });
  res = await other.handle(new Request('http://localhost:8787/api/state', { headers: { Cookie: renewed, ...own } }));
  assert.equal(res.status, 401);
  res = await other.handle(new Request('http://localhost:8787/api/login', { method: 'POST', body: JSON.stringify({ password: 'a different password' }) }));
  assert.doesNotMatch(res.headers.get('Set-Cookie'), /Secure/);
});

test('setup flow: test, save, sync; nothing secret or private leaks into responses, storage or logs', async () => {
  const { app, dt, google, store, clock, call, logs } = setup();
  dt.appPut('single', ics(['UID:single', 'SUMMARY:Design review', 'DTSTART:20261117T100000Z', 'DTEND:20261117T110000Z']));
  google.add('me@example.com', BOOKING);

  assert.deepEqual(await app.pass(), { skipped: true, missing: ['DINGTALK_USERNAME', 'DINGTALK_PASSWORD', 'GOOGLE_SOURCE_CALENDAR', 'GOOGLE_MIRROR_CALENDAR', 'GOOGLE_SERVICE_ACCOUNT_JSON'] });

  // Step 1: a wrong password is explained, the right one passes; values are tested before they are saved.
  let r = await call('POST', '/api/test', { parts: ['dingtalk'], values: { DINGTALK_USERNAME: 'u_test', DINGTALK_PASSWORD: 'nope' } });
  assert.deepEqual(r.data.results.map((x) => x.key), ['check.dingtalk.auth']);
  r = await call('POST', '/api/test', { parts: ['dingtalk'], values: { DINGTALK_USERNAME: 'u_test', DINGTALK_PASSWORD: 'caldav-secret' } });
  assert.deepEqual(r.data.results.map((x) => `${x.level} ${x.key}`), ['ok check.dingtalk.ok']);
  assert.equal(store.data.has('settings'), false, 'testing saves nothing');

  // Step 2.
  r = await call('POST', '/api/test', { parts: ['google'], values: { ...GOOD, GOOGLE_MIRROR_CALENDAR: 'typo@group.calendar.google.com' } });
  assert.deepEqual(r.data.results.map((x) => x.key), ['check.google.ok', 'check.source.ok', 'check.mirror.notShared']);
  assert.equal(r.data.results[2].vars.email, 'bot@demo.iam.gserviceaccount.com');
  r = await call('POST', '/api/test', { parts: ['google'], values: GOOD });
  assert.ok(r.data.results.every((x) => x.level === 'ok'));
  assert.equal(google.events.get('mirror@group.calendar.google.com').size, 0, 'the write test leaves nothing behind');

  r = await call('POST', '/api/settings', { values: GOOD });
  assert.equal(r.status, 200);
  assert.deepEqual(r.data.missing, []);
  assert.equal(r.data.serviceAccountEmail, 'bot@demo.iam.gserviceaccount.com');
  assert.deepEqual(r.data.fields.DINGTALK_PASSWORD, { set: true });
  assert.doesNotMatch(JSON.stringify(r.data), /caldav-secret|PRIVATE KEY/, 'secrets never travel back to the browser');
  assert.doesNotMatch(store.data.get('settings'), /caldav-secret|u_test|PRIVATE KEY|me@example/, 'saved settings are encrypted');

  // First sync through the page.
  r = await call('POST', '/api/run', {});
  assert.equal(r.data.error, null);
  assert.deepEqual([r.data.stats.pushed, r.data.stats.mirrored], [1, 1]);
  assert.deepEqual(google.titles('mirror@group.calendar.google.com'), ['Design review']);
  assert.deepEqual(dt.summaries(), ['Design review', 'Intro call: Ada and IT Test']);
  const everything = () => JSON.stringify([r.data, store.data.get('state'), logs]);
  assert.doesNotMatch(everything(), /Design review|Intro call|Ada/, 'no event text in the response, the saved state or the log');

  r = await call('GET', '/api/state');
  assert.equal(r.data.status.bookings, 1);
  assert.equal(r.data.status.busy, 1, 'the page can show how many busy blocks Google holds');
  assert.equal(r.data.status.catchingUp, false);
  assert.deepEqual(r.data.status.last, { at: NOW, pushed: 1, mirrored: 1 });
  assert.equal(r.data.status.err, null);
  assert.ok(r.data.status.lines.some((l) => /^DingTalk \+ booking #/.test(l.text)));

  // Once the new booking has been verified in DingTalk (two minutes after it was written), idle
  // passes do not write to storage: KV allows 1,000 writes a day on the free plan.
  for (let i = 0; i < 3; i++) { clock.now += 60000; await app.pass(); }
  const puts = store.puts;
  for (let i = 0; i < 5; i++) { clock.now += 60000; await app.pass(); }
  assert.equal(store.puts, puts, 'idle passes cause no writes');
});

test('step 3 is confirmed on the server, so every browser sees it; reset forgets it', async () => {
  const { call } = setup();
  let r = await call('POST', '/api/settings', { values: GOOD });
  assert.equal(r.data.fields.CALENDLY_CHECKED.value, '');
  assert.equal((await call('POST', '/api/settings', { values: { CALENDLY_CHECKED: 'yes' } })).data.fields.CALENDLY_CHECKED, 'badValue');
  r = await call('POST', '/api/settings', { values: { CALENDLY_CHECKED: 'true' } });
  assert.deepEqual(r.data.fields.CALENDLY_CHECKED, { set: true, value: 'true' });
  assert.deepEqual((await call('GET', '/api/state')).data.missing, [], 'it is a note for the page, not a setting the sync waits for');
  r = await call('POST', '/api/settings', { values: { CALENDLY_CHECKED: null } });
  assert.equal(r.data.fields.CALENDLY_CHECKED.set, false, 'taking a tick away makes the step "to do" again');
  r = await call('POST', '/api/settings', { values: { CALENDLY_CHECKED: 'skipped' } });
  assert.deepEqual(r.data.fields.CALENDLY_CHECKED, { set: true, value: 'skipped' }, 'Calendly is optional: the step can be skipped');
  assert.equal(r.data.fields.PUSH_MATCH.value, '', 'skipping leaves the default: only Calendly bookings are copied to DingTalk');
  await call('POST', '/api/settings', { values: { CALENDLY_CHECKED: 'true' } });
  assert.equal((await call('POST', '/api/reset', {})).data.fields.CALENDLY_CHECKED.set, false);
});

test('status: a first sync that stops at the write limit reports that it is still catching up', async () => {
  const { dt, call } = setup();
  for (let i = 0; i < 5; i++) dt.appPut(`e${i}`, ics([`UID:e${i}`, 'SUMMARY:Busy', `DTSTART:2026111${7 + (i % 2)}T1${i}0000Z`, `DTEND:2026111${7 + (i % 2)}T1${i}3000Z`]));
  await call('POST', '/api/settings', { values: { ...GOOD, MAX_WRITES: '2' } });
  let r = await call('POST', '/api/run', {});
  assert.equal(r.data.stats.partial, true);
  r = await call('GET', '/api/state');
  assert.deepEqual([r.data.status.catchingUp, r.data.status.busy], [true, 2], 'two of five blocks are in Google and the page is told more will follow');
  await call('POST', '/api/run', {});
  await call('POST', '/api/run', {});
  r = await call('GET', '/api/state');
  assert.deepEqual([r.data.status.catchingUp, r.data.status.busy], [false, 5]);
});

test('debug mode: titles and network calls appear in results and logs, never in saved status; it expires', async () => {
  const { app, dt, store, clock, call, logs } = setup();
  dt.appPut('single', ics(['UID:single', 'SUMMARY:Design review', 'DTSTART:20261117T100000Z', 'DTEND:20261117T110000Z']));
  await call('POST', '/api/settings', { values: GOOD });
  let r = await call('POST', '/api/debug', { on: true });
  assert.deepEqual(r.data.debug, { on: true, until: NOW + 24 * 3600000 });

  r = await call('POST', '/api/run', {});
  assert.ok(r.data.lines.some((l) => /Google \+ "Design review"/.test(l)));
  assert.ok(r.data.lines.some((l) => /^http REPORT https:\/\/calendar\.dingtalk\.com\/dav\/u_test\/primary\/ -> 207/.test(l)));
  assert.ok(logs.some((l) => /"Design review"/.test(l)));
  assert.doesNotMatch(JSON.stringify(r.data.lines), /caldav-secret|Bearer|Basic /);
  assert.doesNotMatch(store.data.get('state'), /Design review/, 'the status kept for the page stays free of titles');

  clock.now += 25 * 3600000;
  assert.equal((await call('GET', '/api/state')).data.debug.on, false, 'switches itself off after 24 hours');
  dt.appPut('other', ics(['UID:other', 'SUMMARY:Board meeting', 'DTSTART:20261118T100000Z', 'DTEND:20261118T110000Z']));
  r = await call('POST', '/api/run', {});
  assert.doesNotMatch(JSON.stringify([r.data, logs.slice(-10)]), /Board meeting/);
  void app;
});

test('preview: a dry run reports what would happen and changes nothing', async () => {
  const { dt, google, store, call } = setup();
  dt.appPut('single', ics(['UID:single', 'SUMMARY:Design review', 'DTSTART:20261117T100000Z', 'DTEND:20261117T110000Z']));
  google.add('me@example.com', BOOKING);
  await call('POST', '/api/settings', { values: GOOD });
  const r = await call('POST', '/api/run', { dryRun: true });
  assert.equal(r.data.dryRun, true);
  assert.deepEqual([r.data.stats.pushed, r.data.stats.mirrored], [1, 1]);
  assert.ok(r.data.lines.every((l) => l.startsWith('[dry-run] ')));
  assert.equal(dt.items.size, 1);
  assert.equal(google.events.get('mirror@group.calendar.google.com').size, 0);
  assert.equal(store.data.has('state'), false);
});

test('status: a failing sync is reported once and clears when it works again', async () => {
  const { app, dt, store, clock, call } = setup();
  await call('POST', '/api/settings', { values: GOOD });
  await app.pass();
  dt.password = 'changed-in-dingtalk';
  clock.now += 60000; await app.pass();
  let r = await call('GET', '/api/state');
  assert.match(r.data.status.err.msg, /DingTalk CalDAV PROPFIND .* -> 401/);
  const puts = store.puts;
  for (let i = 0; i < 5; i++) { clock.now += 60000; await app.pass(); }
  assert.equal(store.puts, puts, 'the same error is not written again every minute');
  assert.equal((await call('GET', '/api/state')).data.status.err.since, NOW + 60000);
  dt.password = 'caldav-secret';
  clock.now += 60000; await app.pass();
  r = await call('GET', '/api/state');
  assert.equal(r.data.status.err, null);
});

test('doctor: a calendar shared read-only is told apart from one that is not shared', async () => {
  const { call } = setup({ mirrorRole: 'reader' });
  const r = await call('POST', '/api/test', { parts: ['google'], values: GOOD });
  assert.deepEqual(r.data.results.map((x) => `${x.level} ${x.key}`), ['ok check.google.ok', 'ok check.source.ok', 'error check.mirror.readonly']);
  const bad = await call('POST', '/api/test', { parts: ['google'], values: { ...GOOD, GOOGLE_SERVICE_ACCOUNT_JSON: '{"nope":true}' } });
  assert.equal(bad.status, 400);
  assert.equal(bad.data.fields.GOOGLE_SERVICE_ACCOUNT_JSON, 'badKey');
});

test('settings only come from the page: the environment is ignored, and reset deletes everything', async () => {
  const { store, call, app } = setup({ env: { ...GOOD, HORIZON_DAYS: '30', DEBUG: 'true' } });
  let r = await call('GET', '/api/state');
  assert.equal(r.data.missing.length, 5);
  assert.deepEqual(r.data.fields.DINGTALK_USERNAME, { set: false, value: '' });
  assert.deepEqual(r.data.fields.DINGTALK_PASSWORD, { set: false });
  assert.deepEqual(r.data.debug, { on: false, until: 0 });
  assert.equal((await app.pass()).skipped, true);
  r = await call('POST', '/api/test', { parts: ['dingtalk'] });
  assert.deepEqual(r.data.results.map((x) => x.key), ['check.dingtalk.missing']);

  r = await call('POST', '/api/settings', { values: { ...GOOD, HORIZON_DAYS: '60' } });
  assert.deepEqual(r.data.fields.DINGTALK_USERNAME, { set: true, value: 'u_test' });
  assert.deepEqual(r.data.fields.DINGTALK_PASSWORD, { set: true });
  assert.equal(r.data.fields.HORIZON_DAYS.value, '60');
  r = await call('POST', '/api/run', {});
  assert.equal(r.data.error, null);
  assert.ok(store.data.has('state'));

  r = await call('POST', '/api/reset', {});
  assert.deepEqual([...store.data.keys()], []);
  assert.equal(r.data.missing.length, 5);
});

test('a changed admin password locks the saved settings instead of failing', async () => {
  const first = setup();
  await first.call('POST', '/api/settings', { values: GOOD });
  const store = first.store;
  const app = createApp({ store, env: { ADMIN_PASSWORD: 'a different password' }, platform: 'node', logger: silent });
  const res = await app.handle(new Request('https://bridge.test/api/state', { headers: { Authorization: 'Bearer a different password' } }));
  const data = await res.json();
  assert.equal(data.locked, true);
  assert.equal(data.missing.length, 5);
  assert.deepEqual(await app.pass(), { skipped: true, missing: data.missing });
});

test('older deployments: POST /run with RUN_TOKEN still triggers a pass', async () => {
  const { app } = setup({ env: { RUN_TOKEN: 'tok-123' } });
  const run = (token) => app.handle(new Request('https://bridge.test/run', { method: 'POST', headers: { Authorization: `Bearer ${token}` } }));
  assert.equal((await run('wrong')).status, 404);
  assert.equal((await (await run('tok-123')).json()).skipped, true);
});
