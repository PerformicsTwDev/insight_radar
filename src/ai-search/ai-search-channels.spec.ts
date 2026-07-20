import type { CaptureChannel } from '../captures/dto/capture-ingest.dto';
import {
  EXTENSION_CHANNELS,
  SERPAPI_CHANNELS,
  extensionChannelsOf,
  serpapiChannelsOf,
} from './ai-search-channels';

/** TC-77 部分（T14.6 · FR-41/AC-41.2）：渠道→來源路由（extension primary / serpapi reserved）。 */
describe('TC-77: ai-search channel routing', () => {
  it('partitions the four extension channels from the three serpapi channels', () => {
    expect(EXTENSION_CHANNELS).toEqual(['chatGpt', 'geminiApp', 'googleAiMode', 'googleSearch']);
    expect(SERPAPI_CHANNELS).toEqual(['aiOverview', 'aiMode', 'bingCopilot']);
    // no overlap
    for (const ch of EXTENSION_CHANNELS) {
      expect(SERPAPI_CHANNELS).not.toContain(ch);
    }
  });

  it('extensionChannelsOf keeps only extension channels, preserving order', () => {
    const requested: CaptureChannel[] = ['aiOverview', 'chatGpt', 'aiMode', 'googleSearch'];
    expect(extensionChannelsOf(requested)).toEqual(['chatGpt', 'googleSearch']);
  });

  it('serpapiChannelsOf keeps only serpapi channels, preserving order', () => {
    const requested: CaptureChannel[] = ['aiOverview', 'chatGpt', 'aiMode', 'googleSearch'];
    expect(serpapiChannelsOf(requested)).toEqual(['aiOverview', 'aiMode']);
  });

  it('returns empty arrays when no channel of that source is requested', () => {
    expect(serpapiChannelsOf(['chatGpt', 'googleSearch'])).toEqual([]);
    expect(extensionChannelsOf(['aiOverview'])).toEqual([]);
  });
});
