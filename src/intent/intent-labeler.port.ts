/**
 * Azure OpenAI 低階呼叫的 Port（T2.1，NFR-3 可測 / DI 可替換）。
 * `AzureOpenAiService` 不直接讓上層依賴 openai SDK 型別。
 */
export const AZURE_OPENAI_CLIENT = Symbol('AZURE_OPENAI_CLIENT');
/** DI token for the deployment name string（避免 magic-string 在多處重複、typo 只在 runtime 才爆）。 */
export const AZURE_OPENAI_DEPLOYMENT = Symbol('AZURE_OPENAI_DEPLOYMENT');

/** 對話訊息（openai chat 子集）。 */
export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

/** structured-outputs `json_schema`（strict 由 service 固定為 true）。 */
export interface JsonSchemaSpec {
  name: string;
  schema: Record<string, unknown>;
}

/** `parseChat` 參數（與 openai SDK 解耦）。 */
export interface ParseChatParams {
  messages: ChatMessage[];
  jsonSchema: JsonSchemaSpec;
  temperature?: number;
}

/** `parseChat` 結果：解析後 payload（或 refusal）。 */
export interface ParseChatResult<T> {
  parsed: T | null;
  refusal: string | null;
}

/**
 * openai SDK client 的最小子集（只用 `chat.completions.parse`）。
 * 真實由 `AzureOpenAI` 實例提供；測試以 fake 替換。
 */
export interface OpenAiChatClient {
  chat: {
    completions: {
      parse(params: unknown): Promise<unknown>;
    };
  };
}

/** Intent 低階呼叫介面（service 對外只露此）。`T` 為期望的 `parsed` 型別。 */
export interface IntentLabeler {
  parseChat<T>(params: ParseChatParams): Promise<ParseChatResult<T>>;
}
