import { z } from 'zod';

// Boot-time environment contract. Validated once at startup so the process
// FAILS LOUD (crashes) on misconfiguration instead of erroring deep in a request.
export const EnvSchema = z.object({
  NODE_ENV: z
    .enum(['development', 'test', 'production'])
    .default('development'),
  PORT: z.coerce.number().int().positive().default(3001),

  // Required secrets — no defaults; missing values must crash the process.
  DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),
  JWT_SECRET: z.string().min(1, 'JWT_SECRET is required'),

  JWT_EXPIRES_IN: z.string().default('1d'),

  // DEMO / NO-LOGIN MODE. When true, the JwtAuthGuard stops requiring a token and
  // treats every (non-@Public) request as a real super-admin user resolved from the
  // DB — so the whole app is usable with nobody signed in. ⚠️ This makes all
  // org data reachable by anyone who can hit the API; only enable behind a gate.
  // Default false = normal auth. Flip to false to restore login.
  AUTH_DISABLED: z
    .enum(['true', 'false'])
    .default('false')
    .transform((v) => v === 'true'),
  // The account AUTH_DISABLED impersonates. Blank = the first active SUPER_ADMIN.
  AUTH_DISABLED_USER_EMAIL: z.string().default(''),

  // Comma-separated allowlist of browser origins for CORS. Empty = no CORS.
  CORS_ORIGINS: z.string().default(''),

  // Cookie flags. `secure` should be true behind TLS in production.
  COOKIE_SECURE: z
    .enum(['true', 'false'])
    .default('false')
    .transform((v) => v === 'true'),

  // SameSite for the auth cookie. Use 'none' (with COOKIE_SECURE=true) when the
  // web and API live on DIFFERENT sites (e.g. *.vercel.app + *.onrender.com) so
  // the session cookie can cross origins. 'lax' is correct for same-site (a shared
  // root domain like app./api.evertrust-germany.de) and for local dev.
  COOKIE_SAMESITE: z.enum(['lax', 'strict', 'none']).default('lax'),

  // Filesystem directory where uploaded tender documents are stored (Phase 4).
  // Created at boot if missing. In containers this is a mounted volume.
  UPLOAD_DIR: z.string().min(1).default('./uploads'),

  // ---- Google OAuth ("Sign in with Google" + Gmail/Calendar on the user's behalf) ----
  // Blank CLIENT_ID/SECRET = the Google sign-in route is DISABLED (redirects to
  // /login?error=google_not_configured), so the API is safe to run before GCP is set up.
  GOOGLE_CLIENT_ID: z.string().default(''),
  GOOGLE_CLIENT_SECRET: z.string().default(''),
  // The backend callback Google redirects to, e.g. http://localhost:3001/auth/google/callback.
  GOOGLE_OAUTH_REDIRECT_URI: z.string().default(''),
  // Space-separated scopes: identity (openid/email/profile) + minimal Gmail/Calendar.
  GOOGLE_OAUTH_SCOPES: z
    .string()
    .default(
      'openid email profile https://www.googleapis.com/auth/gmail.send https://www.googleapis.com/auth/calendar.events',
    ),
  // Secret used to encrypt stored refresh tokens at rest (any string; sha256-derived to
  // a 32-byte AES key). Blank = refresh tokens cannot be stored (sign-in fails clearly).
  GOOGLE_TOKEN_ENC_KEY: z.string().default(''),
  // Where to send the browser after a successful Google sign-in (the web app origin).
  FRONTEND_URL: z.string().default('http://localhost:3000'),

  // Growth Engine: the AIM "deploy campaign" n8n webhook (the reference's
  // EVERTRUST_DEPLOY_WEBHOOK). Empty = skip the deploy step — the campaign still
  // persists as DRAFT — so the feature is safe to run before the webhook is set.
  // On a 2xx the campaign flips to ACTIVE; a failure leaves it DRAFT (no FAILED
  // state) with the error surfaced in the create response.
  N8N_AIM_WEBHOOK_URL: z.string().default(''),

  // Arsenal stage webhooks (the "Run now" triggers). Each blank = that stage's
  // trigger is disabled (the API rejects the run + the button hides). The
  // schedule-only n8n workflows (Bazooka, Reply Glock, Sleeper) need a Webhook
  // trigger added in n8n before their URLs resolve.
  N8N_LEAD_SATELLITE_WEBHOOK_URL: z.string().default(''),
  N8N_AMMO_FORGE_WEBHOOK_URL: z.string().default(''),
  N8N_REACH_BAZOOKA_WEBHOOK_URL: z.string().default(''),
  N8N_REPLY_GLOCK_WEBHOOK_URL: z.string().default(''),
  N8N_SLEEPER_GRENADE_WEBHOOK_URL: z.string().default(''),

  // Python-agent service base URLs (the ERP-native replacement for the n8n
  // webhooks). When a stage's AGENT_*_URL is set it takes PRECEDENCE over the n8n
  // webhook: ArsenalService POSTs to `${url}/<agent>/run` (live) and the agent
  // posts its own /arsenal/runs/callback. Blank = use the n8n webhook fallback.
  AGENT_LEAD_SATELLITE_URL: z.string().default(''),
  AGENT_AMMO_FORGE_URL: z.string().default(''),
  AGENT_REACH_BAZOOKA_URL: z.string().default(''),
  AGENT_REPLY_GLOCK_URL: z.string().default(''),
  AGENT_SLEEPER_GRENADE_URL: z.string().default(''),

  // The unified erp-agents service (modular monolith) base URL. The engage module
  // POSTs `${AGENTS_BASE_URL}/run` { workflow, mode, input } and gets the AgentResult
  // back SYNCHRONOUSLY (engage is per-reply, not a campaign batch). Blank = engage
  // agent runs are disabled (the run/classify endpoints return 503), so the API is
  // safe to deploy before the agent service is up. Local dev: http://localhost:8001.
  AGENTS_BASE_URL: z.string().default(''),
  // How long the backend waits for a synchronous agent /run (classify + draft). The
  // local Hermes model does two sequential LLM calls, so this needs headroom; raise it
  // further for slower hardware. Milliseconds.
  AGENT_TIMEOUT_MS: z.coerce.number().int().positive().default(300_000),
  // (The daily Bazooka send time is now an ERP-editable setting in arsenal_settings,
  // not an env var — changeable in the UI without a redeploy.)

  // Reach Gmail send safety. 'test' (default) redirects EVERY send to
  // REACH_TEST_RECIPIENT (capped at REACH_TEST_SEND_CAP) so synthetic lead
  // addresses are never emailed; 'live' sends to the real lead email. Flip to
  // 'live' only when you intend real outbound mail.
  REACH_SEND_MODE: z.enum(['test', 'live']).default('test'),
  REACH_TEST_RECIPIENT: z.string().default('admin@evertrust-germany.de'),
  REACH_TEST_SEND_CAP: z.coerce.number().int().positive().default(3),

  // Phase 5b — Claude price-assist. Blank ANTHROPIC_API_KEY = the feature is
  // DISABLED (the price-assist endpoint returns { configured: false } instead of
  // erroring), so the API is safe to run before a key is set. ANTHROPIC_MODEL is
  // the model id used for suggestions — overridable without a code change.
  ANTHROPIC_API_KEY: z.string().default(''),
  ANTHROPIC_MODEL: z.string().default('claude-3-5-sonnet-latest'),

  // Phase 5c — Hermes supplier RFQ. The n8n webhook the ERP fires to email an RFQ
  // to suppliers. Blank = the RFQ trigger is disabled (the API rejects "send" with
  // a clear message), so the feature is safe to deploy before the webhook exists.
  N8N_HERMES_RFQ_WEBHOOK_URL: z.string().default(''),

  // n8n executions poller — real RUNNING→END sync for the Growth Engine sequence.
  // N8N_API_URL = the instance base (https://<host>); N8N_API_KEY = a read-only n8n
  // public API key. Blank EITHER = the feature is OFF and the strip falls back to
  // its dispatch-based status proxy. The ERP only ever READS executions.
  N8N_API_URL: z.string().default(''),
  N8N_API_KEY: z.string().default(''),

  // n8n→ERP run callback shared secret. An n8n stage workflow posts its autonomous
  // run outcome to POST /arsenal/runs/callback with this token in the
  // `x-arsenal-token` header. Blank = the callback endpoint is DISABLED (returns
  // 503), so the feature is safe to deploy before a token is minted. This is the
  // ONLY auth on that public (JWT-less) route — treat it like a password.
  ARSENAL_INGEST_TOKEN: z.string().default(''),

  // Key Account hot-leads webhooks. PROVISION creates a campaign's hot_leads sheet
  // (POST {folderId}); PIPELINE intakes Interested leads + graduates customers
  // (POST {folderId}). Blank = that ERP action is disabled. Hot-lead DATA is read
  // via the executions backfill (N8N_API_URL/KEY), not these.
  N8N_PROVISION_HOT_LEADS_WEBHOOK_URL: z.string().default(''),
  N8N_HOT_LEADS_PIPELINE_WEBHOOK_URL: z.string().default(''),

  // Marketing · RAG Draft Review. Optional explicit overrides; blank falls back
  // to ${N8N_API_URL}/webhook/erp-rag-drafts and /erp-rag-send. So once
  // N8N_API_URL is set, Draft Review works without setting these.
  N8N_RAG_DRAFTS_WEBHOOK_URL: z.string().default(''),
  N8N_RAG_SEND_WEBHOOK_URL: z.string().default(''),
  N8N_RAG_SCAN_WEBHOOK_URL: z.string().default(''),
});

export type Env = z.infer<typeof EnvSchema>;

// @nestjs/config `validate` hook. Throws (boot crash) when env is invalid.
export function validateEnv(config: Record<string, unknown>): Env {
  const parsed = EnvSchema.safeParse(config);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((i) => `  - ${i.path.join('.') || '(root)'}: ${i.message}`)
      .join('\n');
    throw new Error(`Invalid environment configuration:\n${issues}`);
  }
  return parsed.data;
}
