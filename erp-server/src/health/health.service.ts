import { Inject, Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import type { HealthDto } from '@evertrust/shared';
import { DB, type DbClient } from '../db/db.tokens';

@Injectable()
export class HealthService {
  constructor(@Inject(DB) private readonly db: DbClient) {}

  // Always reports status 'ok' so this can serve as a container healthcheck that
  // does not flap when Postgres has a transient blip. The `db` flag degrades to
  // false (still HTTP 200) when the `select 1` probe fails.
  async check(): Promise<HealthDto> {
    let db = false;
    try {
      await this.db.execute(sql`select 1`);
      db = true;
    } catch {
      db = false;
    }

    return {
      status: 'ok',
      service: 'api',
      at: new Date().toISOString(),
      db,
    };
  }
}
