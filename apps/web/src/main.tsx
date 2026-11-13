import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router';

import { ApiError } from './api/client';
import { App } from './App';
import { CatalogProvider } from './catalog/CatalogProvider';
import { ConfigProvider } from './config/ConfigProvider';
import { ErrorBoundary } from './ErrorBoundary';
import { reportError } from './lib/reportError';
import './index.css';

const root = document.getElementById('root');
if (!root) throw new Error('Missing #root element');

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // An answer from the server, such as a 404, is final. Only a lost connection is retried.
      retry: (failures, error) => !(error instanceof ApiError) && failures < 2,
      refetchOnWindowFocus: false,
    },
  },
});

window.addEventListener('error', (event) => reportError(event.error, { where: 'window' }));
window.addEventListener('unhandledrejection', (event) =>
  reportError(event.reason, { where: 'promise' }),
);

createRoot(root).render(
  <StrictMode>
    <ErrorBoundary>
      <QueryClientProvider client={queryClient}>
        <ConfigProvider>
          <CatalogProvider>
            <BrowserRouter>
              <App />
            </BrowserRouter>
          </CatalogProvider>
        </ConfigProvider>
      </QueryClientProvider>
    </ErrorBoundary>
  </StrictMode>,
);
