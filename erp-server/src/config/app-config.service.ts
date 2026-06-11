import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Env } from './env.schema';

// Thin typed wrapper over ConfigService so the rest of the app reads validated,
// fully-typed env values (no `string | undefined` noise at every call site).
@Injectable()
export class AppConfigService {
  constructor(private readonly config: ConfigService<Env, true>) {}

  get<K extends keyof Env>(key: K): Env[K] {
    return this.config.get(key, { infer: true });
  }

  // Parsed CORS allowlist; empty array means "no cross-origin browser access".
  get corsOrigins(): string[] {
    return this.get('CORS_ORIGINS')
      .split(',')
      .map((o) => o.trim())
      .filter((o) => o.length > 0);
  }
}
