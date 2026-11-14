import { type ComponentProps, lazy, type ReactElement } from 'react';

import { LazyDialog } from '../editor/panels/LazyDialog';

const Body = lazy(() =>
  import('./QuotesDialogBody').then((m) => ({ default: m.QuotesDialogBody })),
);

/** The quotes of a design, and a form for a new one, from a trigger. */
export function QuotesDialog({
  trigger,
  ...props
}: { trigger: ReactElement } & Omit<ComponentProps<typeof Body>, 'open' | 'onOpenChange'>) {
  return <LazyDialog trigger={trigger} body={Body} props={props} />;
}
