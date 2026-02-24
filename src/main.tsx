import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { ThemeProvider } from './context/ThemeContext';
import { FileLibraryProvider } from './context/FileLibraryContext';
import { PolicyProvider } from './context/PolicyContext';
import { AuditProvider } from './context/AuditContext';
import App from './App';
import './index.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
      <ThemeProvider>
        <FileLibraryProvider>
          <PolicyProvider>
            <AuditProvider>
              <App />
            </AuditProvider>
          </PolicyProvider>
        </FileLibraryProvider>
      </ThemeProvider>
    </BrowserRouter>
  </StrictMode>,
);
