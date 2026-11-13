import { Dialog } from 'radix-ui';
import type { ReactNode } from 'react';

import { BUTTON } from './fields';

const STEPS: { title: string; text: string }[] = [
  {
    title: 'Make the room',
    text: 'Room template makes a rectangle, L or U room from its inside dimensions. Or pick the Wall tool and click each corner; double-click to finish.',
  },
  {
    title: 'Add doors and windows',
    text: 'Pick the Opening tool, choose Door or Window, and click a wall. Change sizes and offsets in the properties on the right.',
  },
  {
    title: 'Place cabinets and appliances',
    text: 'Drag them from the catalog onto a wall; they snap to the wall and to their neighbours. Or select the canvas and use Add, then the arrow keys.',
  },
  {
    title: 'Fix what the checks find',
    text: 'The validation panel lists overlaps, blocked doors, gaps and clearances. Click one to see it; Apply fixes those that have a fix.',
  },
  {
    title: 'Finish and price it',
    text: 'Generate countertops, open Materials for the bill of materials, and create a quote from Quotes.',
  },
];

/** A short guide to a first design, from the toolbar. */
export function HelpDialog({ trigger }: { trigger: ReactNode }) {
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
            Five steps from an empty room to a quote. Every change can be undone.
          </Dialog.Description>
          <ol className="mt-4 flex flex-col gap-3">
            {STEPS.map((step, i) => (
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
