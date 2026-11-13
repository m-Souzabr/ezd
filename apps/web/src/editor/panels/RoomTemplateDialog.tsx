import { type Len, parseLength } from '@ezd/core';
import { Dialog } from 'radix-ui';
import { type FormEvent, type ReactNode, useId, useState } from 'react';

import { useDesignStore } from '../../store/context';
import { fitView } from '../../store/selectors';
import { newId } from '../ids';
import { ROOM_SHAPES, roomCommand, type RoomDimensions, type RoomShape } from '../tools/wall';
import { BUTTON } from './fields';

type FieldKey = keyof RoomDimensions;

const FIELDS: { key: FieldKey; label: string; notch: boolean }[] = [
  { key: 'width', label: 'Width', notch: false },
  { key: 'depth', label: 'Depth', notch: false },
  { key: 'notchWidth', label: 'Cut-out width', notch: true },
  { key: 'notchDepth', label: 'Cut-out depth', notch: true },
];

const DEFAULTS: Record<FieldKey, string> = {
  width: '144',
  depth: '120',
  notchWidth: '48',
  notchDepth: '48',
};

const input =
  'w-full rounded border border-slate-300 bg-white px-2 py-1 text-sm ' +
  'focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-sky-500';

/** Makes a rectangle, L or U room from typed dimensions, as one `batch`. */
export function RoomTemplateDialog({ trigger }: { trigger: ReactNode }) {
  const store = useDesignStore();
  const id = useId();
  const [open, setOpen] = useState(false);
  const [shape, setShape] = useState<RoomShape>('rectangle');
  const [text, setText] = useState(DEFAULTS);
  const [errors, setErrors] = useState<Partial<Record<FieldKey | 'form', string>>>({});
  const fields = FIELDS.filter((field) => shape !== 'rectangle' || !field.notch);

  const submit = (event: FormEvent) => {
    event.preventDefault();
    const found: typeof errors = {};
    const dims: RoomDimensions = { width: 0, depth: 0, notchWidth: 0, notchDepth: 0 };
    for (const { key } of fields) {
      const parsed = parseLength(text[key]);
      if (parsed.ok) dims[key] = parsed.value satisfies Len;
      else found[key] = parsed.error.message;
    }
    if (Object.keys(found).length === 0) {
      const command = roomCommand(shape, dims, newId);
      if (!command.ok) {
        found.form = command.error;
      } else {
        const state = store.getState();
        const executed = state.execute(command.value);
        if (!executed.ok) {
          found.form = executed.error.message;
        } else {
          const { doc, canvasSize } = store.getState();
          state.setView({ kind: 'plan' });
          if (canvasSize) state.setViewport(fitView(doc, { kind: 'plan' }, canvasSize));
          setOpen(false);
        }
      }
    }
    setErrors(found);
  };

  return (
    <Dialog.Root open={open} onOpenChange={setOpen}>
      <Dialog.Trigger asChild>{trigger}</Dialog.Trigger>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-slate-900/40" />
        <Dialog.Content className="fixed top-1/2 left-1/2 z-50 w-80 -translate-x-1/2 -translate-y-1/2 rounded-lg bg-white p-5 shadow-xl">
          <Dialog.Title className="text-base font-semibold text-slate-900">
            Room template
          </Dialog.Title>
          <Dialog.Description className="mt-1 text-sm text-slate-600">
            Dimensions are in inches, measured along the inside of the walls.
          </Dialog.Description>
          <form className="mt-4 flex flex-col gap-3" onSubmit={submit} noValidate>
            <div className="flex flex-col gap-1">
              <label htmlFor={`${id}-shape`} className="text-xs font-medium text-slate-600">
                Shape
              </label>
              <select
                id={`${id}-shape`}
                className={input}
                value={shape}
                onChange={(event) => setShape(event.target.value as RoomShape)}
              >
                {ROOM_SHAPES.map((choice) => (
                  <option key={choice.shape} value={choice.shape}>
                    {choice.name}
                  </option>
                ))}
              </select>
            </div>
            {fields.map(({ key, label }) => (
              <div key={key} className="flex flex-col gap-1">
                <label htmlFor={`${id}-${key}`} className="text-xs font-medium text-slate-600">
                  {label}
                </label>
                <input
                  id={`${id}-${key}`}
                  type="text"
                  inputMode="decimal"
                  className={input}
                  value={text[key]}
                  aria-invalid={errors[key] !== undefined}
                  aria-describedby={errors[key] ? `${id}-${key}-error` : undefined}
                  onChange={(event) => setText({ ...text, [key]: event.target.value })}
                />
                {errors[key] && (
                  <p id={`${id}-${key}-error`} role="alert" className="text-xs text-red-700">
                    {errors[key]}
                  </p>
                )}
              </div>
            ))}
            {errors.form && (
              <p role="alert" className="text-xs text-red-700">
                {errors.form}
              </p>
            )}
            <div className="mt-2 flex justify-end gap-2">
              <Dialog.Close asChild>
                <button type="button" className={BUTTON}>
                  Cancel
                </button>
              </Dialog.Close>
              <button
                type="submit"
                className={`${BUTTON} border-sky-700 bg-sky-700 text-white hover:bg-sky-800`}
              >
                Create room
              </button>
            </div>
          </form>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
