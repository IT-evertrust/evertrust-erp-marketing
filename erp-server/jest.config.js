/** @type {import('ts-jest').JestConfigWithTsJest} */
module.exports = {
  moduleFileExtensions: ['js', 'json', 'ts'],
  rootDir: '.',
  testRegex: '.*\\.spec\\.ts$',
  // Resolve the workspace packages to their TS SOURCE (not the built dist). Their
  // package.json "main" points at dist/index.js, which isn't built when tests run
  // (CI runs `test` before `build`), so without this jest fails with
  // "Cannot find module '@evertrust/db'". ts-jest transpiles the mapped source.
  moduleNameMapper: {
    '^@evertrust/db$': '<rootDir>/../packages/db/src/index.ts',
    '^@evertrust/shared$': '<rootDir>/../packages/shared/src/index.ts',
  },
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
