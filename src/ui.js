// The setup and status page: one self-contained HTML document (no external requests, so it
// also loads where Google Fonts and CDNs are blocked). Every language of locales/, light and dark.
//
// The page is a React app in web/ (Tailwind and Animate UI). `npm run ui:build` compiles it into
// ui.gen.js: a single HTML template with the script and the styles inline. That file is kept in
// the repository, so the bridge itself still runs and deploys without installing anything.
//
// Two things are filled in per request: the nonce that the Content-Security-Policy header
// allows, and the boot data (platform, version and the text of the page). The text is handed over
// with each page load, so a wording change or a new language needs no rebuild.
import { TEMPLATE } from './ui.gen.js';
import { LOCALES } from './i18n.js';

const NONCE = '__DTSYNC_NONCE__';
const [HEAD, TAIL] = TEMPLATE.split('__DTSYNC_BOOT__');

const safeJson = (value) => JSON.stringify(value).replace(/</g, '\\u003c').replace(/[\u2028\u2029]/g, '');

/** What the page needs before it can talk to the server: where it runs, its version, its languages. */
export const bootData = ({ platform, version }) => ({ platform, version, locales: LOCALES });

/** The whole page. `nonce` must match the Content-Security-Policy header. */
export function page({ nonce, platform, version }) {
  return HEAD.replaceAll(NONCE, nonce) + safeJson(bootData({ platform, version })) + TAIL.replaceAll(NONCE, nonce);
}
