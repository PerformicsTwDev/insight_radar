import type { StartedPostgreSqlContainer } from '@testcontainers/postgresql';

type GlobalWithContainer = typeof globalThis & {
  __PG_CONTAINER__?: StartedPostgreSqlContainer;
};

/** Jest globalTeardown（integration project）：停掉臨時 Postgres 容器。 */
export default async function globalTeardown(): Promise<void> {
  const container = (globalThis as GlobalWithContainer).__PG_CONTAINER__;
  await container?.stop();
}
