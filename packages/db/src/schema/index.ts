// Aggregated schema surface. drizzle.config.ts and the db client both consume
// this barrel so the migration generator and the runtime client stay in sync.
export * from './enums';
export * from './org';
export * from './core';
export * from './auth';
export * from './observability';
export * from './industries';
export * from './niches';
export * from './campaigns';
export * from './leads';
export * from './meetings';
export * from './prospects';
export * from './outreach';
export * from './contracts';
export * from './notifications';
export * from './personas';
export * from './performance';
export * from './workflow-config';
export * from './org-config';
export * from './signature-assets';
export * from './org-senders';
export * from './google-accounts';
export * from './reach';
