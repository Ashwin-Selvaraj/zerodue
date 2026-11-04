import { Body, Controller, HttpCode, Post, Req, Res } from '@nestjs/common';
import { ApiCookieAuth, ApiCreatedResponse, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import type { Request, Response } from 'express';
import { Public } from '../common/public.decorator';
import { AppConfig } from '../config/app-config';
import { AuthResponseDto, LoginDto, RegisterDto } from './auth.dto';
import { AuthService, type Session } from './auth.service';

export const REFRESH_COOKIE = 'zd_refresh';
const authLimit = {
  default: { limit: () => Number(process.env.AUTH_RATE_LIMIT ?? 10), ttl: 60_000 },
};

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly config: AppConfig,
  ) {}

  @Public()
  @Throttle(authLimit)
  @Post('register')
  @ApiCreatedResponse({
    type: AuthResponseDto,
    description: 'Account created; sets the refresh cookie',
  })
  async register(@Body() body: RegisterDto, @Res({ passthrough: true }) res: Response) {
    return this.respond(res, await this.auth.register(body));
  }

  @Public()
  @Throttle(authLimit)
  @HttpCode(200)
  @Post('login')
  @ApiOkResponse({
    type: AuthResponseDto,
    description: 'Returns an access token; sets the refresh cookie',
  })
  async login(@Body() body: LoginDto, @Res({ passthrough: true }) res: Response) {
    return this.respond(res, await this.auth.login(body));
  }

  @Public()
  @Throttle(authLimit)
  @HttpCode(200)
  @Post('refresh')
  @ApiCookieAuth(REFRESH_COOKIE)
  @ApiOkResponse({
    type: AuthResponseDto,
    description: 'Rotates the refresh cookie, returns a new access token',
  })
  async refresh(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const token = (req.cookies as Record<string, string | undefined> | undefined)?.[REFRESH_COOKIE];
    return this.respond(res, await this.auth.refresh(token));
  }

  @Public()
  @HttpCode(204)
  @Post('logout')
  @ApiCookieAuth(REFRESH_COOKIE)
  async logout(@Req() req: Request, @Res({ passthrough: true }) res: Response): Promise<void> {
    const token = (req.cookies as Record<string, string | undefined> | undefined)?.[REFRESH_COOKIE];
    await this.auth.logout(token);
    res.clearCookie(REFRESH_COOKIE, this.cookieOptions());
  }

  private respond(res: Response, session: Session) {
    res.cookie(REFRESH_COOKIE, session.refreshToken, {
      ...this.cookieOptions(),
      expires: session.refreshExpiresAt,
    });
    return session.response;
  }

  private cookieOptions() {
    return {
      httpOnly: true,
      secure: this.config.cookieSecure,
      sameSite: 'lax' as const,
      path: '/auth',
    };
  }
}
