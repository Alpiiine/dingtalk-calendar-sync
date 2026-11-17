# Changelog

## 1.2.0

### Upgrading from 1.1.0

- **Settings are entered only on the setup page.** Logins, calendars and options are no longer
  read from environment variables or Worker secrets. An install that was configured that way
  stops syncing after this update until they are entered on the setup page. The old variables
  are ignored and can be deleted. Still read from the environment, because they are needed
  before the page can open: `ADMIN_PASSWORD`, and for Node and Docker `PORT`, `HOST`,
  `STATE_FILE` and `INTERVAL_SECONDS`.
- **The fallback time zone defaults to your browser's time zone** instead of `Asia/Shanghai`.
  It only applies to DingTalk events that carry no time zone, which is rare. An install that
  never set it reads such events as UTC until the setup page is opened once, and from then on
  in the time zone of that browser. To keep the old behaviour, enter `Asia/Shanghai` under
  **Options → Advanced → Fallback time zone**.
- `DEBUG=true` is gone: turn debug mode on from the page, for 24 hours.
- `DRY_RUN=1` is gone: use `node cli.js once --dry-run`, or **Preview changes** on the page.
- In `/api/state`, `robotEmail` is now `serviceAccountEmail`.

### Changed

- **dtsync is a two-way sync between DingTalk Calendar and Google Calendar, Calendly-ready.**
  The READMEs, the package description and the setup page lead with DingTalk ⇄ Google, and
  Calendly is an optional extra. What travels either way is called "events" ("3 events written
  to Google", "Events synced to Google").
- **Step 3 (Calendly) is optional.** **Skip this step** leaves it out, and the step explains how
  to copy everyday events from the Google main calendar instead: change *Events to copy from
  your main calendar* under Options. The default is still *Calendly bookings only*. The step is
  saved on the server, so every browser shows the same progress, and it follows Calendly's
  current layout (Settings → Scheduling → Calendars).
- **The setup page is a new React app** (`web/`) built on
  [Animate UI](https://github.com/imskyleen/animate-ui). It is still served as one inline HTML
  document under a strict Content-Security-Policy, and the built page is checked in as
  `src/ui.gen.js`, so running and deploying dtsync needs no install and no build.
  - The three steps open one after the other and fold away when done. The Google step is split
    into parts A, B and C, the key file can be dropped onto the page, and **Copy service
    account email** sits where the address is needed.
  - A step gets its tick only after its test passed. A failed test turns the status red, marks
    the fields it blames, and opens the part that failed.
  - Once connected, the page leads with the sync status: events synced to DingTalk, events
    synced to Google, when dtsync last checked, and **Sync now** next to **Preview changes**.
    While a large first sync is still being copied in batches, it says "Catching up" instead of
    "Live".
  - Recent activity is a table in plain words, in the language of the page and in local time.
  - **Save without testing** is available under a step when DingTalk or Google can't be
    reached.
  - **Disconnect and delete saved data** asks for confirmation in a dialog.
  - Dark mode follows the system, and with "reduce motion" switched on nothing moves.
- **Signing in holds across tabs and reloads.** The page signs in once and the browser keeps a
  session cookie (HttpOnly, SameSite=Strict, twelve hours, renewed while a page is open)
  instead of keeping the admin password in the tab. Sending the password as
  `Authorization: Bearer` still works for scripts.
- **More options on the page.** The three settings that had no field (recurring event lookback,
  full DingTalk refresh interval, max calendar writes per run) and the fallback time zone are
  under **Options → Advanced**, each with what it is for and when to change it.
- **"Robot" is now "Google service account"** on the page, in the checks and in the docs
  (Google 服务账号), the name Google Cloud itself uses.
- **Clearer error messages**, each followed by what to do: "Invalid DingTalk CalDAV username or
  password", "The Google service account cannot access calendar …", "The Google service account
  does not have permission to modify events in …", and "Cannot decrypt saved credentials
  (ADMIN_PASSWORD may have changed)". The README troubleshooting tables quote them word for
  word.
- **The language of the page is chosen from a menu** in the top right, and starts in the first
  language of the browser that dtsync has. Languages are one file each in `src/locales/`, so
  adding one is a single file and one line in `src/locales/index.js`: see "Adding a language"
  in CONTRIBUTING.md.
- **The copy was rewritten in both languages.** English is shorter and plainer, with counts
  that read naturally ("1 event written to Google"). Chinese reads as written in Chinese, with
  proper spacing between Chinese characters, Latin text and numbers. The text dtsync writes
  into calendar events is unchanged.

### Fixed

- The page's once-a-minute refresh no longer clears what is being typed into a step.
- `npm run demo` no longer stops on a `HEAD` request.

## 1.1.0

- Setup and status page, in English and 简体中文, served by dtsync itself. Logins are tested
  before they are saved, and problems are explained in plain language.
- Settings can be saved from the page (encrypted with a key derived from `ADMIN_PASSWORD`).
  Environment variables and Worker secrets keep working and take precedence.
- One-click "Deploy to Cloudflare"; the KV namespace is created automatically.
- `node cli.js serve` (and the Docker image) show the same page on port 8787.
- Privacy: the saved state no longer contains any event text (recurring series from the past
  are fetched on each full read instead of being stored), and logs carry no titles or guests.
- Debug mode: adds titles and every network call to the log, switches itself off after 24 hours
  (`DEBUG=true` forces it on).
- Text written into events follows `DTSYNC_LANG` (`en` or `zh`).
- `MAX_WRITES` spreads a large first sync over several passes, so the Workers free plan's limit
  of 50 outside requests per run is not exceeded.
- `doctor` explains what is wrong (wrong CalDAV password, calendar not shared, shared read-only).

## 1.0.0

- First working version: DingTalk busy time mirrored into a Google calendar, Calendly bookings
  written into DingTalk, for Node, Docker and Cloudflare Workers.
