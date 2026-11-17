// Everything the page knows and everything it can do: one small store outside React, so the
// actions always read the current state (several of them wait for the server in between).
import { useCallback, useSyncExternalStore } from 'react';
import { BOOT, mem, type Lang } from '../lib/boot';
import { counts, pickLang, translate, type Translate, type Vars } from '../lib/i18n';

export type Field = { set: boolean; value?: string };
export type LogLine = { at: number; text: string };
export type ServerState = {
  version: string; platform: string; now: number; locked: boolean;
  missing: string[];
  fields: Record<string, Field>;
  serviceAccountEmail: string;
  debug: { on: boolean; until: number };
  status: {
    fullAt: number; okAt: number;
    err: { msg: string; at: number; since?: number } | null;
    last: ({ at: number } & Record<string, number>) | null;
    lines: LogLine[]; bookings: number; busy: number | null; catchingUp: boolean;
  };
};

export type Gate = 'loading' | 'login' | 'nopass' | 'in';
export type StepId = 's1' | 's2' | 's3';
export type FormStep = 's1' | 's2';
export type Part = 'dingtalk' | 'google';
/** One line under a "Save and test" button. `key` is a message, so it follows the language. */
export type Result = { level: 'ok' | 'warn' | 'error' | 'info'; key?: string; vars?: Vars; text?: string; part?: string };
export type Note = { text: string; tone: 'good' | 'bad' } | null;
/** What is wrong with a field. `quiet` marks the field without repeating the text under it. */
export type FieldErr = { key: string; vars?: Vars; quiet?: boolean };
/** What "Sync now" or "Preview changes" reported. */
export type Run = { level: Result['level']; text: string; lines: string[]; dry: boolean; failed: boolean } | null;
export type PushMode = 'calendly' | 'all' | 'custom';

export type Forms = {
  DINGTALK_USERNAME: string; DINGTALK_PASSWORD: string;
  GOOGLE_MIRROR_CALENDAR: string; GOOGLE_SOURCE_CALENDAR: string;
  DTSYNC_LANG: Lang; hide: boolean; push: PushMode; pattern: string;
  PUSH_PREFIX: string; HORIZON_DAYS: string; DEFAULT_TZ: string;
  LOOKBACK_DAYS: string; FULL_SYNC_MINUTES: string; MAX_WRITES: string;
};

export type State = {
  lang: Lang;
  gate: Gate;
  S: ServerState | null;
  tested: Partial<Record<Part, 'ok' | 'err'>>;
  /** Saved without testing in this visit: not known to work. */
  untested: Partial<Record<Part, boolean>>;
  /** Fields typed into since the last test: what the test said about them is out of date. */
  touched: Record<string, boolean>;
  /** The "cannot test right now?" corner under a step's button. */
  skipOpen: Partial<Record<FormStep, boolean>>;
  /** Finished a moment ago: offer the way to the next step. */
  fresh: Partial<Record<StepId, boolean>>;
  /** Nothing typed since the last save: "Save and test" steps back for "Continue". */
  savedForm: Partial<Record<FormStep, boolean>>;
  open: StepId[];
  /** A key file that was chosen but not saved yet. */
  key: { json: string; email: string; name: string } | null;
  keyInput: number;
  howOpen: boolean;
  c1: boolean; c2: boolean;
  forms: Forms;
  /** Field name -> what is wrong with it. */
  errors: Record<string, FieldErr>;
  /** Field name -> how often it was rejected; a change makes the field shake once. */
  shakes: Record<string, number>;
  results: Record<FormStep, Result[]>;
  busy: Partial<Record<'signin' | 's1' | 's2' | 's3' | 'run' | 'dry' | 'opt' | 'dbg' | 'reset', boolean>>;
  gateError: Result | null;
  working: boolean;
  run: Run; runLinesOpen: boolean;
  optNote: Note; resetNote: Note; s3Note: Note;
  optsOpen: boolean;
};

