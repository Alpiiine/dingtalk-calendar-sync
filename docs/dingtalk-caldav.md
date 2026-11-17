# DingTalk's CalDAV server, and how dtsync works around it

DingTalk Calendar offers CalDAV as its only sync interface, and the server behaves differently
from what the protocol promises. This page records what was measured, because it explains most
of the design.

## What the server really does

Measured on `calendar.dingtalk.com` with a test account on 14 Nov 2026, each result checked in the
DingTalk desktop app.

| Operation by a third-party client | HTTP answer | Reality |
|---|---|---|
| Read events (`REPORT calendar-query` with a time range) | 207 | Works. |
| Create event (`PUT <uuid>.ics`) | 201 | Works; appears in the DingTalk app within seconds. |
| **Edit event (`PUT` on an existing event)** | 204 | **Silently discarded** — the event never changes. |
| Delete event (`DELETE`) | 204 | Works (also for events created inside DingTalk) once the event is readable over CalDAV. |
| Re-create a UID that was deleted | 204 | Silently discarded. |
| Edit / delete inside DingTalk | – | Visible over CalDAV about 30–60 s later. |

So "third-party edits don't sync back" is true, but creating and deleting do work. dtsync
therefore never edits: a changed booking is **deleted and re-created under a new UID**.

Other quirks the code works around:

- The time-range filter only looks at a series' first start, and the server does not expand
  recurrences. Recurring series are collected from the past (the *Recurring event lookback* option) and expanded locally
  from `RRULE` / `EXDATE` / `RECURRENCE-ID`.
- Queries spanning more than about two years are rejected (400); long ranges are sliced.
- `sync-collection` always returns nothing; the collection `ctag` is used as the change signal.
- The default listing (no time range) only covers about a week.
- UIDs must look like a UUID (or `x@y`), and new events must be `PUT` to `<uid>.ics` with
  `Content-Type: text/calendar; charset=utf-8`; anything else returns 400.
- On create the server drops `LOCATION` and `URL` and adds its own 15-minute reminder. dtsync
  repeats the location, meeting link and guest list in the description.
- The calendar has no time zone of its own: `calendar-timezone` (and `calendar-timezone-id`)
  answer 404. Every timed event carries a `TZID` and a `VTIMEZONE` instead, in the zone of the
  device that created it (measured 15 Nov 2026 on five events, none all-day or recurring). The
  *Fallback time zone* option is therefore rarely used: in practice it only decides where
  midnight falls for all-day events.
- CalDAV reads lag writes by up to a minute, and a `DELETE` sent before the new event is readable
  answers 204 but does nothing. dtsync re-reads DingTalk two minutes after every write,
  removes leftovers, and retries a booking under a fresh UID if it never showed up.


## How a pass works

1. Read DingTalk's `ctag`. Unchanged and the last full read is recent → skip the DingTalk read.
2. Otherwise fetch the window (`now-1d … now+HORIZON_DAYS`) with data and list the past with
   etags only. Past events not seen before are downloaded once to learn whether they recur; the
   state remembers only their etag and that flag. Recurring series from the past are downloaded
   again on every full read (one request per 100 series), so no event text is ever stored.
   Everything is then expanded into concrete occurrences.
3. Bookings: list the Google source calendar, keep events matching `PUSH_MATCH`, and make DingTalk
   match — create new ones, replace changed ones (delete + create), delete cancelled ones.
4. Mirror: make the Google mirror calendar equal to the DingTalk occurrences (deterministic event
   IDs, so the pass is idempotent).

Loops are impossible by construction: events dtsync writes into DingTalk have UIDs starting
with `d7c0ffee-` and are never mirrored; mirror events carry the private property `dtsync=1` and are
never pushed.


## Write limit per pass

A Cloudflare Worker on the free plan may make 50 outbound requests per run. A pass therefore
stops after a set number of calendar writes (the *Max calendar writes per run* option: default 30
on Cloudflare, no limit elsewhere), marks the state so that the next pass reads DingTalk again
straight away, and carries on a minute later.
A first sync of a busy calendar takes a few minutes instead of failing.

## Storage writes

Workers KV allows 1,000 writes a day on the free plan, and dtsync runs 1,440 times a day.
The state is only written when it changed: on every full read (every 15 minutes by default), after
calendar writes, when a Google token was renewed, and when an error appears or clears.
