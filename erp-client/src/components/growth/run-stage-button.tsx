'use client';

import { toast } from 'sonner';
import { Loader2, Play } from 'lucide-react';
import { ARSENAL_STAGE_META, type ArsenalStage } from '@evertrust/shared';
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
  const run = useRunArsenalStage();
  const meta = ARSENAL_STAGE_META[stage];

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
                ? toast.success(`${meta.label} dispatched.`)
                : toast.error(`${meta.label} failed: ${r.detail ?? 'unknown'}`),
            onError: (e) =>
              toast.error(e.message ?? `Could not run ${meta.label}.`),
          },
        )
      }
    >
      {run.isPending ? <Loader2 className="animate-spin" /> : <Play />}
      {run.isPending ? 'Dispatching…' : (label ?? `Run ${meta.label}`)}
    </Button>
  );
}
