import { randomUUID } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';

export const REQUEST_ID_HEADER = 'x-request-id';

/**
 * 產生/沿用 request id（NFR-6 可追溯）：有傳入 `x-request-id` 就沿用，否則新 uuid；
 * 一律回寫到 response header，供呼叫端關聯。
 */
export function genReqId(req: IncomingMessage, res: ServerResponse): string {
  const existing = req.headers[REQUEST_ID_HEADER];
  const id = typeof existing === 'string' && existing.length > 0 ? existing : randomUUID();
  res.setHeader(REQUEST_ID_HEADER, id);
  return id;
}
