import { Controller, Get } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { APP_NAME } from '@zerodue/shared';
import { Public } from './common/public.decorator';

@ApiTags('health')
@Controller('health')
export class HealthController {
  @Public()
  @Get()
  check() {
    return { service: `${APP_NAME} API`, status: 'ok' };
  }
}
