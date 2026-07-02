import { BrowserExtensionProvider } from './browser-extension.provider';

describe('BrowserExtensionProvider (T8.3 Phase 2 stub)', () => {
  it('rejects with a not-implemented error (does not silently return empty)', async () => {
    const provider = new BrowserExtensionProvider();
    await expect(
      provider.fetch([{ normalizedText: 'coffee', keyword: 'coffee', geo: 'US', language: 'en' }]),
    ).rejects.toThrow(/Phase 2 stub/);
  });
});
