/** @type {import('ts-jest').JestConfigWithTsJest} */
module.exports = {
  moduleFileExtensions: ['js', 'json', 'ts'],
  rootDir: '.',
  testRegex: '.*\\.spec\\.ts$',
  transform: {
    '^.+\\.ts$': [
      'ts-jest',
      {
        tsconfig: '<rootDir>/tsconfig.json',
      },
    ],
  },
  collectCoverageFrom: ['src/**/*.ts'],
  testEnvironment: 'node',
  // Real-Postgres test harness (test/real-db.ts): one pgvector container per run.
  globalSetup: '<rootDir>/test/global-setup.ts',
  globalTeardown: '<rootDir>/test/global-teardown.ts',
  setupFilesAfterEnv: ['<rootDir>/test/setup-after-env.ts'],
  // Shared DB → serialize specs so truncate-per-test stays deterministic.
  maxWorkers: 1,
  // Container startup + first connection can be slow on a cold machine.
  testTimeout: 30000,
};
