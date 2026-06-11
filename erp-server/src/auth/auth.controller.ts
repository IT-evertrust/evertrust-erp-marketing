import { Body, Controller, Get, Post, Res } from '@nestjs/common';
import type { Response } from 'express';
import type { LoginResponseDto, MeDto } from '@evertrust/shared';
import { AppConfigService } from '../config/app-config.service';
import { Public } from './decorators/public.decorator';
import { CurrentUser } from './decorators/current-user.decorator';
import type { AuthUser } from './auth.types';
import { AuthService } from './auth.service';
import { LoginBodyDto } from './auth.dto';

@Controller('auth')
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly config: AppConfigService,
  ) {}

  // Public. Verifies credentials, returns { accessToken, user } AND sets the
  // token as an httpOnly cookie so the browser is authenticated without JS
  // touching the token. `passthrough: true` lets us set the cookie and still
  // return a normal JSON body.
  @Public()
  @Post('login')
  async login(
    @Body() body: LoginBodyDto,
    @Res({ passthrough: true }) res: Response,
  ): Promise<LoginResponseDto> {
    const result = await this.auth.login(body);

    const sameSite = this.config.get('COOKIE_SAMESITE');
    res.cookie('access_token', result.accessToken, {
      httpOnly: true,
      sameSite,
      // Browsers only honor SameSite=None when the cookie is also Secure, so
      // force it on in that case (cross-site deploys are always over HTTPS).
      secure: this.config.get('COOKIE_SECURE') || sameSite === 'none',
      path: '/',
    });

    return result;
  }

  // Authenticated (covered by the global JwtAuthGuard). Returns the full current
  // user, re-read from the DB via the id in the verified token.
  @Get('me')
  me(@CurrentUser() user: AuthUser): Promise<MeDto> {
    return this.auth.me(user.id);
  }
}
