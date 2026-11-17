// Turns settings into the config object the sync core uses.
// Settings are plain NAME=value pairs: what was saved on the setup page (see settings.js).
import { DingTalkCalDAV } from './caldav.js';
import { GoogleCalendar, googleAuth } from './google.js';
import { pickLang } from './i18n.js';

const num = (v, d) => (v === undefined || v === null || v === '' ? d : Number(v));
const bool = (v, d) => (v === undefined || v === null || v === '' ? d : /^(1|true|yes|on)$/i.test(String(v)));

export const REQUIRED = ['DINGTALK_USERNAME', 'DINGTALK_PASSWORD', 'GOOGLE_SOURCE_CALENDAR', 'GOOGLE_MIRROR_CALENDAR'];

/** Names of the settings that still have to be filled in before a sync can run. */
export function missingSettings(settings) {
  const missing = REQUIRED.filter((k) => !settings[k]);
  if (!settings.GOOGLE_SERVICE_ACCOUNT_JSON && !settings.GOOGLE_REFRESH_TOKEN) missing.push('GOOGLE_SERVICE_ACCOUNT_JSON');
  return missing;
}

/** Debug mode: switched on for a while from the setup page, through DEBUG_UNTIL (a timestamp in ms). */
export function debugOn(settings, now = Date.now()) {
  return num(settings.DEBUG_UNTIL, 0) > now;
}

export function loadConfig(settings, { now = Date.now(), platform = 'node', dryRun = false } = {}) {
  const missing = REQUIRED.filter((k) => !settings[k]);
  if (missing.length) throw new Error(`Missing configuration: ${missing.join(', ')}`);
  if (settings.GOOGLE_SOURCE_CALENDAR === settings.GOOGLE_MIRROR_CALENDAR) {
    throw new Error('GOOGLE_SOURCE_CALENDAR and GOOGLE_MIRROR_CALENDAR must be two different calendars');
  }
  let pushMatch;
  try {
    pushMatch = new RegExp(settings.PUSH_MATCH || 'calendly\\.com', 'i');
  } catch (err) {
    throw new Error(`PUSH_MATCH is not a valid pattern: ${err.message}`);
  }
  return {
    dingtalk: {
      username: settings.DINGTALK_USERNAME, password: settings.DINGTALK_PASSWORD,
      baseUrl: settings.DINGTALK_URL || undefined, calendarPath: settings.DINGTALK_CALENDAR_PATH || undefined,
    },
    googleCreds: {
      serviceAccount: settings.GOOGLE_SERVICE_ACCOUNT_JSON || undefined,
      clientId: settings.GOOGLE_CLIENT_ID, clientSecret: settings.GOOGLE_CLIENT_SECRET, refreshToken: settings.GOOGLE_REFRESH_TOKEN,
    },
    // Calendar Calendly adds bookings to (usually your Google address).
    sourceCalendarId: settings.GOOGLE_SOURCE_CALENDAR,
    // Separate calendar the bridge owns; Calendly checks it for conflicts.
    mirrorCalendarId: settings.GOOGLE_MIRROR_CALENDAR,
    // Which Google events are copied into DingTalk. Default: Calendly bookings only. ".*" copies everything.
    pushMatch,
    pushPrefix: settings.PUSH_PREFIX || '',
    mirrorTitles: bool(settings.MIRROR_TITLES, true), // false: mirror as anonymous "Busy (DingTalk)" blocks
    horizonDays: num(settings.HORIZON_DAYS, 90), // how far ahead to sync; keep >= Calendly's booking range
    lookbackDays: num(settings.LOOKBACK_DAYS, 730), // how far back to look for recurring series that are still running
    historyBatch: num(settings.HISTORY_BATCH, 300),
    fullSyncMinutes: num(settings.FULL_SYNC_MINUTES, 15),
    confirmMinutes: num(settings.CONFIRM_MINUTES, 10),
    verifyMinutes: num(settings.VERIFY_MINUTES, 2),
    // Only used for events without a timezone. The setup page saves the zone of the browser it
    // is opened in; until then such events are read as UTC.
    defaultTz: settings.DEFAULT_TZ || 'UTC',
    // Language of the text the bridge writes into events: a code from locales/, such as 'en' or 'zh'.
    lang: pickLang(settings.DTSYNC_LANG),
    // Calendar writes per pass; 0 = no limit. A Worker on the free plan may make 50 outside
    // requests per run, so there the bridge stops early and carries on a minute later.
    maxWrites: num(settings.MAX_WRITES, platform === 'cloudflare' ? 30 : 0),
    // Debug mode adds event titles and every HTTP call to the log. Off: logs carry no event text.
    debug: debugOn(settings, now),
    dryRun, // log what would be done without writing anything
  };
}

/**
 * `debugLog`, when given, receives one line per HTTP call (method, URL without query, status, ms).
 * Request and response bodies and the Authorization header are never logged.
 */
export function makeClients(cfg, { fetch: f = globalThis.fetch, tokenCache = {}, debugLog } = {}) {
  const traced = !debugLog ? f : async (url, init = {}) => {
    const started = Date.now();
    const where = String(url).split('?')[0];
    try {
      const res = await f(url, init);
      debugLog(`http ${init.method || 'GET'} ${where} -> ${res.status} (${Date.now() - started} ms)`);
      return res;
    } catch (err) {
      debugLog(`http ${init.method || 'GET'} ${where} -> failed: ${err.message}`);
      throw err;
    }
  };
  const caldav = new DingTalkCalDAV({ ...cfg.dingtalk, fetch: traced });
  const google = new GoogleCalendar({ getToken: googleAuth(cfg.googleCreds, { fetch: traced, cache: tokenCache }), fetch: traced });
  return { caldav, google };
}
