import { Dialog } from 'radix-ui';
import type { ReactNode } from 'react';

import { BUTTON } from '../editor/panels/fields';

/** A dialog the caller opens and closes: a title, a description, and the content. */
export function Modal({
  open,
  onOpenChange,
  title,
  description,
  children,
  width = 'w-[32rem]',
}: {
  open: boolean;
  onOpenChange(open: boolean): void;
  title: string;
  description?: string;
  children: ReactNode;
  width?: string;
}) {
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-slate-900/40" />
        <Dialog.Content
          className={`fixed top-1/2 left-1/2 z-50 flex max-h-[85vh] max-w-[95vw] -translate-x-1/2 -translate-y-1/2 flex-col overflow-y-auto rounded-lg bg-white p-5 shadow-xl ${width}`}
          {...(description === undefined && { 'aria-describedby': undefined })}
        >
          <Dialog.Title className="text-base font-semibold text-slate-900">{title}</Dialog.Title>
          {description !== undefined && (
            <Dialog.Description className="mt-1 text-sm text-slate-600">
              {description}
            </Dialog.Description>
          )}
          <div className="mt-4 flex flex-col gap-4">{children}</div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

export function CloseButton({ label = 'Close' }: { label?: string }) {
  return (
    <Dialog.Close asChild>
      <button type="button" className={BUTTON}>
        {label}
      </button>
    </Dialog.Close>
  );
}
