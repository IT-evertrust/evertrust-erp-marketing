import { randomBytes } from 'crypto';
import {
  BadRequestException,
  Body,
  Controller,
  Get,
  HttpException,
  Post,
  Query,
  Req,
  Res,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import type { LoginResponseDto, MeDto } from '@evertrust/shared';
import { AppConfigService } from '../config/app-config.service';
import { Public } from './decorators/public.decorator';
import { CurrentUser } from './decorators/current-user.decorator';
import type { AuthUser } from './auth.types';
import { AuthService } from './auth.service';
import { GoogleAuthService } from './google/google-auth.service';
import { LoginBodyDto } from './auth.dto';

const OAUTH_STATE_COOKIE = 'g_oauth_state';

@Controller('auth')
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly google: GoogleAuthService,
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
    this.setSessionCookie(res, result.accessToken);
    return result;
  }

  // Public. Kicks off "Sign in with Google": set a short-lived CSRF state cookie and
  // redirect to Google's consent screen. If Google isn't configured, bounce back to
  // the login page with an error flag rather than 500-ing.
  @Public()
  @Get('google')
  googleStart(@Res() res: Response): void {
    if (!this.google.isConfigured()) {
      res.redirect(`${this.frontendUrl()}/login?error=google_not_configured`);
      return;
    }
    const state = randomBytes(16).toString('hex');
    res.cookie(OAUTH_STATE_COOKIE, state, {
      httpOnly: true,
      sameSite: 'lax',
      secure: this.config.get('COOKIE_SECURE'),
      path: '/',
      maxAge: 600_000, // 10 minutes
    });
    res.redirect(this.google.authUrl(state));
  }

  // Public. Google redirects here with ?code & ?state. Verify state, exchange the
  // code, set the SAME session cookie as password login, and return to the app.
  @Public()
  @Get('google/callback')
  async googleCallback(
    @Query('code') code: string | undefined,
    @Query('state') state: string | undefined,
    @Req() req: Request,
    @Res() res: Response,
  ): Promise<void> {
    const cookieState = (req.cookies as Record<string, string> | undefined)?.[
      OAUTH_STATE_COOKIE
    ];
    res.clearCookie(OAUTH_STATE_COOKIE, { path: '/' });
    try {
      if (!code) throw new BadRequestException('Missing authorization code');
      if (!state || state !== cookieState) {
        throw new BadRequestException('Invalid OAuth state');
      }
      const { accessToken } = await this.google.handleCallback(code);
      this.setSessionCookie(res, accessToken);
      res.redirect(this.frontendUrl());
    } catch (err) {
      const reason =
        err instanceof HttpException
          ? encodeURIComponent(err.message)
          : 'google_failed';
      res.redirect(`${this.frontendUrl()}/login?error=${reason}`);
    }
  }

  // Authenticated (covered by the global JwtAuthGuard). Returns the full current
  // user, re-read from the DB via the id in the verified token.
  @Get('me')
  me(@CurrentUser() user: AuthUser): Promise<MeDto> {
    return this.auth.me(user.id);
  }

  private setSessionCookie(res: Response, token: string): void {
    const sameSite = this.config.get('COOKIE_SAMESITE');
    res.cookie('access_token', token, {
      httpOnly: true,
      sameSite,
      // Browsers only honor SameSite=None when the cookie is also Secure, so
      // force it on in that case (cross-site deploys are always over HTTPS).
      secure: this.config.get('COOKIE_SECURE') || sameSite === 'none',
      path: '/',
    });
  }

  private frontendUrl(): string {
    return this.config.get('FRONTEND_URL').replace(/\/+$/, '');
  }
}
