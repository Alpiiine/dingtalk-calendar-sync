// Cloudflare Worker entry point.
//   every minute   a cron trigger runs one sync pass
//   in a browser   the Worker's address shows the setup and status page (needs the ADMIN_PASSWORD secret)
// Binding: STATE (KV namespace) holds the saved settings and the sync bookkeeping.
// Logins, calendars and options are entered on that page; ADMIN_PASSWORD is the only secret the Worker reads.
import { createApp } from './src/app.js';

const kvStore = (kv) => ({
  get: (key) => kv.get(key),
  put: (key, value) => kv.put(key, value),
  delete: (key) => kv.delete(key),
});

const appFor = (env) => createApp({ store: kvStore(env.STATE), env, platform: 'cloudflare' });

export default {
  async scheduled(_event, env, ctx) {
    // Until setup is finished a pass returns { skipped: true } and does nothing.
    ctx.waitUntil(appFor(env).pass().catch((err) => console.error(`sync failed: ${err.message}`)));
  },

  fetch(request, env) {
    return appFor(env).handle(request);
  },
};
