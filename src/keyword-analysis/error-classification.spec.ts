import {
  BadRequestError,
  ContentFilterFinishReasonError,
  LengthFinishReasonError,
} from 'openai/core/error';
import { RetryStrategy, classifyError, isTerminalJobError } from './error-classification';

/**
 * T7.1（FR-12 · NFR-2/9 · Design §11）：集中錯誤分類矩陣。彙整測試——各錯誤族對應到單一策略詞彙。
 */
describe('classifyError (T7.1 error-classification matrix)', () => {
  describe('Ads transient quota → ADS_BACKOFF_IN_JOB (job 內退避、不重跑整 job)', () => {
    it.each([
      [
        'GoogleAdsFailure RESOURCE_EXHAUSTED',
        { errors: [{ error_code: { quota_error: 'RESOURCE_EXHAUSTED' } }] },
      ],
      [
        'GoogleAdsFailure RESOURCE_TEMPORARILY_EXHAUSTED',
        { errors: [{ error_code: { quota_error: 'RESOURCE_TEMPORARILY_EXHAUSTED' } }] },
      ],
      ['raw gRPC code 8', { code: 8 }],
      ['flat string code', { code: 'RESOURCE_EXHAUSTED' }],
    ])('%s', (_label, err) => {
      expect(classifyError(err)).toBe(RetryStrategy.ADS_BACKOFF_IN_JOB);
    });
  });

  describe('LLM content outcomes → LLM_DEGRADE (該批 fallback)', () => {
    it('finish_reason=length (LengthFinishReasonError)', () => {
      expect(classifyError(new LengthFinishReasonError())).toBe(RetryStrategy.LLM_DEGRADE);
    });
    it('content_filter (ContentFilterFinishReasonError)', () => {
      expect(classifyError(new ContentFilterFinishReasonError())).toBe(RetryStrategy.LLM_DEGRADE);
    });
    it('prompt-side content_filter (BadRequestError code=content_filter)', () => {
      const err = new BadRequestError(
        400,
        { code: 'content_filter' },
        'content filter',
        new Headers(),
      );
      expect(classifyError(err)).toBe(RetryStrategy.LLM_DEGRADE);
    });
  });

  describe('transient infra/Redis → INFRA_RETRY_WHOLE_JOB (BullMQ 整 job 重試)', () => {
    it.each(['ECONNREFUSED', 'ECONNRESET', 'ETIMEDOUT', 'ENOTFOUND'])('code %s', (code) => {
      expect(classifyError(Object.assign(new Error('conn'), { code }))).toBe(
        RetryStrategy.INFRA_RETRY_WHOLE_JOB,
      );
    });
  });

  describe('Ads non-retryable → ADS_NON_RETRYABLE (job 級終態、不重打同一非法請求)', () => {
    it.each([
      [
        'request_error INVALID_ARGUMENT (>20 seed / resource name 格式錯)',
        { errors: [{ error_code: { request_error: 'INVALID_ARGUMENT' } }] },
      ],
      ['field_error', { errors: [{ error_code: { field_error: 'REQUIRED' } }] }],
      ['undecoded raw gRPC INVALID_ARGUMENT (code 3)', { code: 3 }],
    ])('%s', (_label, err) => {
      expect(classifyError(err)).toBe(RetryStrategy.ADS_NON_RETRYABLE);
    });
  });

  describe('unknown → UNKNOWN (保留 BullMQ 重試安全網，不誤殺無碼暫時性故障)', () => {
    it('a generic BadRequestError without content_filter (not a GoogleAdsFailure)', () => {
      const err = new BadRequestError(400, { code: 'invalid_request_error' }, 'bad', new Headers());
      expect(classifyError(err)).toBe(RetryStrategy.UNKNOWN);
    });
    it('an unknown/programming error (no error code)', () => {
      expect(classifyError(new TypeError('boom'))).toBe(RetryStrategy.UNKNOWN);
    });
    it('a non-object (null/undefined/string)', () => {
      expect(classifyError(null)).toBe(RetryStrategy.UNKNOWN);
      expect(classifyError('nope')).toBe(RetryStrategy.UNKNOWN);
    });
  });

  describe('isTerminalJobError (策略→是否 job 級終態)', () => {
    it('terminal (UnrecoverableError, 不整 job 重試): Ads backoff-exhausted / Ads non-retryable / LLM degrade', () => {
      expect(isTerminalJobError(RetryStrategy.ADS_BACKOFF_IN_JOB)).toBe(true);
      expect(isTerminalJobError(RetryStrategy.ADS_NON_RETRYABLE)).toBe(true);
      expect(isTerminalJobError(RetryStrategy.LLM_DEGRADE)).toBe(true);
    });
    it('retryable (BullMQ attempts): transient infra / unknown', () => {
      expect(isTerminalJobError(RetryStrategy.INFRA_RETRY_WHOLE_JOB)).toBe(false);
      expect(isTerminalJobError(RetryStrategy.UNKNOWN)).toBe(false);
    });
  });
});
