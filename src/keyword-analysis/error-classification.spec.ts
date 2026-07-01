import {
  BadRequestError,
  ContentFilterFinishReasonError,
  LengthFinishReasonError,
} from 'openai/core/error';
import { RetryStrategy, classifyError } from './error-classification';

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

  describe('non-retryable → NO_RETRY (不放大 Ads 用量)', () => {
    it('Ads InvalidArgument (>20 seed / resource name 格式錯)', () => {
      const err = { errors: [{ error_code: { request_error: 'INVALID_ARGUMENT' } }] };
      expect(classifyError(err)).toBe(RetryStrategy.NO_RETRY);
    });
    it('a generic BadRequestError without content_filter is not degraded', () => {
      const err = new BadRequestError(400, { code: 'invalid_request_error' }, 'bad', new Headers());
      expect(classifyError(err)).toBe(RetryStrategy.NO_RETRY);
    });
    it('an unknown/programming error', () => {
      expect(classifyError(new TypeError('boom'))).toBe(RetryStrategy.NO_RETRY);
    });
    it('a non-object (null/undefined/string)', () => {
      expect(classifyError(null)).toBe(RetryStrategy.NO_RETRY);
      expect(classifyError('nope')).toBe(RetryStrategy.NO_RETRY);
    });
  });
});
