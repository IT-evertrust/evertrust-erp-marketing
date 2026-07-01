'use client';

import { useCallback, useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { Check, Copy, Loader2 } from 'lucide-react';

import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';

import type { ReachBatchState } from '../types';
import { getReachBatch, saveReachBatchResults } from '../services/reach.service';

type BatchDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  aimId: string | null;
  campaignName?: string;
  // Called after a batch's leads are saved, so the parent can refresh the leads table.
  onLeadsSaved?: () => void;
};

// The 4-batch dedup sweep round-trip: shows the current batch's prompt (base +
// accumulated exclusion list) to copy into ChatGPT, takes the JSON it returns back
// (pasted), verifies + saves the deduped leads, and advances to the next batch. After
// batch 4 the button becomes "Done" and refreshes the leads table.
export function BatchDialog({
  open,
  onOpenChange,
  aimId,
  campaignName,
  onLeadsSaved,
}: BatchDialogProps) {
  const t = useTranslations('reach');
  const [state, setState] = useState<ReachBatchState | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [paste, setPaste] = useState('');
  const [pasteError, setPasteError] = useState<string | null>(null);
  const [verifying, setVerifying] = useState(false);
  const [copied, setCopied] = useState(false);

  const load = useCallback(async () => {
    if (!aimId) return;
    setLoading(true);
    setError(null);
    try {
      setState(await getReachBatch(aimId));
    } catch (err) {
      setError(err instanceof Error ? err.message : t('batch.loadError'));
    } finally {
      setLoading(false);
    }
  }, [aimId, t]);

  // (Re)load whenever the dialog opens for a campaign.
  useEffect(() => {
    if (open && aimId) {
      setPaste('');
      setPasteError(null);
      setCopied(false);
      void load();
    }
  }, [open, aimId, load]);

  async function copyPrompt() {
    if (!state?.prompt) return;
    try {
      await navigator.clipboard.writeText(state.prompt);
      setCopied(true);
      toast.success(t('modal.prompt.copied'));
    } catch {
      toast.error(t('modal.prompt.copyFailed'));
    }
  }

  // Verify = validate + save the pasted JSON (server dedupes) and advance to the next
  // batch. A server error means the pasted text didn't verify.
  async function verify() {
    if (!aimId || !paste.trim()) return;
    setVerifying(true);
    setPasteError(null);
    try {
      const savedForBatch = state?.batch ?? 1;
      const next = await saveReachBatchResults(aimId, paste);
      setState(next);
      setPaste('');
      setCopied(false);
      onLeadsSaved?.();
      toast.success(
        t('batch.verifiedToast', {
          batch: savedForBatch,
          total: next.collectedCount,
        }),
      );
    } catch (err) {
      setPasteError(err instanceof Error ? err.message : t('batch.verifyError'));
    } finally {
      setVerifying(false);
    }
  }

  function finish() {
    onLeadsSaved?.(); // refresh the table to show the collected data
    onOpenChange(false);
  }

  const isLast = state ? state.batch >= state.totalBatches : false;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>
            {campaignName
              ? t('batch.title', { campaign: campaignName })
              : t('batch.titleGeneric')}
          </DialogTitle>
        </DialogHeader>

        {loading ? (
          <div className="flex items-center gap-2 py-8 text-sm text-muted-foreground">
            <Loader2 className="size-4 animate-spin" />
            {t('batch.loading')}
          </div>
        ) : error ? (
          <div className="grid gap-3 py-4">
            <p className="text-sm text-destructive">{error}</p>
            <Button type="button" variant="outline" onClick={() => void load()}>
              {t('batch.retry')}
            </Button>
          </div>
        ) : state?.done ? (
          <div className="grid gap-4 py-4">
            <div className="grid gap-2 text-center">
              <p className="text-sm font-bold text-foreground">
                {t('batch.doneTitle')}
              </p>
              <p className="text-xs text-muted-foreground">
                {t('batch.doneBody', {
                  count: state.collectedCount,
                  total: state.totalBatches,
                })}
              </p>
            </div>
            <Button type="button" onClick={finish}>
              {t('batch.doneButton')}
            </Button>
          </div>
        ) : state ? (
          <div className="grid gap-4">
            {/* Progress */}
            <div className="flex items-center justify-between text-xs font-bold uppercase tracking-[0.08em] text-muted-foreground">
              <span>
                {t('batch.batchOf', {
                  batch: state.batch,
                  total: state.totalBatches,
                })}
              </span>
              <span>{t('batch.collected', { count: state.collectedCount })}</span>
            </div>

            {/* Steps */}
            <ol className="grid gap-1 text-xs text-muted-foreground">
              <li>1. {t('batch.step1')}</li>
              <li>2. {t('batch.step2')}</li>
              <li>3. {t('batch.step3')}</li>
            </ol>

            {/* Current batch prompt */}
            <div className="grid gap-2">
              <div className="flex items-center justify-between">
                <Label htmlFor="batch-prompt">
                  {t('batch.promptLabel', { batch: state.batch })}
                </Label>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="h-7 gap-1.5 px-2 text-xs"
                  onClick={copyPrompt}
                >
                  {copied ? (
                    <Check className="size-3.5" />
                  ) : (
                    <Copy className="size-3.5" />
                  )}
                  {copied ? t('modal.prompt.copiedShort') : t('modal.prompt.copy')}
                </Button>
              </div>
              <Textarea
                id="batch-prompt"
                value={state.prompt ?? ''}
                readOnly
                rows={8}
                className="max-h-56 resize-none font-mono text-xs leading-relaxed"
              />
            </div>

            {/* Paste results */}
            <div className="grid gap-2">
              <Label htmlFor="batch-paste">{t('batch.pasteLabel')}</Label>
              <Textarea
                id="batch-paste"
                value={paste}
                onChange={(e) => {
                  setPasteError(null);
                  setPaste(e.target.value);
                }}
                rows={6}
                placeholder={t('batch.pastePlaceholder')}
                className="max-h-48 resize-none font-mono text-xs leading-relaxed"
              />
              {pasteError ? (
                <p className="text-xs text-destructive">{pasteError}</p>
              ) : null}
            </div>

            <Button
              type="button"
              onClick={verify}
              disabled={verifying || !paste.trim()}
            >
              {verifying
                ? t('batch.verifying')
                : isLast
                  ? t('batch.verifyLast')
                  : t('batch.verify')}
            </Button>
          </div>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
