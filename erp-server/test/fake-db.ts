import type { DbClient } from '../src/db/db.tokens';

// ---------------------------------------------------------------------------
// In-memory, tenant-aware fake of the Drizzle client — enough surface for the
// ERP-core services (select/insert/update with .where/.orderBy/.returning).
//
// It is NOT a SQL engine: it recovers the referenced column names + bound param
// VALUES out of a Drizzle SQL condition (eq/and over organization_id/id/status)
// and matches in-memory rows against them. That is precisely what lets the
// tenant-isolation and status-filter tests exercise REAL service behavior
// (a cross-org get genuinely returns no rows) instead of a canned stub.
// ---------------------------------------------------------------------------

interface ParsedCondition {
  // column name (snake_case) -> required value (AND-combined equality only)
  equals: Record<string, unknown>;
}

// Recover {column: value} equality pairs from a Drizzle SQL node by walking its
// queryChunks. Columns expose {name, table, columnType}; params expose
// {value, encoder}. We pair them positionally (eq emits column then param).
function parseCondition(sql: unknown): ParsedCondition {
  const cols: string[] = [];
  const params: unknown[] = [];

  const visit = (node: unknown): void => {
    if (node == null) return;
    if (Array.isArray(node)) {
      node.forEach(visit);
      return;
    }
    if (typeof node !== 'object') return;
    const o = node as Record<string, unknown>;
    if ('name' in o && 'table' in o && 'columnType' in o) {
      cols.push(o.name as string);
    }
    if ('value' in o && 'encoder' in o) {
      params.push(o.value);
    }
    if ('queryChunks' in o) visit(o.queryChunks);
  };

  visit((sql as { queryChunks?: unknown }).queryChunks ?? sql);

  const equals: Record<string, unknown> = {};
  cols.forEach((c, i) => {
    equals[c] = params[i];
  });
  return { equals };
}

// snake_case column name -> the camelCase row key our schema rows use.
const COLUMN_TO_KEY: Record<string, string> = {
  organization_id: 'organizationId',
  user_id: 'userId',
  deployed_by: 'deployedBy',
  triggered_by: 'triggeredBy',
  actor_id: 'actorId',
  id: 'id',
  status: 'status',
  vergabe_id: 'vergabeId',
  source: 'source',
  tender_id: 'tenderId',
  campaign_id: 'campaignId',
  pic_id: 'picId',
  line_item_id: 'lineItemId',
  supplier_id: 'supplierId',
  created_by: 'createdBy',
  drive_folder_id: 'driveFolderId',
  drive_file_id: 'driveFileId',
  drive_missing: 'driveMissing',
  session_id: 'sessionId',
  lead_id: 'leadId',
  match_method: 'matchMethod',
  // Growth-Engine v2 columns.
  niche_id: 'nicheId',
  niche_target_id: 'nicheTargetId',
  activated_by: 'activatedBy',
  source_prospect_id: 'sourceProspectId',
  prospect_id: 'prospectId',
  gmail_message_id: 'gmailMessageId',
  gmail_thread_id: 'gmailThreadId',
  message_id: 'messageId',
  customer_id: 'customerId',
};

function rowMatches(row: Record<string, unknown>, cond: ParsedCondition): boolean {
  return Object.entries(cond.equals).every(([col, val]) => {
    const key = COLUMN_TO_KEY[col] ?? col;
    return row[key] === val;
  });
}

type Row = Record<string, unknown>;

// A single backing table keyed by the Drizzle table object identity.
export class FakeTable {
  rows: Row[] = [];
  // monotonic clock so default createdAt ordering is deterministic
  private seq = 0;

  constructor(initial: Row[] = []) {
    this.rows = initial.map((r) => ({ ...r }));
  }

  nextSeq(): number {
    return ++this.seq;
  }
}

