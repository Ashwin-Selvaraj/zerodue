import { Controller, Get } from '@nestjs/common';
import { APP_NAME } from '@zerodue/shared';

@Controller('health')
export class HealthController {
  @Get()
  check() {
    return { service: `${APP_NAME} API`, status: 'ok' };
  }
}
