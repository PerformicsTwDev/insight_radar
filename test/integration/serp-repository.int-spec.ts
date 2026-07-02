import type { INestApplication } from '@nestjs/common';
import type { PrismaService } from 'src/prisma';
import { SerpRepository } from 'src/serp/serp.repository';
import type { SerpFetchResult, SerpQuery } from 'src/serp/serp.types';
import { createPrismaTestApp } from '../utils/create-prisma-test-app';

/**
 * TC-47（T8.3 · FR-15 · Testcontainers）：serp_fetches append-only + freshness 窗查詢。驗 append→findLatestWithin
 * 往返、窗內取最新、超窗不回、append-only 保留歷史。
 */
function query(normalizedText: string): SerpQuery {
  return { normalizedText, keyword: normalizedText, geo: 'US', language: 'en' };
}

function fetchAt(normalizedText: string, fetchedAt: Date, domain: string): SerpFetchResult {
  return {
    ...query(normalizedText),
    provider: 'serpapi',
    results: {
      organic: [{ position: 1, title: 't', url: `https://${domain}`, snippet: 's', domain }],
    },
    fetchedAt,
  };
}

const daysAgo = (n: number): Date => new Date(Date.now() - n * 86_400_000);

describe('SerpRepository (integration · Testcontainers, TC-47)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let repo: SerpRepository;

  beforeAll(async () => {
    ({ app, prisma } = await createPrismaTestApp());
    repo = new SerpRepository(prisma);
  });
  afterAll(async () => {
    await app.close();
  });
  afterEach(async () => {
    await prisma.$executeRawUnsafe('DELETE FROM serp_fetches');
  });

  it('append then findLatestWithin round-trips the neutral results', async () => {
    await repo.append(fetchAt('coffee', daysAgo(1), 'a.com'));

    const found = await repo.findLatestWithin(query('coffee'), 30);
    expect(found?.normalizedText).toBe('coffee');
    expect(found?.results.organic[0].domain).toBe('a.com');
  });

  it('returns the LATEST row within the window (append-only keeps history)', async () => {
    await repo.append(fetchAt('coffee', daysAgo(10), 'old.com'));
    await repo.append(fetchAt('coffee', daysAgo(2), 'new.com')); // 較新

    const found = await repo.findLatestWithin(query('coffee'), 30);
    expect(found?.results.organic[0].domain).toBe('new.com'); // 取最新

    // append-only：兩列都在（保留歷史）。
    const count = await prisma.serpFetch.count({ where: { normalizedText: 'coffee' } });
    expect(count).toBe(2);
  });

  it('returns null when the only row is outside the freshness window', async () => {
    await repo.append(fetchAt('coffee', daysAgo(40), 'stale.com')); // 40 天前

    expect(await repo.findLatestWithin(query('coffee'), 30)).toBeNull(); // 超窗 → 重抓
    expect(await repo.findLatestWithin(query('coffee'), 60)).not.toBeNull(); // 放寬窗 → 命中
  });

  it('scopes by geo/language/normalizedText', async () => {
    await repo.append(fetchAt('coffee', daysAgo(1), 'us.com'));
    const other = await repo.findLatestWithin(
      { normalizedText: 'coffee', keyword: 'coffee', geo: 'GB', language: 'en' },
      30,
    );
    expect(other).toBeNull(); // 不同 geo 不命中
  });
});
