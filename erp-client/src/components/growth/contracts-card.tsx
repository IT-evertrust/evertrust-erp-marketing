'use client';

import { useTranslations } from 'next-intl';
import { ExternalLink, FileSignature, Sparkles } from 'lucide-react';
import type { ContractDto } from '@evertrust/shared';
import { useContracts, type ContractFilters } from '@/hooks/use-contracts';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { EmptyState } from '@/components/common/empty-state';
import { formatDateTime } from '@/lib/tender-format';
import { CONTRACT_STATUS_CLASS } from '@/lib/growth-format';

// Reusable contract list (ContractMaker output; the PDF lives in Drive). Read-only.
// Pass a scope (leadId or campaignId) — the fetch only fires when a scope is set.
//
// `showDraftForm` opts into the mockup's "deal + template -> draft contract"
// composer (Nurture › Contract Assist). There is NO contract-generation API in the
// client today, so that form renders a clear "coming soon" state above the live
// (real) contracts list rather than a fake draft. campaign-detail.tsx omits it, so
// its surface is unchanged.
export function ContractsCard({
  filters,
  title,
  emptyHint,
  showDraftForm = false,
}: {
  filters: ContractFilters;
  title?: string;
  emptyHint?: string;
  showDraftForm?: boolean;
}) {
  const t = useTranslations('marketing');
  const enabled = !!(filters.leadId || filters.campaignId);
  const q = useContracts(filters, enabled);
  const contracts = q.data ?? [];
  const resolvedTitle = title ?? t('contracts.title');
  const resolvedEmptyHint = emptyHint ?? t('contracts.emptyHint');

  return (
    <div className="flex flex-col gap-4">
      {showDraftForm ? <ContractDraftComposer /> : null}

      <div className="flex flex-col gap-2">
        <div className="flex items-center gap-2 text-[11px] uppercase tracking-wider text-muted-foreground">
          <FileSignature className="size-3.5" />
          <span>{resolvedTitle}</span>
          {contracts.length > 0 ? (
            <span className="tabular-nums">· {contracts.length}</span>
          ) : null}
        </div>

        {q.isLoading ? (
          <Skeleton className="h-24 w-full rounded-lg" />
        ) : q.isError ? (
          <p className="text-sm text-destructive">
            {t('contracts.loadError', { message: q.error.message })}
          </p>
        ) : contracts.length === 0 ? (
          <p className="rounded-lg border border-dashed px-4 py-6 text-center text-sm text-muted-foreground">
            {resolvedEmptyHint}
          </p>
        ) : (
          <div className="overflow-hidden rounded-lg border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t('contracts.colStatus')}</TableHead>
                  <TableHead>{t('contracts.colTerm')}</TableHead>
                  <TableHead>{t('contracts.colCreated')}</TableHead>
                  <TableHead>{t('contracts.colSigned')}</TableHead>
                  <TableHead className="text-right">
                    {t('contracts.colDrive')}
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {contracts.map((c) => (
                  <ContractRow key={c.id} contract={c} />
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </div>
    </div>
  );
}

// The mockup's Contract Assist composer (deal + template -> draft). No client API
// backs contract generation yet, so the picker + action are disabled and an
// EmptyState makes the "coming soon" nature explicit — no fabricated draft.
function ContractDraftComposer() {
  const tn = useTranslations('nurture');
  const TEMPLATES = ['MSA', 'SOW', 'NDA'] as const;

  return (
    <div className="flex flex-col gap-3 rounded-lg border bg-card p-4 shadow-sm">
      <div className="flex flex-wrap items-center gap-2">
        <Select disabled>
          <SelectTrigger className="w-[260px]">
            <SelectValue placeholder={tn('contracts.dealPlaceholder')} />
          </SelectTrigger>
          <SelectContent />
        </Select>
        <Select disabled>
          <SelectTrigger className="w-[200px]">
            <SelectValue placeholder={tn('contracts.templatePlaceholder')} />
          </SelectTrigger>
          <SelectContent>
            {TEMPLATES.map((tpl) => (
              <SelectItem key={tpl} value={tpl}>
                {tn(`contracts.template.${tpl}`)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Button type="button" disabled>
          <Sparkles />
          {tn('contracts.generate')}
        </Button>
      </div>
      <EmptyState
        icon={<FileSignature />}
        title={tn('contracts.comingSoonTitle')}
        description={tn('contracts.comingSoonBody')}
      />
    </div>
  );
}

function ContractRow({ contract: c }: { contract: ContractDto }) {
  const t = useTranslations('marketing');
  return (
    <TableRow>
      <TableCell>
        <Badge variant="outline" className={CONTRACT_STATUS_CLASS[c.status]}>
          {t(`contract.${c.status}`)}
        </Badge>
        {c.status === 'FAILED' && c.error ? (
          <p className="mt-1 text-xs text-rose-400">{c.error}</p>
        ) : null}
      </TableCell>
      <TableCell className="text-muted-foreground">
        {c.cooperationTerm || '—'}
      </TableCell>
      <TableCell className="tabular-nums text-muted-foreground">
        {formatDateTime(c.createdAt)}
      </TableCell>
      <TableCell className="tabular-nums text-muted-foreground">
        {c.signedAt ? formatDateTime(c.signedAt) : '—'}
      </TableCell>
      <TableCell className="text-right">
        {c.driveUrl ? (
          <a
            href={c.driveUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 text-sm text-sky-400 hover:underline"
          >
            {t('common.open')}
            <ExternalLink className="size-3.5" />
          </a>
        ) : (
          <span className="text-sm text-muted-foreground">—</span>
        )}
      </TableCell>
    </TableRow>
  );
}
