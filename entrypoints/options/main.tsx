import { StrictMode } from 'react';
import {
  forgetSettingsTab,
  rememberSettingsTab,
  returnToTab,
} from '../../lib/browser/side-panel';
import { createRoot } from '../../lib/reader/create-root';
// The same settings surface as the side panel: one panel, two ways to reach it.
import App from '../sidepanel/App';
import '../reader/reader.css';
import '../sidepanel/sidepanel.css';

// So the Reader's Settings button brings this tab back rather than opening
// another (#68). Best effort: without session storage, a new tab is opened.
void rememberSettingsTab().catch(() => {});
addEventListener('pagehide', () => void forgetSettingsTab().catch(() => {}));

const root = document.getElementById('root');
if (root) {
  createRoot(root).render(
    <StrictMode>
      <App returnTo={returnToTab(location.search)} />
    </StrictMode>,
  );
}
