import { Global, Module } from '@nestjs/common';
import { db } from '@evertrust/db';
import { DB } from './db.tokens';

// Global DB module: provides the single shared postgres.js-backed Drizzle client
// under the DB token. The connection pool lives in @evertrust/db; we just expose
// it to Nest's DI so every consumer shares one pool.
@Global()
@Module({
  providers: [{ provide: DB, useValue: db }],
  exports: [DB],
})
export class DbModule {}
