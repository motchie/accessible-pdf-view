import { act, useState } from 'react';
import type { Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createRoot } from '../lib/reader/create-root';

/**
 * Firefox exposes an element with a click, mousedown or mouseup listener as
 * clickable, and everything under it as having a clickable ancestor (#33).
 * The Reader's container must end up with neither React's listeners nor its
 * no-op `onclick`, and React's handlers must still run.
 *
 * Both halves depend on how React 19 attaches to its container: it calls the
 * container's own `addEventListener`, and it assigns `onclick` itself. These
 * tests are what notices when an update to React changes either.
 */
declare global {
  // eslint-disable-next-line no-var
  var IS_REACT_ACT_ENVIRONMENT: boolean;
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const CLICK_EVENTS = ['click', 'mousedown', 'mouseup'];

let container: HTMLDivElement;
let root: Root | undefined;
let added: { target: EventTarget; type: string }[];

/** The event types of the listeners added to one node. */
function addedTo(target: EventTarget): string[] {
  return added.filter((entry) => entry.target === target).map((entry) => entry.type);
}

beforeEach(() => {
  container = document.createElement('div');
  document.body.append(container);
  added = [];
  // Recorded at the prototype, so a React that bypasses the container's own
  // `addEventListener` is seen too.
  const add = EventTarget.prototype.addEventListener;
  vi.spyOn(EventTarget.prototype, 'addEventListener').mockImplementation(function (
    this: EventTarget,
    type: string,
    ...rest: [EventListenerOrEventListenerObject | null, (boolean | AddEventListenerOptions)?]
  ) {
    added.push({ target: this, type });
    return add.call(this, type, ...rest);
  });
});

afterEach(() => {
  if (root) act(() => root!.unmount());
  root = undefined;
  container.remove();
  vi.restoreAllMocks();
});

function Counter() {
  const [count, setCount] = useState(0);
  return (
    <>
      <h2>Heading</h2>
      <div role="status">Done.</div>
      <button type="button" onClick={() => setCount((n) => n + 1)}>
        Clicked {count}
      </button>
    </>
  );
}

function render() {
  root = createRoot(container);
  act(() => root!.render(<Counter />));
}

describe('createRoot', () => {
  it('adds no listener to the container', () => {
    render();
    expect(addedTo(container)).toEqual([]);
  });

  it('leaves the container without an onclick', () => {
    render();
    expect(container.onclick).toBeUndefined();
    expect(container.hasAttribute('onclick')).toBe(false);
  });

  it('still runs React click handlers', () => {
    render();
    const button = container.querySelector('button')!;
    act(() => button.click());
    act(() => button.click());
    expect(button.textContent).toBe('Clicked 2');
  });

  it('puts React’s click listeners on the document instead', () => {
    render();
    for (const type of CLICK_EVENTS) expect(addedTo(document)).toContain(type);
  });

  /*
   * The reason the helper exists. If a React update stops doing this, the
   * helper may be unnecessary, but it is more likely to have moved the
   * listeners somewhere this helper does not reach: look before removing it.
   */
  it('is needed: React’s own createRoot puts click listeners and onclick on the container', async () => {
    const { createRoot: reactCreateRoot } = await import('react-dom/client');
    root = reactCreateRoot(container);
    act(() => root!.render(<Counter />));
    for (const type of CLICK_EVENTS) expect(addedTo(container)).toContain(type);
    expect(typeof container.onclick).toBe('function');
  });
});
