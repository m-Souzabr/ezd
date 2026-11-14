import {
  type ComponentProps,
  type FocusEvent,
  lazy,
  type PointerEvent,
  Suspense,
  useEffect,
  useRef,
  useState,
} from 'react';

import { Button } from '@/components/ui/button';

const HintPopup = lazy(() => import('./HintPopup'));

type HintProps = { hint?: string | undefined; shortcut?: string | undefined };

/** How long the pointer rests on a button before its hint shows. */
const HINT_DELAY_MS = 400;

/**
 * A button with its label always visible and, on a pointer that hovers or a keyboard focus, a
 * tooltip with what it does and its shortcut. The tooltip never holds the only name, so a touch
 * screen loses nothing. It loads on first use and sits beside the button, which is never swapped.
 */
export function HintButton({
  hint,
  shortcut,
  ...props
}: ComponentProps<typeof Button> & HintProps) {
  const anchor = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const [armed, setArmed] = useState(false);
  const timer = useRef<number | undefined>(undefined);
  const hide = () => {
    window.clearTimeout(timer.current);
    setOpen(false);
  };
  const show = (delay: number) => {
    window.clearTimeout(timer.current);
    setArmed(true);
    timer.current = window.setTimeout(() => setOpen(true), delay);
  };
  useEffect(() => () => window.clearTimeout(timer.current), []);

  const hinted = Boolean(hint || shortcut);
  return (
    <>
      <Button
        ref={anchor}
        {...props}
        {...(hinted && {
          onPointerEnter: (event: PointerEvent<HTMLButtonElement>) => {
            if (event.pointerType === 'mouse') show(HINT_DELAY_MS);
          },
          onPointerLeave: hide,
          onPointerDown: hide,
          onFocus: (event: FocusEvent<HTMLButtonElement>) => {
            if (event.currentTarget.matches(':focus-visible')) show(0);
          },
          onBlur: hide,
        })}
      />
      {armed && (
        <Suspense fallback={null}>
          <HintPopup open={open} anchor={anchor} hint={hint} shortcut={shortcut} />
        </Suspense>
      )}
    </>
  );
}

export type Choice<T extends string> = {
  value: T;
  label: string;
  /** The accessible name, when it says more than the label. */
  name?: string;
  hint?: string;
  shortcut?: string;
};

/**
 * One choice out of several, as a row of buttons: a radio group. In the toolbar its buttons are
 * reached with the arrow keys like the rest of the toolbar (`useRovingFocus`), and Space or
 * Enter chooses.
 */
export function ChoiceGroup<T extends string>({
  label,
  value,
  choices,
  onChange,
  className,
}: {
  label: string;
  value: T;
  choices: readonly Choice<T>[];
  onChange(value: T): void;
  className?: string;
}) {
  return (
    <div role="radiogroup" aria-label={label} className={className ?? 'flex gap-1'}>
      {choices.map((choice) => {
        const selected = choice.value === value;
        return (
          <HintButton
            key={choice.value}
            role="radio"
            aria-checked={selected}
            aria-label={choice.name}
            variant={selected ? 'default' : 'outline'}
            size="sm"
            hint={choice.hint}
            shortcut={choice.shortcut}
            onClick={() => onChange(choice.value)}
          >
            {choice.label}
          </HintButton>
        );
      })}
    </div>
  );
}
