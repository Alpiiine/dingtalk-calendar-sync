import type { ReactNode } from 'react';
import { cn } from '../lib/cn';

export type Level = 'ok' | 'warn' | 'error' | 'info';

/** Each level has its own mark as well as its own colour, so it never rests on colour alone. */
export const LEVEL: Record<Level, { row: string; icon: string; mark: string }> = {
  ok: { row: 'bg-ok-soft', icon: 'text-ok', mark: '✓' },
  error: { row: 'bg-bad-soft', icon: 'text-bad', mark: '×' },
  warn: { row: 'bg-warn-soft', icon: 'text-warn', mark: '!' },
  info: { row: 'bg-accent-soft', icon: 'text-accent', mark: 'i' },
};

/** A marked line: "✓ DingTalk works". */
export function NoticeLine({ level, children }: { level: Level; children: ReactNode }) {
  return (
    <span className="flex min-w-0 gap-2.5 break-words">
      <span aria-hidden className={cn('w-[1ch] shrink-0 text-center font-semibold', LEVEL[level].icon)}>{LEVEL[level].mark}</span>
      <span className="min-w-0">{children}</span>
    </span>
  );
}

/** One tinted box that reports how something went. */
export function Notice({ level, children, className }: { level: Level; children: ReactNode; className?: string }) {
  return <div className={cn('rounded-box px-3 py-2.5', LEVEL[level].row, className)}><NoticeLine level={level}>{children}</NoticeLine></div>;
}
