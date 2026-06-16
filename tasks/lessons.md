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

### 2026-06-16 - Conflated "config built" with "feature wired end-to-end"
- **Trigger:** Said the per-org sender/calendar was "already in place" and "works with Google for you." The user pushed back — the n8n workflows still send via the 2 hardcoded Gmail creds and poll those 2 inboxes. Only the ERP config layer + the `/campaigns/:id/config` seam were built; the n8n send/reply mechanics were unchanged (only Reply Glock's calendar *id* was rewired).
- **Lesson:** "Built/committed in the ERP" and "exposed in the config endpoint" is NOT the same as "the consuming system actually uses it." A feature that spans ERP↔n8n is only "in place" when the CONSUMER (the n8n node / send path) is wired — not when the producer can emit the data.
- **Rule going forward:** When reporting a cross-system feature's status, name the layer explicitly (produced/config vs consumed/wired) and never say "in place / works" for the whole feature unless the consumer has been changed AND verified. Default to under-claiming: give a what's-wired-vs-still-hardcoded table.

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

### 2026-06-13 - "Settings" pages: confirm intent against what already exists
- **Trigger:** Asked to build General + Configuration settings pages, I made General a clone of the existing user profile (`/users/[id]`, already in the avatar menu) and made Configuration a read-only status/health dashboard. The user wanted General = app/website preferences (theme, language, locale) and Configuration = a real control surface to edit the n8n workflow nodes + the Postgres data that drives them (webhook endpoints, ingest token, cadence, niches/targets/suppressions/sender).
- **Lesson:** I designed named surfaces from the label alone without contrasting them against features the app already ships, so I restated existing functionality; and I read "Configuration" as "show the config's status" rather than "edit the config."
- **Rule going forward:** Before designing any named surface (a "Settings", "Dashboard", "Config" page), first list what already covers that concern in the app and explicitly state how the new surface differs — never duplicate an existing page. Read "Configuration/Settings" as an EDIT surface (knobs that change state) unless the user says "status/health."
