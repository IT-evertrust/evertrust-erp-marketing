// Aggregated schema surface. drizzle.config.ts and the db client both consume
// this barrel so the migration generator and the runtime client stay in sync.
export * from './enums';
export * from './org';
export * from './core';
export * from './auth';
export * from './pricing';
export * from './process';
export * from './observability';
export * from './campaigns';
export * from './leads';
export * from './meetings';
export * from './personas';
export * from './performance';
