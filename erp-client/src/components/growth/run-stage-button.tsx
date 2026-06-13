'use client';

import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { Loader2, Play } from 'lucide-react';
import { type ArsenalStage } from '@evertrust/shared';
import { useRunArsenalStage } from '@/hooks/use-arsenal';
import { Button } from '@/components/ui/button';

// Fires one arsenal stage's n8n webhook. The API returns the recorded run even on
// a failed webhook (status FAILED), so success vs failure is reflected by the run
// status; a 4xx (e.g. stage not configured) surfaces via onError.
export function RunStageButton({
  stage,
  campaignId,
  label,
  variant = 'outline',
  size = 'sm',
}: {
  stage: ArsenalStage;
  campaignId?: string;
  label?: string;
  variant?: 'outline' | 'ghost' | 'default';
  size?: 'sm' | 'default';
}) {
  const t = useTranslations('marketing');
  const run = useRunArsenalStage();
  const stageLabel = t(`stage.${stage}`);

  return (
    <Button
      variant={variant}
      size={size}
      disabled={run.isPending}
      onClick={() =>
        run.mutate(
          { stage, campaignId },
          {
            onSuccess: (r) =>
              r.status === 'DISPATCHED'
                ? toast.success(t('actions.dispatched', { stage: stageLabel }))
                : toast.error(
                    t('actions.runFailed', {
                      stage: stageLabel,
                      detail: r.detail ?? t('actions.unknown'),
                    }),
                  ),
            onError: (e) =>
              toast.error(e.message ?? t('actions.runError', { stage: stageLabel })),
          },
        )
      }
    >
      {run.isPending ? <Loader2 className="animate-spin" /> : <Play />}
      {run.isPending
        ? t('actions.dispatching')
        : (label ?? t('actions.run', { stage: stageLabel }))}
    </Button>
  );
}