const STEPS: StepId[] = ['s1', 's2', 's3'];
const PART: Record<FormStep, Part> = { s1: 'dingtalk', s2: 'google' };
const KEY = 'GOOGLE_SERVICE_ACCOUNT_JSON';
const CALENDLY = 'CALENDLY_CHECKED';
const STEP_FIELDS: Record<FormStep, string[]> = { s1: ['DINGTALK_USERNAME', 'DINGTALK_PASSWORD'], s2: [KEY, 'GOOGLE_MIRROR_CALENDAR', 'GOOGLE_SOURCE_CALENDAR'] };
/** The parts of step 2 in the order they stand on the page: [what the test calls it, its field, where it is, what to focus]. */
const GOOGLE_PARTS = [
  ['google', KEY, 'part-a', 'keyfile'],
  ['mirror', 'GOOGLE_MIRROR_CALENDAR', 'part-b', 'f-GOOGLE_MIRROR_CALENDAR'],
  ['source', 'GOOGLE_SOURCE_CALENDAR', 'part-c', 'f-GOOGLE_SOURCE_CALENDAR'],
] as const;
const INPUT_OF: Record<string, string> = { PUSH_MATCH: 'pattern', [KEY]: 'keyfile' };
const HAS_INPUT = new Set(['DINGTALK_USERNAME', 'DINGTALK_PASSWORD', KEY, 'GOOGLE_MIRROR_CALENDAR', 'GOOGLE_SOURCE_CALENDAR', 'PUSH_MATCH', 'PUSH_PREFIX', 'HORIZON_DAYS', 'DEFAULT_TZ', 'LOOKBACK_DAYS', 'FULL_SYNC_MINUTES', 'MAX_WRITES']);

const emptyForms: Forms = {
  DINGTALK_USERNAME: '', DINGTALK_PASSWORD: '', GOOGLE_MIRROR_CALENDAR: '', GOOGLE_SOURCE_CALENDAR: '',
  DTSYNC_LANG: 'en', hide: false, push: 'calendly', pattern: '', PUSH_PREFIX: '', HORIZON_DAYS: '', DEFAULT_TZ: '',
  LOOKBACK_DAYS: '', FULL_SYNC_MINUTES: '', MAX_WRITES: '',
};

/** The language chosen here before, else the first language of the browser that we have. */
function firstLang(): Lang {
  const saved = mem.get('localStorage', 'dtsync.lang');
  return saved && BOOT.locales[saved] ? saved : pickLang(navigator.languages?.length ? navigator.languages : [navigator.language || '']);
}

/** The time zone this browser is in, or '' when it does not say. */
export const browserZone = (() => {
  try { return Intl.DateTimeFormat().resolvedOptions().timeZone || ''; } catch { return ''; }
})();

let autoOpen = true; // open the first unfinished step when the state first arrives

let state: State = {
  lang: firstLang(), gate: 'loading', S: null, tested: {}, untested: {}, touched: {}, skipOpen: {}, fresh: {}, savedForm: {}, open: [], key: null, keyInput: 0, howOpen: false,
  // Versions before 1.2 kept these two ticks in the browser. They start ticked there, so "Complete setup" is one press away.
  c1: mem.get('localStorage', 'dtsync.c1') === '1', c2: mem.get('localStorage', 'dtsync.c2') === '1',
  forms: emptyForms, errors: {}, shakes: {}, results: { s1: [], s2: [] }, busy: {}, gateError: null,
  working: false, run: null, runLinesOpen: false, optNote: null, resetNote: null, s3Note: null, optsOpen: false,
};

const listeners = new Set<() => void>();
const get = () => state;
function set(patch: Partial<State> | ((s: State) => Partial<State>)) {
  state = { ...state, ...(typeof patch === 'function' ? patch(state) : patch) };
  listeners.forEach((l) => l());
}
const subscribe = (l: () => void) => { listeners.add(l); return () => { listeners.delete(l); }; };

export const useApp = () => useSyncExternalStore(subscribe, get);
export function useT(): Translate {
  const { lang } = useApp();
  return useCallback((key: string, vars?: Vars) => translate(lang, key, vars), [lang]);
}

