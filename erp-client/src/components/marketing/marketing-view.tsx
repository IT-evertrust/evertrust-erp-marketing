'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { Mail, Search, Send, Sparkles, Target } from 'lucide-react';
import { PageHeader } from '@/components/common/page-header';
import { SegmentedTabs } from '@/components/rean/segmented-tabs';
import { MarketingCampaigns } from './marketing-campaigns';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { CampaignBoard } from '@/components/growth/campaign-board';
import { SequenceStrip } from '@/components/growth/sequence-strip';

// Reach (R.E.A.N.) page: the top of the acquisition funnel under one roof. The
// masthead carries the AIM "Launch campaign" action; four segmented tabs match the
// approved mockup — Campaigns (create + track), Lead Scraper (criteria + niche
// targets), Email Generator (compose + AI preview) and Sequence Sender (the
// outbound sequence + launch). Every campaign/niche surface is live-wired; the
// Email + Sequence builders are clearly flagged "coming soon" until their
// standalone APIs land (today they run through the arsenal stages).
const TABS = ['campaigns', 'scraper', 'email', 'sequence'] as const;
type ReachTab = (typeof TABS)[number];

const TAB_ICON: Record<ReachTab, React.ReactNode> = {
  campaigns: <Target className="size-3.5" />,
  scraper: <Search className="size-3.5" />,
  email: <Mail className="size-3.5" />,
  sequence: <Send className="size-3.5" />,
};

export function MarketingView() {
  const t = useTranslations('growth.reach');
  const [tab, setTab] = useState<ReachTab>('campaigns');

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title={t('header.title')}
        description={t('header.description')}
      />
      <SegmentedTabs
        tabs={TABS.map((value) => ({
          value,
          label: t(`tabs.${value}`),
          icon: TAB_ICON[value],
        }))}
        value={tab}
        onValueChange={(v) => setTab(v as ReachTab)}
      />
      <div>
        {tab === 'campaigns' ? <MarketingCampaigns /> : null}
        {tab === 'scraper' ? <CampaignBoard /> : null}
        {tab === 'email' ? <ReachEmail /> : null}
        {tab === 'sequence' ? <SequenceStrip /> : null}
      </div>
    </div>
  );
}

// Reach → "Email Generator" tab (R.E.A.N. mockup): a two-pane Compose / Preview
// layout. There is NO standalone email-generation API yet — first-touch copy is
// produced by the Ammo Forge arsenal stage as per-campaign drafts — so the form is
// disabled and the card is clearly flagged "coming soon" (the inputs mirror the
// approved mockup so the surface is ready to wire when the endpoint lands).
function ReachEmail() {
  const t = useTranslations('growth.reach.email');
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center justify-between gap-2 text-base">
            <span>{t('composeTitle')}</span>
            <Badge variant="secondary">{t('comingSoonBadge')}</Badge>
          </CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <div className="grid gap-2">
            <Label htmlFor="email-recipient">{t('recipientLabel')}</Label>
            <Input id="email-recipient" disabled placeholder="—" />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="email-template">{t('templateLabel')}</Label>
            <Input id="email-template" disabled placeholder="—" />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="email-tone">{t('toneLabel')}</Label>
            <Input id="email-tone" disabled placeholder="—" />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="email-angle">{t('angleLabel')}</Label>
            <Input
              id="email-angle"
              disabled
              placeholder={t('anglePlaceholder')}
            />
          </div>
          <Button disabled className="mt-1 w-fit">
            <Sparkles />
            {t('generate')}
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center justify-between gap-2 text-base">
            <span>{t('previewTitle')}</span>
            <Badge className="border-violet-500/30 bg-violet-500/10 font-medium text-violet-600 dark:text-violet-400">
              {t('previewBadge')}
            </Badge>
          </CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <Textarea
            disabled
            className="min-h-60"
            placeholder={t('previewPlaceholder')}
          />
          <p className="text-xs text-muted-foreground">{t('notWired.description')}</p>
          <div className="flex flex-wrap items-center gap-2">
            <Button disabled>{t('send')}</Button>
            <Button variant="outline" disabled>
              {t('saveDraft')}
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
