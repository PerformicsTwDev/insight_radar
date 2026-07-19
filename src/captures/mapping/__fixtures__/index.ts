// captures mapper golden fixtures barrel（T13.5 / FR-37 AC-37.2 / NFR-17）——每個 `(source, discriminator, schemaVersion)`
// 一份 golden，供 `mapper-golden.contract.spec.ts` 迭代跑 contract + 漂移守衛。
//
// ⚠ grounded in Design §18.2/§18.3/§18.5; pending extension `type.ts` reconciliation at T13.6（各檔 header 另註）。
import { aiChatGptV1Golden } from './ai-chatgpt.v1.golden';
import { aiGeminiAppV1Golden } from './ai-gemini-app.v1.golden';
import { aiGoogleAiModeV1Golden } from './ai-google-ai-mode.v1.golden';
import { aiGoogleSearchV1Golden } from './ai-google-search.v1.golden';
import type { MapperGolden } from './golden.types';
import { socialThreadsApiV1Golden } from './social-threads-api.v1.golden';
import { socialThreadsSearchV1Golden } from './social-threads-search.v1.golden';

export type { MapperGolden, GoldenCoverage } from './golden.types';

export {
  aiChatGptV1Golden,
  aiGeminiAppV1Golden,
  aiGoogleAiModeV1Golden,
  aiGoogleSearchV1Golden,
  socialThreadsSearchV1Golden,
  socialThreadsApiV1Golden,
};

/** 全部 golden（AI 四渠道 extension + Social threadsSearch extension / threadsApi reserved）。 */
export const mapperGoldens: readonly MapperGolden[] = [
  aiChatGptV1Golden,
  aiGeminiAppV1Golden,
  aiGoogleAiModeV1Golden,
  aiGoogleSearchV1Golden,
  socialThreadsSearchV1Golden,
  socialThreadsApiV1Golden,
];
