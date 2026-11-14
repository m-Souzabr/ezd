import { lazy, type ReactElement } from 'react';

import { LazyDialog } from './LazyDialog';

const Body = lazy(() => import('./HelpDialogBody').then((m) => ({ default: m.HelpDialogBody })));

/** A short guide to a first design, from the toolbar. */
export function HelpDialog({ trigger }: { trigger: ReactElement }) {
  return <LazyDialog trigger={trigger} body={Body} props={{}} />;
}
