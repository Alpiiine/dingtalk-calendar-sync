import { BOOT, type Lang } from './boot';

export type Vars = Record<string, unknown>;
export type Translate = (key: string, vars?: Vars) => string;

/** The languages of the page, in the order of the menu. */
export const LANGS: Lang[] = Object.keys(BOOT.locales);

/** The first of `wanted` (browser languages, most wanted first) that we have. Same rules as pickLang in src/i18n.js. */
export function pickLang(wanted: readonly string[]): Lang {
  const known = LANGS.map((code) => [code, code.toLowerCase()] as const);
  for (const w of wanted) {
    const want = w.trim().toLowerCase().replace(/_/g, '-');
    const hit = known.find(([, k]) => k === want)
      || known.find(([, k]) => want.startsWith(`${k}-`))
      || known.find(([, k]) => k.split('-')[0] === want.split('-')[0]);
    if (hit) return hit[0];
  }
  return 'en';
}

/** The tag for <html lang> and for wording ("5 minutes ago"). */
export const tagOf = (lang: Lang) => BOOT.locales[lang]?.tag || 'en';
/** The tag for dates and clock times. */
export const datesOf = (lang: Lang) => BOOT.locales[lang]?.dates || tagOf(lang);

/** Translate `key`; `{name}` placeholders are filled from `vars`. Falls back to English, then to the key. */
export function translate(lang: Lang, key: string, vars?: Vars): string {
  const text = BOOT.locales[lang]?.messages[key] ?? BOOT.locales.en?.messages[key] ?? key;
  return text.replace(/\{(\w+)\}/g, (_, k: string) => (vars?.[k] === undefined || vars[k] === null ? '' : String(vars[k])));
}

/** How long ago `ms` was, in the largest unit that fits, and the formatter that words it. */
function since(lang: Lang, ms: number) {
  const diff = Math.round((ms - Date.now()) / 60000);
  const rtf = new Intl.RelativeTimeFormat(tagOf(lang), { numeric: 'auto' });
  if (Math.abs(diff) < 60) return [rtf, diff, 'minute'] as const;
  if (Math.abs(diff) < 60 * 48) return [rtf, Math.round(diff / 60), 'hour'] as const;
  return [rtf, Math.round(diff / 1440), 'day'] as const;
}

/**
 * Chinese sets a space between a character and a number beside it ("在 4 小时前", like the
 * catalogue's own "1 个"), which neither Intl nor a filled-in placeholder writes. For wording
 * and counts only: a date ("11月16日") keeps its numbers closed up.
 */
export const spaced = (lang: Lang, text: string) => (tagOf(lang).startsWith('zh')
  ? text.replace(/(\p{Script=Han})(?=\d)|(\d)(?=\p{Script=Han})/gu, '$1$2 ') : text);

/** "5 minutes ago", "in 2 hours". */
export function ago(lang: Lang, ms: number): string {
  try { const [rtf, n, unit] = since(lang, ms); return spaced(lang, rtf.format(n, unit)); } catch { return new Date(ms).toLocaleString(); }
}

/** The same in pieces, so the number can be set apart from its unit: "5" + " minutes ago". */
export function agoParts(lang: Lang, ms: number): Array<{ text: string; num: boolean }> {
  try {
    const [rtf, n, unit] = since(lang, ms);
    return rtf.formatToParts(n, unit).map((p) => ({ text: p.value, num: p.type !== 'literal' }));
  } catch { return [{ text: ago(lang, ms), num: false }]; }
}

export const clock = (lang: Lang, ms: number) => new Date(ms).toLocaleTimeString(datesOf(lang), { hour: '2-digit', minute: '2-digit', second: '2-digit' });
export const dateTime = (lang: Lang, ms: number) => new Date(ms).toLocaleString(datesOf(lang));

const COUNTERS = ['pushed', 'replaced', 'removed', 'retried', 'mirrored', 'unmirrored'] as const;

/** "1 event added to DingTalk, 5 events written to Google": a count of one has a key of its own. */
export function counts(lang: Lang, obj: Record<string, unknown> | null | undefined): string {
  const one = new Intl.PluralRules(tagOf(lang));
  return COUNTERS.filter((k) => obj?.[k]).map((k) => {
    const n = Number(obj![k]);
    return translate(lang, `count.${k}${one.select(n) === 'one' ? '.one' : ''}`, { n });
  }).join(translate(lang, 'list.sep'));
}
