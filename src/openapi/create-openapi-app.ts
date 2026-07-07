import type { INestApplication } from '@nestjs/common';

/**
 * 建立**僅供 OpenAPI 反射**的 Nest app：`preview: true` 不實例化 provider（不連 Redis/DB/外部服務），
 * 只保留 module/controller metadata 供 `SwaggerModule.createDocument` 反射路由。掛 `/api/v1` 前綴、
 * `/health` 排除，使產出的 paths 與正式路由一致。呼叫端須 `await app.close()`。
 */
export function createOpenApiApp(): Promise<INestApplication> {
  throw new Error('not implemented');
}
