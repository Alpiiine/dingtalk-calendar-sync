// The settings of the bridge. All of them are entered on the setup page and saved (encrypted)
// in the store. Nothing here is read from environment variables: the only things the host still
// takes from its environment are the ones it needs before the page can open (ADMIN_PASSWORD,
// and for Node the port and where to keep its files).
import { LANGS } from './i18n.js';

/** Settings the setup page may change. `secret` values are never sent back to the browser. */
export const EDITABLE = {
  DINGTALK_USERNAME: {},
  DINGTALK_PASSWORD: { secret: true },
  GOOGLE_SERVICE_ACCOUNT_JSON: { secret: true },
  GOOGLE_SOURCE_CALENDAR: {},
  GOOGLE_MIRROR_CALENDAR: {},
  PUSH_MATCH: {},
  PUSH_PREFIX: { keepSpaces: true },
  MIRROR_TITLES: {},
  HORIZON_DAYS: {},
  DEFAULT_TZ: {},
  DTSYNC_LANG: {},
  // Advanced options.
  LOOKBACK_DAYS: {},
  FULL_SYNC_MINUTES: {},
  MAX_WRITES: {},
  // Step 3 of the setup page, which is optional: 'true' once the owner confirmed that Calendly
  // checks both calendars, 'skipped' when Calendly is not used. The bridge cannot look into
  // Calendly, so this is a note for the page, kept where every browser sees it.
  CALENDLY_CHECKED: {},
};

/** The Google service account email address inside the key, or '' when there is no valid key. */
export function serviceAccountEmail(settings) {
  try {
    return JSON.parse(settings.GOOGLE_SERVICE_ACCOUNT_JSON).client_email || '';
  } catch {
    return '';
  }
}

const whole = (value, min, max, error = 'badValue') => {
  const n = Number(value);
  return Number.isInteger(n) && n >= min && n <= max ? { value: String(n) } : { error };
};

function checkValue(key, value) {
  switch (key) {
    case 'GOOGLE_SERVICE_ACCOUNT_JSON': {
      let k;
      try { k = JSON.parse(value); } catch { return { error: 'badKey' }; }
      if (!k || typeof k.client_email !== 'string' || typeof k.private_key !== 'string') return { error: 'badKey' };
      return { value: JSON.stringify(k) };
    }
    case 'PUSH_MATCH':
      try { new RegExp(value, 'i'); } catch { return { error: 'badPattern' }; }
      return { value };
    case 'HORIZON_DAYS': return whole(value, 1, 365, 'badDays');
    case 'LOOKBACK_DAYS': return whole(value, 1, 3650);
    case 'FULL_SYNC_MINUTES': return whole(value, 1, 1440);
    case 'MAX_WRITES': return whole(value, 0, 10000); // 0 = no limit
    case 'DEFAULT_TZ':
      try { new Intl.DateTimeFormat('en-US', { timeZone: value }); } catch { return { error: 'badTimeZone' }; }
      return { value };
    case 'MIRROR_TITLES':
      return /^(true|false)$/.test(value) ? { value } : { error: 'badValue' };
    case 'CALENDLY_CHECKED':
      return value === 'true' || value === 'skipped' ? { value } : { error: 'badValue' };
    case 'DTSYNC_LANG':
      return LANGS.includes(value) ? { value } : { error: 'badValue' };
    default:
      return value.length > 2000 ? { error: 'badValue' } : { value };
  }
}

/**
 * Apply `values` (from the setup page) to the saved settings.
 * null removes a setting; '' leaves a secret untouched and removes anything else.
 * Returns { next } or { errors: { NAME: code } }.
 */
export function applyChanges(stored, values) {
  const next = { ...stored };
  const errors = {};
  for (const [key, spec] of Object.entries(EDITABLE)) {
    if (!(key in (values || {}))) continue;
    let v = values[key];
    if (v === null) { delete next[key]; continue; }
    if (typeof v !== 'string') { errors[key] = 'badValue'; continue; }
    if (!spec.keepSpaces) v = v.trim();
    if (v === '') { if (!spec.secret) delete next[key]; continue; }
    const res = checkValue(key, v);
    if (res.error) errors[key] = res.error;
    else next[key] = res.value;
  }
  if (next.GOOGLE_SOURCE_CALENDAR && next.GOOGLE_SOURCE_CALENDAR === next.GOOGLE_MIRROR_CALENDAR) errors.GOOGLE_MIRROR_CALENDAR = 'sameCalendar';
  return Object.keys(errors).length ? { errors } : { next };
}

/** What the setup page is allowed to see: which settings are saved, and the values of the non-secret ones. */
export function publicView(stored) {
  const fields = {};
  for (const [key, spec] of Object.entries(EDITABLE)) {
    const set = typeof stored[key] === 'string' && stored[key] !== '';
    fields[key] = { set, ...(spec.secret ? {} : { value: set ? stored[key] : '' }) };
  }
  return fields;
}
