import { useEffect, useState } from 'react';
import { isPdfHandlerEnabled } from '../browser/pdf-handler';

/**
 * Whether PDFs are currently being sent to the Reader.
 *
 * The Reader needs this for one sentence: while the setting is on, its own link
 * to the original PDF opens the Reader again, and someone who cannot see the
 * new tab has no way to tell that from a link that did nothing.
 *
 * **Asked again whenever this document regains focus**, because the setting
 * lives in the side panel — a separate document, beside this one, with no
 * storage event to listen for since the state belongs to the browser rather
 * than to `readerSettings`. Focus is the right signal and not a guess: the link
 * cannot be activated without focus being in this document first, so an answer
 * refreshed on focus is an answer that was true the last moment it could have
 * been acted on.
 *
 * Starts false, which is the extension's default and the state of every browser
 * that has no such setting. A label that appears a moment after the toolbar is
 * better than one that has to be taken back.
 */
export function usePdfHandlerEnabled(): boolean {
  const [enabled, setEnabled] = useState(false);

  useEffect(() => {
    let cancelled = false;

    const ask = () => {
      void isPdfHandlerEnabled().then((value) => {
        if (!cancelled) setEnabled(value);
      });
    };

    ask();
    window.addEventListener('focus', ask);
    return () => {
      cancelled = true;
      window.removeEventListener('focus', ask);
    };
  }, []);

  return enabled;
}
