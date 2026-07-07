import type { INestApplication } from '@nestjs/common';
import type { OpenAPIObject } from '@nestjs/swagger';

/** 對映 `/api/v1`；固定值（不綁 package version，避免發版 bump 造成 openapi.json drift 噪音）。 */
export const OPENAPI_VERSION = '1';

/** 由 Nest app（preview 反射即可）建 OpenAPI 文件。含全域 `/api/v1` 前綴、x-api-key 安全定義、SSE 事件 schema。 */
export function buildOpenApiDocument(_app: INestApplication): OpenAPIObject {
  throw new Error('not implemented');
}

/** 決定性序列化：遞迴排序物件 key + 固定縮排 → 兩次產出 byte 相同（drift check / 前端 codegen 穩定）。 */
export function serializeOpenApi(_doc: OpenAPIObject): string {
  throw new Error('not implemented');
}
