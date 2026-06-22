# Reach + Activate — Production Cutover Runbook

Branch: `integrate/reach-activate` (additive on `main`). This ships Kobe's Reach +
Activate features and his `/run` agent monolith **restructure**, while keeping
**main's Google creds / auth / RBAC / org-config untouched**. The migrations are
**additive + idempotent only** — they create new `reach_*` tables and two `meetings`
columns; they touch **zero** existing tables or rows.

> **Golden rule:** never `git merge erp-rework`. This branch is additive on `main`,
> so the PR merges clean. The only things that touch live prod are Stage D (backup),
> Stage E (mini), and Stage F (merge) — all gated below.

---

## 0. Pre-flight (already done on the branch)

- DB: `0037_reach.sql`, `0038_meetings_readai.sql` (+ `schema/reach.ts`, `meetings` cols)
- API: `erp-server/src/reach/` + `erp-server/src/activate/` (RBAC-gated, ZodDto-validated)
- Gmail send funnels through main's `GoogleAccountsService.getAccessTokenForAccount` (+ `resolveMailbox`)
- Agents: Kobe's `erp-agents/src/erp_agents/` `/run` monolith; reach workflows **adapter-wrap**
  your improved `satellite`/`ammoforge`/`bazooka` (verbatim — scraper, FORGE, send pipeline,
  email-safety fix all intact); `reach.reach_bazooka` registered
- `render.yaml`: `AGENTS_BASE_URL` (blank → set in Stage F), `REACH_SEND_MODE=test`, +3 vars

**Decisions locked:** agent monolith → Mac mini (Tailscale Funnel); first deploy → `test` send mode.
**Decisions deferred (defaults in place):** RBAC reuses `campaigns:*`; reach config is env-level (per-org
seam present, columns not added); per-sender mailbox → org default; Read-AI body scope NOT widened
(`gmail.metadata`), so Read-AI *import* returns headers only until you widen scope.

**Guard — run before merging, must stay true:**
```bash
git diff origin/main -- erp-server/src/google erp-server/src/auth packages/shared \
  packages/db/src/schema/org-config.ts packages/db/src/schema/org.ts erp-agents/workflows
# Expect: ONLY erp-server/src/google/google-accounts.service.ts (+26 lines, the funnel method).
# Anything else here = stop, your Google/RBAC/org/agents were touched.
```

---

## Stage D — Back up Supabase prod (do this FIRST; nothing else touches prod before it)

Either is fine; the migrations are additive so this is belt-and-suspenders:
```bash
# A) logical dump (portable)
pg_dump "$SUPABASE_PROD_URL" -Fc -f evertrust-prod-$(date +%F).dump
# B) OR confirm Point-in-Time Recovery is enabled (Supabase dashboard → Database → Backups)
```
Record the restore point / dump path. **Do not proceed to Stage F without this.**

---

## Stage E — Stand up the agent monolith on the Mac mini (NOT on Render)

The `/run` service is the n8n replacement. Reach/Activate agent calls 503 until it's up.

**Prereqs on the mini:** Python **3.11+** (the monolith uses `X | None` annotations),
the repo checked out, and the central `erp-agents/.env` populated from the vault.

1. **Central env** — create `erp-agents/.env` (read by the monolith and the wrapped agents):
   ```ini
   ERP_BASE_URL=https://evertrust-api.onrender.com
   ERP_AGENT_TOKEN=<same value as ARSENAL_INGEST_TOKEN in Render>   # sent as x-arsenal-token
   # LLM (per-org overrides arrive in /run input; this is the default fallback)
   LLM_BASE_URL=http://127.0.0.1:4000/v1     # LiteLLM gateway on the mini
   LLM_API_KEY=<litellm key>
   LLM_MODEL=<default model id>
   # Lead Satellite scraping
   SEARXNG_URL=http://127.0.0.1:8088
   SEARXNG_API_KEY=<X-Search-Key>
   # Bazooka agent Gmail (agent-side sender; SEPARATE from the ERP per-org Google).
   # Only needed if you invoke the reach.reach_bazooka AGENT directly; the ERP's own
   # Reach send path uses main's per-org Google + REACH_SEND_MODE instead.
   GMAIL_* / GOOGLE_* = <from vault, as your bazooka agent expects>
   ```
2. **Install + run** (venv keeps it off the system Python):
   ```bash
   cd erp-agents
   python3.11 -m venv .venv && . .venv/bin/activate
   pip install -e .                         # monolith (pyproject.monolith.toml: rename to pyproject.toml on the mini, or `pip install -f`)
   pip install -e workflows/satellite -e workflows/ammoforge -e workflows/bazooka  # the wrapped agents
   uvicorn erp_agents.server:app --host 127.0.0.1 --port 8001
   ```
   Make it durable with a launchd plist (pattern: the old `com.evertrust.bazooka.plist`)
   or add it as an `ai-stack` docker-compose service.
