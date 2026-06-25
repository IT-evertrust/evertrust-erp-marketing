'use client';

// Contract Assist (Nurture › Contract Assist tab). A Read AI sales-analysis driven
// contract generator: each row is a real `contracts` row, inline-edited (PATCH on
// blur), generated (status → GENERATED), downloaded as a client-side .txt draft, or
// deleted. Clicking a company name selects the row into the Company Analysis panel.
import { useEffect, useMemo, useState } from 'react';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { Download, Loader2, Plus, Trash2 } from 'lucide-react';
import type { ContractDto, ContractType } from '@evertrust/shared';
import {
  useContracts,
  useCreateContract,
  useDeleteContract,
  useUpdateContract,
} from '@/hooks/use-contracts';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';

const CONTRACT_TYPES: readonly ContractType[] = [
  'Vollmacht',
  'Vertragsvereinbarung',
  'NDA',
];

// "€28,000" — whole euros, thousands-grouped. null/0 ⇒ em dash placeholder text.
function formatEuro(value: number | null): string {
  if (value == null) return '';
  return `€${value.toLocaleString('en-US')}`;
}

// Parse the digits out of a free-typed value field into a non-negative int.
function parseEuro(raw: string): number | null {
  const digits = raw.replace(/[^\d]/g, '');
  if (!digits) return null;
  return Number.parseInt(digits, 10);
}

