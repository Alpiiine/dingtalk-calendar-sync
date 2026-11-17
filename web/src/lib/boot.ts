// What the server put into the page: where the bridge runs, its version, and its languages.
/** A language code from src/locales/, such as 'en' or 'zh'. The page learns the list from the server. */
export type Lang = string;
/** One language: its own name, its tag for <html lang>, a narrower tag for dates if it has one, its text. */
export type Locale = { name: string; tag: string; dates?: string; messages: Record<string, string> };

type Boot = { platform: string; version: string; locales: Record<Lang, Locale> };

export const BOOT: Boot = { locales: {}, ...JSON.parse(document.getElementById('boot')?.textContent || '{}') };
export const CF = BOOT.platform === 'cloudflare';

/** The nonce the Content-Security-Policy allows. Style tags added while the page runs need it. */
export const NONCE = document.querySelector<HTMLElement>('script[nonce], style[nonce]')?.nonce || undefined;

/** Storage that may be unavailable (private mode). */
export const mem = {
  get(store: 'localStorage' | 'sessionStorage', key: string): string | null {
    try { return window[store].getItem(key); } catch { return null; }
  },
  set(store: 'localStorage' | 'sessionStorage', key: string, value: string | null) {
    try { if (value === null) window[store].removeItem(key); else window[store].setItem(key, value); } catch { /* private mode */ }
  },
};
