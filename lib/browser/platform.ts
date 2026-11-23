import { useEffect, useState } from 'react';
import { browser } from 'wxt/browser';

/**
 * Whether this is Firefox for Android (#70).
 *
 * Some of what the settings say is a fact about the desktop browser: that the
 * settings sync between devices (`storage.sync` does not sync on Firefox for
 * Android, where it behaves as local storage), that the browser zooms with
 * Ctrl and +, that the extension has a toolbar button. Where the wording
 * depends on it, the Reader says what is true on the device it is running on.
 *
 * `runtime.getPlatformInfo()` is the extension's own answer and is what
 * decides. It is asynchronous, so the first render goes by the user agent,
 * which says "Android" on every Firefox for Android; the answer then confirms
 * or corrects it. Outside an extension there is no runtime, and the user agent
 * is all there is.
 */
export function guessAndroidFromUserAgent(userAgent = globalThis.navigator?.userAgent ?? ''): boolean {
  return /\bAndroid\b/.test(userAgent);
}

interface RuntimeApi {
  getPlatformInfo?(): Promise<{ os: string }>;
}

let answer: Promise<boolean> | null = null;

export function isAndroid(): Promise<boolean> {
  answer ??= (async () => {
    const runtime = (browser as unknown as { runtime?: RuntimeApi } | undefined)?.runtime;
    if (!runtime?.getPlatformInfo) return guessAndroidFromUserAgent();
    try {
      return (await runtime.getPlatformInfo()).os === 'android';
    } catch {
      return guessAndroidFromUserAgent();
    }
  })();
  return answer;
}

/** For tests, which hand over a different browser each time. */
export function forgetPlatform(): void {
  answer = null;
}

export function useIsAndroid(): boolean {
  const [android, setAndroid] = useState(guessAndroidFromUserAgent);
  useEffect(() => {
    let cancelled = false;
    void isAndroid().then((value) => {
      if (!cancelled) setAndroid(value);
    });
    return () => {
      cancelled = true;
    };
  }, []);
  return android;
}
