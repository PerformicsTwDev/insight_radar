/**
 * 路由專屬的 JSON body 上限 middleware（T13.2，AC-36.5）。
 *
 * **動機**：`POST /captures`（AI 回答／貼文集）body 可能大於全域 `BODY_LIMIT_MB`（NFR-14），需**獨立、較大**
 * 的上限（`INGEST_BODY_LIMIT_MB`）。全域 `useBodyParser('json')`（T9.8）是唯一 JSON parser，且其上限較小、會
 * 在此路由**先**擋掉大 body。故於 `configureApp` **早於**全域 parser、僅對 captures 路由掛此 middleware：以較大
 * 上限逐塊計位、解析成功即設 `req._body=true` → 全域 body-parser 依慣例（`if (req._body) next()`）**略過此路由**，
 * 非此路由則不受影響（維持全域上限，TC-58 不變）。
 *
 * **無法直接用 `express.json({ limit })`**：pnpm 嚴格化下 `express`/`body-parser` 不可直接 `require`（T9.8 既定
 * 決策）。故此處自行逐塊計位 + `JSON.parse`（單一路由、內容型別限 `application/json`）。逾限／malformed 拋
 * **http-errors 形狀（`expose=true` 的 4xx）**，與 body-parser 一致 → 由 `HttpExceptionFilter`「尊重 http-errors
 * 4xx」分支回**真 413/400**（非遮成 500），與既有 hardening 機制共用。
 */

/** 建 http-errors 形狀的 client 錯誤（`expose=true` 的 4xx）；由 `HttpExceptionFilter` 尊重其 status。 */
function httpClientError(
  status: number,
  message: string,
): Error & { status: number; statusCode: number; expose: boolean } {
  const err = new Error(message) as Error & {
    status: number;
    statusCode: number;
    expose: boolean;
  };
  err.status = status;
  err.statusCode = status;
  err.expose = true;
  return err;
}

/** 逐塊計位所需的最小 request 表面（避免相依 express 型別，與 `*Like`/`CookieRequest` 慣例一致）。 */
interface StreamRequestLike {
  headers: Record<string, string | string[] | undefined>;
  _body?: boolean;
  body?: unknown;
  on(event: 'data', listener: (chunk: Buffer) => void): unknown;
  on(event: 'end' | 'error', listener: (err?: Error) => void): unknown;
  resume(): unknown;
}
type NextLike = (err?: unknown) => void;

/**
 * 回傳一個 express-style middleware：對 `application/json` body 逐塊計位，逾 `limitBytes` → 413；讀完 `JSON.parse`
 * 設 `req.body` + `req._body=true`（供下游全域 parser 略過）；malformed → 400。非 JSON／已解析 → 直接放行。
 */
export function scopedJsonBodyLimit(limitBytes: number) {
  return (req: StreamRequestLike, _res: unknown, next: NextLike): void => {
    const contentType = req.headers['content-type'];
    const isJson = typeof contentType === 'string' && contentType.includes('application/json');
    // 非 JSON body（GET/preflight/其他型別）或已被解析 → 交回全域 parser；此 middleware 僅為 captures 放大 JSON 上限。
    if (!isJson || req._body === true) {
      next();
      return;
    }

    const chunks: Buffer[] = [];
    let size = 0;
    let settled = false;
    const settle = (err?: unknown): void => {
      if (settled) {
        return;
      }
      settled = true;
      if (err === undefined) {
        next();
      } else {
        next(err);
      }
    };

    req.on('data', (chunk: Buffer) => {
      if (settled) {
        return;
      }
      size += chunk.length;
      if (size > limitBytes) {
        // 逾限：立即回 413，但**不** destroy socket（會使仍在上傳的 client 收 EPIPE）。改丟棄後續 chunk 並
        // `resume()` 讓 request 排空自然收束（與 body-parser 一致：回應早於 body 讀完亦不切斷連線）。
        chunks.length = 0;
        settle(httpClientError(413, 'request entity too large'));
        req.resume();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      if (settled) {
        return;
      }
      const raw = Buffer.concat(chunks).toString('utf8');
      if (raw.length === 0) {
        req.body = {};
        req._body = true;
        settle();
        return;
      }
      try {
        req.body = JSON.parse(raw);
        req._body = true;
        settle();
      } catch {
        settle(httpClientError(400, 'Invalid JSON body'));
      }
    });
    req.on('error', (err?: Error) => settle(err));
  };
}
