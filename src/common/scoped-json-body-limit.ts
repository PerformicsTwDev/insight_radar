import zlib from 'node:zlib';

/**
 * 路由專屬的 JSON body 上限 middleware（T13.2，AC-36.5；M13-R3 對齊全域語意）。
 *
 * **動機**：`POST /captures`（AI 回答／貼文集）body 可能大於全域 `BODY_LIMIT_MB`（NFR-14），需**獨立、較大**
 * 的上限（`INGEST_BODY_LIMIT_MB`）。全域 `useBodyParser('json')`（T9.8）是唯一 JSON parser，且其上限較小、會
 * 在此路由**先**擋掉大 body。故於 `configureApp` **早於**全域 parser、僅對 captures 路由掛此 middleware：以較大
 * 上限逐塊計位、解析成功即設 `req._body=true` → 全域 body-parser 依慣例（`if (req._body) next()`）**略過此路由**，
 * 非此路由則不受影響（維持全域上限，TC-58 不變）。
 *
 * **無法直接用 `express.json({ limit })` / `body-parser`**：pnpm 嚴格化下兩者皆非直接相依、不可 `require`（T9.8
 * 既定決策；`useBodyParser` 亦無 per-route 上限）。故此處以 **Node 內建 `node:zlib`** 忠實重建 body-parser 語意
 * （M13-R3 對齊；#554）：
 * - **content-type** 大小寫不敏感、僅認 `application/json`（媒體型別取 `;` 前段）——與全域一致（[5]）。
 * - **Content-Encoding** `gzip`/`deflate`/`br` **真 inflate**（全域 `inflate:true`），`identity`/缺省不解；未知編碼 →
 *   415（[1]）。限額以**解壓後大小**計（防解壓炸彈）。
 * - **charset** 依 content-type 參數解碼；JSON 僅支援 `utf-*`（RFC 7159），非 utf 或 Node 不能解者 → 415（[8]）。
 * - **Content-Length 預檢**：`identity` 且宣告長度逾限 → 早拒 413，不先全 buffer（壓縮 body 的 Content-Length 為
 *   壓縮後大小，故不預檢）（[11]）。
 * - **abort / premature close** 監聽 finalize，釋放 zlib 資源、不 hang（[12]）。
 *
 * 逾限／malformed 拋 **http-errors 形狀（`expose=true` 的 4xx）**，與 body-parser 一致 → 由 `HttpExceptionFilter`
 * 「尊重 http-errors 4xx」分支回**真 413/400/415**（非遮成 500），與既有 hardening 機制共用。
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
  on(event: 'end' | 'error' | 'aborted' | 'close', listener: (err?: Error) => void): unknown;
  resume(): unknown;
}
type NextLike = (err?: unknown) => void;

/** 取單一 header 值（重複 header 取首個），供 content-length/encoding 解析。 */
function firstHeader(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

/**
 * 解析 content-type：僅在媒體型別（`;` 前段、大小寫不敏感）為 `application/json` 時回傳其 charset（若有），否則
 * `null`（＝非此 parser 目標，交回全域）。與全域 `useBodyParser('json')` 的 type 比對對齊（[5]）。
 */
function parseJsonContentType(
  header: string | string[] | undefined,
): { charset: string | undefined } | null {
  const value = firstHeader(header);
  if (typeof value !== 'string') {
    return null;
  }
  const parts = value.split(';');
  const mediaType = parts[0]?.trim().toLowerCase();
  if (mediaType !== 'application/json') {
    return null;
  }
  let charset: string | undefined;
  for (let i = 1; i < parts.length; i += 1) {
    const [rawKey, rawVal] = parts[i].split('=');
    if (rawKey?.trim().toLowerCase() === 'charset' && rawVal !== undefined) {
      charset = rawVal
        .trim()
        .toLowerCase()
        .replace(/^["']|["']$/g, '');
    }
  }
  return { charset };
}

type ContentEncoding = 'identity' | 'gzip' | 'deflate' | 'br';

/** 正規化 Content-Encoding；未知編碼回 `undefined`（呼叫端 → 415）。缺省/空 ＝ identity（body-parser 同）。 */
function normalizeEncoding(header: string | string[] | undefined): ContentEncoding | undefined {
  const value = firstHeader(header);
  if (value === undefined || value.trim() === '') {
    return 'identity';
  }
  const enc = value.trim().toLowerCase();
  if (enc === 'identity' || enc === 'gzip' || enc === 'deflate' || enc === 'br') {
    return enc;
  }
  return undefined;
}

/** zlib inflate 串流工廠（gzip/deflate/br）。與 body-parser 一致採 zlib 格式 inflate。 */
function createDecoder(
  encoding: Exclude<ContentEncoding, 'identity'>,
): zlib.Gunzip | zlib.Inflate | zlib.BrotliDecompress {
  switch (encoding) {
    case 'gzip':
      return zlib.createGunzip();
    case 'deflate':
      return zlib.createInflate();
    case 'br':
      return zlib.createBrotliDecompress();
  }
}

/**
 * 解析 charset → Node `BufferEncoding`。JSON 僅支援 `utf-*`（RFC 7159 §8.1；body-parser `isValidCharset`）；缺省
 * ＝utf-8。非 utf 或 Node 原生不能解者回 `undefined`（呼叫端 → 415；寧 415 也不無聲誤解，[8]）。
 */
function resolveUtfEncoding(charset: string | undefined): BufferEncoding | undefined {
  const cs = charset ?? 'utf-8';
  if (cs === 'utf-8' || cs === 'utf8') {
    return 'utf8';
  }
  if (cs === 'utf-16le' || cs === 'utf16le') {
    return 'utf16le';
  }
  return undefined;
}

/**
 * 回傳一個 express-style middleware：對 `application/json` body（可 gzip/deflate/br 壓縮、依 charset 解碼）逐塊
 * 計位，逾 `limitBytes`（以**解壓後**大小計）→ 413；讀完 `JSON.parse` 設 `req.body` + `req._body=true`（供下游全域
 * parser 略過）；malformed → 400；未知編碼/charset → 415。非 JSON／已解析 → 直接放行。
 */
export function scopedJsonBodyLimit(limitBytes: number) {
  return (req: StreamRequestLike, _res: unknown, next: NextLike): void => {
    const parsed = parseJsonContentType(req.headers['content-type']);
    // 非 JSON body（GET/preflight/其他型別）或已被解析 → 交回全域 parser；此 middleware 僅為 captures 放大 JSON 上限。
    if (parsed === null || req._body === true) {
      next();
      return;
    }

    // charset 驗證（JSON 僅 utf-*）。放在讀取前：非法 charset 即 415，不浪費讀取（[8]）。
    const nodeEncoding = resolveUtfEncoding(parsed.charset);
    if (nodeEncoding === undefined) {
      next(httpClientError(415, `unsupported charset "${(parsed.charset ?? '').toUpperCase()}"`));
      return;
    }

    // Content-Encoding：未知 → 415（[1]）。
    const encoding = normalizeEncoding(req.headers['content-encoding']);
    if (encoding === undefined) {
      next(httpClientError(415, 'unsupported content encoding'));
      return;
    }

    // Content-Length 預檢：僅 identity（壓縮 body 的長度為壓縮後大小、無法對比解壓限額）。逾限即拒、不先全 buffer（[11]）。
    if (encoding === 'identity') {
      const declared = Number(firstHeader(req.headers['content-length']));
      if (Number.isFinite(declared) && declared > limitBytes) {
        next(httpClientError(413, 'request entity too large'));
        req.resume(); // 排空、不切 socket（與 body-parser 一致）
        return;
      }
    }

    const chunks: Buffer[] = [];
    let size = 0;
    let settled = false;
    let reqEnded = false;
    const decoder = encoding === 'identity' ? undefined : createDecoder(encoding);

    const settle = (err?: unknown): void => {
      if (settled) {
        return;
      }
      settled = true;
      if (decoder && !decoder.destroyed) {
        decoder.destroy(); // 釋放 zlib 資源（[12]）
      }
      if (err === undefined) {
        next();
      } else {
        next(err);
      }
    };

    // 收到「解碼後」chunk：計位、逾限即 413（以解壓後大小計，防解壓炸彈，[1]）。
    const onDecoded = (chunk: Buffer): void => {
      if (settled) {
        return;
      }
      size += chunk.length;
      if (size > limitBytes) {
        chunks.length = 0;
        settle(httpClientError(413, 'request entity too large'));
        req.resume(); // 丟棄後續、排空 request（不 destroy socket → 避免 client EPIPE）
        return;
      }
      chunks.push(chunk);
    };

    const finish = (): void => {
      if (settled) {
        return;
      }
      const raw = Buffer.concat(chunks).toString(nodeEncoding);
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
    };

    if (decoder) {
      decoder.on('data', onDecoded);
      decoder.on('end', finish);
      // 壓縮串流損毀（Z_DATA_ERROR 等）＝ client 送了壞資料 → 顯式 400（非 500、非吞錯，[1]）。
      decoder.on('error', () => settle(httpClientError(400, `invalid ${encoding} body`)));
    }

    req.on('data', (chunk: Buffer) => {
      if (settled) {
        return;
      }
      if (decoder) {
        decoder.write(chunk); // 壓縮位元組餵入 inflate 串流；解碼後由 decoder 'data' 計位
      } else {
        onDecoded(chunk);
      }
    });
    req.on('end', () => {
      reqEnded = true;
      if (settled) {
        return;
      }
      if (decoder) {
        decoder.end(); // flush → decoder 'end' 觸發 finish
      } else {
        finish();
      }
    });
    req.on('error', (err?: Error) => settle(err));

    // abort / premature close：settle 一次、釋放資源、不 hang（[12]）。正常收束為 end→close，reqEnded 已設 → close 忽略
    // （避免把「壓縮串流仍在 flush」的正常 close 誤判為 abort）。
    const onAbort = (): void => settle(httpClientError(400, 'request aborted'));
    req.on('aborted', onAbort);
    req.on('close', () => {
      if (settled || reqEnded) {
        return;
      }
      onAbort();
    });
  };
}
