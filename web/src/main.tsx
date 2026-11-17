import { createRoot } from 'react-dom/client';
import { MotionConfig } from 'motion/react';
import { AnimateUIProvider } from '@animate-ui/react/provider';
import './index.css';
import { NONCE } from './lib/boot';
import { App } from './app/App';
import { start } from './app/store';

// The page is served under a Content-Security-Policy that only accepts styles carrying the
// nonce of this response. Motion and Radix add a style tag now and then: both take the nonce.
(window as unknown as { __webpack_nonce__?: string }).__webpack_nonce__ = NONCE;

createRoot(document.getElementById('root')!).render(
  <MotionConfig nonce={NONCE}>
    <AnimateUIProvider>
      <App />
    </AnimateUIProvider>
  </MotionConfig>,
);
start();
