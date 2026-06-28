import {
  AZURE_OPENAI_API_VERSION_ALLOWLIST,
  isAllowedAzureApiVersion,
} from './azure-api-version.allowlist';

describe('isAllowedAzureApiVersion (allowlist, not lexical compare)', () => {
  it('accepts every allowlisted value', () => {
    for (const version of AZURE_OPENAI_API_VERSION_ALLOWLIST) {
      expect(isAllowedAzureApiVersion(version)).toBe(true);
    }
  });

  it('rejects values outside the allowlist', () => {
    expect(isAllowedAzureApiVersion('2099-12-31')).toBe(false);
    expect(isAllowedAzureApiVersion('')).toBe(false);
  });

  it('rejects GA-like values a lexical >= compare would mis-handle', () => {
    // '2024-08-01'（GA，無 -preview）字典序 < '2024-08-01-preview'；'v1' 字首在數字之後。
    // 唯有 allowlist 集合比對能正確拒絕這些「未明確列入」的值。
    expect(isAllowedAzureApiVersion('2024-08-01')).toBe(false);
    expect(isAllowedAzureApiVersion('2025-01-01-preview')).toBe(false);
  });
});
