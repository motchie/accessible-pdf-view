import { useId, useState, type ChangeEvent, type JSX } from 'react';
import type { PdfErrorMessage } from '../../pdf/errors';
import { useMessages } from '../../i18n';

/** A PDF the reader chose on their own device. */
export interface ChosenFile {
  name: string;
  bytes: ArrayBuffer;
}

/**
 * The errors a chosen file is the answer to (#69).
 *
 * A file the Reader cannot fetch by its address — `file:`, `blob:`, and on
 * Firefox for Android the `content:` address of every downloaded PDF — and a
 * Reader that was given nothing to open at all. Offering a file for any other
 * error would be a wrong diagnosis: a refused fetch is answered by granting the
 * site, and a broken PDF is not fixed by choosing it again.
 */
const ANSWERED_BY_A_FILE: ReadonlySet<PdfErrorMessage> = new Set([
  'file-scheme',
  'blob-scheme',
  'content-scheme',
  'no-source',
  'unsupported-page',
]);

export function isAnsweredByAFile(messageKey: PdfErrorMessage): boolean {
  return ANSWERED_BY_A_FILE.has(messageKey);
}

/**
 * Choosing a PDF on the device.
 *
 * A native file input with a visible label: the platform's own picker is the
 * one a screen reader already knows how to use — on Android, the system's
 * document picker, which offers the Downloads folder. The file is read here,
 * in the Reader's own page, and nothing is sent anywhere; the hint says so
 * because a file picker on a web page usually means an upload.
 */
export function LocalFileChooser({
  onChoose,
}: {
  onChoose: (file: ChosenFile) => void;
}): JSX.Element {
  const m = useMessages();
  const id = useId();
  const hintId = `${id}-hint`;
  const [failure, setFailure] = useState<string | null>(null);

  async function handleChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    setFailure(null);
    try {
      onChoose({ name: file.name, bytes: await file.arrayBuffer() });
    } catch (cause) {
      setFailure(cause instanceof Error ? cause.message : String(cause));
    }
  }

  return (
    <div className="apv-file-chooser">
      <p>
        <label htmlFor={id}>{m.localFile.label}</label>{' '}
        <input
          id={id}
          type="file"
          accept="application/pdf,.pdf"
          aria-describedby={hintId}
          onChange={(event) => void handleChange(event)}
        />
      </p>
      <p id={hintId} className="apv-notice__detail">
        {m.localFile.hint}
      </p>
      {failure ? <p>{m.localFile.readFailed(failure)}</p> : null}
    </div>
  );
}
