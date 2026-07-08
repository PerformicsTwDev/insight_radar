import type { INestApplication } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import type { OpenAPIObject } from '@nestjs/swagger';
import {
  SseCompletedEventDto,
  SseFailedEventDto,
  SseProgressEventDto,
} from '../keyword-analysis/dto/sse-event.dto';

/** 對映 `/api/v1`；固定值（不綁 package version，避免發版 bump 造成 openapi.json drift 噪音）。 */
export const OPENAPI_VERSION = '1';

/** 由 Nest app（preview 反射即可）建 OpenAPI 文件。含全域 `/api/v1` 前綴、x-api-key 安全定義、SSE 事件 schema。 */
export function buildOpenApiDocument(app: INestApplication): OpenAPIObject {
  const config = new DocumentBuilder()
    .setTitle('insight_radar_v3 API')
    .setDescription('關鍵字分析 dashboard 後端 API（業務路由掛 /api/v1，/health 除外）')
    .setVersion(OPENAPI_VERSION)
    .addApiKey({ type: 'apiKey', name: 'x-api-key', in: 'header' }, 'x-api-key')
    .build();

  // `ignoreGlobalPrefix` 預設 false → paths 含 `/api/v1`（/health 因 setGlobalPrefix exclude 而不含前綴）。
  // `extraModels`：把 SSE 事件 DTO 註冊進 components.schemas（`@Sse` 無法自 route 反推事件形狀）。
  return SwaggerModule.createDocument(app, config, {
    extraModels: [SseProgressEventDto, SseCompletedEventDto, SseFailedEventDto],
  });
}

/** 決定性序列化：遞迴排序物件 key + 固定縮排 + 尾端換行 → 兩次產出 byte 相同（drift check / 前端 codegen 穩定）。 */
export function serializeOpenApi(doc: OpenAPIObject): string {
  return `${JSON.stringify(sortKeysDeep(doc), null, 2)}\n`;
}

/** 遞迴以字典序排序所有物件 key（陣列順序保留——由 createDocument 反射穩定產生）。 */
function sortKeysDeep(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(sortKeysDeep);
  }
  if (value !== null && typeof value === 'object') {
    const source = value as Record<string, unknown>;
    return Object.keys(source)
      .sort()
      .reduce<Record<string, unknown>>((acc, key) => {
        acc[key] = sortKeysDeep(source[key]);
        return acc;
      }, {});
  }
  return value;
}
