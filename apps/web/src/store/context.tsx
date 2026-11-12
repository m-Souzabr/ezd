import { createContext, type ReactNode, useContext } from 'react';
import { useStore } from 'zustand';

import type { DesignStore, DesignStoreApi } from './designStore';

const DesignStoreContext = createContext<DesignStoreApi | null>(null);

export function DesignStoreProvider({
  store,
  children,
}: {
  store: DesignStoreApi;
  children: ReactNode;
}) {
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
