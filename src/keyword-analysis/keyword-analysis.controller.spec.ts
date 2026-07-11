import type { AuthenticatedUser } from '../common/authenticated-user';
import { KeywordAnalysisController } from './keyword-analysis.controller';
import type { CreateKeywordAnalysisDto } from './dto/create-keyword-analysis.dto';
import type { CreateAnalysisInput, KeywordAnalysisService } from './keyword-analysis.service';

/** 機器 actor（x-api-key）：controller 只把 request.user 透傳給 service，用機器身分即可。 */
const ACTOR: AuthenticatedUser = { kind: 'apiKey' };

describe('KeywordAnalysisController (T3.3)', () => {
  let create: jest.MockedFunction<KeywordAnalysisService['create']>;
  let controller: KeywordAnalysisController;

  beforeEach(() => {
    create = jest.fn().mockResolvedValue({ analysisId: 'id-1' });
    controller = new KeywordAnalysisController(
      { create } as unknown as KeywordAnalysisService,
      { forJob: jest.fn() } as unknown as import('../queue/job-events.service').JobEventsService,
      { sseHeartbeatMs: 15000 } as unknown as ConstructorParameters<
        typeof KeywordAnalysisController
      >[2],
    );
  });

  it('applies defaults (mode=expand, includeAdult=false, network=GOOGLE_SEARCH) when omitted', async () => {
    const dto: CreateKeywordAnalysisDto = {
      seeds: ['a'],
      geo: 'geoTargetConstants/2158',
      language: 'languageConstants/1018',
    };

    const result = await controller.create(dto, ACTOR);

    expect(result).toEqual({ analysisId: 'id-1' });
    expect(create).toHaveBeenCalledWith(expect.anything(), ACTOR); // actor 透傳（FR-27）
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

    await controller.create(dto, ACTOR);

    const input: CreateAnalysisInput = create.mock.calls[0][0];
    expect(input.params).toEqual({
      geo: 'g',
      language: 'l',
      mode: 'exact',
      includeAdult: true,
      network: 'GOOGLE_SEARCH_AND_PARTNERS',
    });
  });

  it('delegates cancel to the service (DELETE :id, T3.12)', async () => {
    const cancel = jest.fn().mockResolvedValue({ status: 'canceled' });
    const ctrl = new KeywordAnalysisController(
      { cancel } as unknown as KeywordAnalysisService,
      { forJob: jest.fn() } as unknown as import('../queue/job-events.service').JobEventsService,
      { sseHeartbeatMs: 15000 } as unknown as ConstructorParameters<
        typeof KeywordAnalysisController
      >[2],
    );

    expect(await ctrl.cancel('a-1', ACTOR)).toEqual({ status: 'canceled' });
    expect(cancel).toHaveBeenCalledWith('a-1', ACTOR);
  });
});
