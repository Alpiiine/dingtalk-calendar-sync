/** Joins class names, skipping the empty ones. */
export const cn = (...parts: Array<string | false | null | undefined>) => parts.filter(Boolean).join(' ');
