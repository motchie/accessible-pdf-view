import { storage } from 'wxt/utils/storage';
import { DEFAULT_SETTINGS, type ReaderSettings } from './settings';

/**
 * Where the display settings are kept.
 *
 * Split from `settings.ts` deliberately: `defineItem` runs its migration check
 * eagerly, which touches `browser.runtime` the moment this module is imported.
 * Keeping that in its own file lets the pure mapping be imported anywhere —
 * a unit test, a future non-extension context — without needing a browser.
 *
 * One object rather than five keys, and `sync` rather than `local`: someone who
 * needs 150% text needs it on every machine they use, and setting it again on
 * each one is the friction this exists to remove. Nothing from any document is
 * stored here, which is what makes syncing it unobjectionable.
 */
export const readerSettings = storage.defineItem<ReaderSettings>('sync:apv-settings', {
  fallback: DEFAULT_SETTINGS,
  version: 1,
});
