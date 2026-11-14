import type { ReactNode } from 'react';

import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';

// Still used by the Control Panel (Phase 19 moves its dialogs to `ResponsiveDialog` and deletes
// this file). It is the design system's `Dialog` with the old props.

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
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        showCloseButton={false}
        className={`max-h-[85vh] overflow-y-auto sm:max-w-[95vw] ${width}`}
        {...(description === undefined && { 'aria-describedby': undefined })}
      >
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          {description !== undefined && <DialogDescription>{description}</DialogDescription>}
        </DialogHeader>
        <div className="flex flex-col gap-4">{children}</div>
      </DialogContent>
    </Dialog>
  );
}

export function CloseButton({ label = 'Close' }: { label?: string }) {
  return <DialogClose render={<Button variant="outline" />}>{label}</DialogClose>;
}
