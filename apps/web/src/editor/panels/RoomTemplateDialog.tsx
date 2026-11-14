import { lazy, type ReactElement } from 'react';

import { LazyDialog } from './LazyDialog';

const Body = lazy(() =>
  import('./RoomTemplateDialogBody').then((m) => ({ default: m.RoomTemplateDialogBody })),
);

/** Makes a rectangle, L or U room from typed dimensions, as one `batch`. */
export function RoomTemplateDialog({ trigger }: { trigger: ReactElement }) {
  return <LazyDialog trigger={trigger} body={Body} props={{}} />;
}
