import type { ReactNode } from 'react';
import { AlertDialog } from '@animate-ui/react/primitives/radix-ui';
import { Button } from './button';

/** Asks before something that cannot be undone. Animate UI's alert dialog: it grows in, the page dims. */
export function ConfirmDialog({ trigger, title, description, confirm, cancel, onConfirm }: {
  trigger: ReactNode; title: string; description: string; confirm: string; cancel: string; onConfirm: () => void;
}) {
  return (
    <AlertDialog.Root>
      <AlertDialog.Trigger asChild>{trigger}</AlertDialog.Trigger>
      <AlertDialog.Portal>
        <AlertDialog.Overlay className="fixed inset-0 z-50 bg-veil" />
        <AlertDialog.Content className="fixed top-1/2 left-1/2 z-50 grid w-[calc(100%-2rem)] max-w-md -translate-x-1/2 -translate-y-1/2 gap-2 rounded-card border border-line bg-surface p-5 shadow-pop sm:p-6">
          <AlertDialog.Title className="text-base leading-snug font-semibold tracking-[-.02em] zh:tracking-normal">{title}</AlertDialog.Title>
          <AlertDialog.Description className="text-sm text-muted">{description}</AlertDialog.Description>
          <div className="mt-4 flex flex-wrap justify-end gap-2">
            <AlertDialog.Cancel asChild><Button>{cancel}</Button></AlertDialog.Cancel>
            <AlertDialog.Action asChild><Button variant="destroy" onClick={onConfirm}>{confirm}</Button></AlertDialog.Action>
          </div>
        </AlertDialog.Content>
      </AlertDialog.Portal>
    </AlertDialog.Root>
  );
}
