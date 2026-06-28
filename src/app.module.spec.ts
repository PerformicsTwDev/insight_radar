import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { AppModule } from './app.module';

describe('AppModule (smoke)', () => {
  let app: INestApplication;

  afterEach(async () => {
    await app?.close();
  });

  it('compiles and initialises the application context', async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleRef.createNestApplication();
    await app.init();

    expect(app).toBeDefined();
  });
});
