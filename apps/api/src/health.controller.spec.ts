import { HealthController } from './health.controller';

describe('HealthController', () => {
  it('reports the ZeroDue API as ok', () => {
    expect(new HealthController().check()).toEqual({ service: 'ZeroDue API', status: 'ok' });
  });
});
