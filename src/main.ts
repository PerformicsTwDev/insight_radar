import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';

/** 預設對外前綴；可由 `API_PREFIX` 覆寫（NFR-10）。 */
const DEFAULT_API_PREFIX = 'api/v1';
const DEFAULT_PORT = 3000;

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule, { bufferLogs: true });

  // NFR-10：所有對外路由掛在 /api/v1 之下，唯 /health 例外（liveness 不帶版本前綴）。
  const apiPrefix = process.env.API_PREFIX ?? DEFAULT_API_PREFIX;
  app.setGlobalPrefix(apiPrefix, { exclude: ['health'] });

  // 優雅關機：後續引入 Queue/Worker/QueueEvents/cache 時靠 onModuleDestroy 收連線（防 Jest/部署 hang）。
  app.enableShutdownHooks();

  const port = process.env.PORT ?? DEFAULT_PORT;
  await app.listen(port);
}

void bootstrap();
