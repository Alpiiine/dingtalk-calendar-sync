#!/usr/bin/env node
// Node entry point (Node 20+, no dependencies).
//   node cli.js serve    setup page on http://localhost:8787 and a sync every minute (Docker runs this)
//   node cli.js doctor   check the logins and calendar access
//   node cli.js once     run a single sync pass
//   node cli.js watch    keep syncing every INTERVAL_SECONDS (default 60), without the setup page
// Add --dry-run to once, watch or serve to log what would be done without writing anything.
// Logins, calendars and options are entered on the setup page and kept encrypted next to the
// state file. The environment (or a .env file next to this script) only holds what the process
// needs to start: ADMIN_PASSWORD, PORT, HOST, STATE_FILE and INTERVAL_SECONDS.
import { readFile, writeFile, rename, rm, mkdir, chmod } from 'node:fs/promises';
import { existsSync, readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { createApp, VERSION } from './src/app.js';
import { missingSettings } from './src/config.js';
import { runChecks } from './src/doctor.js';
import { randomPassword } from './src/crypto.js';
import { t, pickLang } from './src/i18n.js';

const here = path.dirname(fileURLToPath(import.meta.url));

function loadDotEnv(file) {
  if (!existsSync(file)) return;
  for (const line of readFileSync(file, 'utf8').split(/\r?\n/)) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);
    if (!m || process.env[m[1]] !== undefined) continue;
    process.env[m[1]] = m[2].replace(/^(['"])(.*)\1$/, '$2');
  }
}

/** One file per key. "state" keeps its historical location (STATE_FILE); the rest sit beside it. */
function fileStore(stateFile) {
  const dir = path.dirname(stateFile);
  const fileFor = (key) => (key === 'state' ? stateFile : path.join(dir, `${key}.json`));
  return {
    dir,
    async get(key) {
      try { return await readFile(fileFor(key), 'utf8'); } catch (err) { if (err.code === 'ENOENT') return null; throw err; }
    },
    async put(key, value) {
      await mkdir(dir, { recursive: true });
      const file = fileFor(key);
      await writeFile(`${file}.tmp`, value, { mode: 0o600 });
      await rename(`${file}.tmp`, file);
    },
    async delete(key) { await rm(fileFor(key), { force: true }); },
  };
}

const stamp = () => new Date().toISOString();
const logger = { log: (m) => console.log(`${stamp()} ${m}`), error: (m) => console.error(`${stamp()} ${m}`) };

/** ADMIN_PASSWORD from the environment, else the one generated earlier, else (for `serve`) a new one. */
async function adminPassword(dir, { create }) {
  if (process.env.ADMIN_PASSWORD) return { password: process.env.ADMIN_PASSWORD };
  const file = path.join(dir, 'admin-password');
  if (existsSync(file)) return { password: (await readFile(file, 'utf8')).trim(), file };
  if (!create) return {};
  const password = randomPassword();
  await mkdir(dir, { recursive: true });
  await writeFile(file, `${password}\n`, { mode: 0o600 });
  await chmod(file, 0o600).catch(() => {});
  return { password, file };
}

function serve(app, { port, host }) {
  const server = createServer(async (req, res) => {
    try {
      const chunks = [];
      let size = 0;
      for await (const chunk of req) {
        size += chunk.length;
        if (size > 256 * 1024) { res.writeHead(413).end(); return; }
        chunks.push(chunk);
      }
      const headers = new Headers();
      for (const [k, v] of Object.entries(req.headers)) if (typeof v === 'string') headers.set(k, v);
      const hasBody = req.method !== 'GET' && req.method !== 'HEAD';
      const request = new Request(`http://${req.headers.host || 'localhost'}${req.url}`, {
        method: req.method, headers, body: hasBody ? Buffer.concat(chunks) : undefined,
      });
      const response = await app.handle(request);
      res.writeHead(response.status, Object.fromEntries(response.headers));
      res.end(Buffer.from(await response.arrayBuffer()));
    } catch (err) {
      logger.error(`request failed: ${err.message}`);
      if (!res.headersSent) res.writeHead(500);
      res.end();
    }
  });
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, host, () => resolve(server));
  });
}

async function main() {
  loadDotEnv(path.join(here, '.env'));
  const args = process.argv.slice(2);
  const dryRun = args.includes('--dry-run');
  const cmd = args.find((a) => !a.startsWith('--')) || 'once';
  const lang = pickLang(process.env.DTSYNC_LANG, process.env.LC_ALL, process.env.LANG);
  if (!['serve', 'doctor', 'once', 'watch'].includes(cmd)) throw new Error(t(lang, 'cli.unknown', { cmd }));

  const store = fileStore(process.env.STATE_FILE || path.join(here, 'state.json'));
  const admin = await adminPassword(store.dir, { create: cmd === 'serve' });
  const app = createApp({ store, env: { ADMIN_PASSWORD: admin.password }, platform: 'node', logger });

  if (cmd === 'doctor') {
    const { stored } = await app.settings();
    const results = await runChecks(stored);
    for (const r of results) console.log(`${r.level === 'ok' ? '✓' : r.level === 'warn' ? '!' : 'x'} ${t(lang, r.key, r.vars)}`);
    const failed = results.some((r) => r.level === 'error');
    console.log(t(lang, failed ? 'cli.someFailed' : 'cli.allGood'));
    if (failed) process.exitCode = 1;
    return;
  }

  const pass = async ({ quietWhenNotSetUp = false } = {}) => {
    const res = await app.pass({ dryRun });
    if (res.skipped) {
      if (!quietWhenNotSetUp) throw new Error(t(lang, 'cli.notConfigured', { missing: res.missing.join(', ') }));
      return;
    }
    if (res.error) return; // already logged
    const changed = Object.entries(res.stats).filter(([k, v]) => k !== 'full' && v).map(([k, v]) => `${k}=${v}`).join(' ');
    if (changed || res.stats.full) logger.log(`sync ok${res.stats.full ? ' (full)' : ''} ${changed}`.trimEnd());
  };

  if (cmd === 'once') return pass();

  const every = Number(process.env.INTERVAL_SECONDS || 60) * 1000;
  const dry = dryRun ? t(lang, 'cli.dry') : '';
  if (cmd === 'serve') {
    const port = Number(process.env.PORT || 8787), host = process.env.HOST || '127.0.0.1';
    await serve(app, { port, host });
    console.log(`dtsync ${VERSION}`);
    console.log(t(lang, 'cli.serve.open', { url: `http://${host === '0.0.0.0' ? 'localhost' : host}:${port}` }));
    if (admin.file) {
      console.log(t(lang, 'cli.serve.password', { password: admin.password }));
      console.log(t(lang, 'cli.serve.passwordSaved', { file: admin.file }));
    }
  } else {
    const { stored } = await app.settings();
    const missing = missingSettings(stored);
    if (missing.length) throw new Error(t(lang, 'cli.notConfigured', { missing: missing.join(', ') }));
  }
  console.log(t(lang, 'cli.watching', { seconds: every / 1000, dry }));
  for (;;) {
    await pass({ quietWhenNotSetUp: cmd === 'serve' }).catch((err) => logger.error(`sync failed: ${err.message}`));
    await new Promise((r) => setTimeout(r, every));
  }
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
