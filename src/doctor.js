// Connection checks behind the "Save and test" buttons and `node cli.js doctor`.
// Every result is { part, level: 'ok' | 'warn' | 'error', key, vars }; `key` is an i18n message
// (see i18n.js) so the page and the command line can explain the problem in the user's language.
import { DingTalkCalDAV } from './caldav.js';
import { GoogleCalendar, googleAuth } from './google.js';
import { serviceAccountEmail } from './settings.js';

const brief = (err) => String(err?.message || err).slice(0, 240);

async function checkDingTalk(settings, f, add) {
  if (!settings.DINGTALK_USERNAME || !settings.DINGTALK_PASSWORD) return add('dingtalk', 'error', 'check.dingtalk.missing');
  try {
    const caldav = new DingTalkCalDAV({
      username: settings.DINGTALK_USERNAME, password: settings.DINGTALK_PASSWORD,
      baseUrl: settings.DINGTALK_URL || undefined, calendarPath: settings.DINGTALK_CALENDAR_PATH || undefined, fetch: f,
    });
    const who = await caldav.whoami();
    add('dingtalk', who.canWrite ? 'ok' : 'error', who.canWrite ? 'check.dingtalk.ok' : 'check.dingtalk.readonly', { calendar: who.calendar });
  } catch (err) {
    if ([401, 403, 404].includes(err.status)) add('dingtalk', 'error', 'check.dingtalk.auth');
    else add('dingtalk', 'error', 'check.dingtalk.error', { message: brief(err) });
  }
}

async function checkGoogle(settings, f, add) {
  const email = serviceAccountEmail(settings);
  const useKey = Boolean(settings.GOOGLE_SERVICE_ACCOUNT_JSON);
  if (!useKey && !settings.GOOGLE_REFRESH_TOKEN) return add('google', 'error', 'check.google.missing');
  if (useKey && !email) return add('google', 'error', 'check.google.badKey');

  const google = new GoogleCalendar({
    fetch: f,
    getToken: googleAuth({
      serviceAccount: settings.GOOGLE_SERVICE_ACCOUNT_JSON || undefined,
      clientId: settings.GOOGLE_CLIENT_ID, clientSecret: settings.GOOGLE_CLIENT_SECRET, refreshToken: settings.GOOGLE_REFRESH_TOKEN,
    }, { fetch: f }),
  });
  try {
    await google.getToken();
    add('google', 'ok', 'check.google.ok', { email: email || 'Google' });
  } catch (err) {
    return add('google', 'error', 'check.google.auth', { message: brief(err) });
  }

  const source = settings.GOOGLE_SOURCE_CALENDAR, mirror = settings.GOOGLE_MIRROR_CALENDAR;
  if (!source) add('source', 'error', 'check.source.missing');
  else {
    try {
      const cal = await google.calendarInfo(source);
      add('source', 'ok', 'check.source.ok', { name: cal.summary || source });
    } catch (err) {
      if (err.status === 404 || err.status === 403) add('source', 'error', 'check.source.notShared', { id: source, email });
      else add('source', 'error', 'check.source.error', { message: brief(err) });
    }
  }

  if (!mirror) return add('mirror', 'error', 'check.mirror.missing');
  if (mirror === source) return add('mirror', 'error', 'check.same');
  try {
    const cal = await google.calendarInfo(mirror);
    const name = cal.summary || mirror;
    if (await google.canWrite(mirror)) add('mirror', 'ok', 'check.mirror.ok', { name });
    else add('mirror', 'error', 'check.mirror.readonly', { name, email });
    if (!/@group\.calendar\.google\.com$/i.test(mirror) && !/@import\.calendar\.google\.com$/i.test(mirror)) {
      add('mirror', 'warn', 'check.mirror.looksPrimary', { id: mirror });
    }
  } catch (err) {
    if (err.status === 404 || err.status === 403) add('mirror', 'error', 'check.mirror.notShared', { id: mirror, email });
    else add('mirror', 'error', 'check.mirror.error', { message: brief(err) });
  }
}

/**
 * Check the logins and calendar access described by `settings`.
 * `parts` limits the checks to 'dingtalk' and/or 'google'. Nothing is synced. The only possible
 * write is the short-lived test entry described at GoogleCalendar.canWrite.
 */
export async function runChecks(settings, { fetch: f = globalThis.fetch, parts = ['dingtalk', 'google'] } = {}) {
  const results = [];
  const add = (part, level, key, vars = {}) => { results.push({ part, level, key, vars }); };
  if (parts.includes('dingtalk')) await checkDingTalk(settings, f, add);
  if (parts.includes('google')) await checkGoogle(settings, f, add);
  return results;
}
