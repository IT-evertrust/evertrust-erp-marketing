'use client';

import Link from 'next/link';
import { ChevronLeft } from 'lucide-react';
import { useTranslations } from 'next-intl';
// Client-rendered + dynamic: gated, browser-fetched data, nothing at build time.
import { useRequirePermission } from '@/lib/permissions';
import { AppShell } from '@/components/shell/app-shell';
import { TenderCreateForm } from '@/components/tenders/tender-create-form';
import { Skeleton } from '@/components/ui/skeleton';

export default function NewTenderPage() {
  const t = useTranslations('tenders');
  // Creating requires write; guard on it so a read-only user can't reach the form.
  const { allowed, isLoading } = useRequirePermission('tenders:write');

  return (
    <AppShell>
      <div className="mx-auto flex max-w-3xl flex-col gap-6">
        <Link
          href="/tenders"
          className="inline-flex w-fit items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
        >
          <ChevronLeft className="size-4" />
          {t('detail.back')}
        </Link>
        {isLoading ? (
          <Skeleton className="h-96 w-full rounded-lg" />
        ) : allowed ? (
          <TenderCreateForm />
        ) : (
          <p className="text-sm text-muted-foreground">{t('common.redirecting')}</p>
        )}
      </div>
    </AppShell>
  );
}
