import {
  Body,
  Controller,
  ForbiddenException,
  Get,
  Post,
  Res,
} from '@nestjs/common';
import type { Response } from 'express';
import type { LoginResponseDto, MeDto } from '@evertrust/shared';
import { AppConfigService } from '../config/app-config.service';
import { Public } from './decorators/public.decorator';
import { CurrentUser } from './decorators/current-user.decorator';
import type { AuthUser } from './auth.types';
import { AuthService } from './auth.service';
import { GoogleAuthService } from './google-auth.service';
import {
  GoogleCodeLoginBodyDto,
  GoogleLoginBodyDto,
  LoginBodyDto,
} from './auth.dto';

@Controller('auth')
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly google: GoogleAuthService,
    private readonly config: AppConfigService,
  ) {}

  // DISABLED: login is Google-only now. The route is KEPT (not deleted) so the
  // contract stays explicit and any client still POSTing credentials gets a clear
  // 403 telling it to use Google, rather than a 404. AuthService.login (the JWT
  // logic) is untouched and still reused by the Google path's signer.
  @Public()
  @Post('login')
  login(@Body() _body: LoginBodyDto): never {
    throw new ForbiddenException(
      'Password login is disabled — sign in with Google.',
    );
  }

  // Public. Verifies the Google ID token, resolves/auto-provisions the user, and
  // returns { accessToken, user } AND sets the token as an httpOnly cookie so the
  // browser is authenticated without JS touching the token. `passthrough: true`
  // lets us set the cookie and still return a normal JSON body.
  @Public()
  @Post('google')
  async google_(
    @Body() body: GoogleLoginBodyDto,
    @Res({ passthrough: true }) res: Response,
  ): Promise<LoginResponseDto> {
    const result = await this.google.loginWithGoogle(body.idToken);
    this.setAuthCookie(res, result.accessToken);
    return result;
  }

  // Public. The OAuth 2.0 authorization-code variant of POST /auth/google, so the
  // web can use a fully custom sign-in button (the GIS rendered button can't be
  // restyled). Exchanges the GIS authorization `code` server-side, then behaves
  // EXACTLY like POST /auth/google: same cookie, same LoginResponse body.
  @Public()
  @Post('google/code')
  async googleCode(
    @Body() body: GoogleCodeLoginBodyDto,
    @Res({ passthrough: true }) res: Response,
  ): Promise<LoginResponseDto> {
    const result = await this.google.loginWithGoogleCode(body.code);
    this.setAuthCookie(res, result.accessToken);
    return result;
  }

  // Authenticated (covered by the global JwtAuthGuard). Returns the full current
  // user, re-read from the DB via the id in the verified token.
  @Get('me')
  me(@CurrentUser() user: AuthUser): Promise<MeDto> {
    return this.auth.me(user.id);
  }

  // Sets the httpOnly session cookie carrying the JWT (same flags as the legacy
  // password flow used). Shared so the Google flow stays consistent.
  private setAuthCookie(res: Response, accessToken: string): void {
    const sameSite = this.config.get('COOKIE_SAMESITE');
    res.cookie('access_token', accessToken, {
      httpOnly: true,
      sameSite,
      // Browsers only honor SameSite=None when the cookie is also Secure, so
      // force it on in that case (cross-site deploys are always over HTTPS).
      secure: this.config.get('COOKIE_SECURE') || sameSite === 'none',
      path: '/',
    });
  }
}
