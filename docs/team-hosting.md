# Team Hosting — Mac mini: ERP Postgres + AI Gateway

The Mac mini runs 24/7 and hosts two Docker stacks. Apps (`erp-server` NestJS, `erp-client`
Next.js) run on laptops. **n8n runs on n8n CLOUD** (the local n8n was retired 2026-06-10; its
volumes `erp-server_n8n_data` / `erp-server_n8n_postgres_data` are kept on disk just in case).

```
n8n cloud ──HTTPS+key──► Funnel :443 ──► LiteLLM "Hermes req" gateway ──► Ollama backends:
                                          │ cache: in-memory + Redis        ├ Trev's machine (tailnet, PRIMARY)
                                          │ audit: requests logged to PG    ├ mini hermes3:8b (fallback, free)
n8n cloud ──HTTPS+api-key─► Funnel :8443 ─► Qdrant (RAG vectors)            └ deepseek-cloud (paid, optional)
n8n cloud ──HTTPS+X-Search-Key─► Funnel :10000 ─► Caddy auth ─► SearXNG (web search for agents)
laptops ──tailnet──► mac-mini-ca-mac.tailc3d837.ts.net:5432 (ERP Postgres)
```

| What | Where | Port |
|---|---|---|
| ERP Postgres | `erp-server/docker-compose.yml` | 5432 (published) |
| LiteLLM gateway | `ai-stack/docker-compose.yml` | 4000 loopback → Funnel **:443** |
| Qdrant | `ai-stack/docker-compose.yml` | 6333 loopback → Funnel **:8443** |
| SearXNG (behind Caddy auth) | `ai-stack/docker-compose.yml` | 8088 loopback → Funnel **:10000** |
| Redis (gateway cache) | `ai-stack/docker-compose.yml` | internal only |
| Ollama | native macOS app (Metal) | 11434 loopback |

## 1. Connecting from your laptop

