import { getQueueToken } from '@nestjs/bullmq';
import { Test } from '@nestjs/testing';
import { Queue } from 'bullmq';
import RedisMock from 'ioredis-mock';
import { BULL_CONNECTION, KEYWORD_ANALYSIS_QUEUE } from './queue.constants';
import { QueueModule } from './queue.module';

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

  it('exposes the queue name as a shared constant', () => {
    expect(KEYWORD_ANALYSIS_QUEUE).toBe('keyword-analysis');
  });
});
