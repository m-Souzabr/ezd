import {
  type ComponentType,
  type LazyExoticComponent,
  type ReactElement,
  Suspense,
  useState,
} from 'react';

import { withOpen } from './trigger';

/** What a lazy dialog's body is given: it is controlled, and holds no trigger of its own. */
export type DialogState = { open: boolean; onOpenChange(open: boolean): void };

/**
 * A dialog opened from a trigger, whose body is loaded the first time it is opened and stays
 * mounted after that, so what was typed in it is kept. The dialogs bring the dialog, drawer and
 * form code with them, which the editor does not need until someone asks for one.
 */
export function LazyDialog<P extends object>({
  trigger,
  body: Body,
  props,
}: {
  trigger: ReactElement;
  body: LazyExoticComponent<ComponentType<P & DialogState>>;
  props: P;
}) {
  const [open, setOpen] = useState(false);
  const [wanted, setWanted] = useState(false);
  return (
    <>
      {withOpen(trigger, () => {
        setWanted(true);
        setOpen(true);
      })}
      {wanted && (
        <Suspense fallback={null}>
          <Body {...props} open={open} onOpenChange={setOpen} />
        </Suspense>
      )}
    </>
  );
}
