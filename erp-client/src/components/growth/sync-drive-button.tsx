'use client';

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
  const sync = useSyncCampaigns();

  function run() {
    sync.mutate(undefined, {
      onSuccess: (r) => {
        const parts = [`${r.driveCount} in Drive`];
        if (r.markedMissing > 0)
          parts.push(`${r.markedMissing} archived (folder deleted)`);
        if (r.restored > 0) parts.push(`${r.restored} restored`);
        if (r.untracked.length > 0)
          parts.push(`${r.untracked.length} untracked in Drive`);
        toast.success('Synced with Drive', { description: parts.join(' · ') });
      },
      onError: (e) =>
        toast.error('Drive sync failed', {
          description:
            e.message ?? 'Check that the CAMPAIGNS LIST workflow is active.',
        }),
    });
  }

  return (
    <Button type="button" variant="outline" onClick={run} disabled={sync.isPending}>
      {sync.isPending ? <Loader2 className="animate-spin" /> : <RefreshCw />}
      {sync.isPending ? 'Syncing…' : 'Sync with Drive'}
    </Button>
  );
}
