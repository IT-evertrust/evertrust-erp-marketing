'use client';

import { useTranslations } from 'next-intl';
import { Hammer } from 'lucide-react';
import { PageHeader } from '@/components/common/page-header';
import { EmptyState } from '@/components/common/empty-state';
import { Badge } from '@/components/ui/badge';

// A standard "rebuilt in a later phase" placeholder for routes that exist in the
// new R.E.A.N. nav but aren't built yet (Activate / Nurture / Reports). Reads its
// copy from the `placeholders` i18n namespace. `page` selects the title +
// description block (placeholders.<page>.{title,description}).
export function ComingSoon({ page }: { page: 'activate' | 'nurture' | 'reports' }) {
  const t = useTranslations('placeholders');
  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title={t(`${page}.title`)}
        description={t(`${page}.description`)}
        actions={<Badge variant="secondary">{t('comingSoon.badge')}</Badge>}
      />
      <EmptyState
        icon={<Hammer />}
        title={t('comingSoon.badge')}
        description={t('comingSoon.body')}
      />
    </div>
  );
}
