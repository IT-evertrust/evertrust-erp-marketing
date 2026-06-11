# tasks/lessons.md

Self-improvement log, per CLAUDE.md: after **any** correction from the user, add an entry here capturing the pattern behind the mistake and a concrete rule that prevents it from recurring. Review this file at the start of every session for this project, and ruthlessly iterate on the rules until the mistake rate drops.

## Entry template

```markdown
### YYYY-MM-DD - <short title of the mistake pattern>
- **Trigger:** What happened — what was done wrong and how the user corrected it.
- **Lesson:** The underlying pattern or wrong assumption, not just the surface symptom.
- **Rule going forward:** A concrete, checkable rule to apply next time.
```

## Lessons

_No lessons recorded yet._

## Imported from evertrust-ERP (pre-migration gotchas, 2026-06-11)

Carried over from the archived source repo's `tasks/lessons.md` — these are codebase gotchas,
not session corrections, but they bite hard:

### pnpm: declare runtime deps explicitly (no phantom deps)
A package you `import` MUST be in that workspace's `package.json` dependencies, even if it's
transitively present. Local pnpm hoisting hides the problem; the strict Docker install
(`pnpm install --frozen-lockfile`) does not → container crashes at boot with
`Cannot find module '<x>'`. Hit with `multer`. Rule: if you import it, declare it — and
**verify the container BOOTS**, not just builds.

### drizzle-kit enum-value changes are unreliable — squash in dev only
Incremental migrations that rename/remove Postgres enum values generate SQL that fails on
apply. Dev fix (no released data): `rm -rf packages/db/drizzle && db:generate` → one baseline,
then a fresh DB. NEVER once a migration has been applied to the shared/prod DB. Also:
drizzle-kit does NOT emit `CREATE EXTENSION` — `CREATE EXTENSION IF NOT EXISTS vector;` is
hand-prepended to the baseline migration and must survive any regeneration.

### Keep the seed idempotent
The api container re-runs migrate + seed on every start — the seed early-returns if the
bootstrap org exists. Keep any future seeding guarded the same way.

### Docker / compose tips
- The API runs under `tsx` (runtime-transpile) because `@evertrust/db`/`@evertrust/shared`
  ship raw TS — intentional, do not "fix" by precompiling without a plan.
- `docker compose up -d --no-deps <svc>` restarts one service without re-triggering deps.
- Additive migrations apply in place; enum/PK changes need a fresh schema (dev only).
