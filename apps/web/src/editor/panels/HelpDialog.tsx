import { Dialog } from 'radix-ui';
import type { ReactNode } from 'react';

import { useConfig } from '../../config/useConfig';
import { BUTTON } from './fields';

/** A short guide to a first design, from the toolbar. */
export function HelpDialog({ trigger }: { trigger: ReactNode }) {
  const steps = useConfig().help.steps;
  return (
    <Dialog.Root>
      <Dialog.Trigger asChild>{trigger}</Dialog.Trigger>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-slate-900/40" />
        <Dialog.Content className="fixed top-1/2 left-1/2 z-50 max-h-[85vh] w-[32rem] max-w-[calc(100vw-2rem)] -translate-x-1/2 -translate-y-1/2 overflow-y-auto rounded-lg bg-white p-5 shadow-xl">
          <Dialog.Title className="text-base font-semibold text-slate-900">
            Your first design
          </Dialog.Title>
          <Dialog.Description className="mt-1 text-sm text-slate-600">
            From an empty room to a quote. Every change can be undone.
          </Dialog.Description>
          <ol className="mt-4 flex flex-col gap-3">
            {steps.map((step, i) => (
              <li key={step.title} className="flex gap-3 text-sm">
                <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-sky-100 font-semibold text-sky-900">
                  {i + 1}
                </span>
                <span>
                  <strong className="text-slate-900">{step.title}.</strong>{' '}
                  <span className="text-slate-700">{step.text}</span>
                </span>
              </li>
            ))}
          </ol>
          <p className="mt-4 rounded bg-amber-50 p-3 text-xs text-amber-950">
            The checks are design guidance, not building-code compliance. Check local codes and the
            manufacturers&apos; instructions before anything is built.
          </p>
          <div className="mt-4 flex justify-end">
            <Dialog.Close asChild>
              <button type="button" className={BUTTON}>
                Close
              </button>
            </Dialog.Close>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
