import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import { initializeLanguage, I18nProvider } from './i18n';
import { registerAllEngines } from './jobs/registry';
import { registerPwa } from './pwa';
import { initializeTheme, ThemeProvider } from './ui/theme';
import './styles.css';

registerAllEngines();
initializeTheme();
initializeLanguage();
void registerPwa();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ThemeProvider>
      <I18nProvider>
        <App />
      </I18nProvider>
    </ThemeProvider>
  </StrictMode>,
);
