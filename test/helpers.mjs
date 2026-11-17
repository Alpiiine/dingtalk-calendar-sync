// In-memory stand-ins for the two remote systems.
// FakeDingTalk reproduces the server quirks measured on calendar.dingtalk.com (see README).
import { parseEvents } from '../src/ical.js';
import { toUtcMs } from '../src/tz.js';

const DAY = 86400000;
const parseStamp = (s) => Date.parse(s.replace(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/, '$1-$2-$3T$4:$5:$6Z'));
const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

export class FakeDingTalk {
  constructor({ user = 'u_test', password = null, clock = () => Date.now(), lagMs = 0 } = {}) {
    this.user = user;
    this.password = password; // when set, requests must carry this CalDAV password
    this.clock = clock;
    this.lagMs = lagMs; // read-after-write delay
    this.items = new Map(); // name -> { ics, etag, visibleAt }
    this.tombstones = new Set();
    this.seq = 1000;
    this.calls = [];
    this.multigets = []; // names asked for by each calendar-multiget
    this.dropNextCreate = false; // answer 201 but store nothing
    this.fetch = this.fetch.bind(this);
  }

  get path() { return `/dav/${this.user}/primary/`; }
  visible() { return [...this.items].filter(([, v]) => v.visibleAt <= this.clock()); }
  summaries() { return this.visible().map(([, v]) => parseEvents(v.ics)[0].summary).sort(); }

  /** Simulates the user creating or editing an event inside the DingTalk app. */
  appPut(name, ics) { this.items.set(name, { ics, etag: `"${++this.seq}"`, visibleAt: 0 }); }
  appDelete(name) { this.items.delete(name); this.seq++; }

  async fetch(url, { method = 'GET', body = '', headers = {} } = {}) {
    const p = new URL(url).pathname;
    if (this.password !== null && headers.Authorization !== 'Basic ' + btoa(`${this.user}:${this.password}`)) {
      return new Response('<html>HTTP Status 401</html>', { status: 401 });
    }
    this.calls.push(`${method} ${body.includes('calendar-multiget') ? 'multiget' : body.includes('calendar-query') ? (body.includes('calendar-data') ? 'query' : 'query-etags') : ''}`.trim());
    const reply = (status, text = '') => new Response(status === 204 ? null : text, { status });

    if (method === 'PROPFIND') {
      return reply(207, `<D:multistatus xmlns:D="DAV:"><D:response><D:href>${this.path}</D:href><D:propstat><D:prop><CS:getctag xmlns:CS="http://calendarserver.org/ns/">${this.seq}</CS:getctag><D:displayname>Fake</D:displayname><D:current-user-privilege-set><D:privilege><D:write/></D:privilege></D:current-user-privilege-set></D:prop></D:propstat></D:response></D:multistatus>`);
    }

    if (method === 'REPORT') {
      let hits;
      if (body.includes('calendar-multiget')) {
        const names = [...body.matchAll(/<d:href>([^<]+)<\/d:href>/g)].map((m) => decodeURIComponent(m[1].split('/').pop()));
        this.multigets.push(names);
        hits = this.visible().filter(([n]) => names.includes(n));
      } else {
        const [, s, e] = /time-range start="([^"]+)" end="([^"]+)"/.exec(body);
        const a = parseStamp(s), b = parseStamp(e);
        if (b - a > 800 * DAY) return reply(400, '<html>HTTP Status 400</html>');
        // Quirk: only the master's own DTSTART is matched; no recurrence expansion.
        hits = this.visible().filter(([, v]) => {
          const ev = parseEvents(v.ics).find((x) => !x.recurrenceId) || parseEvents(v.ics)[0];
          const st = toUtcMs(ev.start, 'Asia/Shanghai'), en = ev.end ? toUtcMs(ev.end, 'Asia/Shanghai') : st;
          return en > a && st < b;
        });
      }
      const withData = body.includes('calendar-data');
      const xml = hits.map(([n, v]) => `<D:response><D:href>${this.path}${encodeURIComponent(n)}</D:href><D:propstat><D:prop><D:getetag>${esc(v.etag)}</D:getetag>${withData ? `<C:calendar-data xmlns:C="urn:ietf:params:xml:ns:caldav">${esc(v.ics).replace(/\r/g, '&#13;')}</C:calendar-data>` : ''}</D:prop><D:status>HTTP/1.1 200 OK</D:status></D:propstat></D:response>`).join('');
      return reply(207, `<?xml version="1.0" encoding="UTF-8"?><D:multistatus xmlns:D="DAV:">${xml}</D:multistatus>`);
    }

    const name = decodeURIComponent(p.slice(this.path.length));
    if (method === 'PUT') {
      if (!name.endsWith('.ics')) return reply(400);
      const uid = name.slice(0, -4);
      if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(uid) && !uid.includes('@')) return reply(400);
      // Quirk: edits and re-creations are acknowledged but discarded.
      if (this.items.has(uid) || this.tombstones.has(uid)) return reply(204);
      if (this.dropNextCreate) { this.dropNextCreate = false; return reply(201); }
      // Quirk: the server rewrites the event — adds the owner as organizer, drops LOCATION.
      const stored = body.replace(/^LOCATION:.*\r\n/m, '').replace('BEGIN:VEVENT\r\n', `BEGIN:VEVENT\r\nORGANIZER;CN=owner:mailto:owner@dingtalk.com\r\n`);
      this.items.set(uid, { ics: stored, etag: `"${++this.seq}"`, visibleAt: this.clock() + this.lagMs });
      return reply(201);
    }
    if (method === 'DELETE') {
      // Quirk: deleting an event that is not readable yet is acknowledged but does nothing.
      const it = this.items.get(name);
      if (it && it.visibleAt <= this.clock()) { this.items.delete(name); this.tombstones.add(name); this.seq++; }
      return reply(204);
    }
    return reply(405);
  }
}

