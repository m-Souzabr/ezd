import { type ComponentProps, lazy, type ReactElement } from 'react';

import { LazyDialog } from './LazyDialog';

const Body = lazy(() =>
  import('./VersionsDialogBody').then((m) => ({ default: m.VersionsDialogBody })),
);

/**
 * The saved versions of a design, from a trigger: save the current draft as a new one, look at
 * an old one, or restore it.
 */
export function VersionsDialog({
  trigger,
  ...props
}: { trigger: ReactElement } & Omit<ComponentProps<typeof Body>, 'open' | 'onOpenChange'>) {
  return <LazyDialog trigger={trigger} body={Body} props={props} />;
}
