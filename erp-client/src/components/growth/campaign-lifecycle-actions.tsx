'use client';

import { toast } from 'sonner';
import { Archive, MoreHorizontal, Pause, Play } from 'lucide-react';
import type { CampaignDto, UpdateCampaignLifecycleDto } from '@evertrust/shared';
import { useSetCampaignLifecycle } from '@/hooks/use-campaigns';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';

type LifecycleTarget = UpdateCampaignLifecycleDto['lifecycle'];

// The lifecycle transitions offered for a campaign, by its current state. ARCHIVED
// is terminal (no actions). DRAFT can't be paused (it hasn't launched), so it only
// offers Archive. The change is optimistic (the badge flips immediately).
export function CampaignLifecycleActions({ campaign: c }: { campaign: CampaignDto }) {
  const setLifecycle = useSetCampaignLifecycle();
  const label = c.name || c.project;

  const actions: { target: LifecycleTarget; label: string; icon: typeof Play }[] = [];
  if (c.lifecycle === 'ACTIVE') {
    actions.push({ target: 'PAUSED', label: 'Pause', icon: Pause });
  }
  if (c.lifecycle === 'PAUSED') {
    actions.push({ target: 'ACTIVE', label: 'Resume', icon: Play });
  }
  if (c.lifecycle !== 'ARCHIVED') {
    actions.push({ target: 'ARCHIVED', label: 'Archive', icon: Archive });
  }

  if (actions.length === 0) return null;

  function run(target: LifecycleTarget, actionLabel: string) {
    setLifecycle.mutate(
      { id: c.id, lifecycle: target },
      {
        onSuccess: () => toast.success(`${actionLabel} “${label}”.`),
        onError: (e) =>
          toast.error(e.message ?? `Could not ${actionLabel.toLowerCase()} the campaign.`),
      },
    );
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="shrink-0 text-muted-foreground"
          aria-label={`Campaign actions for ${label}`}
          disabled={setLifecycle.isPending}
        >
          <MoreHorizontal />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        {actions.map((a, i) => {
          const Icon = a.icon;
          const destructive = a.target === 'ARCHIVED';
          return (
            <div key={a.target}>
              {destructive && i > 0 ? <DropdownMenuSeparator /> : null}
              <DropdownMenuItem
                variant={destructive ? 'destructive' : 'default'}
                onSelect={() => run(a.target, a.label)}
              >
                <Icon />
                {a.label}
              </DropdownMenuItem>
            </div>
          );
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
