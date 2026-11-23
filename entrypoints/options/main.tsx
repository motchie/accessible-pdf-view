import { StrictMode } from 'react';
import { createRoot } from '../../lib/reader/create-root';
import App from '../sidepanel/App';
import '../reader/reader.css';
import '../sidepanel/sidepanel.css';
import './options.css';

/**
 * The settings, as the extension's options page (#68).
 *
 * The same panel as the side panel, not a second one: one set of controls, one
 * set of tests, and a change made here reaches every open Reader the same way —
 * through storage, which the Reader is watching.
 *
 * It exists because Firefox for Android has no sidebar. Without it the settings
 * could not be reached there at all — not from the Reader, and not from the
 * browser's add-ons manager, which offers a settings entry only to an extension
 * that declares an options page. Desktop browsers keep the side panel as the
 * Reader's way in (`lib/browser/side-panel.ts`), and gain this as the entry in
 * their own extensions page.
 */
const root = document.getElementById('root');
if (root) createRoot(root).render(<StrictMode><App /></StrictMode>);
