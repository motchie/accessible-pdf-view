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
 * - While React's `createRoot` runs, and only then, the container's
 *   `addEventListener` sends click, mousedown and mouseup listeners to the
 *   document. React adds all its root listeners inside that call, so the
 *   override is removed again before anything else can see it. Every other
 *   event React delegates stays on the container. React binds each listener
 *   to the container when it creates it, and it finds the root from that
 *   binding, not from the node the listener sits on, so handlers still run.
 * - `onclick` always reads `undefined`. React assigns its no-op only while
 *   the property reads `null`. Writing an empty function is ignored, which
 *   also covers a React that assigns it unconditionally. Writing anything
 *   else throws, because a real handler there would expose the page as
 *   clickable again.
 *
 * What that changes for the three click events: React's handlers now run
 * from the document, so `stopPropagation()` in a React handler does not stop
 * a native click listener on the document, and a native document listener
 * added before the Reader mounted runs before React's handlers. Nothing in
 * the Reader listens for clicks on the document. A "click outside" handler
 * that needs React to stop it must listen on `window` instead.
 *
 * Portals are not covered. React gives every `createPortal` container the
 * same listeners, so a portal into `document.body` would expose the whole
 * page as clickable again. tests/create-root.test.tsx fails if a portal is
 * added, so that this is dealt with then.
 *
 * Both changes rely on how React 19 attaches to its container.
 * tests/create-root.test.tsx pins that, so a React update that changes it
 * fails there and not silently in Firefox.
 */
export function createRoot(container: HTMLElement): Root {
  const document = container.ownerDocument;
  container.addEventListener = function (
    this: HTMLElement,
    type: string,
    listener: EventListenerOrEventListenerObject | null,
    options?: boolean | AddEventListenerOptions,
  ) {
    const target = CLICK_EVENTS.has(type) ? document : this;
    EventTarget.prototype.addEventListener.call(target, type, listener, options);
  };
  Object.defineProperty(container, 'onclick', {
    configurable: true,
    get: () => undefined,
    set: (value: unknown) => {
      if (value == null || isEmptyFunction(value)) return;
      throw new TypeError(
        'The Reader root cannot take an onclick: Firefox would expose the whole page as clickable (#33).',
      );
    },
  });
  try {
    return createReactRoot(container);
  } finally {
    delete (container as { addEventListener?: unknown }).addEventListener;
  }
}

/** The events that make Firefox expose an element as clickable. */
const CLICK_EVENTS = new Set(['click', 'mousedown', 'mouseup']);

/** React's no-op: a function with no parameters and an empty body. */
function isEmptyFunction(value: unknown): boolean {
  return (
    typeof value === 'function' &&
    value.length === 0 &&
    /^function\s*[\w$]*\s*\(\s*\)\s*\{\s*\}$/.test(Function.prototype.toString.call(value))
  );
}