// Builds a fake DbClient over a map of (schema table object) -> FakeTable.
// Inserts auto-fill id/createdAt/updatedAt when absent so services that rely on
// DB defaults still get a complete row back from .returning().
export function makeFakeDb(
  tables: Map<unknown, FakeTable>,
  opts: { idFactory?: () => string } = {},
): { db: DbClient; insertedInto: (t: unknown) => Row[] } {
  let idCounter = 0;
  const idFactory =
    opts.idFactory ?? (() => `00000000-0000-0000-0000-${String(++idCounter).padStart(12, '0')}`);

  const tableFor = (t: unknown): FakeTable => {
    const ft = tables.get(t);
    if (!ft) throw new Error('fake-db: unknown table passed to query');
    return ft;
  };

  const db = {
    // SELECT: db.select(...).from(table).where(cond?).orderBy(...)?.limit(n)?
    select(_proj?: unknown) {
      return {
        from(table: unknown) {
          const ft = tableFor(table);
          let result = [...ft.rows];
          // Reads return CLONES so callers hold immutable snapshots — a later
          // in-place update must not retro-mutate a previously returned row
          // (this is what makes `before` in update/transition correct).
          const snapshot = (rows: Row[]): Row[] => rows.map((r) => ({ ...r }));
          const builder = {
            where(cond: unknown) {
              const parsed = parseCondition(cond);
              result = result.filter((r) => rowMatches(r, parsed));
              return builder;
            },
            orderBy() {
              // Services only order by createdAt desc; emulate newest-first using
              // the insertion sequence stamped on each row.
              result = [...result].sort(
                (a, b) => Number(b.__seq ?? 0) - Number(a.__seq ?? 0),
              );
              return builder;
            },
            limit(n: number) {
              return Promise.resolve(snapshot(result.slice(0, n)));
            },
            then(onF: (v: Row[]) => unknown, onR?: (e: unknown) => unknown) {
              return Promise.resolve(snapshot(result)).then(onF, onR);
            },
          };
          return builder;
        },
      };
    },

    // INSERT: db.insert(table).values(v).returning()
    insert(table: unknown) {
      const ft = tableFor(table);
      return {
        values(v: Row) {
          const row: Row = {
            id: v.id ?? idFactory(),
            createdAt: v.createdAt ?? new Date(),
            ...v,
            __seq: ft.nextSeq(),
          };
          if ('updatedAt' in v || 'updatedAt' in row) {
            row.updatedAt = (v.updatedAt as unknown) ?? row.createdAt;
          }
          ft.rows.push(row);
          return {
            returning() {
              return Promise.resolve([{ ...row }]);
            },
          };
        },
      };
    },

    // UPDATE: db.update(table).set(patch).where(cond).returning()
    update(table: unknown) {
      const ft = tableFor(table);
      return {
        set(patch: Row) {
          return {
            where(cond: unknown) {
              const parsed = parseCondition(cond);
              const updated: Row[] = [];
              for (const r of ft.rows) {
                if (rowMatches(r, parsed)) {
                  Object.assign(r, patch);
                  updated.push({ ...r });
                }
              }
              return {
                returning() {
                  return Promise.resolve(updated);
                },
              };
            },
          };
        },
      };
    },

    // DELETE: db.delete(table).where(cond) — removes matching rows in place.
    // Returns a thenable so `await db.delete(...).where(...)` resolves.
    delete(table: unknown) {
      const ft = tableFor(table);
      return {
        where(cond: unknown) {
          const parsed = parseCondition(cond);
          const kept: Row[] = [];
          for (const r of ft.rows) {
            if (!rowMatches(r, parsed)) kept.push(r);
          }
          ft.rows = kept;
          return Promise.resolve(undefined);
        },
      };
    },

    // Minimal transaction shim: run the callback with the same fake db. No real
    // isolation/rollback — enough for services that wrap multi-step writes.
    transaction<T>(cb: (tx: DbClient) => Promise<T>): Promise<T> {
      return Promise.resolve(cb(db));
    },
  } as unknown as DbClient;

  return {
    db,
    insertedInto: (t: unknown) => tableFor(t).rows,
  };
}
