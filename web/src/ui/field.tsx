import { createElement, useState, type ComponentProps, type ReactNode } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { Check, CircleAlert, Eye, EyeOff } from 'lucide-react';
import { scale, transition, useTempoTransition } from '@animate-ui/react/utils/motion';
import { cn } from '../lib/cn';
import { Reveal, useShake } from './motion';

// A soft hairline and a faint shadow under it; the outline darkens under the pointer, and focus
// turns it to the accent and adds a soft 3px ring. A value longer than the box ends in an
// ellipsis while the box is not being typed in.
const INPUT = 'block w-full min-h-11 rounded-ctl border border-field bg-surface px-3 py-[.45rem] text-[max(1rem,1em)] text-ellipsis text-ink shadow-field outline-none '
  + 'pointer-fine:min-h-8 pointer-fine:px-2.5 pointer-fine:py-1 pointer-fine:text-base '
  + 'transition-[border-color,box-shadow,background-color] duration-150 placeholder:text-muted/65 hover:border-field-hover disabled:bg-sunken disabled:text-muted '
  + 'focus-visible:border-accent focus-visible:shadow-[0_0_0_3px_var(--ring)] '
  + 'aria-invalid:border-bad aria-invalid:focus-visible:shadow-[0_0_0_3px_var(--bad-ring)]';

// A number with its unit ("90 days"): the box is drawn by the group, and the number is typed
// against the unit at its end, so the two read as one phrase. It answers the pointer, the focus
// and a rejected value the way a plain text box does.
const GROUP = 'flex min-h-11 cursor-text items-center rounded-ctl border border-field bg-surface shadow-field pointer-fine:min-h-8 '
  + 'transition-[border-color,box-shadow,background-color] duration-150 hover:border-field-hover '
  + 'has-[input:focus-visible:not([aria-invalid=true])]:border-accent has-[input:focus-visible:not([aria-invalid=true])]:shadow-[0_0_0_3px_var(--ring)] '
  + 'has-[[aria-invalid=true]]:border-bad has-[[aria-invalid=true]:focus-visible]:shadow-[0_0_0_3px_var(--bad-ring)]';
const GROUP_INPUT = 'block w-full min-w-0 flex-1 bg-transparent py-[.45rem] ps-3 text-end text-[max(1rem,1em)] text-ink tabular-nums outline-none '
  + 'placeholder:text-muted/65 pointer-fine:py-1 pointer-fine:ps-2.5 pointer-fine:text-base';

/** The name of a field. What follows it sets the gap (`mb-1.5` above a box). */
export const LABEL = 'block text-sm font-medium';
export const HINT = 'text-sm text-muted';

/** What is wrong with a field: folds in under it and is read out. */
export function FieldError({ id, text }: { id?: string; text?: string }) {
  return (
    <Reveal show={Boolean(text)}>
      <p id={id} role="alert" className="flex gap-1.5 pt-1.5 text-sm font-medium break-words text-bad">
        <CircleAlert size={14} aria-hidden className="mt-[.2rem] shrink-0" />
        <span className="min-w-0">{text}</span>
      </p>
    </Reveal>
  );
}

type TextFieldProps = Omit<ComponentProps<'input'>, 'onChange' | 'value' | 'id'> & {
  id: string; label: string; value: string; onChange: (value: string) => void;
  /** A hint is a sentence, or a node when it holds tags (an example set as <code>). */
  hints?: Array<ReactNode | false | null | undefined>; error?: string; shake?: number;
  /** The first hint is a condition, and the value meets it: the hint gets a tick. */
  met?: boolean;
  /** Marks the field as wrong without a text of its own (the explanation stands elsewhere). */
  invalid?: boolean;
  mono?: boolean; secret?: boolean; showLabel?: string; first?: boolean;
  /** How wide the box is: as wide as what goes into it, not as wide as the page. */
  width?: string;
  /** What the number counts ("days"), shown inside the box at its end, the number set against it. */
  unit?: string;
  /** The range and the default ("1–365 · default 90"): a small caption apart from the prose. */
  meta?: string;
  /** A settings row: the label and its hints on one side, the box on the other. */
  side?: boolean;
  /** Sits under the box, in its column. */
  after?: ReactNode;
};