/** Same surface as GoogleCalendar, backed by Maps. */
export class FakeGoogle {
  constructor() { this.cals = new Map(); this.writes = []; }
  cal(id) { if (!this.cals.has(id)) this.cals.set(id, new Map()); return this.cals.get(id); }
  add(calId, ev) { this.cal(calId).set(ev.id, { status: 'confirmed', ...ev }); }
  titles(calId) { return [...this.cal(calId).values()].map((e) => `${e.summary} @ ${e.start.dateTime || e.start.date}`).sort(); }

  async list(calId, { timeMin, timeMax, privateProperty }) {
    const ms = (t) => Date.parse(t.dateTime ? (t.timeZone ? `${t.dateTime}Z` : t.dateTime) : t.date);
    return [...this.cal(calId).values()].filter((e) => {
      if (privateProperty) {
        const [k, v] = privateProperty.split('=');
        if (e.extendedProperties?.private?.[k] !== v) return false;
      }
      return ms(e.end) > timeMin - DAY && ms(e.start) < timeMax + DAY; // loose: naive local times
    });
  }
  async upsert(calId, ev, { exists = false } = {}) { this.writes.push(`${exists ? 'update' : 'upsert'} ${ev.summary}`); this.cal(calId).set(ev.id, structuredClone(ev)); }
  async remove(calId, id) { this.writes.push(`remove ${id}`); this.cal(calId).delete(id); }
}

export const ics = (lines) => ['BEGIN:VCALENDAR', 'BEGIN:VEVENT', ...lines, 'END:VEVENT', 'END:VCALENDAR', ''].join('\r\n');

/**
 * Google at the HTTP level (token endpoint + the Calendar calls the bridge makes), for tests of
 * the whole app. `calendars` maps id -> { summary, role: 'reader' | 'writer' }; calendars that are
 * not listed answer 404, exactly like a calendar that was not shared with the service account.
 */
