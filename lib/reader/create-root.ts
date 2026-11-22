import { createRoot as createReactRoot, type Root } from 'react-dom/client';

/**
 * `createRoot`, without exposing the whole page as clickable in Firefox (#33).
 *
 * React puts its delegated listeners on the root container. When an element
 * has a click, mousedown or mouseup listener, Firefox exposes it as
 * clickable and gives everything under it the `clickAncestor` action;
 * TalkBack then reads headings, paragraphs and the status line as "double-tap
 * to activate". Listeners on `document` or `window` do not count.
 *
 * React also gives the container a no-op `onclick`, as a workaround for iOS
 * Safari, and Firefox counts that as a listener too. `createRoot(document)`
 * would avoid both, but it clears `<head>` down to its scripts and
 * stylesheets. The viewport meta and the title go with it. Rendering `<html>`
 * also strips its attributes, `lang` included, and #40 needs `lang` to be set
 * before the body is parsed.
 *
 * So the container stays the element, and two things change on it:
 *
 * - Its `addEventListener` and `removeEventListener` forward to the document,
 *   for every event React delegates and not only the three that matter. That
 *   keeps React's listeners together on one node and in one order. React
 *   binds each listener to the container when it creates it, and it finds the
 *   root from that binding, not from the node the listener sits on. So
 *   handlers still run.
 * - `onclick` always reads `undefined` and ignores writes. React assigns its
 *   no-op only while the property reads `null`, but a setter that does
 *   nothing also covers a later version that assigns it unconditionally.
 *
 * Both rely on how React 19 attaches to its container.
 * tests/create-root.test.tsx pins that, so a React update that changes it
 * fails there and not silently in Firefox.
 */
export function createRoot(container: HTMLElement): Root {
  const target = container.ownerDocument;
  container.addEventListener = target.addEventListener.bind(target);
  container.removeEventListener = target.removeEventListener.bind(target);
  Object.defineProperty(container, 'onclick', {
    configurable: true,
    get: () => undefined,
    set: () => {},
  });
  return createReactRoot(container);
}
