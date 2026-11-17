// A playground: the real setup page and sync engine running against in-memory stand-ins for
// DingTalk and Google. Nothing leaves your machine and no accounts are needed.
//
//   npm run demo        then open http://localhost:8788   (admin password: demo-password)
//
// Values that pass the tests: CalDAV username "u_demo", password "demo", any key file made by
// Google (or the one this script prints), main calendar "me@example.com",
// DingTalk calendar "dingtalk@group.calendar.google.com".
import { createServer } from 'node:http';
import { writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createApp } from '../src/app.js';
import { FakeDingTalk, FakeGoogleHttp, MemoryStore, makeServiceAccountKey, routeFetch, ics } from '../test/helpers.mjs';

const port = Number(process.env.PORT || 8788);
const day = (n) => new Date(Date.now() + n * 86400000).toISOString().slice(0, 10).replace(/-/g, '');

const dt = new FakeDingTalk({ user: 'u_demo', password: 'demo' });
dt.appPut('review', ics(['UID:review', 'SUMMARY:Design review', `DTSTART:${day(2)}T020000Z`, `DTEND:${day(2)}T030000Z`]));
dt.appPut('offsite', ics(['UID:offsite', 'SUMMARY:Team offsite', `DTSTART;VALUE=DATE:${day(5)}`, `DTEND;VALUE=DATE:${day(6)}`]));
dt.appPut('standup', ics(['UID:standup', 'SUMMARY:Standup', 'RRULE:FREQ=WEEKLY;BYDAY=MO,WE,FR', 'DTSTART;TZID=Asia/Shanghai:20250106T093000', 'DTEND;TZID=Asia/Shanghai:20250106T094500']));

const google = new FakeGoogleHttp({
  'me@example.com': { summary: 'Me', role: 'reader' },
  'dingtalk@group.calendar.google.com': { summary: 'DingTalk', role: 'writer' },
  'readonly@group.calendar.google.com': { summary: 'Shared read-only by mistake', role: 'reader' },
});
google.add('me@example.com', {
  id: 'booking1', summary: 'Intro call: Ada Lovelace and you', start: { dateTime: `${new Date(Date.now() + 3 * 86400000).toISOString().slice(0, 10)}T10:00:00Z` },
  end: { dateTime: `${new Date(Date.now() + 3 * 86400000).toISOString().slice(0, 10)}T10:30:00Z` },
  description: 'Need to make changes to this event?\nCancel: https://calendly.com/cancellations/demo',
  attendees: [{ email: 'me@example.com', self: true, responseStatus: 'accepted' }, { email: 'ada@example.org', displayName: 'Ada Lovelace' }],
});

const keyFile = path.join(tmpdir(), 'dtsync-demo-key.json');
await writeFile(keyFile, await makeServiceAccountKey('dtsync@demo-project.iam.gserviceaccount.com'));

const app = createApp({
  store: new MemoryStore(), env: { ADMIN_PASSWORD: process.env.ADMIN_PASSWORD || 'demo-password', ...(process.env.DEMO_NO_PASSWORD ? { ADMIN_PASSWORD: '' } : {}) },
  platform: process.env.DEMO_PLATFORM || 'cloudflare', fetch: routeFetch(dt, google),
});

createServer(async (req, res) => {
  const chunks = [];
  for await (const c of req) chunks.push(c);
  const headers = new Headers();
  for (const [k, v] of Object.entries(req.headers)) if (typeof v === 'string') headers.set(k, v);
  const response = await app.handle(new Request(`http://localhost:${port}${req.url}`, {
    method: req.method, headers, body: req.method === 'GET' || req.method === 'HEAD' ? undefined : Buffer.concat(chunks),
  }));
  res.writeHead(response.status, Object.fromEntries(response.headers));
  res.end(Buffer.from(await response.arrayBuffer()));
}).listen(port, '127.0.0.1', () => {
  console.log(`Demo setup page: http://localhost:${port}   (admin password: demo-password)`);
  console.log('DingTalk: username u_demo, password demo');
  console.log(`Key file to upload: ${keyFile}`);
  console.log('Calendars: me@example.com and dingtalk@group.calendar.google.com');
});
setInterval(() => app.pass().catch(() => {}), 60000);
