import type { ReactNode } from 'react';
import type { HTMLMotionProps } from 'motion/react';
import { Button as Press } from '@animate-ui/react/primitives/buttons/button';
import { cn } from '../lib/cn';
import { Spinner, SwapText } from './motion';

type Variant = 'primary' | 'solid' | 'outline' | 'ghost' | 'text' | 'danger' | 'destroy';
type Size = 'md' | 'sm';

const BASE = 'inline-flex items-center justify-center gap-1.5 rounded-ctl border font-medium select-none transition-[background-color,border-color,color,box-shadow,translate] duration-150 disabled:pointer-events-none disabled:opacity-55';
const VARIANT: Record<Variant, string> = {
  // A solid button is lit from above: a faint gradient, a highlight on its top edge, a short shadow.
  // Under the pointer it darkens a shade and rises a pixel onto a longer shadow.
  primary: 'bg-accent bg-linear-to-b from-white/10 to-white/0 border-accent-deep/70 text-on-accent shadow-primary hover:bg-accent-deep hover:shadow-primary-hover hover:-translate-y-px',
  // The way forward inside a section ("Save and test", "Continue"): flat dark slate. The accent
  // above is kept for the one action of the whole page, "Sync now".
  solid: 'bg-ink border-transparent text-surface shadow-[0_1px_2px_rgba(15,23,42,.16)] hover:bg-ink/88',
  outline: 'bg-surface border-rim text-ink shadow-ctl hover:bg-sunken hover:border-edge/70',
  // A control that waits at the edge of the page: no surface until the pointer is on it.
  ghost: 'bg-transparent border-transparent text-muted hover:bg-tint hover:text-ink',
  text: 'bg-transparent border-transparent text-muted underline underline-offset-[.15em] hover:bg-tint hover:text-ink',
  // Deleting is offered quietly: crimson text on white, a faint red outline, and more only under the pointer.
  danger: 'bg-surface border-bad/25 text-bad shadow-ctl hover:bg-bad-soft hover:border-bad/45',
  // The last press before something is deleted: solid, so it cannot be taken for "Cancel".
  destroy: 'bg-bad bg-linear-to-b from-white/10 to-white/0 border-bad text-surface shadow-primary hover:brightness-95 hover:-translate-y-px',
};
// A finger needs 44px; a mouse does not, and the page reads tighter without it.
const SIZE: Record<Size, string> = { md: 'min-h-11 px-4 py-2 pointer-fine:min-h-8 pointer-fine:px-3 pointer-fine:py-1 pointer-fine:text-sm', sm: 'min-h-9 px-3 py-1 text-sm pointer-fine:min-h-7 pointer-fine:px-2.5 pointer-fine:py-0.5' };
/** How far a button gives way under a press. */
export const PRESS = 0.99;

export const buttonClass = (variant: Variant = 'outline', size: Size = 'md', className?: string) =>
  cn(BASE, VARIANT[variant], SIZE[size], variant === 'text' && 'px-1.5', className);

export type ButtonProps = Omit<HTMLMotionProps<'button'>, 'children'> & { variant?: Variant; size?: Size; children?: ReactNode };

/** Animate UI's button: it presses down on a spring. */
export function Button({ variant, size, className, type = 'button', children, ...props }: ButtonProps) {
  return <Press type={type} tapScale={PRESS} className={buttonClass(variant, size, className)} {...props}>{children}</Press>;
}

/**
 * A button that reports on its own action: while `busy` it is disabled, shows a spinner and
 * `busyLabel`. The label swaps in place and the button keeps the width of the longer one.
 * An `icon` stands in front of the label, and the spinner takes its place while busy.
 */
export function StatusButton({ label, busyLabel, busy, disabled, icon, ...props }: ButtonProps & { label: string; busyLabel?: string; busy?: boolean; icon?: ReactNode }) {
  const labels = busyLabel && busyLabel !== label ? [label, busyLabel] : [label];
  return (
    <Button {...props} disabled={busy || disabled} aria-busy={busy || undefined} aria-live="polite">
      {icon ? <span aria-hidden className="grid size-3.5 shrink-0 place-items-center">{busy ? <Spinner /> : icon}</span> : busy && <Spinner />}
      <SwapText text={busy ? busyLabel || label : label} reserve={labels} />
    </Button>
  );
}
