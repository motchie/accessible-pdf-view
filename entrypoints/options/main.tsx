import { StrictMode } from 'react';
import { createRoot } from '../../lib/reader/create-root';
// The same settings surface as the side panel: one panel, two ways to reach it.
import App from '../sidepanel/App';
import '../reader/reader.css';
import '../sidepanel/sidepanel.css';

const root = document.getElementById('root');
if (root) createRoot(root).render(<StrictMode><App /></StrictMode>);