Install [Tailscale](https://tailscale.com/download), join the team tailnet. Then in your
laptop's `erp-server/.env` (values from the vault):

```bash
DB_HOST=mac-mini-ca-mac.tailc3d837.ts.net
DB_PORT=5432
DB_NAME=erp_<yourname>     # your own database — see section 5
```

Fallbacks if the name doesn't resolve: `tailscale status` → `ping 100.81.249.124` → ask the
infra owner.

## 2. ⚠ The loopback-5432 trap on the mini

A native **Homebrew postgresql@18** runs on the mini bound to `127.0.0.1:5432`. Consequences:

- `localhost:5432` **on the mini** = the brew instance, NOT the Docker `erp-postgres`.
- Containers using `host.docker.internal:5432` also land on the brew instance.
- Laptops connecting via the Tailscale name are fine (they hit the Docker-published port).

Rules: containers join `erp-server_erp-network` and use host `erp-postgres` (the ai-stack
already does); something on the mini actively uses the brew instance, so do NOT stop it
without checking — consolidating the two Postgreses is an open backlog item.

## 3. Mac mini one-time checklist

- [ ] **Power (NOT yet applied!):** `sudo pmset -a sleep 0 displaysleep 0 disksleep 0 womp 1 autorestart 1 powernap 0`
- [ ] Auto-login + FileVault OFF (power-cut recovery; office door is the physical control).
- [ ] Docker Desktop: "Start when you sign in" ON; cap VM memory at **3 GB** (Settings →
      Resources) — the mini has only 8 GB and the local Hermes fallback needs headroom.
- [ ] Tailscale signed in; **disable key expiry** for the mini in the admin console.
- [ ] **Enable Funnel on the tailnet** (one-time, admin console → Access Controls; the policy
      needs `"nodeAttrs": [{"target": ["autogroup:member"], "attr": ["funnel"]}]`), then:
      ```bash
      tailscale funnel --bg 4000               # :443   → gateway
      tailscale funnel --bg --https=8443 6333  # :8443  → Qdrant
      tailscale funnel --bg --https=10000 8088 # :10000 → SearXNG (Caddy auth proxy)
      tailscale funnel status
      ```
      `--bg` persists across reboots.
- [ ] Ollama: tuned via `~/Library/LaunchAgents/com.evertrust.ollama-env.plist`
      (KEEP_ALIVE 5m, flash attention, q8 KV cache, parallel 1 — keeps the 8 GB machine
      breathing); Ollama.app removed from plain Login Items (the agent starts it).
      Models: `hermes3:8b`, `nomic-embed-text` (+ signed in to ollama.com for deepseek-cloud).
- [ ] Software updates: security auto, OS upgrades manual + announced.

## 4. Deploy / update / secrets

Repo lives at `~/Documents/evertrust-erp-marketing` on the mini. ONE named infra owner.

```bash
git pull
cd erp-server && docker compose up -d          # ERP postgres first (shared network)
cd ../ai-stack && docker compose up -d         # then the AI stack
docker compose ps                              # everything healthy
```

Secrets: `erp-server/.env` and `ai-stack/.env`, both gitignored + `chmod 600`, canonical
copies in the team vault, transferred via Screen Sharing/scp/AirDrop only.
**`LITELLM_SALT_KEY` is set once and never changes** (it encrypts gateway DB credentials).
The n8n virtual key for the gateway: `~/.evertrust/n8n-virtual-key.json` on the mini → paste
into the n8n cloud OpenAI credential (Base URL `https://mac-mini-ca-mac.tailc3d837.ts.net/v1`).
Mint more keys: `curl http://127.0.0.1:4000/key/generate -H "Authorization: Bearer $LITELLM_MASTER_KEY" ...`

## 5. Per-developer databases (ERP Postgres)

`erp_<yourname>` per developer + `erp_shared` for integration, on the one Docker Postgres:
```bash
docker exec -it erp-postgres createdb -U evertrust-erp erp_<yourname>
```
Schema experiments and (once Prisma is wired) `migrate dev` → your own DB only. TypeORM
`synchronize` stays `false` forever.

## 6. Trev's machine — the primary model host

1. Install Tailscale, join the tailnet; note the machine's 100.x address.
2. Ollama: `OLLAMA_HOST=0.0.0.0:11434` and `OLLAMA_KEEP_ALIVE=30m` (env before starting),
   `ollama pull hermes3:8b` and `ollama pull deepseek-r1:14b` (or per RAM).
3. Keep it awake while serving (`caffeinate -dims` or power settings); gaps are tolerated —
   the gateway falls back to the mini's hermes3:8b automatically — but minimize them.
4. On the mini: set `TAILNET_OLLAMA=http://<trev-100.x>:11434` in `ai-stack/.env`, then
   `cd ai-stack && docker compose up -d litellm`.

Model aliases n8n uses (gateway routes them): `hermes`, `deepseek` (Trev), `hermes-mini`
(mini fallback), `deepseek-cloud` (paid last resort), `local-embed` (RAG embeddings).

## 7. n8n (cloud) team rules

- Workflows live at evertrustgmbh.app.n8n.cloud; editing is last-save-wins — announce in
  chat before opening a workflow; duplicate (`Copy of X`) for experiments.
- LLM nodes use the `LiteLLM Gateway (mac-mini)` credential; web-search + German template
  nodes stay on the OpenAI credential (see tasks/todo.md migration plan).
- NEVER recreate workflows that have dedup/static state (RAG AGENT, REACH BAZOOKA) — update
  in place or their state resets and leads get double-contacted.

## 8. Backups (nightly, external SSD, 14-day retention)

`~/bin/erp-backup.sh` via launchd (`com.evertrust.erp-backup`, 02:30):
```bash
#!/bin/zsh
set -euo pipefail
ROOT="/Volumes/ERP-Backup/erp-backups"; DIR="$ROOT/$(date +%F)"; mkdir -p "$DIR"
docker exec erp-postgres pg_dumpall -U evertrust-erp | gzip > "$DIR/erp-postgres.sql.gz"  # incl. litellm DB
docker run --rm -v ai-stack_qdrant_data:/data -v "$DIR":/backup alpine tar czf /backup/qdrant_data.tgz -C /data .
find "$ROOT" -mindepth 1 -maxdepth 1 -type d -mtime +14 -exec rm -rf {} +
```
Monthly restore drill: restore the dump into a scratch DB; an unrestored backup is a hope,
not a backup. (n8n cloud is backed up by n8n; export important workflows periodically.)

## 9. Exposure rules

- Remote access for humans = Tailscale. The ONLY public surfaces are the three Funnel ports
  (gateway 443 with virtual-key auth, Qdrant 8443 with API key, SearXNG 10000 with
  X-Search-Key header enforced by a Caddy proxy) — required because n8n cloud lives outside
  the tailnet. **Never port-forward anything on the office router.**
- SearXNG live since 2026-06-10 (`tailscale funnel --bg --https=10000 8088`): web-search
  backend for the WF-03 agent nodes, so they can move off OpenAI's hosted webSearch.
- Future: `tailscale serve`/TLS for prettier setups.

## 10. Recovery playbook

| Symptom | Do this |
|---|---|
| Power cut | Automatic: autorestart → auto-login → Docker + Tailscale at login → `unless-stopped` containers + funnel resume. Verify `docker compose ps` in both stacks. |
| n8n workflows erroring on LLM calls | `docker compose ps` (ai-stack), `docker logs ai-litellm`. Trev's machine offline → calls auto-fall back to `hermes-mini` (slower, weaker — expected). |
| Gateway up but slow | Mini is swapping (hermes-mini loaded). Wait for the 5-min keep-alive unload, or point n8n traffic at `deepseek-cloud` temporarily. |
| litellm restart-looping | `docker logs ai-litellm` — DB reachable? erp-server stack must be up (shared network). |
| Qdrant data lost | Re-run the "EVERTRUST - KB INGEST" n8n workflow — the collection rebuilds from the Drive knowledge base in seconds. |
