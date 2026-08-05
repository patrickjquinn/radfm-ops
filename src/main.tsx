import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import App from './App';
import './styles.css';

const qc = new QueryClient({
  defaultOptions: {
    queries: {
      // Never retry a failed source. A retry loop against the D1 REST API or the
      // global Cloudflare API limit turns one failed panel into rate-limiting for
      // the whole dashboard, and "unavailable" is a state we want to see quickly
      // rather than a spinner that hides a broken token for 30 seconds.
      retry: false,
      refetchOnWindowFocus: false
    }
  }
});

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={qc}>
      <App />
    </QueryClientProvider>
  </StrictMode>
);
