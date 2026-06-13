'use client';

import Link from 'next/link';
import type { LucideIcon } from 'lucide-react';
import { ArrowRight, ShieldOff, Target, Users } from 'lucide-react';
import { useArsenalExecutions } from '@/hooks/use-arsenal';
import { useHealth } from '@/hooks/use-health';
import { Can } from '@/components/auth/can';
import { PageHeader } from '@/components/common/page-header';
import { BazookaSchedule } from '@/components/growth/bazooka-schedule';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { cn } from '@/lib/utils';

// One integration/health row: a status dot + label + state text. `ok=null` means
// "still loading" — we render a muted dash rather than guessing a colour.
function StatusRow({
  label,
  ok,
  okText,
  badText,
}: {
  label: string;
  ok: boolean | null;
  okText: string;
  badText: string;
}) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="text-sm font-medium">{label}</span>
      {ok === null ? (
        <span className="text-sm text-muted-foreground">—</span>
      ) : (
        <span className="flex items-center gap-2 text-sm text-muted-foreground">
          <span
            className={cn(
              'size-2 rounded-full',
              ok ? 'bg-emerald-500' : 'bg-amber-500',
            )}
          />
          {ok ? okText : badText}
        </span>
      )}
    </div>
  );
}

// A shortcut row into an existing config surface (niches, suppressions, users).
function CatalogLink({
  href,
  icon: Icon,
  title,
  description,
}: {
  href: string;
  icon: LucideIcon;
  title: string;
  description: string;
}) {
  return (
    <Link
      href={href}
      className="flex items-center gap-3 rounded-lg border p-3 hover:bg-accent/50"
    >
      <Icon className="size-4 shrink-0 text-muted-foreground" />
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium">{title}</p>
        <p className="text-xs text-muted-foreground">{description}</p>
      </div>
      <ArrowRight className="size-4 shrink-0 text-muted-foreground" />
    </Link>
  );
}

// Configuration: workspace automation + integrations, admin-only (the page gates on
// admin:config). Every status below reflects a real health/`configured` boolean —
// nothing is faked.
export function ConfigurationSettings() {
  const health = useHealth();
  const executions = useArsenalExecutions();

  // API reachable + its DB probe; null while the first probe is in flight.
  const apiOk = health.isLoading ? null : health.data?.status === 'ok';
  const dbOk = health.isLoading ? null : !!health.data?.db;
  // n8n is "connected" only when the API has the n8n API wired up (configured).
  const n8nOk = executions.isLoading ? null : !!executions.data?.configured;

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Configuration"
        description="Automation and integrations for your workspace."
      />

      {/* Growth automation: the existing, fully-functional daily Bazooka control. */}
      <Card>
        <CardHeader>
          <CardTitle>Outreach automation</CardTitle>
        </CardHeader>
        <CardContent>
          <BazookaSchedule />
        </CardContent>
      </Card>

      {/* Integrations & health: read-only live status of the API, DB, and n8n. */}
      <Card>
        <CardHeader>
          <CardTitle>Integrations &amp; health</CardTitle>
          <CardDescription>Live status of connected services.</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <StatusRow
            label="API"
            ok={apiOk}
            okText="Operational"
            badText="Unreachable"
          />
          <StatusRow
            label="Database"
            ok={dbOk}
            okText="Connected"
            badText="Probe failing"
          />
          <StatusRow
            label="n8n automation"
            ok={n8nOk}
            okText="Connected"
            badText="Not configured"
          />
        </CardContent>
      </Card>

      {/* Managed catalogs: shortcuts into the existing config surfaces. The Users row
          is gated so only user-managers see it. */}
      <Card>
        <CardHeader>
          <CardTitle>Managed catalogs</CardTitle>
          <CardDescription>
            Jump to the lists that drive your workspace.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-2">
          <CatalogLink
            href="/marketing/niches"
            icon={Target}
            title="Niches & targets"
            description="Define the niches and target archetypes campaigns expand."
          />
          <CatalogLink
            href="/marketing/suppressions"
            icon={ShieldOff}
            title="Suppressions"
            description="Your do-not-contact list — addresses outreach skips."
          />
          <Can permission="users:manage">
            <CatalogLink
              href="/users"
              icon={Users}
              title="Users & roles"
              description="Manage members, roles, and permissions."
            />
          </Can>
        </CardContent>
      </Card>
    </div>
  );
}
