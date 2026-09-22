import { ChromeAiOcrProvider } from './chrome-ai-provider';
import { LocalOcrProvider } from './local-provider';
import { MockOcrProvider } from './mock-provider';
import type { OcrProvider } from './provider';

/**
 * Where OCR providers are registered.
 *
 * A future `HostedOcrProvider` (Azure AI Document Intelligence, Google Document
 * AI, AWS Textract, …) is added here and nowhere else. Because
 * `sendsDataExternally` is part of the interface, the Reader can enforce the
 * consent requirement for any such provider without knowing which one it is —
 * see `requiresConsent`.
 */
const providers: OcrProvider[] = [
  // On-device first: it transmits nothing, so it needs no consent gate.
  new ChromeAiOcrProvider(),
  new LocalOcrProvider(),
  new MockOcrProvider(),
];

export function listOcrProviders(): readonly OcrProvider[] {
  return providers;
}

export async function listAvailableOcrProviders(
  options: { languages?: string[] } = {},
): Promise<OcrProvider[]> {
  const availability = await Promise.all(
    providers.map(async (provider) => [provider, await provider.isAvailable(options)] as const),
  );
  return availability.filter(([, available]) => available).map(([provider]) => provider);
}

export function getOcrProvider(id: string): OcrProvider | undefined {
  return providers.find((provider) => provider.id === id);
}

/**
 * True when running this provider would transmit document content off the
 * device. The Reader must show an explicit explanation and obtain consent
 * before such a provider runs. No provider in this build returns true.
 */
export function requiresConsent(provider: OcrProvider): boolean {
  return provider.sendsDataExternally;
}

/* The consent sentence lives in the message catalogue when a provider that
 * needs it ships. No bundled provider does, so there is nothing to translate
 * yet — and a sentence waiting in a constant is how one language ships by
 * accident. */
