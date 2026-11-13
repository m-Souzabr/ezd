import type { AppConfigInput } from '@ezd/core';
import type { ReactNode } from 'react';

import { ConfigContext } from '../config/useConfig';
import { configWith } from './configWith';

export const WithConfig = ({ input, children }: { input: AppConfigInput; children: ReactNode }) => (
  <ConfigContext.Provider value={configWith(input)}>{children}</ConfigContext.Provider>
);
