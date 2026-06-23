# START — running the Evertrust Growth ERP locally

This is the **canonical "how do I start the app again" guide**. The ERP is three
services that run together:

| Service       | Folder        | Port | What it is                                   |
| ------------- | ------------- | ---- | -------------------------------------------- |
| **Web (UI)**  | `erp-client`  | 3000 | Next.js 15 app — the R‑E‑A‑N funnel UI       |
| **API**       | `erp-server`  | 3001 | NestJS 11 backend (auth, Reach, Engage, …)   |
| **Agents**    | `erp-agents`  | 8001 | Python FastAPI — the AI workflows (brain)    |

You open the app at **http://localhost:3000**. The web app talks to the API on
`:3001`, and the API calls the Python agents on `:8001`.

Two shared packages must be **built to `dist/` first** (the API imports them as
compiled CommonJS, not raw TypeScript):

- `packages/shared` → `@evertrust/shared`
- `packages/db` → `@evertrust/db`

---

## 0. Prerequisites (one time)

- **Node ≥ 20** (currently on v24) and **pnpm 11** (`corepack enable` if missing)
- **Python ≥ 3.11** with the agents venv at `erp-agents/.venv`
- **Env files present** (they hold secrets and are git‑ignored — see `CONFIG.md`):
  - `erp-server/.env` — `DATABASE_URL`, `JWT_SECRET`, `GOOGLE_*`, `GOOGLE_TOKEN_ENC_KEY`, `REACH_*`, `AGENTS_BASE_URL`
  - `erp-client/.env.local` — `NEXT_PUBLIC_API_URL`, `NEXT_PUBLIC_GOOGLE_CLIENT_ID`, `NEXT_PUBLIC_AUTH_DISABLED`
  - `erp-agents/.env` — LLM gateway / model config

If the venv doesn't exist yet:

```bash
cd erp-agents
python3 -m venv .venv
.venv/bin/pip install -e .            # installs fastapi/uvicorn + the erp_agents package
```

---

## 1. Install + build (after a fresh clone or a `git pull`)

From the repo root:

```bash
cd ~/marketing-agent-workflows
pnpm install
pnpm build            # turbo: builds @evertrust/shared, @evertrust/db, erp-server, erp-client
```

> **Why the build matters:** if you skip building `packages/*`, the API crashes on
> boot with `ERR_UNSUPPORTED_DIR_IMPORT`. Any time you change a file under
> `packages/shared` or `packages/db`, rebuild it:
> `pnpm --filter @evertrust/shared build && pnpm --filter @evertrust/db build`.

---

## 2. Start the app (3 terminals)

Open three terminals. Start them in this order (agents → API → web).

### Terminal 1 — Agents (`:8001`)

```bash
cd ~/marketing-agent-workflows/erp-agents
.venv/bin/uvicorn erp_agents.server:app --host 0.0.0.0 --port 8001 --reload
```

### Terminal 2 — API (`:3001`)

Dev (auto‑reload on code changes):

```bash
cd ~/marketing-agent-workflows/erp-server
pnpm start:dev          # nest start --watch
```

…or production‑style (faster, no watch — uses the `dist/` you built in step 1):

```bash
cd ~/marketing-agent-workflows/erp-server
pnpm build && node dist/main.js
```

### Terminal 3 — Web (`:3000`)

```bash
cd ~/marketing-agent-workflows/erp-client
pnpm dev                # next dev -p 3000
```

Then open **http://localhost:3000** and log in with Google.

---

## 3. Verify everything is up

```bash
# ports
for p in 3000 3001 8001; do lsof -ti:$p >/dev/null && echo "$p UP" || echo "$p DOWN"; done

# agents health (lists the registered workflows)
curl -s http://localhost:8001/health

# API is serving (302 -> /login when logged out is expected)
curl -s -o /dev/null -w "%{http_code}\n" http://localhost:3001/growth/reach/aims
```

`/health` should return `{"status":"ok","workflows":[…]}` with the 7 reach/engage/activate workflows.

---

## 4. Stop / restart

```bash
# stop one service by its port
lsof -ti:3001 | xargs kill -9      # API   (use 3000 for web, 8001 for agents)

# restart the API (prod style) in the background
cd ~/marketing-agent-workflows/erp-server && nohup node dist/main.js > /tmp/erp-server.log 2>&1 &
```

In dev mode (`pnpm start:dev` / `pnpm dev`) just `Ctrl‑C` the terminal and re‑run the command.

---

## 5. Troubleshooting

| Symptom | Cause → Fix |
| --- | --- |
| API exits immediately with `ERR_UNSUPPORTED_DIR_IMPORT` | `packages/*` not built → `pnpm --filter @evertrust/shared build && pnpm --filter @evertrust/db build`, then restart the API. |
| `EADDRINUSE: :3001` (or 3000/8001) | A previous instance is still running → `lsof -ti:3001 \| xargs kill -9`, then start again. |
| Web loads but every API call is 401/302 to `/login` | Not signed in. Every route except `/login` is auth‑gated. Log in with Google at `:3000`. |
| Login page says **"sign in unavailable"** | `NEXT_PUBLIC_GOOGLE_CLIENT_ID` missing from `erp-client/.env.local`. |
| Google **Calendar empty** / Engage threads empty / "token could not be refreshed" | The connected Google account needs to **log out and log back in** (re‑consent). Tokens were re‑keyed; old ones can't be decrypted. This also unblocks Reach sending. |
| Agents unreachable from the API | Agents not running, or `AGENTS_BASE_URL` in `erp-server/.env` doesn't point at `http://localhost:8001`. |
| Want to run with **no login** (demo) | Set `NEXT_PUBLIC_AUTH_DISABLED=true` in `erp-client/.env.local` **and** the matching API flag, then restart. Leave it `false` for normal use. |

---

## Quick reference

```
open    → http://localhost:3000
agents  → cd erp-agents && .venv/bin/uvicorn erp_agents.server:app --host 0.0.0.0 --port 8001 --reload
api     → cd erp-server && pnpm start:dev          (or: pnpm build && node dist/main.js)
web     → cd erp-client && pnpm dev
build   → pnpm install && pnpm build               (run at repo root after a pull)
```

See `CONFIG.md` for the full env/credential map and `CLAUDE.md` for project conventions.
