import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { configureApp } from './bootstrap';

const DEFAULT_PORT = 3000;

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule, { bufferLogs: true });

  // 全域應用設定（與 e2e harness 共用，見 src/bootstrap.ts）：/api/v1 前綴、/health 排除（NFR-10）。
  configureApp(app);

  // 優雅關機：後續引入 Queue/Worker/QueueEvents/cache 時靠 onModuleDestroy 收連線（防 Jest/部署 hang）。
  app.enableShutdownHooks();

  const port = process.env.PORT ?? DEFAULT_PORT;
  await app.listen(port);
}

void bootstrap();
