import { Logger } from '@nestjs/common';
import type { ConfigType } from '@nestjs/config';
import type { trackingConfig } from '../config/tracking.config';
import type { PrismaService } from '../prisma/prisma.service';
import { SweepLeaseService } from './sweep-lease.service';

/**
 * TC-65（#470 · NFR-16）：SweepLeaseService 的**純邏輯**單元覆蓋（DB 語意由 tracking-concurrency int-spec
 * 以真 Postgres 驗）。此處以 fake prisma 隔離：acquire 依 RETURNING 列數對映 true/false；release best-effort
 * （失敗只 log、不逸出）。
 */
describe('SweepLeaseService (#470 single-flight lease)', () => {
  const config = { sweepLeaseMs: 3_600_000 } as ConfigType<typeof trackingConfig>;

  const makeService = (over: { queryRaw?: jest.Mock; executeRaw?: jest.Mock } = {}) => {
    const queryRaw = over.queryRaw ?? jest.fn().mockResolvedValue([]);
    const executeRaw = over.executeRaw ?? jest.fn().mockResolvedValue(1);
    const prisma = { $queryRaw: queryRaw, $executeRaw: executeRaw } as unknown as PrismaService;
    return { service: new SweepLeaseService(prisma, config), queryRaw, executeRaw };
  };

  describe('acquire', () => {
    it('returns true when the atomic upsert claims the lease (RETURNING one row)', async () => {
      const { service } = makeService({
        queryRaw: jest.fn().mockResolvedValue([{ name: 'scheduled-refresh' }]),
      });
      await expect(service.acquire()).resolves.toBe(true);
    });

    it('returns false when the lease is held (WHERE fails → no row returned)', async () => {
      const { service } = makeService({ queryRaw: jest.fn().mockResolvedValue([]) });
      await expect(service.acquire()).resolves.toBe(false);
    });
  });

  describe('release', () => {
    it('expires the lease (executes the update)', async () => {
      const { service, executeRaw } = makeService();
      await expect(service.release()).resolves.toBeUndefined();
      expect(executeRaw).toHaveBeenCalledTimes(1);
    });

    it('is best-effort: a release failure is swallowed + logged (TTL recovers), not thrown', async () => {
      const { service } = makeService({
        executeRaw: jest.fn().mockRejectedValue(new Error('postgres://u:s3cr3t@h down')),
      });
      const warn = jest
        .spyOn((service as unknown as { logger: Logger }).logger, 'warn')
        .mockImplementation(() => undefined);

      await expect(service.release()).resolves.toBeUndefined(); // 不逸出
      expect(warn).toHaveBeenCalledWith(expect.stringContaining('sweep lease release failed'));
      // NFR-5：連線字串密碼經 scrubSecrets（不外洩）。
      expect(warn).toHaveBeenCalledWith(expect.not.stringContaining('s3cr3t'));
    });
  });
});
