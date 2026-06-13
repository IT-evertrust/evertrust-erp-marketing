'use client';

import { useTranslations } from 'next-intl';
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
type LifecycleAction = {
  target: LifecycleTarget;
  labelKey: 'pause' | 'resume' | 'archive';
  successKey: 'pausedToast' | 'resumedToast' | 'archivedToast';
  errorKey: 'pauseError' | 'resumeError' | 'archiveError';
  icon: typeof Play;
};

export function CampaignLifecycleActions({ campaign: c }: { campaign: CampaignDto }) {
  const t = useTranslations('marketing');
  const setLifecycle = useSetCampaignLifecycle();
  const label = c.name || c.project;

  const actions: LifecycleAction[] = [];
  if (c.lifecycle === 'ACTIVE') {
    actions.push({ target: 'PAUSED', labelKey: 'pause', successKey: 'pausedToast', errorKey: 'pauseError', icon: Pause });
  }
  if (c.lifecycle === 'PAUSED') {
    actions.push({ target: 'ACTIVE', labelKey: 'resume', successKey: 'resumedToast', errorKey: 'resumeError', icon: Play });
  }
  if (c.lifecycle !== 'ARCHIVED') {
    actions.push({ target: 'ARCHIVED', labelKey: 'archive', successKey: 'archivedToast', errorKey: 'archiveError', icon: Archive });
  }

  if (actions.length === 0) return null;

  function run(a: LifecycleAction) {
    setLifecycle.mutate(
      { id: c.id, lifecycle: a.target },
      {
        onSuccess: () => toast.success(t(`actions.${a.successKey}`, { name: label })),
        onError: (e) => toast.error(e.message ?? t(`actions.${a.errorKey}`)),
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
          aria-label={t('actions.campaignActions', { name: label })}
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
                onSelect={() => run(a)}
              >
                <Icon />
                {t(`actions.${a.labelKey}`)}
              </DropdownMenuItem>
            </div>
          );
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
