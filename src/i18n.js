// The text of the bridge, in every language of locales/: calendar events, connection checks,
// the command line and the setup page. Log lines stay in English on purpose: they end up in
// bug reports.
import { LOCALES } from './locales/index.js';

export { LOCALES };
export const LANGS = Object.keys(LOCALES);
/** The language used when none is asked for, and for a message another language lacks. */
export const FALLBACK = 'en';

/**
 * The first candidate that names a language we have. 'zh-CN', 'zh_CN.UTF-8' and 'ZH' all give
 * 'zh': an exact code wins, then a code the candidate narrows down ('zh' for 'zh-TW'), then one
 * of the same base language ('pt-BR' for 'pt'). Anything else gives English.
 */
export function pickLang(...candidates) {
  const known = LANGS.map((code) => [code, code.toLowerCase()]);
  for (const c of candidates) {
    if (!c) continue;
    const want = String(c).trim().toLowerCase().replace(/[.@].*$/, '').replace(/_/g, '-');
    const hit = known.find(([, k]) => k === want)
      || known.find(([, k]) => want.startsWith(`${k}-`))
      || known.find(([, k]) => k.split('-')[0] === want.split('-')[0]);
    if (hit) return hit[0];
  }
  return FALLBACK;
}

/** Translate `key`; `{name}` placeholders are filled from `vars`. Falls back to English, then to the key. */
export function t(lang, key, vars = {}) {
  const text = LOCALES[lang]?.messages[key] ?? LOCALES[FALLBACK].messages[key] ?? key;
  return text.replace(/\{(\w+)\}/g, (_, k) => (vars[k] === undefined || vars[k] === null ? '' : String(vars[k])));
}
