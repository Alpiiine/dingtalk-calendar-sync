// The bridge's log lines are English on purpose: they end up in bug reports. On the page the
// lines it writes in normal operation are told in the reader's language and local time; the
// original stays one hover away, and anything unknown (debug mode adds many) is shown as it is.
import type { Lang } from './boot';
import { datesOf, translate } from './i18n';


/**
 * A date in the reader's own format. Chinese runs the weekday into the date ("11月16日周一"):
 * a weekday that follows a character without a space is set apart from it ("11月16日 周一").
 */
function format(lang: Lang, date: Date, options: Intl.DateTimeFormatOptions): string {
  return new Intl.DateTimeFormat(datesOf(lang), options).formatToParts(date)
    .map((p, i, all) => (p.type === 'weekday' && i > 0 && /\p{Script=Han}$/u.test(all[i - 1].value) ? ` ${p.value}` : p.value)).join('');
}

/** "2026-11-20T10:00:00+08:00" (a moment), "2026-11-20T10:00:00" (a wall-clock time) or "2026-11-20" (a day). */
function when(lang: Lang, text: string): string {
  const m = /^(\d{4})-(\d\d)-(\d\d)(?:T(\d\d):(\d\d))?/.exec(text);
  if (!m) return text;
  const day: Intl.DateTimeFormatOptions = { weekday: 'short', day: 'numeric', month: 'short' };
  if (!m[4]) return format(lang, new Date(+m[1], +m[2] - 1, +m[3]), day);
  const moment = /(Z|[+-]\d\d:?\d\d)$/.test(text) ? new Date(text) : new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5]);
  return Number.isNaN(moment.getTime()) ? text : format(lang, moment, { ...day, hour: '2-digit', minute: '2-digit' });
}

const KNOWN: Array<[RegExp, string, (m: RegExpExecArray, lang: Lang) => Record<string, string>]> = [
  [/^DingTalk \+ booking #\w+ ?(\S*)$/, 'log.book.add', (m, lang) => ({ when: when(lang, m[1]) })],
  [/^DingTalk - \(replace\) booking #\w+$/, 'log.book.replace', () => ({})],
  [/^DingTalk - booking #\w+$/, 'log.book.remove', () => ({})],
  [/^DingTalk - \(leftover\) #\w+$/, 'log.book.leftover', () => ({})],
  [/^Google \+ busy block #\w+ ?(\S*)$/, 'log.busy.add', (m, lang) => ({ when: when(lang, m[1]) })],
  [/^Google ~ busy block #\w+ ?(\S*)$/, 'log.busy.update', (m, lang) => ({ when: when(lang, m[1]) })],
  [/^Google - busy block #\w+$/, 'log.busy.remove', () => ({})],
  [/^write limit of (\d+) per pass reached/, 'log.cap', (m) => ({ n: m[1] })],
  [/^history scan: (\d+) past events/, 'log.history', (m) => ({ n: m[1] })],
  [/^holding back removal of (\d+)\/\d+ mirror events/, 'log.hold', (m) => ({ n: m[1] })],
  [/^ERROR:? (.*)$/s, 'log.error', (m) => ({ message: m[1] })],
];

/** Which way a line travelled: busy time towards Google, a booking towards DingTalk. */
export type Kind = 'busy' | 'book' | '';

/**
 * One log line for the page: what happened, and apart from it the time of the event it is about.
 * `problem` marks lines that report a failure.
 */
export function describe(lang: Lang, raw: string): { text: string; when: string; kind: Kind; problem: boolean } {
  const line = raw.replace(/^\[dry-run\] /, '');
  for (const [pattern, key, vars] of KNOWN) {
    const m = pattern.exec(line);
    if (!m) continue;
    const kind: Kind = key.startsWith('log.busy.') ? 'busy' : key.startsWith('log.book.') ? 'book' : '';
    // A catalogue writes "what · when". Lines without a direction stay in one piece.
    const text = translate(lang, key, vars(m, lang)).replace(/ · $/, '');
    const cut = kind ? text.lastIndexOf(' · ') : -1;
    return { text: cut < 0 ? text : text.slice(0, cut), when: cut < 0 ? '' : text.slice(cut + 3), kind, problem: key === 'log.error' };
  }
  return { text: line, when: '', kind: '', problem: false };
}