// ---- What follows from the state -------------------------------------------------------------

export const fieldOf = (s: State, k: string): Field => s.S?.fields[k] || { set: false, value: '' };
export const missing = (s: State, k: string) => Boolean(s.S) && (s.S!.missing || []).includes(k);

export function progress(s: State) {
  const p = { s1: false, s2: false, s3: false, calendly: false, ready: false, n: 0 };
  if (s.gate !== 'in' || !s.S) return p;
  // Step 3 is optional, and it is what the owner said: Calendly was set up ('true'), or is not
  // used ('skipped'). Either settles the step. It is saved on the server, so every browser agrees.
  p.calendly = fieldOf(s, CALENDLY).value === 'true';
  p.s3 = p.calendly || fieldOf(s, CALENDLY).value === 'skipped';
  p.s1 = !missing(s, 'DINGTALK_USERNAME') && !missing(s, 'DINGTALK_PASSWORD');
  p.s2 = !missing(s, KEY) && !missing(s, 'GOOGLE_SOURCE_CALENDAR') && !missing(s, 'GOOGLE_MIRROR_CALENDAR');
  p.ready = !(s.S.missing || []).length;
  p.n = Number(p.s1) + Number(p.s2) + Number(p.s3);
  return p;
}

/**
 * A saved step that is known to work: its test passed in this visit, or the bridge has synced
 * with it since. "Saved without testing" is neither.
 */
export function verified(s: State, id: FormStep): boolean {
  const part = PART[id];
  if (!s.S || !progress(s)[id] || s.tested[part] === 'err' || s.untested[part]) return false;
  return s.tested[part] === 'ok' || (!(s.S.missing || []).length && s.S.status.okAt > 0 && !s.S.status.err);
}

/** What the last test said about one part of step 2, unless its field was changed since. */
export function partState(s: State, part: 'google' | 'mirror' | 'source'): 'ok' | 'err' | 'set' | '' {
  const field = GOOGLE_PARTS.find((g) => g[0] === part)![1];
  const filled = field === KEY ? Boolean(s.key) || (Boolean(s.S) && !missing(s, KEY)) : Boolean(s.forms[field as 'GOOGLE_MIRROR_CALENDAR'].trim());
  if (!s.touched[field]) {
    const mine = s.results.s2.filter((r) => r.part === part);
    if (mine.some((r) => r.level === 'error') || s.errors[field]) return 'err';
    if (mine.some((r) => r.level === 'ok') || (filled && verified(s, 's2'))) return 'ok';
  }
  return filled ? 'set' : '';
}

// ---- Talking to the server -------------------------------------------------------------------

type Reply = { ok: boolean; status: number; data: any };

