import { createContext, type ReactNode, useContext, useEffect } from 'react';
import { useStore } from 'zustand';

import { registerRecoverySource } from '../lib/recovery';
import type { DesignStore, DesignStoreApi } from './designStore';

const DesignStoreContext = createContext<DesignStoreApi | null>(null);

export function DesignStoreProvider({
  store,
  children,
}: {
  store: DesignStoreApi;
  children: ReactNode;
}) {
  // The error boundary offers this design for download if the editor crashes.
  useEffect(() => registerRecoverySource(() => store.getState().doc), [store]);
  return <DesignStoreContext.Provider value={store}>{children}</DesignStoreContext.Provider>;
}

/** The store itself, for event handlers that read the latest state. */
// eslint-disable-next-line react-refresh/only-export-components
export function useDesignStore(): DesignStoreApi {
  const store = useContext(DesignStoreContext);
  if (!store) throw new Error('No design store: wrap the editor in DesignStoreProvider');
  return store;
}

/** A slice of the store. The component renders again when the slice changes. */
// eslint-disable-next-line react-refresh/only-export-components
export function useDesign<T>(selector: (state: DesignStore) => T): T {
  return useStore(useDesignStore(), selector);
}
