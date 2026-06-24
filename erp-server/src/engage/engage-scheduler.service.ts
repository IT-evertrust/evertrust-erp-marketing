import {
  Injectable,
  Logger,
  type OnModuleDestroy,
  type OnModuleInit,
} from '@nestjs/common';

import { EngageScanService } from './engage-scan.service';
import { GmailWatchService } from './gmail-watch.service';

// ===========================================================================
// Engage · schedulers (dependency-free, like ArsenalScheduler — no @nestjs/schedule).
// Three self-rescheduling timers, each re-armed AFTER its run finishes so a slow scan
// never overlaps itself:
//   1. AUTO-SCAN  — every ENGAGE_AUTOSCAN_INTERVAL_MIN (default 60): scan every AIM
//                   in every org. The reliable always-on baseline.
//   2. POLL       — every ENGAGE_POLL_INTERVAL_MIN (default 2): historyId poll
//                   fallback so new replies are picked up near-real-time even when
//                   gmail.watch / Pub/Sub isn't set up (e.g. on localhost).
//   3. RENEW      — daily: re-register gmail.watch subscriptions before they lapse.
// In a multi-instance deploy, run one instance with these enabled (env toggles).
// ===========================================================================

function envBool(key: string, dflt: boolean): boolean {
  const v = process.env[key]?.trim().toLowerCase();
  if (v == null || v === '') return dflt;
  return ['1', 'true', 'yes', 'y', 'on'].includes(v);
}
function envInt(key: string, dflt: number): number {
  const v = Number(process.env[key]);
  return Number.isFinite(v) && v > 0 ? v : dflt;
}

@Injectable()
export class EngageScheduler implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(EngageScheduler.name);
  private readonly timers = new Set<ReturnType<typeof setTimeout>>();
  private destroyed = false;

  constructor(
    private readonly scan: EngageScanService,
    private readonly watch: GmailWatchService,
  ) {}

  onModuleInit(): void {
    const autoScan = envBool('ENGAGE_AUTOSCAN_ENABLED', true);
    const poll = envBool('ENGAGE_POLL_ENABLED', true);

    if (autoScan) {
      const everyMs = envInt('ENGAGE_AUTOSCAN_INTERVAL_MIN', 60) * 60_000;
      this.logger.log(
        `Engage auto-scan armed: every ${everyMs / 60_000} min across all orgs.`,
      );
      // Delay the first run by one interval so a restart doesn't immediately scan.
      this.arm(everyMs, everyMs, () => this.runAutoScan());
    }

    if (poll) {
      const everyMs = envInt('ENGAGE_POLL_INTERVAL_MIN', 2) * 60_000;
      this.logger.log(
        `Engage Gmail poll armed: every ${everyMs / 60_000} min (gmail.watch ${this.watch.isConfigured() ? 'configured' : 'NOT configured — poll is the live path'}).`,
      );
      // Quick first baseline so we start tracking historyIds soon after boot.
      this.arm(30_000, everyMs, () => this.watch.pollOnce());
    }

    // Daily watch renewal (no-op until GMAIL_PUBSUB_TOPIC is set).
    this.arm(60_000, 24 * 60 * 60_000, () => this.watch.renewExpiring());
  }

  onModuleDestroy(): void {
    this.destroyed = true;
    for (const t of this.timers) clearTimeout(t);
    this.timers.clear();
  }

  // Schedule `fn` after `firstDelayMs`, then re-arm `intervalMs` after each completion.
  private arm(firstDelayMs: number, intervalMs: number, fn: () => Promise<unknown>): void {
    const tick = () => {
      if (this.destroyed) return;
      void Promise.resolve()
        .then(fn)
        .catch((err) =>
          this.logger.warn(
            `scheduled task error: ${err instanceof Error ? err.message : String(err)}`,
          ),
        )
        .finally(() => {
          if (this.destroyed) return;
          const t = setTimeout(tick, intervalMs);
          this.timers.add(t);
        });
    };
    const first = setTimeout(tick, firstDelayMs);
    this.timers.add(first);
  }

  private async runAutoScan(): Promise<void> {
    const orgs = await this.scan.orgsWithAims();
    for (const orgId of orgs) {
      const r = await this.scan.scanAllForOrg(orgId);
      this.logger.log(
        `Auto-scan org ${orgId}: ${r.aims} aim(s), ${r.scanned} lead(s) scanned, ${r.classified} classified.`,
      );
    }
  }
}