async function api(method: string, path: string, body?: unknown): Promise<Reply> {
  let res: Response;
  try {
    res = await fetch(path, {
      method,
      // Signed in means holding the session cookie, which scripts cannot read. The server only
      // accepts it together with this header, which another site cannot send along.
      credentials: 'same-origin', headers: { 'X-Dtsync': '1', 'Content-Type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch {
    return { ok: false, status: 0, data: { error: 'network' } };
  }
  const data = await res.json().catch(() => ({}));
  if (res.status === 401) set({ gate: 'login' });
  if (res.status === 503 && data.error === 'no-admin-password') set({ gate: 'nopass' });
  return { ok: res.ok, status: res.status, data };
}

const problem = (r: Reply): Result => (r.status === 0
  ? { level: 'error', key: 'err.network' }
  : { level: 'error', key: 'err.server', vars: { message: r.data.message || r.data.error || r.status } });
const say = (r: Result) => (r.key ? translate(state.lang, r.key, r.vars) : r.text || '');

/** The saved values, as the inputs show them. */
function formsFrom(s: State): Forms {
  const value = (k: string) => fieldOf(s, k).value || '';
  const pm = value('PUSH_MATCH');
  const push: PushMode = pm === '' || pm === 'calendly\\.com' ? 'calendly' : pm === '.*' ? 'all' : 'custom';
  return {
    DINGTALK_USERNAME: value('DINGTALK_USERNAME'), DINGTALK_PASSWORD: '',
    GOOGLE_MIRROR_CALENDAR: value('GOOGLE_MIRROR_CALENDAR'), GOOGLE_SOURCE_CALENDAR: value('GOOGLE_SOURCE_CALENDAR'),
    DTSYNC_LANG: BOOT.locales[value('DTSYNC_LANG')] ? value('DTSYNC_LANG') : 'en', hide: value('MIRROR_TITLES') === 'false',
    push, pattern: push === 'custom' ? pm : '',
    PUSH_PREFIX: value('PUSH_PREFIX'), HORIZON_DAYS: value('HORIZON_DAYS'), DEFAULT_TZ: value('DEFAULT_TZ'),
    LOOKBACK_DAYS: value('LOOKBACK_DAYS'), FULL_SYNC_MINUTES: value('FULL_SYNC_MINUTES'), MAX_WRITES: value('MAX_WRITES'),
  };
}

/**
 * Takes over what the server sent. `fill` also puts the saved values into the inputs: only when
 * they changed on the server (sign-in, save, reset), because the minute-by-minute refresh must
 * not wipe what someone is typing.
 */
function setState(data: ServerState, fill: boolean) {
  set((s) => {
    const next: State = { ...s, S: data, gate: 'in' };
    const patch: Partial<State> = { S: data, gate: 'in' };
    if (fill) Object.assign(patch, { forms: formsFrom(next), howOpen: missing(next, KEY), touched: {} });
    if (autoOpen) {
      const p = progress(next);
      const first = !p.s1 ? 's1' : !p.s2 ? 's2' : !p.s3 ? 's3' : null;
      patch.open = first ? [first] : [];
      autoOpen = false;
    }
    return patch;
  });
}

async function load(fill: boolean) {
  const r = await api('GET', '/api/state');
  if (r.ok) setState(r.data, fill);
  else if (r.status !== 401 && r.status !== 503) set({ gate: 'login' });
  return r;
}

/**
 * No time zone saved: the one this browser is in becomes the bridge's, so the default is where
 * its owner is. A locked store is left alone, because saving would replace what is in it.
 */
async function adoptTimeZone() {
  if (!browserZone || state.gate !== 'in' || !state.S || state.S.locked || fieldOf(state, 'DEFAULT_TZ').set) return;
  const r = await api('POST', '/api/settings', { values: { DEFAULT_TZ: browserZone } });
  if (!r.ok) return;
  setState(r.data, false);
  if (!state.touched.DEFAULT_TZ) set((s) => ({ forms: { ...s.forms, DEFAULT_TZ: browserZone } }));
}

const later = (fn: () => void) => requestAnimationFrame(() => requestAnimationFrame(fn));
const focus = (id: string) => later(() => document.getElementById(id)?.focus({ preventScroll: true }));
function reveal(id: string) {
  const smooth = !window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  later(() => document.getElementById(id)?.scrollIntoView({ block: 'start', behavior: smooth ? 'smooth' : 'auto' }));
}

/**
 * Shows what the server rejected next to its field. Returns result lines for anything that has
 * no field on the page.
 */
function fieldErrors(fields: Record<string, string> | undefined): Result[] {
  const errors: Record<string, FieldErr> = {}, shakes = { ...state.shakes }, other: Result[] = [];
  let first = '';
  for (const [k, code] of Object.entries(fields || {})) {
    if (!HAS_INPUT.has(k)) { other.push({ level: 'error', key: `err.${code}` }); continue; }
    errors[k] = { key: `err.${code}` };
    shakes[k] = (shakes[k] || 0) + 1;
    first ||= INPUT_OF[k] || `f-${k}`;
  }
  set({ errors, shakes });
  if (first) later(() => { const el = document.getElementById(first) as HTMLInputElement | null; if (el && !el.disabled && el.offsetParent !== null) el.focus(); });
  return other;
}

/**
 * A failed test, shown where it can be fixed: the fields it blames turn red, and in the long
 * Google step the page moves to the first part that failed. A service that could not be reached
 * is nobody's typo, so no field is blamed and the way to save without the test opens instead.
 */
function showFailures(id: FormStep, results: Result[]) {
  const errors = { ...state.errors }, shakes = { ...state.shakes };
  let unreachable = false;
  const blame = (k: string, e: FieldErr) => { if (!errors[k]) { errors[k] = e; shakes[k] = (shakes[k] || 0) + 1; } };
  for (const r of results) {
    if (r.level !== 'error' || !r.key) continue;
    if (r.key.endsWith('.error')) { unreachable = true; continue; }
    if (r.part === 'dingtalk') {
      if (r.key === 'check.dingtalk.readonly') continue;
      const empty = STEP_FIELDS.s1.filter((k) => !state.forms[k as 'DINGTALK_USERNAME'].trim() && !fieldOf(state, k).set);
      // The message stands right under these two fields, so they are only marked.
      for (const k of r.key === 'check.dingtalk.missing' && empty.length ? empty : STEP_FIELDS.s1) blame(k, { key: r.key, vars: r.vars, quiet: true });
    } else {
      const field = GOOGLE_PARTS.find((g) => g[0] === r.part)?.[1];
      if (field) blame(field, { key: r.key, vars: r.vars });
    }
  }
  set((s) => ({ errors, shakes, ...(unreachable ? { skipOpen: { ...s.skipOpen, [id]: true } } : {}) }));
  if (id !== 's2') return;
  const bad = GOOGLE_PARTS.find(([part]) => results.some((r) => r.part === part && r.level === 'error'));
  if (bad) { reveal(bad[2]); focus(bad[3]); }
}

const without = <T,>(obj: Record<string, T>, keys: string[]) => Object.fromEntries(Object.entries(obj).filter(([k]) => !keys.includes(k)));

function stepValues(part: Part): Record<string, string | null> {
  const { forms, key } = state;
  if (part === 'dingtalk') return { DINGTALK_USERNAME: forms.DINGTALK_USERNAME, DINGTALK_PASSWORD: forms.DINGTALK_PASSWORD };
  const v: Record<string, string | null> = { GOOGLE_SOURCE_CALENDAR: forms.GOOGLE_SOURCE_CALENDAR, GOOGLE_MIRROR_CALENDAR: forms.GOOGLE_MIRROR_CALENDAR };
  if (key) v[KEY] = key.json;
  return v;
}

// ---- What the page can do --------------------------------------------------------------------

export const actions = {
  setLang(lang: Lang) { mem.set('localStorage', 'dtsync.lang', lang); set({ lang }); },

  async signIn(password: string) {
    autoOpen = true;
    set((s) => ({ gateError: null, busy: { ...s.busy, signin: true } }));
    const r = await api('POST', '/api/login', { password });
    set((s) => ({ busy: { ...s.busy, signin: false } }));
    if (r.ok) { setState(r.data, true); adoptTimeZone(); return true; }
    if (r.status === 503) return false;
    set((s) => ({ gateError: r.status === 401 ? { level: 'error', key: 'gate.wrong' } : problem(r), shakes: { ...s.shakes, pw: (s.shakes.pw || 0) + 1 } }));
    focus('pw');
    return false;
  },

  /** Ends the session in this browser: every tab of the page is signed out with it. */
  async signOut() {
    autoOpen = true;
    set({ S: null, tested: {}, untested: {}, fresh: {}, open: [], gate: 'login', gateError: null, run: null });
    await api('POST', '/api/logout');
  },

  setOpen(open: string[]) { set({ open: STEPS.filter((id) => open.includes(id)) }); },

  /** "Continue to step 2": close this one, open the next and bring it into view. */
  next(to: 's2' | 's3') {
    const from: StepId = to === 's2' ? 's1' : 's2';
    set((s) => ({ open: [...s.open.filter((id) => id !== from && id !== to), to], fresh: { ...s.fresh, [from]: false } }));
    reveal(to); focus(`${to}-btn`);
  },
  /** "Complete setup": step 3 counts once both lines are ticked and this is pressed. */
  /** Settles step 3: both lines ticked, or `skip` for a setup without Calendly. */
  async finish(skip = false) {
    if ((!skip && !(state.c1 && state.c2)) || state.busy.s3) return;
    set((s) => ({ busy: { ...s.busy, s3: true }, s3Note: null }));
    const r = await api('POST', '/api/settings', { values: { [CALENDLY]: skip ? 'skipped' : 'true' } });
    set((s) => ({ busy: { ...s.busy, s3: false } }));
    if (!r.ok) { if (r.status !== 401) set({ s3Note: { text: say(problem(r)), tone: 'bad' } }); return; }
    mem.set('localStorage', 'dtsync.c1', null); mem.set('localStorage', 'dtsync.c2', null);
    setState(r.data, false);
    set((s) => ({ open: s.open.filter((id) => id !== 's3') }));
    reveal('hero'); focus('hero-h');
  },

  setForm<K extends keyof Forms>(name: K, value: Forms[K]) {
    set((s) => {
      const patch: Partial<State> = { forms: { ...s.forms, [name]: value }, touched: { ...s.touched, [name]: true } };
      const step: FormStep | null = name.startsWith('DINGTALK_') ? 's1' : name.startsWith('GOOGLE_') ? 's2' : null;
      if (step) Object.assign(patch, { fresh: { ...s.fresh, [step]: false }, savedForm: { ...s.savedForm, [step]: false } });
      const field = name === 'pattern' || name === 'push' ? 'PUSH_MATCH' : name;
      if (s.errors[field]) { const { [field]: _gone, ...rest } = s.errors; patch.errors = rest; }
      return patch;
    });
  },

  /** A line of step 3. Taking a tick away from a confirmed step makes it "to do" again. */
  async setCheck(id: 'c1' | 'c2', on: boolean) {
    const wasDone = progress(state).calendly;
    set({ ...(wasDone ? { c1: true, c2: true } : {}), [id]: on, s3Note: null });
    if (!wasDone || on) return;
    set((s) => ({ busy: { ...s.busy, s3: true } }));
    const r = await api('POST', '/api/settings', { values: { [CALENDLY]: null } });
    set((s) => ({ busy: { ...s.busy, s3: false } }));
    if (r.ok) setState(r.data, false);
    else if (r.status !== 401) set({ [id]: true, s3Note: { text: say(problem(r)), tone: 'bad' } });
  },

  setHowOpen(howOpen: boolean) { set({ howOpen }); },
  setOptsOpen(optsOpen: boolean) { set({ optsOpen }); },
  setRunLinesOpen(runLinesOpen: boolean) { set({ runLinesOpen }); },
  setSkipOpen(id: FormStep, on: boolean) { set((s) => ({ skipOpen: { ...s.skipOpen, [id]: on } })); },

  /** The pattern is checked when the field is left, not on every key: "(a|" is only half typed. */
  checkPattern() {
    const { push, pattern } = state.forms;
    if (push !== 'custom' || !pattern) return;
    try { new RegExp(pattern, 'i'); } catch { set((s) => ({ errors: { ...s.errors, PUSH_MATCH: { key: 'err.badPattern' } } })); }
  },

  async readKey(file: File | undefined) {
    set((s) => {
      const { [KEY]: _gone, ...errors } = s.errors;
      return { key: null, errors, touched: { ...s.touched, [KEY]: true }, fresh: { ...s.fresh, s2: false }, savedForm: { ...s.savedForm, s2: false } };
    });
    if (!file) return;
    try {
      const key = JSON.parse(await file.text());
      if (!key.client_email || !key.private_key) throw new Error('not a key');
      set({ key: { json: JSON.stringify(key), email: key.client_email, name: file.name }, howOpen: false });
    } catch {
      set((s) => ({ errors: { ...s.errors, [KEY]: { key: 'err.file' } }, shakes: { ...s.shakes, [KEY]: (s.shakes[KEY] || 0) + 1 } }));
    }
  },

  /** Step 1 and 2: test what was typed (optional), then save it. */
  async saveStep(id: FormStep, withTest: boolean) {
    const part = PART[id];
    if (withTest && part === 'google' && !state.key && missing(state, KEY)) {
      set((s) => ({ errors: { ...s.errors, [KEY]: { key: 'check.google.missing' } }, shakes: { ...s.shakes, [KEY]: (s.shakes[KEY] || 0) + 1 } }));
      reveal('part-a'); focus('keyfile');
      return;
    }
    const values = stepValues(part);
    const show = (results: Result[]) => set((s) => ({ results: { ...s.results, [id]: results } }));
    set((s) => ({
      busy: { ...s.busy, [id]: true }, results: { ...s.results, [id]: [] }, fresh: { ...s.fresh, [id]: false }, savedForm: { ...s.savedForm, [id]: false },
      errors: without(s.errors, STEP_FIELDS[id]), touched: without(s.touched, STEP_FIELDS[id]),
    }));
    try {
      let results: Result[] = [];
      if (withTest) {
        const r = await api('POST', '/api/test', { values, parts: [part] });
        if (!r.ok) {
          if (r.data.error === 'invalid') show(fieldErrors(r.data.fields));
          else if (r.status !== 401) { show([problem(r)]); actions.setSkipOpen(id, true); }
          return;
        }
        results = r.data.results;
        const failed = results.some((x) => x.level === 'error');
        set((s) => ({ tested: { ...s.tested, [part]: failed ? 'err' : 'ok' }, untested: { ...s.untested, [part]: false } }));
        show(results);
        if (failed) { showFailures(id, results); return; }
      }
      const saved = await api('POST', '/api/settings', { values });
      if (!saved.ok) {
        if (saved.data.error === 'invalid') show([...results, ...fieldErrors(saved.data.fields)]);
        else if (saved.status !== 401) show([...results, problem(saved)]);
        return;
      }
      set((s) => {
        const tested = { ...s.tested };
        if (!withTest) delete tested[part];
        return {
          errors: {}, tested, untested: { ...s.untested, [part]: !withTest }, fresh: { ...s.fresh, [id]: true }, savedForm: { ...s.savedForm, [id]: true },
          ...(part === 'google' ? { key: null, keyInput: s.keyInput + 1 } : {}),
        };
      });
      setState(saved.data, true);
      adoptTimeZone(); // after "Delete saved data" the first save brings the time zone back
      show(withTest ? [...results, { level: 'ok', key: 'saved' }] : [{ level: 'warn', key: 'saved.untested' }]);
      // Enter in a field far up the step saves too: bring the way forward into view.
      if (progress(state)[id]) { focus(`${id}-next`); later(() => document.getElementById(`${id}-next`)?.scrollIntoView({ block: 'nearest' })); }
    } finally {
      set((s) => ({ busy: { ...s.busy, [id]: false } }));
    }
  },

  /** "Sync now" and "Preview changes". */
  async runPass(dryRun: boolean) {
    const which = dryRun ? 'dry' : 'run';
    const T: Translate = (key, vars) => translate(state.lang, key, vars);
    set((s) => ({ busy: { ...s.busy, [which]: true }, working: true, run: null }));
    const r = await api('POST', '/api/run', { dryRun });
    set((s) => ({ busy: { ...s.busy, [which]: false }, working: false }));
    const report = (level: Result['level'], text: string, d: any = {}) => set({
      run: { level, text, lines: d.lines || [], dry: Boolean(d.dryRun), failed: level === 'error' }, runLinesOpen: level === 'error',
    });
    if (!r.ok) { if (r.status !== 401) report('error', say(problem(r))); return; }
    const d = r.data;
    if (d.skipped) report('error', T('run.notready'));
    else if (d.error) report('error', T('run.failed', { message: d.error }), d);
    else {
      const what = counts(state.lang, d.stats);
      // A preview changes nothing and a batch is not the end: neither may look like "all done".
      if (d.dryRun) report('info', what ? T('run.preview', { what }) : T('run.preview.nothing'), d);
      else if (d.stats.errors) report('error', `${what ? `${T('run.done', { what })} ` : ''}${T('run.someFailed')}`, d);
      else if (d.stats.partial && what) report('warn', T('run.partial', { what }), d);
      else report('ok', what ? T('run.done', { what }) : T('run.nothing'), d);
    }
    await load(false);
  },

  async saveOptions() {
    const { forms } = state;
    const values = {
      DTSYNC_LANG: forms.DTSYNC_LANG,
      MIRROR_TITLES: forms.hide ? 'false' : null,
      PUSH_MATCH: forms.push === 'all' ? '.*' : forms.push === 'custom' ? forms.pattern : null,
      PUSH_PREFIX: forms.PUSH_PREFIX,
      HORIZON_DAYS: forms.HORIZON_DAYS,
      DEFAULT_TZ: forms.DEFAULT_TZ.trim() || browserZone, // emptied: back to the default
      LOOKBACK_DAYS: forms.LOOKBACK_DAYS, FULL_SYNC_MINUTES: forms.FULL_SYNC_MINUTES, MAX_WRITES: forms.MAX_WRITES,
    };
    set((s) => ({ busy: { ...s.busy, opt: true }, optNote: null }));
    const r = await api('POST', '/api/settings', { values });
    set((s) => ({ busy: { ...s.busy, opt: false } }));
    if (r.ok) { set({ errors: {} }); setState(r.data, true); set({ optNote: { text: translate(state.lang, 'saved'), tone: 'good' } }); }
    else if (r.data.error === 'invalid') { const rest = fieldErrors(r.data.fields); set({ optNote: rest.length ? { text: say(rest[0]), tone: 'bad' } : null }); }
    else if (r.status !== 401) set({ optNote: { text: say(problem(r)), tone: 'bad' } });
  },

  async toggleDebug() {
    const on = !state.S?.debug.on;
    set((s) => ({ busy: { ...s.busy, dbg: true } }));
    const r = await api('POST', '/api/debug', { on });
    set((s) => ({ busy: { ...s.busy, dbg: false } }));
    if (r.ok) setState(r.data, false);
  },

  /** "Delete saved data", after the confirmation. */
  async reset() {
    set((s) => ({ busy: { ...s.busy, reset: true }, resetNote: null }));
    const r = await api('POST', '/api/reset', {});
    set((s) => ({ busy: { ...s.busy, reset: false } }));
    if (!r.ok) { if (r.status !== 401) set({ resetNote: { text: say(problem(r)), tone: 'bad' } }); return; }
    autoOpen = true;
    mem.set('localStorage', 'dtsync.c1', null); mem.set('localStorage', 'dtsync.c2', null);
    set((s) => ({ tested: {}, untested: {}, touched: {}, skipOpen: {}, fresh: {}, savedForm: {}, key: null, keyInput: s.keyInput + 1, results: { s1: [], s2: [] }, errors: {}, c1: false, c2: false, run: null }));
    setState(r.data, true);
    set({ resetNote: { text: translate(state.lang, 'reset.done'), tone: 'good' } });
  },
};

/** Called once when the page starts. */
export function start() {
  // Versions before 1.2 kept the admin password in the tab's storage. It is not needed any more.
  mem.set('sessionStorage', 'dtsync.token', null);
  api('GET', '/api/ping').then((r) => {
    if (r.ok && !r.data.password) set({ gate: 'nopass' });
    else if (r.ok && r.data.signedIn) return load(true).then(adoptTimeZone);
    else set({ gate: 'login' });
  });
  setInterval(() => { if (state.gate === 'in' && !document.hidden) load(false); }, 60000);
}
