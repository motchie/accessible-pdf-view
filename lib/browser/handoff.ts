/**
 * Moving PDF bytes from the background service worker to the Reader tab.
 *
 * Why not `runtime.sendMessage`: extension messages are JSON-serialised, so an
 * ArrayBuffer does not survive the trip and would have to be base64-encoded —
 * a 33% size increase and a full copy on both sides for what can be multi-
 * megabyte documents.
 *
 * Why the Cache API: it is available in MV3 service workers (unlike
 * `URL.createObjectURL`), it is shared across every context of the extension
 * origin, and it stores a `Response` verbatim. The background worker puts the
 * fetched response in; the Reader takes it out and deletes it.
 */
const CACHE_NAME = 'accessible-pdf-view-handoff-v1';

/** Cache keys must be real URLs. This origin is never contacted — the Cache
 * API only uses the string as a key. */
const KEY_ORIGIN = 'https://handoff.accessible-pdf-view.invalid/';

function keyFor(handoffId: string): string {
  return `${KEY_ORIGIN}${encodeURIComponent(handoffId)}`;
}

export function isHandoffSupported(): boolean {
  return typeof caches !== 'undefined';
}

/** Stores the response body under a fresh id and returns that id. */
export async function putHandoff(handoffId: string, response: Response): Promise<void> {
  const cache = await caches.open(CACHE_NAME);
  await cache.put(new Request(keyFor(handoffId)), response);
}

/** Retrieves and removes the stored bytes. Returns null when the entry is gone
 * — e.g. the user reloaded the Reader tab after the handoff was consumed. */
export async function takeHandoff(handoffId: string): Promise<ArrayBuffer | null> {
  const cache = await caches.open(CACHE_NAME);
  const key = keyFor(handoffId);
  const hit = await cache.match(key);
  if (!hit) return null;

  const bytes = await hit.arrayBuffer();
  await cache.delete(key);
  return bytes;
}

/** Drops every pending handoff. Called on browser startup so PDF bytes never
 * outlive the session that fetched them. */
export async function clearHandoffs(): Promise<void> {
  if (!isHandoffSupported()) return;
  await caches.delete(CACHE_NAME);
}

export function createHandoffId(): string {
  return crypto.randomUUID();
}
