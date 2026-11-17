// The part shared by every host (Cloudflare Worker, Node, Docker): running a sync pass against
// a key-value store, and the small HTTP app behind the setup page.
//
// `store` is { get(key) -> string | null, put(key, string), delete(key) }. Two keys are used:
//   settings   what was saved on the setup page, encrypted with a key derived from ADMIN_PASSWORD
// `env` is only asked for ADMIN_PASSWORD (and RUN_TOKEN on older deployments): every setting of
// the bridge comes from the page.
//   state      sync bookkeeping (ids, hashes, etags, times) plus a short status record
import { loadConfig, makeClients, missingSettings, debugOn } from './config.js';
import { runSync } from './sync.js';
import { runChecks } from './doctor.js';
import { seal, open, sameSecret, signSession, sessionUntil } from './crypto.js';
import { applyChanges, publicView, serviceAccountEmail, EDITABLE } from './settings.js';
import { page } from './ui.js';

export const VERSION = '1.2.0';

const MIN_PASSWORD = 8;
const MAX_BODY = 64 * 1024;
const KEEP_LINES = 40;
const STATUS_SAVE_MS = 10 * 60000;
const DEBUG_HOURS = 24;
const COUNTERS = ['pushed', 'replaced', 'removed', 'retried', 'mirrored', 'unmirrored'];
// The setup page signs in once and then holds a cookie that scripts cannot read. A session
// lasts twelve hours and is renewed while a page is open, so it ends by itself when unused.
const SESSION_COOKIE = 'dtsync_session';
const SESSION_MS = 12 * 3600000;

const json = (body, status = 200, headers = {}) => new Response(JSON.stringify(body), {
  status, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', ...headers },
});

/**
 * The Set-Cookie line of a session (an empty `token` ends it). HttpOnly keeps the token away
 * from scripts, SameSite=Strict keeps other sites from sending it, and it is only sent to /api.
 * It has no lifetime of its own, so the browser drops it when it closes.
 */
function sessionCookie(request, token) {
  const secure = new URL(request.url).protocol === 'https:' || request.headers.get('X-Forwarded-Proto') === 'https';
  return `${SESSION_COOKIE}=${token}; Path=/api; HttpOnly; SameSite=Strict${secure ? '; Secure' : ''}${token ? '' : '; Max-Age=0'}`;
}

