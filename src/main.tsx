// Ensure window.fetch has both getter and setter in iframe environments
try {
  const desc = Object.getOwnPropertyDescriptor(window, 'fetch');
  if (desc && !desc.set) {
    let fn = window.fetch ? window.fetch.bind(window) : null;
    Object.defineProperty(window, 'fetch', {
      configurable: true,
      enumerable: true,
      get: () => fn,
      set: (newFn) => {
        fn = newFn;
      },
    });
  }
} catch (_) {}

import {StrictMode} from 'react';
import {createRoot} from 'react-dom/client';
import App from './App.tsx';
import './index.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
