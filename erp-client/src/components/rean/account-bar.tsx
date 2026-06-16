'use client';

import type { ReactNode } from 'react';
import { Check } from 'lucide-react';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { cn } from '@/lib/utils';

export type AccountMailbox = {
  // The select value (typically the email address).
  value: string;
  // The label shown in the trigger + list (e.g. "info@… · default").
  label: ReactNode;
};

// The Engage / Activate "connected account" bar (mockup `acctBar`, lines
// 648–653): a card-row with a green "connected" pill on the left
// ("Google · Gmail" / "Google · Calendar"), a mailbox <select>, and a muted
// stats line flush-right (e.g. "312 sent · 84 replies · synced 2 min ago").
//
// Presentational + controlled: the parent owns the selected mailbox and the
// connected/stat copy. Pass `connected={false}` to dim the pill when no account
// is linked yet.
export function AccountBar({
  service,
  mailboxes,
  value,
  onValueChange,
  stats,
  connected = true,
  className,
}: {
  // Pill label, e.g. "Google · Gmail".
  service: ReactNode;
  mailboxes: AccountMailbox[];
  value?: string;
  onValueChange?: (value: string) => void;
  stats?: ReactNode;
  connected?: boolean;
  className?: string;
}) {
  return (
    <div
      className={cn(
        'flex flex-wrap items-center justify-between gap-3 rounded-lg border bg-card px-4 py-3 shadow-sm',
        className,
      )}
    >
      <div className="flex flex-wrap items-center gap-3">
        <span
          className={cn(
            'inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs',
            connected
              ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400'
              : 'bg-muted text-muted-foreground',
          )}
        >
          {connected ? <Check className="size-3.5" /> : null}
          {service}
        </span>
        {mailboxes.length > 0 ? (
          <Select value={value} onValueChange={onValueChange}>
            <SelectTrigger className="h-8 max-w-80 text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {mailboxes.map((m) => (
                <SelectItem key={m.value} value={m.value}>
                  {m.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        ) : null}
      </div>
      {stats ? (
        <span className="text-xs text-muted-foreground">{stats}</span>
      ) : null}
    </div>
  );
}
