// Turns the built page (dist/index.html, everything inline) into ../src/ui.gen.js, the template
// that the bridge serves. The inline script and style get a nonce placeholder, because the
// page is served under a Content-Security-Policy that only allows the nonce of that response.
import { readFile, writeFile } from 'node:fs/promises';

const NONCE = '__DTSYNC_NONCE__';
const BOOT = '__DTSYNC_BOOT__';
const here = (p) => new URL(p, import.meta.url);

let html = await readFile(here('../dist/index.html'), 'utf8');
if (html.includes(NONCE)) throw new Error('the build already contains the nonce placeholder');

// The bundle itself contains the text "<script>" (React knows about script tags), so only the
// two tags Vite wrote into the head are touched, and each must be there exactly once.
for (const [tag, kind] of [['<script type="module" crossorigin>', 'script'], ['<style rel="stylesheet" crossorigin>', 'style']]) {
  if (html.split(tag).length !== 2) throw new Error(`expected exactly one ${tag} in the build`);
  html = html.replace(tag, () => `<${kind}${kind === 'script' ? ' type="module"' : ''} nonce="${NONCE}">`);
}
if (/<(script|link)\b[^>]*\b(src|rel="(stylesheet|modulepreload)")/.test(html.slice(0, html.indexOf(NONCE)))) throw new Error('the build loads a separate file');
if (html.split(BOOT).length !== 2) throw new Error('the boot placeholder must appear exactly once');

const out = `// Generated from web/ by \`npm run ui:build\`. Do not edit: change web/src and build again.
export const TEMPLATE = ${JSON.stringify(html)};
`;
await writeFile(here('../../src/ui.gen.js'), out);
console.log(`src/ui.gen.js written (${(out.length / 1024).toFixed(0)} kB)`);
