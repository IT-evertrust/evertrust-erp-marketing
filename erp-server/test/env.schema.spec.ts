import { EnvSchema, validateEnv } from '../src/config/env.schema';

// WHY: the system doctrine is "env validated at boot; missing config crashes
// loud". If these required secrets are ever allowed to default/empty, the API
// would boot mis-wired (no DB, unsigned/forgeable JWTs) — a silent failure.
describe('env schema', () => {
  const validBase = {
    DATABASE_URL: 'postgres://user:pass@localhost:5432/db',
    JWT_SECRET: 'super-secret',
  };

  it('rejects a config missing DATABASE_URL', () => {
    const result = EnvSchema.safeParse({ JWT_SECRET: 'x' });
    expect(result.success).toBe(false);
    if (!result.success) {
      const paths = result.error.issues.map((i) => i.path.join('.'));
      expect(paths).toContain('DATABASE_URL');
    }
  });

  it('rejects a config missing JWT_SECRET', () => {
    const result = EnvSchema.safeParse({
      DATABASE_URL: validBase.DATABASE_URL,
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      const paths = result.error.issues.map((i) => i.path.join('.'));
      expect(paths).toContain('JWT_SECRET');
    }
  });

  it('validateEnv throws (boot crash) when required secrets are absent', () => {
    expect(() => validateEnv({})).toThrow(/Invalid environment configuration/);
  });

  it('accepts a valid config and applies sensible defaults', () => {
    const env = validateEnv(validBase);
    expect(env.DATABASE_URL).toBe(validBase.DATABASE_URL);
    expect(env.JWT_SECRET).toBe(validBase.JWT_SECRET);
    expect(env.PORT).toBe(3001);
    expect(env.NODE_ENV).toBe('development');
    expect(env.COOKIE_SECURE).toBe(false);
  });
});