// Build a plain-text contract draft from a row and trigger a browser download.
function downloadDraft(c: ContractDto, label: string): void {
  const lines: string[] = [];
  lines.push(`${(c.contractType ?? label).toUpperCase()}`);
  lines.push('='.repeat(40));
  lines.push('');
  lines.push(`Company:  ${c.company ?? '—'}`);
  lines.push(`Sector:   ${c.sector ?? '—'}`);
  lines.push(`Value:    ${formatEuro(c.value) || '—'}`);
  lines.push(`Deadline: ${c.deadline ?? '—'}`);
  lines.push('');
  if (c.analysis) {
    lines.push('ANALYSIS');
    lines.push('-'.repeat(40));
    lines.push(c.analysis);
    lines.push('');
  }
  if (c.terms.length > 0) {
    lines.push('KEY TERMS');
    lines.push('-'.repeat(40));
    for (const term of c.terms) lines.push(`- ${term}`);
    lines.push('');
  }

  const blob = new Blob([lines.join('\n')], { type: 'text/plain;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  const slug = (c.company ?? 'contract')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '');
  a.href = url;
  a.download = `${slug || 'contract'}.txt`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

export function ContractAssist({ campaignId }: { campaignId?: string }) {
  const t = useTranslations('nurture');
  const params = useMemo(
    () => (campaignId ? { campaignId } : {}),
    [campaignId],
  );
  const q = useContracts(params);
  const create = useCreateContract();

  // Local copy seeded from the server so inline edits feel instant; re-seed when the
  // query data changes (a fetch resolves, an invalidation refetches).
  const [rows, setRows] = useState<ContractDto[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  useEffect(() => {
    if (q.data) setRows(q.data);
  }, [q.data]);

  // Keep the selection valid as rows come and go.
  useEffect(() => {
    if (selectedId && !rows.some((r) => r.id === selectedId)) {
      setSelectedId(null);
    }
  }, [rows, selectedId]);

  const selected = rows.find((r) => r.id === selectedId) ?? null;

  function patchLocal(id: string, patch: Partial<ContractDto>) {
    setRows((prev) => prev.map((r) => (r.id === id ? { ...r, ...patch } : r)));
  }

  function onCreate() {
    create.mutate(
      { contractType: 'Vertragsvereinbarung', sector: 'PV', ...params },
      {
        onSuccess: (row) => {
          setRows((prev) => [row, ...prev]);
          toast.success(t('contracts.createdToast'));
        },
        onError: (e) => toast.error(e.message ?? t('contracts.createError')),
      },
    );
  }

  return (
    <div className="flex flex-col gap-4">
      {/* Contract Generator */}
      <section className="rounded-[10px] border bg-card shadow-sm">
        <header className="flex items-center justify-between gap-3 border-b px-5 py-4">
          <div className="flex flex-col gap-0.5">
            <h2 className="text-[15px] font-semibold leading-none text-foreground">
              {t('contracts.generatorTitle')}
            </h2>
            <p className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
              {t('contracts.generatorHint')}
            </p>
          </div>
          <button
            type="button"
            onClick={onCreate}
            disabled={create.isPending}
            className="inline-flex items-center gap-1.5 rounded-md bg-foreground px-3 py-2 text-[13px] font-semibold text-background transition hover:bg-foreground/90 disabled:opacity-50"
          >
            {create.isPending ? (
              <Loader2 className="size-3.5 animate-spin" />
            ) : (
              <Plus className="size-3.5" />
            )}
            {t('contracts.new')}
          </button>
        </header>

        {q.isLoading ? (
          <div className="p-5">
            <Skeleton className="h-40 w-full rounded-lg" />
          </div>
        ) : q.isError ? (
          <p className="px-5 py-6 text-sm text-destructive">
            {t('contracts.loadError', { message: q.error.message })}
          </p>
        ) : rows.length === 0 ? (
          <p className="px-5 py-10 text-center text-sm text-muted-foreground">
            {t('contracts.tableEmpty')}
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-[13px]">
              <thead>
                <tr className="border-b text-[11px] uppercase tracking-wider text-muted-foreground">
                  <th className="px-5 py-2.5 text-left font-semibold">
                    {t('contracts.colCompany')}
                  </th>
                  <th className="px-3 py-2.5 text-left font-semibold">
                    {t('contracts.colSector')}
                  </th>
                  <th className="px-3 py-2.5 text-left font-semibold">
                    {t('contracts.colValue')}
                  </th>
                  <th className="px-3 py-2.5 text-left font-semibold">
                    {t('contracts.colDeadline')}
                  </th>
                  <th className="px-3 py-2.5 text-left font-semibold">
                    {t('contracts.colType')}
                  </th>
                  <th className="px-5 py-2.5 text-right font-semibold">
                    {t('contracts.colActions')}
                  </th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <ContractRow
                    key={row.id}
                    row={row}
                    selected={row.id === selectedId}
                    onSelect={() => setSelectedId(row.id)}
                    onPatchLocal={patchLocal}
                  />
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* Company Analysis */}
      <CompanyAnalysis contract={selected} />
    </div>
  );
}

function ContractRow({
  row,
  selected,
  onSelect,
  onPatchLocal,
}: {
  row: ContractDto;
  selected: boolean;
  onSelect: () => void;
  onPatchLocal: (id: string, patch: Partial<ContractDto>) => void;
}) {
  const t = useTranslations('nurture');
  const update = useUpdateContract();
  const del = useDeleteContract();

  // Commit a single field to the server when it changed from the server value.
  function commit<K extends 'company' | 'sector' | 'value' | 'deadline'>(
    key: K,
    next: ContractDto[K],
  ) {
    if (next === row[key]) return;
    onPatchLocal(row.id, { [key]: next } as Partial<ContractDto>);
    update.mutate(
      { id: row.id, patch: { [key]: next } },
      {
        onError: (e) => toast.error(e.message ?? t('contracts.saveError')),
      },
    );
  }

  function onType(next: ContractType) {
    onPatchLocal(row.id, { contractType: next });
    update.mutate(
      { id: row.id, patch: { contractType: next } },
      { onError: (e) => toast.error(e.message ?? t('contracts.saveError')) },
    );
  }

  function onGenerate() {
    update.mutate(
      { id: row.id, patch: { status: 'GENERATED' } },
      {
        onSuccess: () => {
          onPatchLocal(row.id, { status: 'GENERATED' });
          toast.success(t('contracts.generatedToast'));
        },
        onError: (e) => toast.error(e.message ?? t('contracts.generateError')),
      },
    );
  }

  function onDelete() {
    if (!window.confirm(t('contracts.deleteConfirm'))) return;
    del.mutate(row.id, {
      onSuccess: () => toast.success(t('contracts.deletedToast')),
      onError: (e) => toast.error(e.message ?? t('contracts.deleteError')),
    });
  }

  return (
    <tr
      className={cn(
        'border-b transition-colors last:border-b-0',
        selected ? 'bg-muted/60' : 'hover:bg-muted/30',
      )}
    >
      {/* COMPANY — click name to select the row */}
      <td className="px-5 py-2">
        <input
          type="text"
          defaultValue={row.company ?? ''}
          placeholder={t('contracts.companyPlaceholder')}
          onFocus={onSelect}
          onClick={onSelect}
          onBlur={(e) => commit('company', e.target.value.trim() || null)}
          className="w-full min-w-[10rem] cursor-pointer rounded-sm bg-transparent px-1 py-0.5 font-semibold text-foreground outline-none focus:bg-background focus:ring-1 focus:ring-ring"
        />
      </td>

      {/* SECTOR */}
      <td className="px-3 py-2">
        <input
          type="text"
          defaultValue={row.sector ?? ''}
          placeholder="PV"
          onBlur={(e) => commit('sector', e.target.value.trim() || null)}
          className="w-20 rounded-full bg-muted px-2.5 py-0.5 text-center text-[12px] font-medium text-muted-foreground outline-none focus:bg-background focus:ring-1 focus:ring-ring"
        />
      </td>

      {/* VALUE */}
      <td className="px-3 py-2">
        <input
          type="text"
          inputMode="numeric"
          defaultValue={formatEuro(row.value)}
          placeholder="€0"
          onBlur={(e) => {
            const next = parseEuro(e.target.value);
            e.target.value = formatEuro(next);
            commit('value', next);
          }}
          className="w-24 rounded-sm bg-transparent px-1 py-0.5 tabular-nums text-foreground outline-none focus:bg-background focus:ring-1 focus:ring-ring"
        />
      </td>

      {/* DEADLINE */}
      <td className="px-3 py-2">
        <input
          type="text"
          defaultValue={row.deadline ?? ''}
          placeholder={t('contracts.deadlinePlaceholder')}
          onBlur={(e) => commit('deadline', e.target.value.trim() || null)}
          className="w-32 rounded-sm bg-transparent px-1 py-0.5 text-muted-foreground outline-none focus:bg-background focus:ring-1 focus:ring-ring"
        />
      </td>

      {/* TYPE */}
      <td className="px-3 py-2">
        <select
          value={row.contractType ?? ''}
          onChange={(e) => onType(e.target.value as ContractType)}
          className="rounded-md border bg-background px-2 py-1 text-[12px] text-foreground outline-none focus:ring-1 focus:ring-ring"
        >
          {row.contractType == null ? (
            <option value="" disabled>
              {t('contracts.typePlaceholder')}
            </option>
          ) : null}
          {CONTRACT_TYPES.map((type) => (
            <option key={type} value={type}>
              {type}
            </option>
          ))}
        </select>
      </td>

      {/* ACTIONS */}
      <td className="px-5 py-2">
        <div className="flex items-center justify-end gap-1.5">
          <button
            type="button"
            onClick={onGenerate}
            disabled={update.isPending}
            className="inline-flex items-center rounded-md bg-foreground px-2.5 py-1.5 text-[12px] font-semibold text-background transition hover:bg-foreground/90 disabled:opacity-50"
          >
            {t('contracts.generate')}
          </button>
          <button
            type="button"
            onClick={() => downloadDraft(row, t('contracts.typePlaceholder'))}
            title={t('contracts.download')}
            aria-label={t('contracts.download')}
            className="inline-flex size-7 items-center justify-center rounded-md border text-muted-foreground transition hover:bg-muted hover:text-foreground"
          >
            <Download className="size-3.5" />
          </button>
          <button
            type="button"
            onClick={onDelete}
            disabled={del.isPending}
            title={t('contracts.delete')}
            aria-label={t('contracts.delete')}
            className="inline-flex size-7 items-center justify-center rounded-md border text-muted-foreground transition hover:bg-destructive/10 hover:text-destructive disabled:opacity-50"
          >
            {del.isPending ? (
              <Loader2 className="size-3.5 animate-spin" />
            ) : (
              <Trash2 className="size-3.5" />
            )}
          </button>
        </div>
      </td>
    </tr>
  );
}

function CompanyAnalysis({ contract }: { contract: ContractDto | null }) {
  const t = useTranslations('nurture');

  const hintParts = contract
    ? [
        contract.sector,
        contract.value != null ? formatEuro(contract.value) : null,
        contract.deadline ? t('contracts.due', { date: contract.deadline }) : null,
      ].filter(Boolean)
    : [];

  return (
    <section className="rounded-[10px] border bg-card shadow-sm">
      <header className="flex flex-col gap-0.5 border-b px-5 py-4">
        <h2 className="text-[15px] font-semibold leading-none text-foreground">
          {t('contracts.analysisTitle')}
        </h2>
        {hintParts.length > 0 ? (
          <p className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
            {hintParts.join(' · ')}
          </p>
        ) : null}
      </header>

      <div className="px-5 py-4">
        {!contract ? (
          <p className="text-sm text-muted-foreground">
            {t('contracts.analysisEmpty')}
          </p>
        ) : (
          <div className="flex flex-col gap-4">
            <p className="whitespace-pre-line text-[13px] leading-relaxed text-foreground">
              {contract.analysis || t('contracts.analysisNone')}
            </p>
            {contract.terms.length > 0 ? (
              <div className="flex flex-col gap-1.5">
                <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                  {t('contracts.termsTitle')}
                </p>
                <ul className="flex list-disc flex-col gap-1 pl-5 text-[13px] text-foreground">
                  {contract.terms.map((term, i) => (
                    <li key={i}>{term}</li>
                  ))}
                </ul>
              </div>
            ) : null}
          </div>
        )}
      </div>
    </section>
  );
}
