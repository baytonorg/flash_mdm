import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router';
import { QueryClientProvider } from '@tanstack/react-query';
import App from './App';
import { BRAND } from './lib/brand';
import { queryClient } from './lib/queryClient';
import './index.css';
import { installOperationalActivity } from './lib/operationalActivity';
import OperationalActivity from './components/common/OperationalActivity';

document.title = BRAND.name;
installOperationalActivity();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <OperationalActivity />
        <App />
      </BrowserRouter>
    </QueryClientProvider>
  </StrictMode>
);
