/**
 * Telling a person's alternative text apart from their word processor's.
 *
 * A Tagged PDF's `/Alt` has always been treated here as the author's own words:
 * authoritative, never replaced, never relabelled. A real document broke that
 * assumption: its only figure carried Microsoft Word's automatic alternative
 * text, disclaimer and all, copied into the PDF verbatim. In English, Word
 * writes
 *
 *     Image containing timeline
 *
 *     AI-generated content may be incorrect.
 *
 * and the document measured here said the same thing in Japanese. The author
 * wrote none of it and may never have read it. Announcing it as theirs is
 * exactly the kind of false attribution this project exists to prevent — and
 * worse than usual, because the text is a bare shape inventory that tells a
 * reader almost nothing.
 *
 * Detection is deliberately narrow: only Microsoft's own boilerplate counts.
 * Guessing "this looks machine-written" from style would eventually demote real
 * author text, which is the more damaging mistake of the two.
 */

/**
 * Microsoft's disclaimers, in the languages this project can check.
 *
 * Two generations of them. The older Office wording appended
 * "Description automatically generated"; the current one appends the AI notice.
 * Both are appended to the description as a separate sentence or paragraph.
 *
 * Every pattern tolerates whitespace, because Word's Japanese output puts a
 * space inside its own phrase. The literals below are the only place in this
 * file where the text itself has to appear — they are what is matched.
 */
const MACHINE_MARKERS: RegExp[] = [
  // Current, AI-era wording.
  /AI\s*生成コンテンツは誤りを含む可能性があります。?/,
  /AI-generated content may be incorrect\.?/i,
  // Older Office wording, which ran on into the description itself.
  /、?\s*自動的に生成された説明/,
  /,?\s*[Dd]escription automatically generated/,
];

export interface AlternativeTextOrigin {
  /** The description with any boilerplate removed. Empty when nothing is left. */
  text: string;
  /** True when the document's own tooling wrote it. */
  machineWritten: boolean;
}

/**
 * Classifies a `/Alt` value, and strips the disclaimer when there is one.
 *
 * The disclaimer is removed rather than read out. It is identical on every
 * image in the document, so a screen reader user would hear the same sentence
 * after every single figure — and the Reader already says the text is
 * machine-written, in its own words, at the point of reading. Only the exact
 * known boilerplate is removed; the description itself is never edited.
 */
export function classifyAlternativeText(raw: string | undefined): AlternativeTextOrigin {
  const alt = raw?.trim() ?? '';
  if (alt === '') return { text: '', machineWritten: false };

  let machineWritten = false;
  let text = alt;
  for (const marker of MACHINE_MARKERS) {
    if (!marker.test(text)) continue;
    machineWritten = true;
    text = text.replace(marker, '');
  }

  return {
    // Collapse the whitespace the removal leaves behind, including the blank
    // line between description and disclaimer.
    text: text.replace(/\s+/g, ' ').trim(),
    machineWritten,
  };
}