export class FakeGoogleHttp {
  constructor(calendars = {}) {
    this.calendars = calendars;
    this.events = new Map(Object.keys(calendars).map((id) => [id, new Map()]));
    this.calls = [];
    this.fetch = this.fetch.bind(this);
  }
  add(calId, ev) { this.events.get(calId).set(ev.id, { status: 'confirmed', ...ev }); }
  titles(calId) { return [...this.events.get(calId).values()].map((e) => e.summary).sort(); }

  async fetch(url, { method = 'GET', body } = {}) {
    const u = new URL(url);
    this.calls.push(`${method} ${u.pathname}`);
    const json = (data, status = 200) => new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });
    if (u.hostname === 'oauth2.googleapis.com') return json({ access_token: 'tok', expires_in: 3600 });

    let m = /^\/calendar\/v3\/users\/me\/calendarList\/(.+)$/.exec(u.pathname);
    if (m) return json({ error: { message: 'Not Found' } }, 404); // a service account has no calendar list
    m = /^\/calendar\/v3\/calendars\/([^/]+)(?:\/events(?:\/([^/]+))?)?$/.exec(u.pathname);
    if (!m) return json({ error: { message: 'unexpected call' } }, 500);
    const calId = decodeURIComponent(m[1]), cal = this.calendars[calId], evs = this.events.get(calId);
    if (!cal) return json({ error: { message: 'Not Found' } }, 404);
    const isEvents = u.pathname.includes('/events');
    if (!isEvents) return json({ id: calId, summary: cal.summary, timeZone: 'Asia/Shanghai' });
    if (method === 'GET') {
      const prop = u.searchParams.get('privateExtendedProperty');
      const items = [...evs.values()].filter((e) => {
        if (!prop) return true;
        const [k, v] = prop.split('=');
        return e.extendedProperties?.private?.[k] === v;
      });
      return json({ items });
    }
    if (cal.role !== 'writer') return json({ error: { message: 'Forbidden' } }, 403);
    if (method === 'POST') {
      const ev = JSON.parse(body);
      if (evs.has(ev.id)) return json({ error: { message: 'duplicate' } }, 409);
      evs.set(ev.id, ev);
      return json(ev);
    }
    if (method === 'PUT') {
      if (!evs.has(m[2])) return json({ error: { message: 'Not Found' } }, 404);
      evs.set(m[2], JSON.parse(body));
      return json(JSON.parse(body));
    }
    if (method === 'DELETE') { evs.delete(m[2]); return new Response(null, { status: 204 }); }
    return json({ error: { message: 'unexpected method' } }, 500);
  }
}

/** A throwaway service-account key that really signs. */
export async function makeServiceAccountKey(email = 'bot@demo.iam.gserviceaccount.com') {
  const { privateKey } = await crypto.subtle.generateKey(
    { name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' }, true, ['sign', 'verify']);
  const der = Buffer.from(await crypto.subtle.exportKey('pkcs8', privateKey)).toString('base64');
  return JSON.stringify({
    type: 'service_account', client_email: email,
    private_key: `-----BEGIN PRIVATE KEY-----\n${der.match(/.{1,64}/g).join('\n')}\n-----END PRIVATE KEY-----\n`,
  });
}

/** Routes requests to the two fakes by host name. */
export const routeFetch = (dt, google) => (url, init) => (new URL(url).hostname === 'calendar.dingtalk.com' ? dt.fetch(url, init) : google.fetch(url, init));

/** In-memory key-value store with the same surface as the Worker's KV binding; counts writes. */
export class MemoryStore {
  constructor() { this.data = new Map(); this.puts = 0; }
  async get(key) { return this.data.has(key) ? this.data.get(key) : null; }
  async put(key, value) { this.puts++; this.data.set(key, value); }
  async delete(key) { this.data.delete(key); }
}
