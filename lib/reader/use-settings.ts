import { useCallback, useEffect, useState } from 'react';
import {
  DEFAULT_SETTINGS,
  applySettings,
  withDefaults,
  type ReaderSettings,
} from './settings';
import { readerSettings } from './settings-storage';

/**
 * The reader's display settings, kept in step across contexts.
 *
 * The Reader tab and the settings side panel are two separate documents — a
 * side panel cannot reach into the page it sits beside. Storage is the seam:
 * the panel writes, and `watch` delivers the change to every open Reader. That
 * is also why this hook subscribes rather than reading once.
 */
export function useReaderSettings(): {
  settings: ReaderSettings;
  update: (patch: Partial<ReaderSettings>) => void;
  reset: () => void;
  /** False until the stored value has been read, so a caller can avoid painting
   * the defaults and then repainting a moment later. */
  loaded: boolean;
} {
  const [settings, setSettings] = useState<ReaderSettings>(DEFAULT_SETTINGS);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let cancelled = false;

    void readerSettings.getValue().then((stored) => {
      if (cancelled) return;
      setSettings(withDefaults(stored));
      setLoaded(true);
    });

    const unwatch = readerSettings.watch((next) => {
      if (!cancelled) setSettings(withDefaults(next));
    });

    return () => {
      cancelled = true;
      unwatch();
    };
  }, []);

  const update = useCallback((patch: Partial<ReaderSettings>) => {
    // Applied optimistically so the control responds at once; the write below
    // is what reaches the other context, and `watch` reconciles either way.
    setSettings((previous) => {
      const next = { ...previous, ...patch };
      void readerSettings.setValue(next);
      return next;
    });
  }, []);

  const reset = useCallback(() => {
    setSettings(DEFAULT_SETTINGS);
    void readerSettings.setValue(DEFAULT_SETTINGS);
  }, []);

  return { settings, update, reset, loaded };
}

/** Writes the settings onto this document's root element whenever they change. */
export function useAppliedSettings(settings: ReaderSettings): void {
  useEffect(() => {
    applySettings(document.documentElement, settings);
  }, [settings]);
}
