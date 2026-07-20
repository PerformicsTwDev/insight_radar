import type { CaptureChannel } from '../captures/dto/capture-ingest.dto';

/**
 * 渠道 → 來源路由（T14.6，FR-41/AC-41.2；Design §18.3）。extension 為主管道、SerpAPI 為 reserved pull——同一渠道
 * enum（S20）依來源分工：
 * - **extension 渠道**（push，primary）：`chatGpt/geminiApp/googleAiMode/googleSearch`（ChatGPT/Gemini SerpAPI 無 engine，
 *   只能靠 extension，NG14）→ job 內收 `POST /captures` 已推入的 raw extension capture（合流以 jobId）。
 * - **serpapi 渠道**（pull，reserved，`SERPAPI_AI_ENABLED=false` 預設關）：`aiOverview/aiMode/bingCopilot` → job 內經
 *   `SerpAiProvider` 拉取（關閉時 short-circuit null → 該渠道缺 → partial，零外部呼叫）。
 */

/** extension 主管道渠道（自 `POST /captures` 推入的 raw capture 收）。 */
export const EXTENSION_CHANNELS: readonly CaptureChannel[] = [
  'chatGpt',
  'geminiApp',
  'googleAiMode',
  'googleSearch',
];

/** SerpAPI reserved pull 渠道（job 內經 provider 拉取；預設關 → null → partial）。 */
export const SERPAPI_CHANNELS: readonly CaptureChannel[] = ['aiOverview', 'aiMode', 'bingCopilot'];

/** 請求渠道中屬 extension 來源者（保序、去重由 DTO `ArrayUnique` 保證）。 */
export function extensionChannelsOf(channels: readonly CaptureChannel[]): CaptureChannel[] {
  return channels.filter((channel) => EXTENSION_CHANNELS.includes(channel));
}

/** 請求渠道中屬 SerpAPI 來源者。 */
export function serpapiChannelsOf(channels: readonly CaptureChannel[]): CaptureChannel[] {
  return channels.filter((channel) => SERPAPI_CHANNELS.includes(channel));
}
