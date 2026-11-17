// The few motions that Animate UI has no ready-made part for, written with its tokens and
// recipes: a text swapping in place, a block that opens and folds, a field that shakes.
import { useCallback, useEffect, useRef, type ReactNode } from 'react';
import { AnimatePresence, motion, useAnimate } from 'motion/react';
import { Collapsible } from '@animate-ui/react/primitives/radix-ui';
import { shift, transition, useShouldReduceMotion, useTempoTransition } from '@animate-ui/react/utils/motion';
import { cn } from '../lib/cn';

/**
 * Text that changes in place: a short cross-fade, and no blur, because this is the text people
 * are reading at that moment (a headline, a badge, a button). With "reduce motion" it just changes.
 * `reserve` lists every label it can show, so the box around it keeps the size of the longest.
 * `children`, if given, are what is drawn for `text` (a number set apart from its unit).
 */
export function SwapText({ text, reserve, block, className, children }: { text: string; reserve?: string[]; block?: boolean; className?: string; children?: ReactNode }) {
  const swap = useTempoTransition(transition.swap);
  const reduce = useShouldReduceMotion();
  const label = reduce ? <span className={block ? 'block' : 'inline-block'}>{children ?? text}</span> : (
    <AnimatePresence mode="popLayout" initial={false}>
      <motion.span
        key={text}
        className={block ? 'block' : 'inline-block'}
        initial={{ opacity: 0 }}
        animate={{ opacity: 1, transition: swap }}
        exit={{ opacity: 0, transition: swap }}
      >
        {children ?? text}
      </motion.span>
    </AnimatePresence>
  );
  if (!reserve) return <span className={cn('relative', block ? 'block' : 'inline-block', className)}>{label}</span>;
  return (
    <span className={cn('relative inline-grid place-items-center', className)}>
      {/* Drawn from an attribute, so the page holds each label once: only the one that shows is text. */}
      {reserve.map((l) => <span key={l} aria-hidden data-reserve={l} className="invisible [grid-area:1/1] before:content-[attr(data-reserve)]" />)}
      <span className="[grid-area:1/1]">{label}</span>
    </span>
  );
}

/**
 * A block that pushes the page around when it appears: it opens and folds by height, the way
 * Animate UI's collapsible does. While folding it keeps showing what it showed last.
 */
export function Reveal({ show, children, className, bleed }: { show: boolean; children?: ReactNode; className?: string; bleed?: boolean }) {
  const last = useRef<ReactNode>(null);
  if (show) last.current = children;
  return (
    <Collapsible.Root open={show}>
      {/* The panel clips. The inset keeps what reaches past the edge of the content visible:
          focus rings, and with `bleed` the shadow of a whole card. */}
      <Collapsible.Content className={bleed ? '-mx-4 px-4 -mb-7 pb-7' : '-mx-1 px-1 -mb-1 pb-1'}>
        <div className={className}>{show ? children : last.current}</div>
      </Collapsible.Content>
    </Collapsible.Root>
  );
}

/** A short shake that draws the eye to a rejected field. Runs each time `count` goes up. */
export function useShake<T extends HTMLElement>(count: number | undefined) {
  const [scope, animate] = useAnimate<T>();
  const reduce = useShouldReduceMotion();
  const timing = useTempoTransition(transition.shake);
  const shake = useCallback(() => {
    if (reduce || !scope.current) return;
    const s = shift.shake;
    animate(scope.current, { x: [0, -s, s, -0.66 * s, 0.66 * s, -0.33 * s, 0.33 * s, 0] }, timing);
  }, [reduce, animate, scope, timing]);
  const seen = useRef(count || 0);
  useEffect(() => {
    if ((count || 0) > seen.current) shake();
    seen.current = count || 0;
  }, [count, shake]);
  return scope;
}

export function Spinner() {
  return <span aria-hidden className="size-[.9em] shrink-0 rounded-full border-2 border-current border-e-transparent motion-safe:animate-spin" />;
}
