import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { setDocumentLanguage } from '../../lib/i18n/document-language';
import App from './App';
import '../reader/reader.css';
import './sidepanel.css';

// Before React, for the reason given in the Reader's main.tsx (#40).
setDocumentLanguage();

const root = document.getElementById('root');
if (root) createRoot(root).render(<StrictMode><App /></StrictMode>);
