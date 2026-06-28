import { execSync } from 'node:child_process';
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';

/** 釘版本以利可重現（含 pgvector + 標準 contrib 如 pg_trgm）；M8 embeddings 也用同一 image。 */
const PG_IMAGE = 'pgvector/pgvector:0.8.3-pg16';

type GlobalWithContainer = typeof globalThis & {
  __PG_CONTAINER__?: StartedPostgreSqlContainer;
};

/**
 * Jest globalSetup（integration project）：起臨時 Postgres、跑 `prisma migrate deploy`、
 * 把連線字串注入 `process.env.DATABASE_URL`（integration 以 `--runInBand` 跑，故同一 process 可見）。
 *
 * ⚠ 嚴禁寫死真實 `DATABASE_URL`（會 shadow 掉 Testcontainers 注入值）。
 */
export default async function globalSetup(): Promise<void> {
  const container = await new PostgreSqlContainer(PG_IMAGE)
    .withDatabase('insight_radar_test')
    .withUsername('test')
    .withPassword('test')
    .start();

  const url = container.getConnectionUri();
  process.env.DATABASE_URL = url;

  // 套用已提交的 migration（含手動補的 pg_trgm extension 與 GIN/trgm 索引）。
  execSync('pnpm exec prisma migrate deploy', {
    env: { ...process.env, DATABASE_URL: url },
    stdio: 'inherit',
  });

  (globalThis as GlobalWithContainer).__PG_CONTAINER__ = container;
}
