import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import { registerAllEngines } from './jobs/registry';
import './styles.css';

registerAllEngines();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
