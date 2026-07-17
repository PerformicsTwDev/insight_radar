import type {
  IntentLabeler,
  ParseChatParams,
  ParseChatResult,
} from '../intent/intent-labeler.port';
import { IdeationGenerationError } from './ideation-generation.error';
import type { IdeationPayload } from './ideation.schema';
import { IDEATION_TEMPLATES } from './ideation.templates';
import { IdeationService, type IdeationConfig } from './ideation.service';

function ok(keywords: string[]): ParseChatResult<IdeationPayload> {
  return { parsed: { keywords }, refusal: null };
}

function build(config: IdeationConfig = { maxKeywords: 50 }): {
  service: IdeationService;
  parseChat: jest.Mock<Promise<ParseChatResult<IdeationPayload>>, [ParseChatParams]>;
} {
  const parseChat = jest.fn<Promise<ParseChatResult<IdeationPayload>>, [ParseChatParams]>();
  const labeler = { parseChat } as unknown as IntentLabeler;
  return { service: new IdeationService(labeler, config), parseChat };
}

function systemContent(params: ParseChatParams): string {
  return params.messages.find((m) => m.role === 'system')?.content ?? '';
}
function userContent(params: ParseChatParams): string {
  return params.messages.find((m) => m.role === 'user')?.content ?? '';
}

describe('IdeationService (T12.10 / FR-35 / AC-35.1 / TC-71 部分)', () => {
  it('AC-35.1: one LLM completion → { keywords }; carries the template directive + seeds', async () => {
    const { service, parseChat } = build();
    parseChat.mockResolvedValue(ok(['吸塵器評比', '掃地機器人 推薦']));

    const out = await service.generate({
      template: 'competitor_comparison',
      seeds: ['吸塵器', '掃地機器人'],
    });

    expect(parseChat).toHaveBeenCalledTimes(1);
    expect(out).toEqual({ keywords: ['吸塵器評比', '掃地機器人 推薦'] });
    // server-controlled directive for the chosen template (not the raw key) reaches the system prompt…
    expect(systemContent(parseChat.mock.calls[0][0])).toContain(
      IDEATION_TEMPLATES.competitor_comparison,
    );
    // …and the seeds reach the user message (as data to expand).
    expect(userContent(parseChat.mock.calls[0][0])).toContain(
      JSON.stringify(['吸塵器', '掃地機器人']),
    );
  });

  it('dedupes by normalizedText (case/whitespace-insensitive), keeping the first original', async () => {
    const { service, parseChat } = build();
    parseChat.mockResolvedValue(ok(['Coffee Maker', 'coffee  maker', 'espresso', 'ESPRESSO']));
    const out = await service.generate({ template: 'related_concepts', seeds: ['coffee'] });
    expect(out.keywords).toEqual(['Coffee Maker', 'espresso']);
  });

  it('drops blank keywords and truncates to maxKeywords', async () => {
    const { service, parseChat } = build({ maxKeywords: 2 });
    parseChat.mockResolvedValue(ok(['  ', 'a', 'b', 'c']));
    const out = await service.generate({ template: 'long_tail', seeds: ['x'] });
    expect(out.keywords).toEqual(['a', 'b']);
  });

  it('maps an LLM refusal to IdeationGenerationError', async () => {
    const { service, parseChat } = build();
    parseChat.mockResolvedValue({ parsed: null, refusal: 'content_filter' });
    await expect(service.generate({ template: 'use_cases', seeds: ['x'] })).rejects.toBeInstanceOf(
      IdeationGenerationError,
    );
  });

  it('maps a thrown LLM error to IdeationGenerationError (scrubbed)', async () => {
    const { service, parseChat } = build();
    parseChat.mockRejectedValue(new Error('boom sk-secret'));
    await expect(service.generate({ template: 'use_cases', seeds: ['x'] })).rejects.toBeInstanceOf(
      IdeationGenerationError,
    );
  });

  it('maps an all-blank/empty result to IdeationGenerationError (nothing usable)', async () => {
    const { service, parseChat } = build();
    parseChat.mockResolvedValue(ok(['  ', '']));
    await expect(
      service.generate({ template: 'pain_points', seeds: ['x'] }),
    ).rejects.toBeInstanceOf(IdeationGenerationError);
  });
});
