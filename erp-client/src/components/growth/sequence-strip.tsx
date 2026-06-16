'use client';

import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { Plus, Send } from 'lucide-react';
import { Can } from '@/components/auth/can';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';

// Reach → "Sequence Sender" tab (R.E.A.N. mockup): the outbound sequence as a
// numbered step strip ("Sequence: Q3 Outbound") with Add step + Launch controls.
// There is NO standalone sequence API yet — multi-step outbound is sent by the
// REACH BAZOOKA arsenal stage on its own schedule — so the steps mirror the
// approved mockup and the card is clearly flagged "coming soon". The buttons are
// gated by campaigns:write and only toast (no fabricated backend call).
const STEP_KEYS = ['intro', 'follow', 'breakup'] as const;

const STEP_BADGE_TONE: Record<(typeof STEP_KEYS)[number], string> = {
  intro: 'border-emerald-500/30 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400',
  follow: 'border-amber-500/30 bg-amber-500/10 text-amber-600 dark:text-amber-400',
  breakup: 'border-border bg-muted text-muted-foreground',
};

export function SequenceStrip() {
  const t = useTranslations('growth.reach.sequence');

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex flex-wrap items-center justify-between gap-2 text-base">
          <span className="flex items-center gap-2">
            {t('title')}
            <Badge variant="secondary">{t('comingSoonBadge')}</Badge>
          </span>
          <Badge className="border-sky-500/30 bg-sky-500/10 font-medium text-sky-600 dark:text-sky-400">
            {t('enrolled', { count: 240 })}
          </Badge>
        </CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <p className="text-xs text-muted-foreground">
          {t('notWired.description')}
        </p>

        <div className="flex flex-col gap-2.5">
          {STEP_KEYS.map((key, i) => (
            <div
              key={key}
              className="flex items-center gap-3 rounded-lg border bg-card p-3"
            >
              <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-semibold text-muted-foreground">
                {i + 1}
              </span>
              <div className="min-w-0 flex-1">
                <div className="text-sm font-semibold">
                  {t(`steps.${key}.title`)}
                </div>
                <div className="text-xs text-muted-foreground">
                  {t(`steps.${key}.sub`)}
                </div>
              </div>
              <Badge variant="outline" className={STEP_BADGE_TONE[key]}>
                {t(`steps.${key}.badge`)}
              </Badge>
            </div>
          ))}
        </div>

        <Can permission="campaigns:write">
          <div className="flex flex-wrap items-center gap-2">
            <Button
              variant="outline"
              onClick={() => toast.info(t('addStep'))}
            >
              <Plus />
              {t('addStep')}
            </Button>
            <Button onClick={() => toast.success(t('launchToast'))}>
              <Send />
              {t('launch')}
            </Button>
          </div>
        </Can>
      </CardContent>
    </Card>
  );
}
