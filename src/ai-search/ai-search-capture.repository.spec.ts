import type { AiSearchCanonical } from '../captures/mapping/canonical.types';
import type { PrismaService } from '../prisma';
import { AiSearchCaptureRepository } from './ai-search-capture.repository';

function build(
  overrides: {
    findMany?: jest.Mock;
    deleteMany?: jest.Mock;
    createMany?: jest.Mock;
  } = {},
) {
  const capture = { findMany: overrides.findMany ?? jest.fn(() => Promise.resolve([])) };
  const aiSearchCapture = {
    deleteMany: overrides.deleteMany ?? jest.fn(() => Promise.resolve({ count: 0 })),
    createMany: overrides.createMany ?? jest.fn(() => Promise.resolve({ count: 0 })),
  };
  const prisma = { capture, aiSearchCapture } as unknown as PrismaService;
  return { repo: new AiSearchCaptureRepository(prisma), capture, aiSearchCapture };
}

function canonical(): AiSearchCanonical {
  return {
    source: 'extension',
    channel: 'chatGpt',
    schemaVersion: 'v1',
    query: 'asus zenbook',
    blocks: ['answer'],
    references: [{ title: 't', link: 'https://x', index: 0 }],
    capturedAt: '2026-07-20T00:00:00.000Z',
  };
}

describe('AiSearchCaptureRepository (unit, T14.6 / FR-41 / AC-41.2)', () => {
  describe('readRawExtensionCaptures', () => {
    it('short-circuits to [] for an empty channel set (no DB hit)', async () => {
      const { repo, capture } = build();
      expect(await repo.readRawExtensionCaptures({ ownerId: null, channels: [] })).toEqual([]);
      expect(capture.findMany).not.toHaveBeenCalled();
    });

    it('filters raw captures by owner + extension source + channel and projects the mapper shape', async () => {
      const findMany = jest.fn(() =>
        Promise.resolve([
          {
            source: 'extension',
            schemaVersion: 'v1',
            channel: 'chatGpt',
            payload: { query: 'asus zenbook' },
            capturedAt: new Date('2026-07-20T00:00:00Z'),
          },
        ]),
      );
      const { repo } = build({ findMany });
      const rows = await repo.readRawExtensionCaptures({
        ownerId: 'owner-A',
        channels: ['chatGpt'],
      });
      expect(findMany).toHaveBeenCalledWith({
        where: { source: 'extension', channel: { in: ['chatGpt'] }, ownerId: 'owner-A' },
        select: {
          source: true,
          schemaVersion: true,
          channel: true,
          payload: true,
          capturedAt: true,
        },
      });
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({ source: 'extension', channel: 'chatGpt' });
    });
  });

  it('deleteByJobId deletes the job’s canonical rows (clean slate)', async () => {
    const deleteMany = jest.fn(() => Promise.resolve({ count: 2 }));
    const { repo } = build({ deleteMany });
    await repo.deleteByJobId('run-1');
    expect(deleteMany).toHaveBeenCalledWith({ where: { jobId: 'run-1' } });
  });

  describe('persistCanonical', () => {
    it('short-circuits to 0 for an empty capture set (no DB hit)', async () => {
      const createMany = jest.fn();
      const { repo } = build({ createMany });
      expect(await repo.persistCanonical('run-1', null, [])).toBe(0);
      expect(createMany).not.toHaveBeenCalled();
    });

    it('inserts canonical rows keyed by jobId and returns the created count', async () => {
      const createMany = jest.fn<Promise<{ count: number }>, [unknown]>(() =>
        Promise.resolve({ count: 1 }),
      );
      const { repo } = build({ createMany });
      const count = await repo.persistCanonical('run-1', 'owner-A', [canonical()]);
      expect(count).toBe(1);
      const data = (createMany.mock.calls[0][0] as { data: Record<string, unknown>[] }).data;
      expect(data[0]).toMatchObject({
        ownerId: 'owner-A',
        jobId: 'run-1',
        channel: 'chatGpt',
        query: 'asus zenbook',
        source: 'extension',
      });
      expect(data[0].capturedAt).toBeInstanceOf(Date); // ISO string → Date
    });
  });
});
