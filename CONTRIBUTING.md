# Contributing

Thanks for contributing! 欢迎贡献！

## Try it without any accounts

```sh
npm run demo
```

runs the real setup page and sync engine against in-memory stand-ins for DingTalk and Google
(`scripts/demo.mjs`). The test values to enter are printed in the terminal.

## Tests

```sh
npm test
```

Nothing to install. The suite runs the sync engine against a fake DingTalk server that
reproduces the quirks measured on the real one (see `docs/dingtalk-caldav.md`), and the HTTP app
against a fake Google.

## Working on the setup page

The page is a React app in `web/` (TypeScript, Tailwind, and
[Animate UI](https://github.com/imskyleen/animate-ui) for the components and the motion). It is
compiled into `src/ui.gen.js`, a single HTML document with the script and styles inline, which
dtsync serves. That file is committed, so dtsync runs and deploys without a build step.

```sh
npm run ui:install   # once
npm run demo         # the API, on http://localhost:8788
npm run ui:dev       # the page with live reload, talking to the demo
npm run ui:build     # type-check, build, and write src/ui.gen.js (commit the result)
```

Also check the built page through `npm run demo`: only there is it served under the real
Content-Security-Policy, which blocks any script or style without the response's nonce.
Animate UI components that inject their own style tag (toggle group, tabs) are blocked by it;
`Highlight` does the same job without one.

## Adding a language

Each language is one file in `src/locales/`. English (`en.js`) is the reference.

1. Copy `src/locales/en.js` to `src/locales/<code>.js`. The code is the language tag, as
   short as it can be: `ja`, `de`, `pt-BR`. (`zh` is Simplified Chinese; Traditional would be
   `zh-TW`.)
2. Set `name` to the language's own name for itself (shown in the language menu) and `tag` to
   its [BCP 47 tag](https://www.w3.org/International/articles/language-tags/). Then translate
   the values. Keep the keys, `{placeholders}`, and HTML tags as they are.
3. Import the file in `src/locales/index.js` and add it to `LOCALES`.
4. Run `npm test`: it fails if a key or placeholder is missing or left over. Then check it in
   `npm run demo`.

That's it. The language appears in the setup page's language menu and among the synced event
languages in Options, the command line follows `LANG`, and the page needs no rebuild because
the server sends the text with each page load. Keys ending in `.one` (such as `count.pushed.one`)
are used when the language's plural rules select "one"; languages without that form can copy
the regular text. The README and `setup.sh` are separate: they exist in
English and 简体中文 only.

## Ground rules

- **dtsync has no dependencies and no build step.** Everything outside `web/` runs
  unchanged on Node 20+, Docker and Cloudflare Workers, using only `fetch` and WebCrypto. The
  setup page is the one part that is built, and its output is checked in.
- **No event text at rest or in logs.** The saved state holds ids, hashes, etags and times.
  Log lines have a "safe" form and a "detailed" form (`log(safe, detailed)`); only debug mode
  prints the detailed one. Tests check this; please keep them passing.
- **Every language.** All user-facing text lives in `src/locales/`, one file per language
  (events, checks, command line, and setup page; a wording change needs no rebuild). A new
  message goes into every file, `en.js` first. A test fails if a key or a placeholder is
  missing in one language. Log lines stay in English.
- **DingTalk never accepts edits.** A changed event is deleted and created again under a new
  UID. If you find different server behavior, add it to `docs/dingtalk-caldav.md` with how you
  measured it, and to the fake server in `test/helpers.mjs`.

## Reporting a bug

Turn on **Debug mode** on the setup page (Options), click **Sync now**, and attach the output.
Debug output includes event titles, so remove anything you don't want to share.
