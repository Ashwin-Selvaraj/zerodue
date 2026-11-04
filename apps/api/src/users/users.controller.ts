import { Body, Controller, Get, Patch } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { CurrentUser, type AuthUser } from '../common/current-user.decorator';
import { MeResponseDto, UpdateUserSettingsDto, UserSettingsResponseDto } from './users.dto';
import { UsersService } from './users.service';

@ApiTags('me')
@ApiBearerAuth()
@Controller('me')
export class UsersController {
  constructor(private readonly users: UsersService) {}

  @Get()
  @ApiOkResponse({ type: MeResponseDto })
  getMe(@CurrentUser() user: AuthUser) {
    return this.users.getMe(user.id);
  }

  @Patch('settings')
  @ApiOkResponse({ type: UserSettingsResponseDto })
  updateSettings(@CurrentUser() user: AuthUser, @Body() body: UpdateUserSettingsDto) {
    return this.users.updateSettings(user.id, body);
  }
}
