import { Module } from '@nestjs/common';
import { JwtModule, type JwtModuleOptions } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { AppConfigService } from '../config/app-config.service';
import { GoogleModule } from '../google/google.module';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { GoogleAuthService } from './google-auth.service';
import { JwtStrategy } from './jwt.strategy';
import { GoogleTokenVerifier, TOKEN_VERIFIER } from './token-verifier';

@Module({
  imports: [
    PassportModule,
    // GoogleModule exports GoogleAccountsService — the single-path login persists the
    // user's Gmail/Calendar refresh token via it. GoogleModule imports nothing
    // feature-specific, so this is not circular.
    GoogleModule,
    // JWT signing config is sourced from the validated env (secret + expiry).
    JwtModule.registerAsync({
      inject: [AppConfigService],
      useFactory: (config: AppConfigService): JwtModuleOptions => ({
        secret: config.get('JWT_SECRET'),
        // expiresIn accepts a number (seconds) or an ms-style string ('1d').
        // JWT_EXPIRES_IN is a validated env string; the lib types it as the
        // narrower ms `StringValue`, so cast through unknown to a plain string.
        signOptions: {
          expiresIn: config.get('JWT_EXPIRES_IN') as unknown as number,
        },
      }),
    }),
  ],
  controllers: [AuthController],
  providers: [
    AuthService,
    GoogleAuthService,
    JwtStrategy,
    // The Google ID-token verifier. Bound under a token so tests bind a fake.
    { provide: TOKEN_VERIFIER, useClass: GoogleTokenVerifier },
  ],
  exports: [AuthService],
})
export class AuthModule {}
