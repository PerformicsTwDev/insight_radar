import { getQueueToken } from '@nestjs/bullmq';
import { Test } from '@nestjs/testing';
import { Queue } from 'bullmq';
import RedisMock from 'ioredis-mock';
import { BULL_CONNECTION, KEYWORD_ANALYSIS_QUEUE } from './queue.constants';
import { createBullConnection, QueueModule } from './queue.module';

describe('QueueModule (T3.1)', () => {
  it('registers the keyword-analysis queue on the injected connection (mock, no real Redis)', async () => {
    const mock = new RedisMock();
    const moduleRef = await Test.createTestingModule({
      imports: [QueueModule],
    })
      // BullMQ would otherwise open a real Redis connection — inject an in-memory mock.
      .overrideProvider(BULL_CONNECTION)
      .useValue(mock)
      .compile();

    const queue = moduleRef.get<Queue>(getQueueToken(KEYWORD_ANALYSIS_QUEUE));
    expect(queue).toBeDefined();
    expect(queue.name).toBe(KEYWORD_ANALYSIS_QUEUE);
    // Prove the queue actually runs on the injected mock connection (not a silent real connection).
    expect(queue.opts.connection).toBe(mock);

    await moduleRef.close();
  });

  it('quits the injected Redis connection on shutdown (graceful shutdown, NFR-8 / no Jest hang)', async () => {
    const mock = new RedisMock();
    const quitSpy = jest.spyOn(mock, 'quit');
    const moduleRef = await Test.createTestingModule({
      imports: [QueueModule],
    })
      .overrideProvider(BULL_CONNECTION)
      .useValue(mock)
      .compile();

    // BullMQ treats an injected instance as `shared` and never quits it; the module
    // must own its lifecycle. Closing the module must close the connection.
    await moduleRef.close();

    expect(quitSpy).toHaveBeenCalledTimes(1);
  });

  it('exposes the queue name as a shared constant', () => {
    expect(KEYWORD_ANALYSIS_QUEUE).toBe('keyword-analysis');
  });

  describe('createBullConnection (production wiring)', () => {
    it('builds the connection with maxRetriesPerRequest:null (BullMQ requirement)', () => {
      const captured: Array<[string, { maxRetriesPerRequest: null }]> = [];
      const FakeRedis = function (this: object, url: string, opts: { maxRetriesPerRequest: null }) {
        captured.push([url, opts]);
      } as unknown as new (
        url: string,
        opts: { maxRetriesPerRequest: null },
      ) => InstanceType<typeof RedisMock>;

      createBullConnection({ url: 'redis://example:6379' }, FakeRedis);

      expect(captured).toEqual([['redis://example:6379', { maxRetriesPerRequest: null }]]);
    });
  });
});
