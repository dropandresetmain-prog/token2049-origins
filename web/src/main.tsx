import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './styles/console.css';

// Placeholder; the app shell lands in web/src/ui/App.tsx.
createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <p>Capsule</p>
  </StrictMode>,
);
