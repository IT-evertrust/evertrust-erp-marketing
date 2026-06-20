import { Module } from '@nestjs/common';
import { JwtModule, type JwtModuleOptions } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { AppConfigService } from '../config/app-config.service';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { GoogleAuthService } from './google/google-auth.service';
import { JwtStrategy } from './jwt.strategy';

@Module({
  imports: [
    PassportModule,
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
  providers: [AuthService, GoogleAuthService, JwtStrategy],
  // GoogleAuthService is exported so the future Gmail/Calendar send layer can call
  // getAccessToken(userId) to act on the signed-in user's behalf.
  exports: [AuthService, GoogleAuthService],
})
export class AuthModule {}
