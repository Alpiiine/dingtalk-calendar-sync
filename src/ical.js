// Minimal iCalendar reader/writer — just what DingTalk's CalDAV server emits and accepts.
// Dates are kept as "wall clock" values so no timezone database is needed:
//   { y, m, d, H, M, S, kind: 'date' | 'utc' | 'local', tzid? }

const pad = (n, w = 2) => String(n).padStart(w, '0');

export function unescapeText(s = '') {
  return s.replace(/\\([nN,;\\])/g, (_, c) => (c === 'n' || c === 'N' ? '\n' : c));
}

export function escapeText(s = '') {
  return String(s).replace(/\\/g, '\\\\').replace(/\r?\n/g, '\\n').replace(/([,;])/g, '\\$1');
}

/** "20261114T210000Z" | "20261114T210000" | "20261114" -> date value */
export function parseDate(value, params = {}) {
  const m = /^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})(Z)?)?$/.exec(value.trim());
  if (!m) return null;
  const [, y, mo, d, H, M, S, z] = m;
  const base = { y: +y, m: +mo, d: +d, H: +(H ?? 0), M: +(M ?? 0), S: +(S ?? 0) };
  if (H === undefined) return { ...base, kind: 'date' };
  if (z) return { ...base, kind: 'utc' };
  return { ...base, kind: 'local', tzid: params.TZID || null };
}

export function formatDate(v) {
  const day = `${pad(v.y, 4)}${pad(v.m)}${pad(v.d)}`;
  if (v.kind === 'date') return day;
  return `${day}T${pad(v.H)}${pad(v.M)}${pad(v.S)}${v.kind === 'utc' ? 'Z' : ''}`;
}

/** The wall-clock fields as if they were UTC. Only ever compared with other naive values. */
export const naiveMs = (v) => Date.UTC(v.y, v.m - 1, v.d, v.H, v.M, v.S);

export function fromNaiveMs(ms, like) {
  const t = new Date(ms);
  return {
    y: t.getUTCFullYear(), m: t.getUTCMonth() + 1, d: t.getUTCDate(),
    H: t.getUTCHours(), M: t.getUTCMinutes(), S: t.getUTCSeconds(),
    kind: like.kind, ...(like.tzid ? { tzid: like.tzid } : {}),
  };
}

function parseLine(line) {
  // NAME;PARAM=val;PARAM="quoted:val":VALUE
  let i = 0, inQuote = false;
  for (; i < line.length; i++) {
    const c = line[i];
    if (c === '"') inQuote = !inQuote;
    else if (c === ':' && !inQuote) break;
  }
  if (i >= line.length) return null;
  const head = line.slice(0, i), value = line.slice(i + 1);
  const parts = head.match(/(?:[^;"]|"[^"]*")+/g) || [head];
  const params = {};
  for (const p of parts.slice(1)) {
    const eq = p.indexOf('=');
    if (eq > 0) params[p.slice(0, eq).toUpperCase()] = p.slice(eq + 1).replace(/^"|"$/g, '');
  }
  return { name: parts[0].toUpperCase(), params, value };
}

function parseDuration(s) {
  const m = /^([+-])?P(?:(\d+)W)?(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/.exec(s.trim());
  if (!m) return null;
  const ms = ((+m[2] || 0) * 7 * 86400 + (+m[3] || 0) * 86400 + (+m[4] || 0) * 3600 + (+m[5] || 0) * 60 + (+m[6] || 0)) * 1000;
  return m[1] === '-' ? -ms : ms;
}

/** Parse every VEVENT in an iCalendar document (nested VALARMs etc. are skipped). */
export function parseEvents(text) {
  const lines = text.replace(/\r\n/g, '\n').replace(/\n[ \t]/g, '').split('\n');
  const events = [];
  let ev = null, depth = 0;
  for (const raw of lines) {
    if (!raw) continue;
    const l = parseLine(raw);
    if (!l) continue;
    if (l.name === 'BEGIN') {
      if (l.value.toUpperCase() === 'VEVENT' && !ev) { ev = { exdates: [], attendees: [] }; depth = 0; }
      else if (ev) depth++;
      continue;
    }
    if (l.name === 'END') {
      if (ev && depth === 0 && l.value.toUpperCase() === 'VEVENT') { if (ev.uid && ev.start) events.push(ev); ev = null; }
      else if (ev) depth--;
      continue;
    }
    if (!ev || depth > 0) continue;
    switch (l.name) {
      case 'UID': ev.uid = l.value.trim(); break;
      case 'SUMMARY': ev.summary = unescapeText(l.value); break;
      case 'DESCRIPTION': ev.description = unescapeText(l.value); break;
      case 'LOCATION': ev.location = unescapeText(l.value); break;
      case 'STATUS': ev.status = l.value.trim().toUpperCase(); break;
      case 'TRANSP': ev.transp = l.value.trim().toUpperCase(); break;
      case 'RRULE': ev.rrule = l.value.trim(); break;
      case 'DTSTART': ev.start = parseDate(l.value, l.params); break;
      case 'DTEND': ev.end = parseDate(l.value, l.params); break;
      case 'DURATION': ev.durationMs = parseDuration(l.value); break;
      case 'RECURRENCE-ID': ev.recurrenceId = parseDate(l.value, l.params); break;
      case 'EXDATE':
        for (const v of l.value.split(',')) { const d = parseDate(v, l.params); if (d) ev.exdates.push(d); }
        break;
      case 'ORGANIZER': ev.organizer = l.value.replace(/^mailto:/i, '').toLowerCase(); break;
      case 'ATTENDEE':
        ev.attendees.push({ email: l.value.replace(/^mailto:/i, '').toLowerCase(), partstat: (l.params.PARTSTAT || '').toUpperCase() });
        break;
    }
  }
  return events;
}

function fold(line) {
  // RFC 5545 wants <= 75 octets per line; 60 chars keeps multi-byte text safe.
  const out = [];
  const chars = Array.from(line);
  for (let i = 0; i < chars.length; i += 60) out.push((i ? ' ' : '') + chars.slice(i, i + 60).join(''));
  return out.join('\r\n');
}

/**
 * Build the VCALENDAR that DingTalk accepts on PUT.
 * No ORGANIZER/ATTENDEE on purpose: DingTalk would treat them as people to invite.
 */
export function buildEvent({ uid, summary, description, location, start, end, stamp = new Date() }) {
  const dt = (name, v) => (v.kind === 'date' ? `${name};VALUE=DATE:${formatDate(v)}`
    : v.kind === 'local' && v.tzid ? `${name};TZID=${v.tzid}:${formatDate(v)}` : `${name}:${formatDate(v)}`);
  const ts = stamp.toISOString().replace(/[-:]/g, '').slice(0, 15) + 'Z';
  const lines = [
    'BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//dtsync//DingTalk Calendar Bridge//EN', 'CALSCALE:GREGORIAN',
    'BEGIN:VEVENT', `UID:${uid}`, `DTSTAMP:${ts}`, `CREATED:${ts}`, dt('DTSTART', start), dt('DTEND', end),
    `SUMMARY:${escapeText(summary || '(no title)')}`,
    description ? `DESCRIPTION:${escapeText(description)}` : null,
    location ? `LOCATION:${escapeText(location)}` : null,
    'TRANSP:OPAQUE', 'STATUS:CONFIRMED', 'SEQUENCE:0', 'END:VEVENT', 'END:VCALENDAR',
  ].filter(Boolean);
  return lines.map(fold).join('\r\n') + '\r\n';
}
