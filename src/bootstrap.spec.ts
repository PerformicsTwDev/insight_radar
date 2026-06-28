import type { INestApplication } from '@nestjs/common';
import { configureApp, DEFAULT_API_PREFIX } from './bootstrap';

describe('configureApp', () => {
  const makeApp = () => ({ setGlobalPrefix: jest.fn() });

  afterEach(() => {
    delete process.env.API_PREFIX;
  });

  it('applies the default /api/v1 prefix with /health excluded', () => {
    const app = makeApp();
    configureApp(app as unknown as INestApplication);

    expect(app.setGlobalPrefix).toHaveBeenCalledWith(DEFAULT_API_PREFIX, { exclude: ['health'] });
  });

  it('honours the API_PREFIX override', () => {
    process.env.API_PREFIX = 'api/v2';
    const app = makeApp();
    configureApp(app as unknown as INestApplication);

    expect(app.setGlobalPrefix).toHaveBeenCalledWith('api/v2', { exclude: ['health'] });
  });
});
