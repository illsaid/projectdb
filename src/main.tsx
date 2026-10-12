import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { registerSW } from 'virtual:pwa-register';
import App from './App.tsx';
import { ErrorBoundary } from '@/components/ErrorBoundary';
import './fonts.css';
import './index.css';

registerSW({ immediate: true });

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ErrorBoundary>{(recovered) => <App resumeAudio={recovered} />}</ErrorBoundary>
  </StrictMode>
);
