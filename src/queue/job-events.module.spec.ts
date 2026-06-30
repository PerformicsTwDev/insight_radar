import { Test } from '@nestjs/testing';
import { JOB_EVENTS_CONNECTION, JOB_QUEUE_EVENTS } from './job-events.constants';
import { JobEventsModule } from './job-events.module';
import { JobEventsService } from './job-events.service';

describe('JobEventsModule (T3.8 lifecycle — no connection leak, NFR-8)', () => {
  it('quits the dedicated QueueEvents connection and closes QueueEvents on shutdown', async () => {
    const quit = jest.fn().mockResolvedValue('OK');
    const close = jest.fn().mockResolvedValue(undefined);

    const moduleRef = await Test.createTestingModule({ imports: [JobEventsModule] })
      .overrideProvider(JOB_EVENTS_CONNECTION)
      .useValue({ quit })
      .overrideProvider(JOB_QUEUE_EVENTS)
      .useValue({ on: () => undefined, close })
      .compile();

    expect(moduleRef.get(JobEventsService)).toBeInstanceOf(JobEventsService);

    await moduleRef.close();

    // QueueEvents 關閉（關其 duplicate 阻塞連線）+ 原始注入連線被收回（不洩漏，blocker 修正）。
    expect(close).toHaveBeenCalledTimes(1);
    expect(quit).toHaveBeenCalledTimes(1);
  });
});
