// @vitest-environment node
import { describe, expect, it } from 'vitest';
import config from '../wxt.config';
import { MINIMUM_FIREFOX_VERSION } from '../lib/browser/minimum-versions';

/**
 * The parts of the manifest a store reads to decide where the extension is
 * offered. A key missing here is not a build error; it is an extension the
 * store quietly does not list.
 */
type ManifestFn = (env: { browser: string }) => Record<string, unknown>;

function manifestFor(browser: string): Record<string, any> {
  return (config.manifest as unknown as ManifestFn)({ browser }) as Record<string, any>;
}

describe('the Firefox manifest', () => {
  const settings = manifestFor('firefox').browser_specific_settings;

  /** Firefox Add-ons offers a version to Android only with this key (#72). */
  it('declares Firefox for Android, with the same floor as the desktop', () => {
    expect(settings.gecko_android).toEqual({ strict_min_version: `${MINIMUM_FIREFOX_VERSION}.0` });
    expect(settings.gecko.strict_min_version).toBe(`${MINIMUM_FIREFOX_VERSION}.0`);
  });

  it('is not in the Chrome manifest', () => {
    expect(manifestFor('chrome').browser_specific_settings).toBeUndefined();
  });
});
