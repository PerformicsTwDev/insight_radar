import type { CreateTopicRunDto } from './dto/create-topic-run.dto';
import { TopicsController } from './topics.controller';
import type { TopicsService } from './topics.service';

describe('TopicsController (T8.10)', () => {
  it('delegates create to the service and returns the topicJobId', async () => {
    const create = jest.fn<Promise<{ topicJobId: string }>, [string, CreateTopicRunDto]>();
    create.mockResolvedValue({ topicJobId: 'run-1' });
    const controller = new TopicsController({ create } as unknown as TopicsService);

    const dto: CreateTopicRunDto = { serpEnabled: true };
    const result = await controller.create('analysis-1', dto);

    expect(create).toHaveBeenCalledWith('analysis-1', dto);
    expect(result).toEqual({ topicJobId: 'run-1' });
  });
});
