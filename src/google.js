// Google Calendar REST client with WebCrypto auth — no SDK, runs on Node 20+ and Workers.
// Auth is either a service account (share the calendars with its email) or an OAuth refresh token.

const API = 'https://www.googleapis.com/calendar/v3';
const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const SCOPE = 'https://www.googleapis.com/auth/calendar';

const b64url = (bytes) => btoa(String.fromCharCode(...new Uint8Array(bytes))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const b64urlText = (s) => b64url(new TextEncoder().encode(s));

async function serviceAccountAssertion(sa, now) {
  const pem = sa.private_key.replace(/-----[^-]+-----/g, '').replace(/\s+/g, '');
  const der = Uint8Array.from(atob(pem), (c) => c.charCodeAt(0));
  const key = await crypto.subtle.importKey('pkcs8', der, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['sign']);
  const iat = Math.floor(now / 1000);
  const unsigned = `${b64urlText(JSON.stringify({ alg: 'RS256', typ: 'JWT' }))}.${b64urlText(JSON.stringify({
    iss: sa.client_email, scope: SCOPE, aud: TOKEN_URL, iat, exp: iat + 3600,
  }))}`;
  const sig = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', key, new TextEncoder().encode(unsigned));
  return `${unsigned}.${b64url(sig)}`;
}

/**
 * Returns `async () => accessToken`. `cache` is any object; the token is kept on it so a
 * host that persists it (the Worker's state) does not sign a new JWT on every run.
 */
export function googleAuth({ serviceAccount, clientId, clientSecret, refreshToken }, { fetch: f = globalThis.fetch, cache = {}, now = Date.now } = {}) {
  return async () => {
    if (cache.token && cache.exp > now() + 60000) return cache.token;
    let params;
    if (serviceAccount) {
      const sa = typeof serviceAccount === 'string' ? JSON.parse(serviceAccount) : serviceAccount;
      params = { grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: await serviceAccountAssertion(sa, now()) };
    } else if (refreshToken) {
      params = { grant_type: 'refresh_token', client_id: clientId, client_secret: clientSecret, refresh_token: refreshToken };
    } else {
      throw new Error('Google credentials missing: set GOOGLE_SERVICE_ACCOUNT_JSON or GOOGLE_CLIENT_ID/SECRET/REFRESH_TOKEN');
    }
    const res = await f(TOKEN_URL, {
      method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(params).toString(),
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok || !json.access_token) {
      const err = new Error(`Google token request failed: ${res.status} ${json.error_description || json.error || ''}`);
      err.status = res.status;
      throw err;
    }
    cache.token = json.access_token;
    cache.exp = now() + (json.expires_in || 3600) * 1000;
    return cache.token;
  };
}

export class GoogleCalendar {
  constructor({ getToken, fetch: f = globalThis.fetch }) {
    this.getToken = getToken;
    this.fetch = (...args) => f(...args); // unbound fetch throws in browsers/Workers
  }

  async call(method, path, { query, body, ok = [] } = {}) {
    const qs = query ? '?' + new URLSearchParams(query).toString() : '';
    const res = await this.fetch(`${API}${path}${qs}`, {
      method,
      headers: { Authorization: `Bearer ${await this.getToken()}`, ...(body ? { 'Content-Type': 'application/json' } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
    if (ok.includes(res.status)) return { status: res.status };
    const text = await res.text();
    if (!res.ok) {
      const err = new Error(`Google Calendar ${method} ${path} -> ${res.status} ${text.slice(0, 200)}`);
      err.status = res.status;
      throw err;
    }
    return text ? JSON.parse(text) : {};
  }

  /** All single (expanded) events of a calendar in [timeMin, timeMax). */
  async list(calendarId, { timeMin, timeMax, privateProperty, fields }) {
    const items = [];
    let pageToken;
    do {
      const query = {
        singleEvents: 'true', showDeleted: 'false', maxResults: '2500',
        timeMin: new Date(timeMin).toISOString(), timeMax: new Date(timeMax).toISOString(),
        ...(privateProperty ? { privateExtendedProperty: privateProperty } : {}),
        ...(fields ? { fields: `nextPageToken,items(${fields})` } : {}),
        ...(pageToken ? { pageToken } : {}),
      };
      const page = await this.call('GET', `/calendars/${encodeURIComponent(calendarId)}/events`, { query });
      items.push(...(page.items || []));
      pageToken = page.nextPageToken;
    } while (pageToken);
    return items;
  }

  /**
   * Insert with a caller-chosen id; an id that already exists (even as a deleted event) is overwritten.
   * `exists: true` tries the overwrite first, so a known event costs one request instead of two.
   */
  async upsert(calendarId, event, { exists = false } = {}) {
    const base = `/calendars/${encodeURIComponent(calendarId)}/events`;
    const put = (ok) => this.call('PUT', `${base}/${event.id}`, { body: { ...event, status: 'confirmed' }, ok });
    if (exists && (await put([404])).status !== 404) return;
    const res = await this.call('POST', base, { body: event, ok: [409] });
    if (res.status === 409) await put([]);
  }

  async remove(calendarId, eventId) {
    await this.call('DELETE', `/calendars/${encodeURIComponent(calendarId)}/events/${eventId}`, { ok: [404, 410] });
  }

  async calendarInfo(calendarId) {
    return this.call('GET', `/calendars/${encodeURIComponent(calendarId)}`);
  }

  /**
   * Can this login change events in the calendar? Asks the calendar list first (changes nothing).
   * A service account usually has no calendar list entry; then a test entry dated 1 Jan 2000 is
   * added and removed again straight away.
   */
  async canWrite(calendarId) {
    const entry = await this.call('GET', `/users/me/calendarList/${encodeURIComponent(calendarId)}`, { ok: [404] });
    if (entry.accessRole) return entry.accessRole === 'owner' || entry.accessRole === 'writer';
    const id = `dtprobe${crypto.randomUUID().replace(/-/g, '')}`;
    const base = `/calendars/${encodeURIComponent(calendarId)}/events`;
    const res = await this.call('POST', base, {
      ok: [403],
      body: {
        id, summary: 'dtsync connection test', start: { date: '2000-01-01' }, end: { date: '2000-01-02' },
        transparency: 'transparent', visibility: 'private', reminders: { useDefault: false, overrides: [] },
      },
    });
    if (res.status === 403) return false;
    await this.remove(calendarId, id);
    return true;
  }
}
