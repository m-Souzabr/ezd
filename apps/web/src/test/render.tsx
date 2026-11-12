import { render } from '@testing-library/react';
import type { ReactElement } from 'react';

import { DesignStoreProvider } from '../store/context';
import type { DesignStoreApi } from '../store/designStore';

/** Renders a panel on the given store. */
export const renderWithStore = (ui: ReactElement, store: DesignStoreApi) =>
  render(<DesignStoreProvider store={store}>{ui}</DesignStoreProvider>);
