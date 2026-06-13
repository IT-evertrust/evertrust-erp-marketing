'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { Trash2 } from 'lucide-react';
import type { CampaignDto } from '@evertrust/shared';
import { useDeleteCampaign } from '@/hooks/use-campaigns';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';

// Delete a campaign from the ERP, behind a confirm dialog. Deleting removes the
// ERP record only — the Google Drive folder and its leads are NOT touched (the
// ERP has no Drive write path), which the dialog states plainly.
export function DeleteCampaignButton({ campaign }: { campaign: CampaignDto }) {
  const t = useTranslations('marketing');
  const [open, setOpen] = useState(false);
  const del = useDeleteCampaign();
  const label = campaign.name || campaign.project;

  function confirm() {
    del.mutate(campaign.id, {
      onSuccess: () => {
        toast.success(t('actions.deleted', { name: label }));
        setOpen(false);
      },
      onError: (e) => toast.error(e.message ?? t('actions.deleteFailed')),
    });
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="shrink-0 text-muted-foreground hover:text-destructive"
          aria-label={t('actions.deleteAria', { name: label })}
        >
          <Trash2 />
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{t('actions.deleteTitle')}</DialogTitle>
          <DialogDescription>
            {t.rich('actions.deleteDescription', {
              name: label,
              b: (chunks) => <span className="font-medium">{chunks}</span>,
              strong: (chunks) => <strong>{chunks}</strong>,
            })}
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button type="button" variant="ghost" onClick={() => setOpen(false)}>
            {t('common.cancel')}
          </Button>
          <Button
            type="button"
            variant="destructive"
            onClick={confirm}
            disabled={del.isPending}
          >
            {del.isPending ? t('actions.deleting') : t('actions.delete')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
