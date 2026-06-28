import { Controller, Get } from '@nestjs/common';
import { Public } from '../common/public.decorator';

/**
 * Liveness placeholder（T0.1）。
 *
 * 掛在 `GET /health`（排除於 `/api/v1` 全域前綴之外——NFR-10）。
 * `@Public()`：全域 ApiKeyGuard 放行（免 `x-api-key`，T0.5）。
 * 真正的 readiness/liveness（`@nestjs/terminus`：DB/Redis/外部依賴探針）於 **T0.7** 取代本實作。
 */
@Controller('health')
export class HealthController {
  @Public()
  @Get()
  check(): { status: string } {
    return { status: 'ok' };
  }
}
