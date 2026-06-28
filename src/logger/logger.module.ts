import { Module } from '@nestjs/common';
import { LoggerModule as PinoLoggerModule } from 'nestjs-pino';
import { errSerializer, REDACT_CENSOR, REDACT_PATHS } from './redaction';
import { genReqId } from './request-id';

/**
 * 全域結構化 logger（nestjs-pino / pino-http；NFR-5 / NFR-6）。
 * - `redact`：祕密欄位（developer token / API key / refresh token / Azure key…）一律遮蔽（TC-29）。
 * - `serializers.err`：錯誤 message / stack 內嵌的連線字串密碼 / bearer token 再做一道遮罩（M0-R3）。
 * - `genReqId`：每請求 request id（沿用 `x-request-id` 或新 uuid，回寫 response header）。
 * - test 環境 `level=silent`（避免測試噪音；redaction 由 redaction.spec 獨立驗證）。
 */
@Module({
  imports: [
    PinoLoggerModule.forRoot({
      pinoHttp: {
        level: process.env.NODE_ENV === 'test' ? 'silent' : (process.env.LOG_LEVEL ?? 'info'),
        redact: { paths: REDACT_PATHS, censor: REDACT_CENSOR },
        serializers: { err: errSerializer },
        genReqId,
      },
    }),
  ],
})
export class LoggerModule {}
