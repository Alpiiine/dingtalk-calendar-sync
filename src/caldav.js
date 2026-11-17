// DingTalk CalDAV client. Plain fetch, no dependencies.
//
// Server behaviour this client is written around (measured against calendar.dingtalk.com):
//   * REPORT calendar-query with a time-range works; ranges of ~3 years are rejected (400).
//   * The time-range only looks at an event's first DTSTART, so recurring series must be
//     fetched from the past and expanded locally.
//   * PUT of a NEW resource works (201) — only at "<uid>.ics" and only with a UUID-shaped UID.
//   * PUT on an EXISTING resource answers 204 but is silently discarded. Never edit; replace.
//   * DELETE works (204). Re-creating a deleted UID is silently discarded, so every create
//     needs a fresh UID.
//   * Reads lag writes by up to about a minute. A DELETE sent before the new event is readable
//     answers 204 but does nothing, so deletions have to be verified later.
//   * LOCATION and URL are dropped on create; DESCRIPTION, times and all-day survive.

const DAY = 86400000;
const MAX_RANGE_DAYS = 600;

const xmlDecode = (s) => s
  .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
  .replace(/&#(x?)([0-9a-fA-F]+);/g, (_, x, n) => String.fromCodePoint(parseInt(n, x ? 16 : 10)))
  .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&');

const xmlEncode = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

function tag(xml, name) {
  const m = new RegExp(`<(?:[\\w-]+:)?${name}(?:\\s[^>]*)?>([\\s\\S]*?)</(?:[\\w-]+:)?${name}>`).exec(xml);
  return m ? m[1] : null;
}

/** Split a WebDAV multistatus body into [{ href, etag, ics, ok }]. */
export function parseMultistatus(xml) {
  const out = [];
  for (const chunk of xml.split(/<(?:[\w-]+:)?response(?:\s[^>]*)?>/).slice(1)) {
    const href = tag(chunk, 'href');
    if (!href) continue;
    const etag = tag(chunk, 'getetag');
    const data = tag(chunk, 'calendar-data');
    out.push({
      href: xmlDecode(href).trim(),
      etag: etag ? xmlDecode(etag).trim() : null,
      ics: data ? xmlDecode(data) : null,
      ok: Boolean(etag || data),
    });
  }
  return out;
}

const stamp = (ms) => new Date(ms).toISOString().replace(/[-:]/g, '').slice(0, 15) + 'Z';

export class DingTalkCalDAV {
  constructor({ username, password, baseUrl = 'https://calendar.dingtalk.com', calendarPath, fetch: f = globalThis.fetch }) {
    if (!username || !password) throw new Error('DingTalk CalDAV username and password are required');
    this.base = baseUrl.replace(/\/$/, '');
    this.path = calendarPath || `/dav/${username}/primary/`;
    this.auth = 'Basic ' + btoa(`${username}:${password}`);
    this.fetch = (...args) => f(...args); // unbound fetch throws in browsers/Workers
  }

  async request(method, path, { body, headers = {}, expect } = {}) {
    const res = await this.fetch(this.base + path, { method, body, headers: { Authorization: this.auth, ...headers } });
    const text = await res.text();
    if (expect && !expect.includes(res.status)) {
      const err = new Error(`DingTalk CalDAV ${method} ${path} -> ${res.status} ${text.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').slice(0, 160)}`);
      err.status = res.status;
      throw err;
    }
    return { status: res.status, text };
  }

  report(body) {
    return this.request('REPORT', this.path, {
      body, expect: [207], headers: { Depth: '1', 'Content-Type': 'application/xml; charset=utf-8' },
    }).then((r) => parseMultistatus(r.text));
  }

  /** Collection tag: changes whenever anything in the calendar changes. */
  async ctag() {
    const { text } = await this.request('PROPFIND', this.path, {
      expect: [207], headers: { Depth: '0', 'Content-Type': 'application/xml; charset=utf-8' },
      body: '<?xml version="1.0"?><d:propfind xmlns:d="DAV:" xmlns:cs="http://calendarserver.org/ns/"><d:prop><cs:getctag/></d:prop></d:propfind>',
    });
    return tag(text, 'getctag');
  }

  /** Events whose (first) start lies in [fromMs, toMs). `data: false` returns hrefs + etags only. */
  async query(fromMs, toMs, { data = true } = {}) {
    const out = new Map();
    for (let a = fromMs; a < toMs; a += MAX_RANGE_DAYS * DAY) {
      const b = Math.min(toMs, a + MAX_RANGE_DAYS * DAY);
      const items = await this.report(
        '<?xml version="1.0"?><c:calendar-query xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav">' +
        `<d:prop><d:getetag/>${data ? '<c:calendar-data/>' : ''}</d:prop>` +
        '<c:filter><c:comp-filter name="VCALENDAR"><c:comp-filter name="VEVENT">' +
        `<c:time-range start="${stamp(a)}" end="${stamp(b)}"/>` +
        '</c:comp-filter></c:comp-filter></c:filter></c:calendar-query>');
      for (const it of items) if (it.ok) out.set(it.href, it);
    }
    return [...out.values()];
  }

  async multiget(hrefs) {
    const out = [];
    for (let i = 0; i < hrefs.length; i += 100) {
      const items = await this.report(
        '<?xml version="1.0"?><c:calendar-multiget xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav">' +
        '<d:prop><d:getetag/><c:calendar-data/></d:prop>' +
        hrefs.slice(i, i + 100).map((h) => `<d:href>${xmlEncode(h)}</d:href>`).join('') +
        '</c:calendar-multiget>');
      out.push(...items.filter((it) => it.ok));
    }
    return out;
  }

  /** Create a new event. Throws unless the server answers 201 (204 means "ignored": the UID was used before). */
  async create(uid, ics) {
    await this.request('PUT', `${this.path}${encodeURIComponent(uid)}.ics`, {
      body: ics, expect: [201], headers: { 'Content-Type': 'text/calendar; charset=utf-8' },
    });
  }

  async remove(uid) {
    await this.request('DELETE', `${this.path}${encodeURIComponent(uid)}`, { expect: [200, 204, 404] });
  }

  /** Read-only connectivity check used by `doctor`. */
  async whoami() {
    const { text } = await this.request('PROPFIND', this.path, {
      expect: [207], headers: { Depth: '0', 'Content-Type': 'application/xml; charset=utf-8' },
      body: '<?xml version="1.0"?><d:propfind xmlns:d="DAV:"><d:prop><d:displayname/><d:current-user-privilege-set/></d:prop></d:propfind>',
    });
    return { calendar: xmlDecode(tag(text, 'displayname') || ''), canWrite: /<(?:[\w-]+:)?write\s*\/>/.test(text) };
  }
}
