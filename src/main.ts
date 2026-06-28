import { NestFactory } from '@nestjs/core';
import { Logger } from 'nestjs-pino';
import { AppModule } from './app.module';
import { configureApp } from './bootstrap';

const DEFAULT_PORT = 3000;

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule, { bufferLogs: true });

  // 用 nestjs-pino 作為 Nest 全域 logger（結構化 + 祕密 redaction，NFR-5/NFR-6）。
  app.useLogger(app.get(Logger));

  // 全域應用設定（與 e2e harness 共用，見 src/bootstrap.ts）：/api/v1 前綴、/health 排除（NFR-10）。
  configureApp(app);

  // 優雅關機：後續引入 Queue/Worker/QueueEvents/cache 時靠 onModuleDestroy 收連線（防 Jest/部署 hang）。
  app.enableShutdownHooks();

  const port = process.env.PORT ?? DEFAULT_PORT;
  await app.listen(port);
}

void bootstrap();
