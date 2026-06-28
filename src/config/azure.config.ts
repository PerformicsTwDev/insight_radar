import { registerAs } from '@nestjs/config';
import type { AzureOpenAiApiVersion } from './azure-api-version.allowlist';

export interface AzureConfig {
  endpoint: string;
  apiKey: string;
  deployment: string;
  apiVersion: AzureOpenAiApiVersion;
}

/** Azure OpenAI 設定（apiVersion 已由 Joi allowlist 驗證，故可安全斷言為聯合型別）。 */
export const azureConfig = registerAs('azure', (): AzureConfig => ({
  endpoint: process.env.AZURE_OPENAI_ENDPOINT as string,
  apiKey: process.env.AZURE_OPENAI_API_KEY as string,
  deployment: process.env.AZURE_OPENAI_DEPLOYMENT as string,
  apiVersion: process.env.AZURE_OPENAI_API_VERSION as AzureOpenAiApiVersion,
}));