export function createApp({ store, env = {}, platform = 'node', fetch: f = globalThis.fetch, now = () => Date.now(), logger = console }) {
  const adminPassword = () => (typeof env.ADMIN_PASSWORD === 'string' && env.ADMIN_PASSWORD.length >= MIN_PASSWORD ? env.ADMIN_PASSWORD : null);

  /** Saved settings. `locked` means something is saved but cannot be decrypted with the current password. */
  async function loadStored() {
    const raw = await store.get('settings');
    if (!raw) return { stored: {}, locked: false };
    const secret = adminPassword();
    if (!secret) return { stored: {}, locked: true };
    try {
      return { stored: await open(raw, secret), locked: false };
    } catch {
      return { stored: {}, locked: true };
    }
  }

  const saveStored = async (stored) => store.put('settings', await seal(stored, adminPassword()));

  /**
   * One sync pass. Returns { skipped, missing } when setup is incomplete, otherwise
   * { stats, lines, error }. `lines` is what was logged: without event text unless debug mode is on.
   */
  async function pass({ dryRun = false } = {}) {
    const { stored } = await loadStored();
    const missing = missingSettings(stored);
    if (missing.length) return { skipped: true, missing };

    const at = now();
    const cfg = loadConfig(stored, { now: at, platform, dryRun });
    const raw = (await store.get('state')) || '{}';
    const state = JSON.parse(raw);
    const status = state.status || {};
    delete state.status;
    state.token ??= {};
    const coreBefore = JSON.stringify(state);

    const safeLines = [], shown = [];
    const log = (safe, detailed) => {
      if (safe) safeLines.push(safe);
      const line = cfg.debug ? detailed || safe : safe;
      if (!line) return;
      shown.push(line);
      logger.log(line);
    };
    const { caldav, google } = makeClients(cfg, { fetch: f, tokenCache: state.token, debugLog: cfg.debug ? (m) => log(null, m) : undefined });

    let stats = null, error = null;
    try {
      stats = await runSync({ cfg, caldav, google, state, now: at, log });
    } catch (err) {
      error = err;
      logger.error(`sync failed: ${err.message}`);
    }

    if (!cfg.dryRun) {
      // The status record feeds the setup page. It is saved together with the state, and on its
      // own only when a problem appears or clears, or every ten minutes: KV allows few writes a day.
      const problem = error ? error.message : stats.errors ? safeLines.find((l) => l.startsWith('ERROR')) || 'some changes failed' : null;
      const before = status.err ? status.err.msg : null;
      if (problem) status.err = { msg: String(problem).slice(0, 500), at, since: before === problem ? status.err.since : at };
      else { delete status.err; status.okAt = at; }
      if (stats && COUNTERS.some((k) => stats[k])) status.last = { at, ...Object.fromEntries(COUNTERS.filter((k) => stats[k]).map((k) => [k, stats[k]])) };
      status.lines = [...(status.lines || []), ...safeLines.map((text) => ({ at, text: text.slice(0, 300) }))].slice(-KEEP_LINES);

      const coreChanged = JSON.stringify(state) !== coreBefore;
      const flipped = before !== (problem || null);
      const due = safeLines.length > 0 && at - (status.savedAt || 0) >= STATUS_SAVE_MS;
      if (coreChanged || flipped || due) {
        status.savedAt = at;
        await store.put('state', JSON.stringify({ ...state, status }));
      }
    }
    return { stats, lines: shown, error: error ? error.message : null, dryRun: cfg.dryRun };
  }

  async function view() {
    const { stored, locked } = await loadStored();
    const state = JSON.parse((await store.get('state')) || '{}');
    const status = state.status || {};
    const at = now();
    return {
      version: VERSION, platform, now: at, locked,
      missing: missingSettings(stored),
      fields: publicView(stored),
      serviceAccountEmail: serviceAccountEmail(stored),
      debug: { on: debugOn(stored, at), until: debugOn(stored, at) ? Number(stored.DEBUG_UNTIL) : 0 },
      status: {
        fullAt: state.fullAt || 0, okAt: status.okAt || 0, err: status.err || null, last: status.last || null,
        lines: status.lines || [], bookings: Object.keys(state.pushed || {}).length,
        // Busy blocks in the Google calendar after the last full pass; null before the first one.
        busy: typeof state.busy === 'number' ? state.busy : null,
        // Not everything has been copied yet: older DingTalk events are still being read, or the
        // last pass stopped at its write limit (or held back a large removal) and continues.
        catchingUp: Boolean(state.histPending || state.recheck),
      },
    };
  }

  async function readBody(request) {
    const text = await request.text();
    if (text.length > MAX_BODY) throw Object.assign(new Error('too large'), { http: 413 });
    if (!text) return {};
    try {
      const body = JSON.parse(text);
      return body && typeof body === 'object' ? body : {};
    } catch {
      throw Object.assign(new Error('bad json'), { http: 400 });
    }
  }

  /**
   * Until when the session cookie of this request is valid; 0 when there is none that counts.
   * A cookie travels by itself, so it only counts on a request that this page's own script made:
   * one that carries the X-Dtsync header (another site cannot add a header without asking
   * first, and that question is never answered) and that the browser does not mark as coming
   * from elsewhere.
   */
  async function session(request, secret) {
    if (request.headers.get('X-Dtsync') !== '1') return 0;
    const from = request.headers.get('Sec-Fetch-Site');
    if (from && from !== 'same-origin') return 0;
    const token = new RegExp(`(?:^|;\\s*)${SESSION_COOKIE}=([^;]+)`).exec(request.headers.get('Cookie') || '')?.[1];
    const until = token ? await sessionUntil(token, secret) : 0;
    return until > now() ? until : 0;
  }

  const refused = async () => {
    await new Promise((r) => setTimeout(r, 400)); // slows down guessing
    return json({ error: 'unauthorized' }, 401);
  };

  async function api(request, pathname) {
    const secret = adminPassword();
    const route = `${request.method} ${pathname}`;
    // Needs no password: lets the page tell "sign in" from "no password set yet" from "still signed in".
    if (route === 'GET /api/ping') return json({ ok: true, password: Boolean(secret), signedIn: Boolean(secret && await session(request, secret)) });
    if (!secret) return json({ error: 'no-admin-password' }, 503);

    if (route === 'POST /api/login') {
      const { password } = await readBody(request);
      if (typeof password !== 'string' || !(await sameSecret(password, secret))) return refused();
      return json(await view(), 200, { 'Set-Cookie': sessionCookie(request, await signSession(secret, now() + SESSION_MS)) });
    }
    // A session cannot be withdrawn on the server (nothing is stored for it): signing out
    // makes the browser forget it.
    if (route === 'POST /api/logout') return json({ ok: true }, 200, { 'Set-Cookie': sessionCookie(request, '') });

    // Scripts and tests may send the password itself; the page uses its session.
    const sent = (request.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '');
    const until = sent ? 0 : await session(request, secret);
    if (sent ? !(await sameSecret(sent, secret)) : !until) return refused();

    const response = await answer(request, route);
    // A page that stays open keeps its session: past half its life it gets a new one.
    if (until && until - now() < SESSION_MS / 2) response.headers.append('Set-Cookie', sessionCookie(request, await signSession(secret, now() + SESSION_MS)));
    return response;
  }

  /** The calls behind the page, once it is known who is asking. */
  async function answer(request, route) {
    if (route === 'GET /api/state') return json(await view());
    if (request.method !== 'POST') return json({ error: 'not-found' }, 404);
    const body = await readBody(request);

    if (route === 'POST /api/settings') {
      const { stored } = await loadStored(); // a locked store starts again from empty
      const res = applyChanges(stored, body.values);
      if (res.errors) return json({ error: 'invalid', fields: res.errors }, 400);
      await saveStored(res.next);
      return json(await view());
    }

    if (route === 'POST /api/test') {
      // Unsaved values typed into the page can be tested before they are saved.
      const { stored } = await loadStored();
      const res = applyChanges(stored, body.values || {});
      if (res.errors) return json({ error: 'invalid', fields: res.errors }, 400);
      const parts = Array.isArray(body.parts) ? body.parts.filter((p) => p === 'dingtalk' || p === 'google') : undefined;
      return json({ results: await runChecks(res.next, { fetch: f, ...(parts?.length ? { parts } : {}) }) });
    }

    if (route === 'POST /api/run') return json(await pass({ dryRun: Boolean(body.dryRun) }));

    if (route === 'POST /api/debug') {
      const { stored } = await loadStored();
      if (body.on) stored.DEBUG_UNTIL = String(now() + DEBUG_HOURS * 3600000);
      else delete stored.DEBUG_UNTIL;
      await saveStored(stored);
      return json(await view());
    }

    if (route === 'POST /api/reset') {
      await store.delete('settings');
      await store.delete('state');
      return json(await view());
    }
    return json({ error: 'not-found' }, 404);
  }

  /** Request -> Response. */
  async function handle(request) {
    const { pathname } = new URL(request.url);
    try {
      if (request.method === 'GET' && (pathname === '/' || pathname === '/index.html')) {
        const nonce = crypto.randomUUID().replace(/-/g, '');
        return new Response(page({ nonce, platform, version: VERSION }), {
          headers: {
            'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff',
            'Referrer-Policy': 'no-referrer', 'X-Frame-Options': 'DENY',
            'Content-Security-Policy': `default-src 'none'; script-src 'nonce-${nonce}'; style-src 'nonce-${nonce}'; connect-src 'self'; img-src data:; base-uri 'none'; form-action 'none'; frame-ancestors 'none'`,
          },
        });
      }
      if (pathname === '/healthz') return new Response('ok');
      // Older deployments: POST /run with "Authorization: Bearer <RUN_TOKEN>" triggers a pass.
      if (request.method === 'POST' && pathname === '/run' && env.RUN_TOKEN && await sameSecret(request.headers.get('Authorization') || '', `Bearer ${env.RUN_TOKEN}`)) {
        return json(await pass());
      }
      if (pathname.startsWith('/api/')) return await api(request, pathname);
      return new Response('Not found', { status: 404 });
    } catch (err) {
      if (err.http) return json({ error: err.message }, err.http);
      logger.error(`request failed: ${err.message}`);
      return json({ error: 'server-error', message: String(err.message).slice(0, 300) }, 500);
    }
  }

  return { handle, pass, view, settings: loadStored, editable: Object.keys(EDITABLE) };
}
