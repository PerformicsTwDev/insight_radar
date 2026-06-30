import { KeywordAnalysisController } from './keyword-analysis.controller';
import type { CreateKeywordAnalysisDto } from './dto/create-keyword-analysis.dto';
import type { CreateAnalysisInput, KeywordAnalysisService } from './keyword-analysis.service';

describe('KeywordAnalysisController (T3.3)', () => {
  let create: jest.MockedFunction<KeywordAnalysisService['create']>;
  let controller: KeywordAnalysisController;

  beforeEach(() => {
    create = jest.fn().mockResolvedValue({ analysisId: 'id-1' });
    controller = new KeywordAnalysisController(
      { create } as unknown as KeywordAnalysisService,
      { forJob: jest.fn() } as unknown as import('../queue/job-events.service').JobEventsService,
    );
  });

  it('applies defaults (mode=expand, includeAdult=false, network=GOOGLE_SEARCH) when omitted', async () => {
    const dto: CreateKeywordAnalysisDto = {
      seeds: ['a'],
      geo: 'geoTargetConstants/2158',
      language: 'languageConstants/1018',
    };

    const result = await controller.create(dto);

    expect(result).toEqual({ analysisId: 'id-1' });
    const input: CreateAnalysisInput = create.mock.calls[0][0];
    expect(input).toEqual({
      seeds: ['a'],
      params: {
        geo: 'geoTargetConstants/2158',
        language: 'languageConstants/1018',
        mode: 'expand',
        includeAdult: false,
        network: 'GOOGLE_SEARCH',
      },
    });
  });

  it('passes through explicit mode/includeAdult/network', async () => {
    const dto: CreateKeywordAnalysisDto = {
      seeds: ['a'],
      geo: 'g',
      language: 'l',
      mode: 'exact',
      includeAdult: true,
      network: 'GOOGLE_SEARCH_AND_PARTNERS',
    };

    await controller.create(dto);

    const input: CreateAnalysisInput = create.mock.calls[0][0];
    expect(input.params).toEqual({
      geo: 'g',
      language: 'l',
      mode: 'exact',
      includeAdult: true,
      network: 'GOOGLE_SEARCH_AND_PARTNERS',
    });
  });
});
