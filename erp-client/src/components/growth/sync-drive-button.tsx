'use client';

import { useTranslations } from 'next-intl';
import { Loader2, RefreshCw } from 'lucide-react';
import { toast } from 'sonner';
import { useSyncCampaigns } from '@/hooks/use-campaigns';
import { Button } from '@/components/ui/button';

// "Sync with Drive": reconcile the campaign list against the live Drive "Evertrust
// Campaigns" folder — the SOURCE OF TRUTH for which campaigns exist. Campaigns whose
// folder was deleted get archived out of the list; ones that reappeared come back.
// This is what stops a deleted folder from lingering: n8n execution history keeps the
// old run forever, but the Drive scan reflects the current folder set.
export function SyncDriveButton() {
  const t = useTranslations('marketing');
  const sync = useSyncCampaigns();

  function run() {
    sync.mutate(undefined, {
      onSuccess: (r) => {
        const parts = [t('actions.syncInDrive', { count: r.driveCount })];
        if (r.markedMissing > 0)
          parts.push(t('actions.syncArchived', { count: r.markedMissing }));
        if (r.restored > 0) parts.push(t('actions.syncRestored', { count: r.restored }));
        if (r.untracked.length > 0)
          parts.push(t('actions.syncUntracked', { count: r.untracked.length }));
        toast.success(t('actions.syncOk'), { description: parts.join(' · ') });
      },
      onError: (e) =>
        toast.error(t('actions.syncFailed'), {
          description: e.message ?? t('actions.syncFailedHint'),
        }),
    });
  }

  return (
    <Button type="button" variant="outline" onClick={run} disabled={sync.isPending}>
      {sync.isPending ? <Loader2 className="animate-spin" /> : <RefreshCw />}
      {sync.isPending ? t('actions.syncing') : t('actions.syncWithDrive')}
    </Button>
  );
}
