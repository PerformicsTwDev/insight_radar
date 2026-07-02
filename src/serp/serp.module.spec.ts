import { ConfigModule } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { PrismaModule } from '../prisma';
import { serpConfig } from '../config/serp.config';
import { SERP_PROVIDER } from './serp-provider.port';
import { SerpModule } from './serp.module';
import { SerpService } from './serp.service';

const ENV: Record<string, string> = {
  SERP_ENABLED: 'false',
  SERP_PROVIDER: 'serpapi',
  SERP_TOP_N: '5',
  SERP_FRESHNESS_DAYS: '30',
  SERP_MAX_RETRIES: '3',
  SERP_BACKOFF_BASE_MS: '500',
};

describe('SerpModule (T8.3 wiring)', () => {
  const original = process.env;
  beforeEach(() => {
    process.env = { ...original, ...ENV };
  });
  afterEach(() => {
    process.env = original;
  });

  it('resolves SERP_PROVIDER to the freshness-aware SerpService (DI graph compiles)', async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({ load: [serpConfig], ignoreEnvFile: true, isGlobal: true }),
        PrismaModule, // @Global PrismaService（lazy connect；SERP_ENABLED=false → 不查詢）
        SerpModule,
      ],
    }).compile();

    expect(moduleRef.get(SERP_PROVIDER)).toBeInstanceOf(SerpService);
    await moduleRef.close();
  });
});
