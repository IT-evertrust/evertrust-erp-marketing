# Team Hosting — shared infra on the Mac mini

The Docker infra stack (Postgres, n8n, optional pgAdmin) runs **once**, 24/7, on the Mac mini.
The apps (`erp-server` NestJS, `erp-client` Next.js) keep running on each developer's laptop and
connect to the mini over **Tailscale**.

```
MacBook 1 ─┐
MacBook 2 ─┼─ tailnet (WireGuard) ──> Mac mini  ── docker: postgres :5432
MacBook 3 ─┘                          mac-mini-ca-mac.tailc3d837.ts.net   n8n      :5678
                                                                          pgadmin  :5050 (on demand)
```

Canonical hostname everywhere: **`mac-mini-ca-mac.tailc3d837.ts.net`** (Tailscale MagicDNS).
It works identically in the office and remotely; on the office LAN Tailscale takes the direct
local path, so there is no performance penalty.

---

## 1. Connecting from your laptop

One-time: install [Tailscale](https://tailscale.com/download) and sign in to the team tailnet.

In `erp-server/.env` on your laptop (copy from `.env.example`, values from the team vault):

```bash
DB_HOST=mac-mini-ca-mac.tailc3d837.ts.net
DB_PORT=5432
DB_NAME=erp_<yourname>          # your own database — see section 6
DATABASE_URL=postgresql://evertrust-erp:<DB_PASSWORD>@mac-mini-ca-mac.tailc3d837.ts.net:5432/erp_<yourname>
```

Browser URLs:

| Service | URL |
|---|---|
| n8n | http://mac-mini-ca-mac.tailc3d837.ts.net:5678 |
| pgAdmin (only when started) | http://mac-mini-ca-mac.tailc3d837.ts.net:5050 |

Passwords live in the team password vault — never in git, never in chat.

## 2. If the hostname doesn't resolve

1. `tailscale status` — are you connected? Is the mini listed and online?
2. `ping 100.81.249.124` (the mini's Tailscale IPv4) — if this works but the name doesn't,
   use the IP temporarily and report the MagicDNS issue.
3. Office-LAN fallback if Tailscale itself is down: `macmini.local` (Bonjour) — only works
   in the office, and only if the mini's local hostname is set to `macmini`.
4. Still stuck → ask the infra owner.

## 3. Mac mini one-time setup

Run through this checklist top to bottom:

- [ ] Dedicated admin account `erpadmin`; strong password in the vault.
- [ ] **FileVault OFF** (System Settings → Privacy & Security). Trade-off, decided: with
      FileVault on, a power-cut reboot stops at the pre-boot unlock screen and nothing starts
      until someone types the password; auto-login is impossible. The disk is unencrypted at
      rest — the office door is the physical control; backups can be encrypted instead.
- [ ] Auto-login as `erpadmin` (System Settings → Users & Groups). Required: Docker on macOS
      only runs inside a logged-in user session.
- [ ] Never sleep + auto-restart after power failure:
      ```bash
      sudo pmset -a sleep 0 displaysleep 0 disksleep 0 womp 1 autorestart 1 powernap 0
      pmset -g    # verify
      ```
- [ ] Docker Desktop installed, Settings → General → **"Start Docker Desktop when you sign in"** ON.
      (OrbStack requires a paid license for company use; colima gains nothing here — it still
      needs a user session on macOS.)
- [ ] Software updates: automatic macOS upgrades OFF, "Install Security Responses and system
      files" ON. macOS upgrades are manual, announced, during work hours.
- [ ] Tailscale installed and signed in (done — `mac-mini-ca-mac.tailc3d837.ts.net`).
      In the Tailscale admin console, disable key expiry for the mini so it never silently
      drops off the tailnet.
- [ ] Screen saver + "require password" ON (locking the screen does not affect Docker).
- [ ] Optional but cheap: a small UPS so brownouts never hit Postgres mid-write.
- [ ] If the macOS firewall prompts for `com.docker.backend` when the first laptop connects: Allow.

Power-cut recovery chain (all automatic once the above is done):
power returns → `autorestart` boots macOS → auto-login starts the session → Docker Desktop
launches at login → `restart: unless-stopped` brings every container back.

## 4. Deploying and updating the stack on the mini

- Repo lives at `~/evertrust-erp-marketing` (clone once; no sudo anywhere).
- **One named infra owner** updates the mini — nobody else. Update only when
  `erp-server/docker-compose.yml` or related infra files change.
- Update sequence:
  ```bash
  cd ~/evertrust-erp-marketing && git pull
  cd erp-server
  docker compose pull
  docker compose up -d
  docker compose ps      # postgres, n8n-postgres, n8n: running/healthy
  ```
- n8n upgrades are **deliberate**: the image is pinned (`n8nio/n8n:2.25.6`) because n8n runs
  one-way DB migrations on boot. To upgrade: export all workflows (Settings → Download), bump
  the tag in git, announce it, then run the update sequence.

## 5. Secrets

- `erp-server/.env` on the mini: `chmod 600`, filled from `.env.example`.
- The canonical copy of every secret is the **team password vault**. Transfer to the mini via
  Screen Sharing paste, `scp` over the tailnet, or AirDrop — never git, never chat.
- Generate fresh secrets for the mini (do not reuse laptop dev passwords):
  ```bash
  openssl rand -base64 24    # DB_PASSWORD, N8N_DB_PASSWORD, PGADMIN_PASSWORD
  openssl rand -base64 32    # N8N_ENCRYPTION_KEY
  ```
- **`N8N_ENCRYPTION_KEY` is set once, before n8n's first boot, and never changes.** It encrypts
  every credential stored in n8n; changing or losing it makes them all undecryptable. Store it
  in the vault the moment it is generated.
- On the mini, `HOST_NAME=mac-mini-ca-mac.tailc3d837.ts.net` — this is what makes n8n's
  webhook and editor URLs reachable from the laptops instead of pointing at `localhost`.

## 6. Per-developer databases

One shared Postgres instance, isolated schemas:

- Each developer gets their own database: `erp_macco`, `erp_<dev2>`, `erp_<dev3>`.
- One shared integration database: `erp_shared`.
- Create yours (from any laptop, or on the mini):
  ```bash
  docker exec -it erp-postgres createdb -U evertrust-erp erp_<yourname>
  ```
- Rules:
  - Schema experiments and (once Prisma is wired) `prisma migrate dev` → **your own DB only**.
  - `prisma migrate deploy` against `erp_shared` → only by the migration's author, after merge.
  - TypeORM `synchronize` is `false` in `app.module.ts` and stays false forever — three
    laptops auto-mutating one schema is silent data loss.

## 7. n8n team rules

- The **owner account** is `info@evertrust-germany.de` with a vault-stored password. The three
  personal accounts are invited as members (Settings → Users).
- SaaS credentials inside n8n are managed by the infra owner; teammates reference them,
  never re-create duplicates.
- Editing is **last-save-wins** — there is no merge. Announce in team chat before opening a
  workflow for editing; for experiments, duplicate the workflow (`Copy of X`) instead.
- Webhook paths are instance-unique: two workflows cannot both register `/test`.

## 8. Backups

Nightly job on the mini → external SSD (`/Volumes/ERP-Backup`), 14-day retention.

`~/bin/erp-backup.sh`:
```bash
#!/bin/zsh
set -euo pipefail
ROOT="/Volumes/ERP-Backup/erp-backups"
DIR="$ROOT/$(date +%F)"
mkdir -p "$DIR"
docker exec erp-postgres pg_dumpall -U evertrust-erp | gzip > "$DIR/erp-postgres.sql.gz"
docker exec n8n-postgres pg_dumpall -U n8n            | gzip > "$DIR/n8n-postgres.sql.gz"
docker run --rm -v erp-server_n8n_data:/data -v "$DIR":/backup alpine \
  tar czf /backup/n8n_data.tgz -C /data .
find "$ROOT" -mindepth 1 -maxdepth 1 -type d -mtime +14 -exec rm -rf {} +
```
(`chmod +x ~/bin/erp-backup.sh`; volume name is `erp-server_n8n_data` — verify once with
`docker volume ls`.)

`~/Library/LaunchAgents/com.evertrust.erp-backup.plist`:
```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN"
  "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>com.evertrust.erp-backup</string>
  <key>ProgramArguments</key>
  <array><string>/Users/erpadmin/bin/erp-backup.sh</string></array>
  <key>StartCalendarInterval</key>
  <dict><key>Hour</key><integer>2</integer><key>Minute</key><integer>30</integer></dict>
  <key>StandardErrorPath</key>
  <string>/Users/erpadmin/Library/Logs/erp-backup.log</string>
</dict>
</plist>
```
Load it: `launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/com.evertrust.erp-backup.plist`

**Monthly restore drill** (5 minutes — an unrestored backup is a hope, not a backup):
```bash
docker exec -it erp-postgres createdb -U evertrust-erp restore_test
gunzip -c erp-postgres.sql.gz | docker exec -i erp-postgres psql -U evertrust-erp -d restore_test
docker exec -it erp-postgres dropdb -U evertrust-erp restore_test
```

## 9. Remote access & exposure rules

- Remote access **is** Tailscale — already live. Free tier covers 3 users comfortably.
- **Never port-forward 5432 / 5678 / 5050 on the office router.** Internet scanners find an
  open 5432 within minutes and brute-force it continuously; this Postgres has password auth
  and no TLS; n8n stores third-party SaaS credentials — an exposed instance is a credential
  vault with a web UI. Tailscale provides the same convenience with zero exposed ports.
- Future, out of scope for now:
  - `tailscale serve` → real HTTPS for the n8n editor (then remove `N8N_SECURE_COOKIE: "false"`
    from the compose file and set `N8N_PROTOCOL: https`).
  - `tailscale funnel` or Cloudflare Tunnel → only if local n8n workflows must one day
    receive webhooks from external SaaS.

## 10. Recovery playbook

| Symptom | Do this |
|---|---|
| Power cut | Nothing — the chain in section 3 recovers automatically. Verify after: `docker compose ps` shows postgres + n8n-postgres + n8n healthy. |
| Mini reachable but containers down | Screen Share in → is Docker Desktop running? A blocking macOS dialog (update prompt, keychain) can prevent auto-login from completing — dismiss it, Docker starts. |
| n8n won't start after an image bump | `docker compose logs n8n`. Migration failure → restore `n8n-postgres.sql.gz` + `n8n_data.tgz` from last night's backup, revert the tag in git, `docker compose up -d`. |
| Disk full | Check backup SSD mounted (else dumps land on the boot disk); `docker system prune` for dangling images. |
| Mini dies entirely | Any laptop can run the same stack meanwhile: fill `.env` (HOST_NAME=localhost), `docker compose up -d`, restore from the latest backup. |

## 11. Migrating an existing laptop stack to the new compose file

For anyone who already ran the old localhost stack on their laptop:

- The new compose **requires** a real `.env` (it refuses to boot without `DB_PASSWORD`,
  `N8N_DB_PASSWORD`, `N8N_ENCRYPTION_KEY`, `HOST_NAME`). Copy `.env.example` → `.env`.
- **Postgres password caveat:** `POSTGRES_PASSWORD` only applies when a volume is first
  initialized. An existing `postgres_data` volume keeps its old password no matter what
  `.env` says — either keep using the old password locally or recreate the volume.
- **n8n encryption key caveat:** an existing local `n8n_data` volume has the old default key
  persisted inside it. Either set `N8N_ENCRYPTION_KEY=supersecretencryptionkey` in your local
  `.env` to keep that volume, or start clean:
  ```bash
  docker compose down n8n n8n-postgres
  docker volume rm erp-server_n8n_data erp-server_n8n_postgres_data
  docker compose up -d
  ```
  (You lose the local n8n owner account + workflows — fine for a scratch instance.)
- Old compose volumes were named after the directory (`erp-server_*`); the new file pins
  `name: erp-server`, so existing volumes keep working unchanged.
