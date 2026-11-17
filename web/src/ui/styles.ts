/** The surface every section sits on: white, a hairline, two soft shadows. */
export const CARD = 'rounded-card border border-line bg-surface shadow-card';
/** How sections arrive (Animate UI's Effect): a fade and a short rise. */
export const ARRIVE = { fade: true, slide: { offset: 8 } } as const;
/** A fold that sits inside a step: a rule down its side, not another box. */
export const ASIDE = 'border-s border-rim ps-3.5';
/** Instructions for another app: a pale box, so they read apart from this page's own fields. */
export const MANUAL = 'manual rounded-box border border-line bg-sunken/70 text-sm leading-[1.6]';
/** The numbered list inside it. */
export const MANUAL_LIST = 'grid list-decimal gap-1.5 ps-[1.35rem] marker:font-medium marker:text-muted';