3. **Expose via Tailscale Funnel** (same pattern as LiteLLM :443 / Qdrant :8443):
   ```bash
   tailscale funnel --bg --https=8443 127.0.0.1:8001    # pick a free funnel port
   tailscale funnel status                              # note the public https URL
   ```
4. **Local smoke test (no prod yet):**
   ```bash
   curl -s 127.0.0.1:8001/health
   curl -s -X POST 127.0.0.1:8001/run -H 'content-type: application/json' \
     -d '{"workflow":"activate.company_research","mode":"dry_run","input":{"company":"ACME"}}'
   # confirm reach.ammo_forge / reach.lead_satellite / reach.reach_bazooka also resolve (no 404)
   ```

---

## Stage F — Merge → Render auto-deploys + auto-migrates (the prod write)

1. **Set env in the dashboards** (values from the vault):
   - **Render** (`evertrust-api`): `AGENTS_BASE_URL` = the Funnel URL from Stage E;
     confirm `REACH_SEND_MODE=test`, `AGENT_TIMEOUT_MS`, `REACH_TEST_RECIPIENT`, `REACH_TEST_SEND_CAP`.
   - **Vercel** (web): no new vars (reach UI uses `NEXT_PUBLIC_API_URL`).
2. **Open the PR** and re-run the **Guard** (section 0). Review the diff — it must only add
   `reach/`, `activate/`, `erp-agents/src/`, the DB migrations, and the 1 Google funnel method.
3. **Merge to `main`.** Render rebuilds `evertrust-api`; `api-start.sh` runs
   `db:migrate` against **Supabase prod** — applies `0037`/`0038` (idempotent; no-op if already
   applied). Vercel redeploys the web.
   ```bash
   # watch the Render deploy logs for:
   #   [api-start] running DB migrations...  →  applies 0037_reach, 0038_meetings_readai
   #   [api-start] launching API...
   ```

---

## Stage G — Prod smoke test (still safe — `test` mode, no real prospect emails)

```bash
API=https://evertrust-api.onrender.com
curl -s $API/health
curl -s $API/growth/reach/aims                       # 200 + [] (auth per AUTH_DISABLED low-priv user)
# create an aim → triggers ammo_forge via the mini /run
curl -s -X POST $API/growth/reach/aims -H 'content-type: application/json' \
  -d '{"name":"smoke","niche":"Housing","region":"Bavaria","sender":"info"}'
# scrape → lead_satellite; send a round → REACH_SEND_MODE=test redirects to REACH_TEST_RECIPIENT
```
Confirm: aim created (templates populated by ammo_forge), scrape returns leads, a send is
**recorded but redirected** to the test inbox (no prospect emailed). Check Render logs for
agent `/run` calls succeeding against the mini funnel.

Verify the DB landed (read-only):
```bash
psql "$SUPABASE_PROD_URL" -c "\dt reach_*"                         # reach_aims/leads/sends exist
psql "$SUPABASE_PROD_URL" -c "select column_name from information_schema.columns where table_name='meetings' and column_name in ('read_ai_id','summary');"
```

---

## Stage H — Go live (only after G passes)

Flip Reach to real sending — ideally per-org, conservatively:
- Set `REACH_SEND_MODE=live` in Render (global) **or** keep global `test` and enable live per-org
  once the per-org config columns are added (deferred decision #2).
- Watch the first live batch closely; the email-safety fix means LLM-guessed addresses stay
  `unverified` and are not auto-emailed.

---

## Rollback

| If… | Do |
|---|---|
| Bad deploy (API) | Render → Rollback to the previous deploy (instant) |
| Bad migration / data | restore the Stage-D dump or PITR point on Supabase |
| Agent service flaky | `AGENTS_BASE_URL` blank in Render → Reach/Activate agent calls 503 cleanly; ERP otherwise unaffected |
| Need to undo the whole feature | revert the PR merge commit on `main`; the additive tables can be left (unused) or dropped via a follow-up migration |

Migrations are additive, so a rollback never destroys existing data.

---

## What this runbook deliberately does NOT change
- Google creds / auth / token crypto / `auth/google-auth` / `src/google/*` — **main's, untouched**
- RBAC (`PERMISSIONS`/`ROLE_PERMISSIONS`/guards) — **main's, untouched**
- `org` / `org-config` multi-tenant schema — **main's, untouched**
- Your improved Python agents under `erp-agents/workflows/` — **untouched** (wrapped, not edited)
