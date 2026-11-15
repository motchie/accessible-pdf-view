import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { setDocumentLanguage } from '../../lib/i18n/document-language';
import App from './App';
import './reader.css';

// Before React, while the page is still loading: a `lang` changed after load
// is not reflected by the screen reader (#40). App.tsx keeps it in step from
// then on.
setDocumentLanguage();

const container = document.getElementById('root');
if (!container) throw new Error('Reader root element is missing.');

createRoot(container).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