/** A labelled input with its hints and its error. `secret` adds the button that shows the password. */
export function TextField({ id, label, value, onChange, hints = [], met, error, invalid, shake, mono, secret, showLabel, first, width, unit, meta, side, after, className, ...input }: TextFieldProps) {
  const [shown, setShown] = useState(false);
  const scope = useShake<HTMLDivElement>(shake);
  const swap = useTempoTransition(transition.swap);
  const notes = hints.filter(Boolean);
  const describedBy = [`${id}-err`, notes.length || meta ? `${id}-hint` : ''].filter(Boolean).join(' ');
  // A box for a number is as wide as a number (120px), and the number stands at its end.
  const numeric = input.type === 'number';
  const size = width || (side ? 'w-[7.5rem]' : 'max-w-[32rem]');
  const control = { ...input, id, value, 'aria-invalid': error || invalid ? true as const : undefined, 'aria-describedby': describedBy };
  const box = unit ? (
    // Pressing the unit puts the cursor in the box, as pressing anywhere else in it does.
    <div
      ref={scope} className={cn(GROUP, size)}
      onMouseDown={(e) => { if (e.target instanceof HTMLInputElement) return; e.preventDefault(); e.currentTarget.querySelector('input')?.focus(); }}
    >
      <input {...control} onChange={(e) => onChange(e.target.value)} className={GROUP_INPUT} />
      <span aria-hidden className="shrink-0 ps-1.5 pe-3 text-sm text-muted select-none pointer-fine:pe-2.5">{unit}</span>
    </div>
  ) : (
    <div ref={scope} className={cn('relative', size)}>
      <input
        {...control} onChange={(e) => onChange(e.target.value)}
        type={secret ? (shown ? 'text' : 'password') : input.type || 'text'}
        className={cn(INPUT, mono && 'font-mono text-[max(1rem,.95em)] tracking-[-.01em] pointer-fine:text-sm', secret && 'pe-12', numeric && 'text-end tabular-nums')}
      />
      {secret && (
        <button
          type="button" aria-label={showLabel} aria-pressed={shown} onClick={() => setShown(!shown)}
          className={cn('absolute inset-y-px end-px grid w-11 place-items-center rounded-[5px] transition-colors duration-150 pointer-fine:w-8', shown ? 'text-accent' : 'text-muted hover:text-ink')}
        >
          <span className="relative inline-flex">
            <AnimatePresence mode="popLayout" initial={false}>
              <motion.span
                key={shown ? 'shown' : 'hidden'} className="inline-flex"
                initial={{ opacity: 0, scale: scale.icon }}
                animate={{ opacity: 1, scale: 1, transition: swap }}
                exit={{ opacity: 0, scale: scale.icon, transition: swap }}
              >
                {shown ? <EyeOff size={16} aria-hidden /> : <Eye size={16} aria-hidden />}
              </motion.span>
            </AnimatePresence>
          </span>
        </button>
      )}
    </div>
  );
  const hint = (notes.length > 0 || meta) && (
    <div id={`${id}-hint`} className={cn('grid gap-1.5', meta ? 'mt-1' : 'mt-1.5')}>
      {/* Facts to look up, not sentences to read: small, monospaced, on a line of their own. */}
      {meta && <p className="font-mono text-[.6875rem] leading-4 tracking-[-.01em] text-muted tabular-nums">{meta}</p>}
      {notes.map((n, i) => (
        <p key={i} className={cn(HINT, 'max-w-[60ch] transition-colors duration-150', i === 0 && met && 'flex items-start gap-1 text-ok')}>
          {i === 0 && met && <Check size={14} strokeWidth={3} aria-hidden className="mt-[.15em] shrink-0" />}{n}
        </p>
      ))}
    </div>
  );
  if (side) {
    // The label, the box beside it, and under the label what explains it. A short box (a
    // number) stays beside its label on a phone too, and the explanation runs under both;
    // a wide one goes under its label there.
    const short = !width;
    return (
      <div className={cn('grid min-w-0 gap-x-8 py-4 sm:grid-rows-[auto_1fr]', short ? 'grid-cols-[minmax(0,1fr)_auto] max-sm:gap-x-4' : 'sm:grid-cols-[minmax(0,1fr)_auto]', className)}>
        <label htmlFor={id} className={cn(LABEL, 'min-w-0', short ? 'max-sm:self-center' : 'max-sm:mb-1.5')}>{label}</label>
        <div className="min-w-0 sm:row-span-2">{box}{after}</div>
        <div className={cn('min-w-0', short && 'max-sm:col-span-2')}>
          <FieldError id={`${id}-err`} text={error} />
          {hint}
        </div>
      </div>
    );
  }
  return (
    <div className={cn('min-w-0', !first && 'mt-4', className)}>
      <label htmlFor={id} className={`${LABEL} mb-1.5`}>{label}</label>
      {box}
      {/* What is wrong comes first, right under the field; the standing hints follow. */}
      <FieldError id={`${id}-err`} text={error} />
      {hint}
      {after}
    </div>
  );
}

// A name set as a tag (<b>Enable</b>) or a link that is followed by a full stop or a comma: it
// is marked, so that neither the padding of the tag nor the arrow of the link stands between
// the word and its punctuation. White space that strayed in between the two is dropped.
// Full-width marks count as well, the opening bracket among them: "（" brings its own room on
// the side of the word, so the padding of a tag before it reads as a stray space.
const PUNCT = '[.,;:!?。，；：、！？（）]';
const TIGHT = new RegExp(`<(a|b|code)(\\s[^>]*)?>([^<]*)</\\1>\\s*(?=${PUNCT})`, 'g');

/** A message that contains tags (<b>, <a>, <code>). The text comes from the server's own catalogue. */
export function Html({ as = 'span', html, className }: { as?: string; html: string; className?: string }): ReactNode {
  return createElement(as, { className, dangerouslySetInnerHTML: { __html: html.replace(TIGHT, '<$1$2 data-tight>$3</$1>') } });
}
