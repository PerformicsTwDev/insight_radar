import { Controller, Get } from '@nestjs/common';

/**
 * Liveness placeholder（T0.1）。
 *
 * 掛在 `GET /health`（排除於 `/api/v1` 全域前綴之外——NFR-10）。
 * 真正的 readiness/liveness（`@nestjs/terminus`：DB/Redis/外部依賴探針 + `@Public`）
 * 於 **T0.7** 取代本實作。
 */
@Controller('health')
export class HealthController {
  @Get()
  check(): { status: string } {
    return { status: 'ok' };
  }
}
