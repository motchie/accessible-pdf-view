import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
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
 * container's own `addEventListener` inside `createRoot`, and it assigns
 * `onclick` itself. These tests are what notices when an update to React
 * changes either.
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
  it('adds no click, mousedown or mouseup listener to the container', () => {
    render();
    for (const type of CLICK_EVENTS) expect(addedTo(container)).not.toContain(type);
  });

  it('keeps React’s other delegated listeners on the container', () => {
    render();
    expect(addedTo(container)).toContain('keydown');
    expect(addedTo(document)).not.toContain('keydown');
  });

  it('gives the container its ordinary addEventListener back', () => {
    render();
    expect(Object.hasOwn(container, 'addEventListener')).toBe(false);
    const listener = vi.fn();
    container.addEventListener('click', listener);
    document.body.click();
    expect(listener).not.toHaveBeenCalled();
    container.querySelector('button')!.click();
    expect(listener).toHaveBeenCalledOnce();
  });

  it('leaves the container without an onclick', () => {
    render();
    expect(container.onclick).toBeUndefined();
    expect(container.hasAttribute('onclick')).toBe(false);
  });

  it('refuses a real onclick, so the page cannot quietly become clickable', () => {
    render();
    expect(() => {
      container.onclick = () => console.log('clicked');
    }).toThrow(/#33/);
    expect(container.onclick).toBeUndefined();
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

  it('still runs React keyboard handlers, which stay on the container', () => {
    const onKeyDown = vi.fn();
    root = createRoot(container);
    act(() => root!.render(<input aria-label="Field" onKeyDown={onKeyDown} />));
    container
      .querySelector('input')!
      .dispatchEvent(new KeyboardEvent('keydown', { key: 'a', bubbles: true }));
    expect(onKeyDown).toHaveBeenCalledOnce();
  });

  /*
   * React gives a portal's container the same listeners as a root's, and
   * this helper does not reach it: a portal into `document.body` would
   * expose the whole page as clickable again. When one is needed, give it a
   * container that is not an ancestor of the Reader's content, or extend the
   * helper, and change this test with it.
   */
  it('has no portal to cover: nothing in the extension calls createPortal', () => {
    const callers = sourceFiles(['lib', 'entrypoints']).filter((file) =>
      /\bcreatePortal\s*\(|import[^;]*\bcreatePortal\b/.test(readFileSync(file, 'utf8')),
    );
    expect(callers).toEqual([]);
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

function sourceFiles(directories: string[]): string[] {
  const files: string[] = [];
  const walk = (directory: string) => {
    for (const name of readdirSync(directory)) {
      const path = join(directory, name);
      if (statSync(path).isDirectory()) walk(path);
      else if (/\.(ts|tsx)$/.test(name)) files.push(path);
    }
  };
  for (const directory of directories) walk(directory);
  return files;
}
