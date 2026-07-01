'use client';

import { useState, type ReactNode } from 'react';
import { useTranslations } from 'next-intl';
import { Trash2 } from 'lucide-react';

import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { GrowthCard, StatusPill } from '../../shared';

import type { Campaign } from '../types';
import { Spinner } from './spinner';

type CampaignTableProps = {
  campaigns: Campaign[];
  selectedCampaignId: string;
  onSelectCampaign: (campaignId: string) => void;
  title?: string;
  showAction?: boolean;
  actionLabel?: string;
  onActionClick?: () => void;
  loading?: boolean;
  // The 4th column. Defaults to the "Companies" count; the Email Generator tab
  // overrides it to show "Sent" (total emails sent across the three rounds).
  metricLabel?: string;
  metricValue?: (campaign: Campaign) => ReactNode;
  // When provided, each row gets a trash button that (after a confirm popup)
  // permanently deletes the campaign.
  onDeleteCampaign?: (campaignId: string) => void | Promise<void>;
};

export function CampaignTable({
  campaigns,
  selectedCampaignId,
  onSelectCampaign,
  title,
  showAction = false,
  actionLabel,
  onActionClick,
  loading = false,
  metricLabel,
  metricValue,
  onDeleteCampaign,
}: CampaignTableProps) {
  const t = useTranslations('reach');
  // The campaign the confirm popup is currently asking about, or null when closed.
  const [pendingDelete, setPendingDelete] = useState<Campaign | null>(null);
  // True while the delete DB call is in flight — swaps the popup for a spinner.
  const [deleting, setDeleting] = useState(false);
  const canDelete = !!onDeleteCampaign;

  async function confirmDelete() {
    if (!pendingDelete) return;
    setDeleting(true);
    try {
      await onDeleteCampaign?.(pendingDelete.id);
      // Success: refresh the page so the table reflects the deletion from the server.
      window.location.reload();
    } catch {
      // The hook already surfaced the error toast — just close the popup.
      setDeleting(false);
      setPendingDelete(null);
    }
  }

  return (
    <GrowthCard
      title={title ?? t('campaignTable.title')}
      hint={
        showAction ? (
            <button
            type="button"
            onClick={onActionClick}
            className="rounded-md border border-foreground bg-foreground px-3 py-1.5 text-[10px] font-bold uppercase tracking-[0.08em] text-background"
            >
            {actionLabel ?? t('campaignTable.aim')}
            </button>
        ) : null
        }
    >
      {loading && campaigns.length === 0 ? (
        <Spinner label={t('campaignTable.loading')} />
      ) : campaigns.length === 0 ? (
        <div className="rounded-lg border border-dashed border-border bg-muted p-6 text-center text-[12.5px] font-bold text-muted-foreground">
          {t('campaignTable.empty')}
        </div>
      ) : (
      <div className="max-h-[280px] overflow-auto">
        <table className="w-full min-w-[640px] border-collapse">
          <thead>
            <tr>
              <th className="px-3 pb-3 text-left text-[9.5px] font-bold uppercase tracking-[0.1em] text-muted-foreground">
                {t('campaignTable.col.campaign')}
              </th>
              <th className="px-3 pb-3 text-left text-[9.5px] font-bold uppercase tracking-[0.1em] text-muted-foreground">
                {t('campaignTable.col.niche')}
              </th>
              <th className="px-3 pb-3 text-left text-[9.5px] font-bold uppercase tracking-[0.1em] text-muted-foreground">
                {t('campaignTable.col.region')}
              </th>
              <th className="px-3 pb-3 text-left text-[9.5px] font-bold uppercase tracking-[0.1em] text-muted-foreground">
                {metricLabel ?? t('campaignTable.col.companies')}
              </th>
              <th className="px-3 pb-3 text-left text-[9.5px] font-bold uppercase tracking-[0.1em] text-muted-foreground">
                {t('campaignTable.col.status')}
              </th>
              {canDelete ? <th className="w-8 px-3 pb-3" /> : null}
            </tr>
          </thead>

          <tbody>
            {campaigns.map((campaign) => {
              const selected = selectedCampaignId === campaign.id;
              const live =
                campaign.status === 'IN CAMPAIGN' ||
                campaign.status === 'SCRAPING';

              return (
                <tr
                  key={campaign.id}
                  onClick={() => onSelectCampaign(campaign.id)}
                  className={[
                    'cursor-pointer border-t border-border hover:bg-muted',
                    selected ? 'bg-muted' : '',
                  ].join(' ')}
                >
                  <td className="px-3 py-3 text-[12.5px] font-bold text-foreground">
                    {campaign.name}
                  </td>
                  <td className="px-3 py-3 text-[12.5px] text-muted-foreground">
                    {campaign.niche}
                  </td>
                  <td className="px-3 py-3 text-[12.5px] text-muted-foreground">
                    {campaign.region}
                  </td>
                  <td className="px-3 py-3 text-[12.5px] text-muted-foreground">
                    {metricValue ? metricValue(campaign) : campaign.companies}
                  </td>
                  <td className="px-3 py-3">
                    <StatusPill live={live}>
                      {t(`campaignTable.status.${campaign.status}`)}
                    </StatusPill>
                  </td>
                  {canDelete ? (
                    <td className="px-2 py-3 text-right">
                      <button
                        type="button"
                        aria-label={t('campaignTable.delete.aria', {
                          name: campaign.name,
                        })}
                        title={t('campaignTable.delete.title')}
                        onClick={(e) => {
                          e.stopPropagation(); // don't select the row
                          setPendingDelete(campaign);
                        }}
                        className="rounded p-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                      >
                        <Trash2 className="size-4" />
                      </button>
                    </td>
                  ) : null}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      )}

      {/* Delete confirmation popup — swaps to a spinner while the delete is in flight. */}
      <Dialog
        open={!!pendingDelete}
        onOpenChange={(o) => {
          // Don't let the operator dismiss the popup mid-delete.
          if (!o && !deleting) setPendingDelete(null);
        }}
      >
        <DialogContent
          className="sm:max-w-sm"
          showCloseButton={!deleting}
          onEscapeKeyDown={(e) => {
            if (deleting) e.preventDefault();
          }}
          onInteractOutside={(e) => {
            if (deleting) e.preventDefault();
          }}
        >
          {deleting ? (
            <Spinner label={t('campaignTable.delete.deleting')} />
          ) : (
            <>
              <DialogHeader>
                <DialogTitle>
                  {t('campaignTable.delete.confirmTitle')}
                </DialogTitle>
                <DialogDescription>
                  {t('campaignTable.delete.confirmBody', {
                    name: pendingDelete?.name ?? '',
                  })}
                </DialogDescription>
              </DialogHeader>
              <DialogFooter>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setPendingDelete(null)}
                >
                  {t('campaignTable.delete.cancel')}
                </Button>
                <Button
                  type="button"
                  className="bg-foreground text-background hover:bg-foreground/90"
                  onClick={confirmDelete}
                >
                  {t('campaignTable.delete.confirm')}
                </Button>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>
    </GrowthCard>
  );
}