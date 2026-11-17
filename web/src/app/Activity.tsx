// What the bridge did lately, newest first, as a small table: when, which way it travelled (in
// the colours of the two lanes), what happened, and the time of the event it was about. The two
// times never look alike: the moment the bridge acted is a clock in small monospace at the start
// of the row, the calendar slot is a date beside a calendar icon at its end. Lines that arrive
// while the page is open slide in and stay tinted for a moment.
import { useEffect, useRef } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { ArrowLeft, ArrowRight, CalendarDays } from 'lucide-react';
import { ReducedMotionConfig, spring, transition, useTempoTransition } from '@animate-ui/react/utils/motion';
import type { Lang } from '../lib/boot';
import { cn } from '../lib/cn';
import { clock, dateTime, translate } from '../lib/i18n';
import { describe, type Kind } from '../lib/log';
import { CARD } from '../ui/styles';
import type { LogLine } from './store';

/** The direction of a line. The arrow says it as well as the colour. */
function Way({ kind, lang }: { kind: Kind; lang: Lang }) {
  if (!kind) return null;
  const Arrow = kind === 'busy' ? ArrowRight : ArrowLeft;
  return (
    <span className={cn('inline-flex items-center gap-1 justify-self-start rounded-[.3125rem] px-1.5 text-[.6875rem] leading-[1.125rem] font-medium whitespace-nowrap', kind === 'busy' ? 'bg-busy-soft text-busy-ink' : 'bg-book-soft text-book-ink')}>
      <Arrow size={11} strokeWidth={2.5} aria-hidden />{translate(lang, `act.${kind}`)}
    </span>
  );
}

export function Activity({ lines, lang }: { lines: LogLine[]; lang: Lang }) {
  const rise = useTempoTransition(spring.entrance);
  const fade = useTempoTransition(transition.reveal);
  // The newest line that was on screen before this render: anything later is new.
  const seen = useRef<number | null>(null);
  const before = seen.current;
  useEffect(() => { seen.current = Math.max(seen.current ?? 0, ...lines.map((l) => l.at)); }, [lines]);

  const rows = lines.slice().reverse();
  const count = new Map<string, number>();
  return (
    <section id="activity" aria-labelledby="act-h" className={`${CARD} mt-3 scroll-mt-4 overflow-hidden`}>
      <h2 id="act-h" className="px-5 pt-4 pb-3 font-semibold max-[34rem]:px-4">{translate(lang, 'act.title')}</h2>
      {rows.length === 0 ? <p className="border-t border-hair px-5 py-4 text-sm text-muted max-[34rem]:px-4">{translate(lang, 'act.none')}</p> : (
        <ReducedMotionConfig>
          {/* The rows run from edge to edge of the card, so the tint under the pointer does too. */}
          <ol tabIndex={0} className="grid max-h-[17rem] grid-cols-[auto_auto_minmax(0,1fr)_auto] content-start gap-x-3 overflow-auto border-t border-hair text-sm focus-visible:-outline-offset-2 max-[34rem]:grid-cols-[auto_auto_minmax(0,1fr)]">
            <AnimatePresence initial={false}>
              {rows.map((l) => {
                const base = `${l.at}|${l.text}`, n = count.get(base) || 0;
                count.set(base, n + 1);
                const told = describe(lang, l.text);
                return (
                  <motion.li
                    key={`${base}|${n}`}
                    initial={{ opacity: 0, y: -6 }}
                    animate={{ opacity: 1, y: 0, transition: { ...rise, opacity: fade } }}
                    className={cn('col-span-full grid grid-cols-subgrid items-baseline border-b border-hair px-5 py-2 break-words transition-colors duration-150 last:border-b-0 hover:bg-tint/50 max-[34rem]:px-4', before !== null && l.at > before && 'log-new')}
                  >
                    <time title={dateTime(lang, l.at)} className="font-mono text-xs tracking-[-.01em] text-muted tabular-nums">{clock(lang, l.at)}</time>
                    <Way kind={told.kind} lang={lang} />
                    {/* The bridge's own wording stays one hover away: it is what a bug report needs. */}
                    <span title={l.text} className={cn('min-w-0', !told.kind && 'col-start-2 col-end-[-1]', told.problem && 'font-medium text-bad')}>{told.text}</span>
                    {told.kind && (
                      <span className="inline-flex items-baseline gap-1.5 text-xs text-muted tabular-nums min-[34rem]:justify-self-end max-[34rem]:col-start-3">
                        {told.when && <CalendarDays size={12} aria-hidden className="relative top-[.125rem] shrink-0 opacity-60" />}{told.when}
                      </span>
                    )}
                  </motion.li>
                );
              })}
            </AnimatePresence>
          </ol>
        </ReducedMotionConfig>
      )}
    </section>
  );
}
