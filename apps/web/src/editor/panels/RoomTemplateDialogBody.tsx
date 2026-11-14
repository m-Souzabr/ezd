import { type Len, parseLength } from '@ezd/core';
import { type FormEvent, useId, useState } from 'react';

import { ResponsiveDialog } from '@/components/patterns/responsive-dialog';
import { Button } from '@/components/ui/button';
import { FieldError } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { NativeSelect } from '@/components/ui/native-select';
import { useDesignStore } from '../../store/context';
import { fitView } from '../../store/selectors';
import { newId } from '../ids';
import { ROOM_SHAPES, roomCommand, type RoomDimensions, type RoomShape } from '../tools/wall';
import { Field } from './fields';

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

/** Makes a rectangle, L or U room from typed dimensions, as one `batch`. */
export function RoomTemplateDialogBody({
  open,
  onOpenChange: setOpen,
}: {
  open: boolean;
  onOpenChange(open: boolean): void;
}) {
  const store = useDesignStore();
  const id = useId();
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

  const close = () => {
    setOpen(false);
    setErrors({});
  };

  return (
    <>
      <ResponsiveDialog
        open={open}
        onOpenChange={(next) => (next ? setOpen(true) : close())}
        title="Room template"
        description="Dimensions are in inches, measured along the inside of the walls."
        footer={
          <>
            <Button variant="outline" onClick={close}>
              Cancel
            </Button>
            <Button type="submit" form={`${id}-form`}>
              Create room
            </Button>
          </>
        }
      >
        <form id={`${id}-form`} className="flex flex-col gap-3" onSubmit={submit} noValidate>
          <Field label="Shape" htmlFor={`${id}-shape`}>
            <NativeSelect
              id={`${id}-shape`}
              value={shape}
              onChange={(event) => setShape(event.target.value as RoomShape)}
            >
              {ROOM_SHAPES.map((choice) => (
                <option key={choice.shape} value={choice.shape}>
                  {choice.name}
                </option>
              ))}
            </NativeSelect>
          </Field>
          {fields.map(({ key, label }) => (
            <Field
              key={key}
              label={label}
              htmlFor={`${id}-${key}`}
              error={errors[key]}
              errorId={`${id}-${key}-error`}
            >
              <Input
                id={`${id}-${key}`}
                type="text"
                inputMode="decimal"
                value={text[key]}
                aria-invalid={errors[key] !== undefined}
                aria-describedby={errors[key] ? `${id}-${key}-error` : undefined}
                onChange={(event) => setText({ ...text, [key]: event.target.value })}
              />
            </Field>
          ))}
          {errors.form && <FieldError>{errors.form}</FieldError>}
        </form>
      </ResponsiveDialog>
    </>
  );
}
