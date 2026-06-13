'use client';

import { useMemo, useState } from 'react';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { Layers, Pencil, Plus, Target, Trash2 } from 'lucide-react';
import type { IndustryListItemDto, NicheListItemDto } from '@evertrust/shared';
import { ApiError } from '@/lib/api';
import { useNiches } from '@/hooks/use-niche-targets';
import {
  useAssignNicheIndustry,
  useCreateIndustry,
  useCreateNiche,
  useDeleteIndustry,
  useDeleteNiche,
  useIndustries,
  useRenameIndustry,
  useRenameNiche,
} from '@/hooks/use-industries';
import { PageHeader } from '@/components/common/page-header';
import { StatTile } from '@/components/common/stat-tile';
import { EmptyState } from '@/components/common/empty-state';
import { ConfirmButton } from '@/components/common/confirm-button';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { NicheTargets } from './niche-targets';

// Radix Select forbids an empty-string item value, so "Unassigned" rides a
// sentinel that we map back to null when calling the assign API.
const UNASSIGNED = '__none__';

// One industry section: its niches (already filtered + sorted by the parent) plus
// the niche rows. `industry` is null for the synthetic "Unassigned" bucket, which
// has no rename/delete affordances.
type Section = {
  industry: IndustryListItemDto | null;
  niches: NicheListItemDto[];
};

// Niches management page: the org's niche catalog grouped by industry, with
// target/campaign/prospect rollups. Click a niche to manage its targets (the same
// NicheTargets surface used on the campaign detail). Industries are grouping-only
// (create/rename/delete here; assign per niche). All data is real.
export function NichesView() {
  const t = useTranslations('growth.niches');
  const nichesQuery = useNiches();
  const industriesQuery = useIndustries();

  const assignIndustry = useAssignNicheIndustry();
  const createIndustry = useCreateIndustry();
  const renameIndustry = useRenameIndustry();
  const deleteIndustry = useDeleteIndustry();
  const createNiche = useCreateNiche();
  const renameNiche = useRenameNiche();
  const deleteNiche = useDeleteNiche();

  // The niche being managed (targets dialog), and the industry dialogs' state.
  const [selected, setSelected] = useState<NicheListItemDto | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [newName, setNewName] = useState('');
  const [renaming, setRenaming] = useState<IndustryListItemDto | null>(null);
  const [renameValue, setRenameValue] = useState('');

  // The niche create/rename dialogs' state. Create carries a chosen industry
  // (UNASSIGNED sentinel = no parent); rename edits one niche's name.
  const [nicheCreateOpen, setNicheCreateOpen] = useState(false);
  const [nicheName, setNicheName] = useState('');
  const [nicheIndustry, setNicheIndustry] = useState<string>(UNASSIGNED);
  const [nicheRenaming, setNicheRenaming] = useState<NicheListItemDto | null>(
    null,
  );
  const [nicheRenameValue, setNicheRenameValue] = useState('');

  const niches = useMemo(() => nichesQuery.data ?? [], [nichesQuery.data]);
  const industries = useMemo(
    () => industriesQuery.data ?? [],
    [industriesQuery.data],
  );

  const totalTargets = niches.reduce((s, n) => s + n.targetCount, 0);
  const totalCampaigns = niches.reduce((s, n) => s + n.campaignCount, 0);
  const totalProspects = niches.reduce((s, n) => s + n.prospectCount, 0);

  // Group niches under their industry. We seed the sections from the industries
  // list (so an industry with zero niches still renders + can be managed), then
  // drop each niche into its parent — or the Unassigned bucket. Industries sort
  // alphabetically; Unassigned always sits last.
  const sections = useMemo<Section[]>(() => {
    const byIndustry = new Map<string, NicheListItemDto[]>();
    const unassigned: NicheListItemDto[] = [];
    for (const n of niches) {
      if (n.industryId) {
        const list = byIndustry.get(n.industryId) ?? [];
        list.push(n);
        byIndustry.set(n.industryId, list);
      } else {
        unassigned.push(n);
      }
    }
    const sortByName = (a: { name: string }, b: { name: string }) =>
      a.name.localeCompare(b.name);
    const assigned: Section[] = [...industries]
      .sort(sortByName)
      .map((industry) => ({
        industry,
        niches: (byIndustry.get(industry.id) ?? []).sort(sortByName),
      }));
    const result = [...assigned];
    if (unassigned.length > 0) {
      result.push({ industry: null, niches: unassigned.sort(sortByName) });
    }
    return result;
  }, [niches, industries]);

  function handleAssign(niche: NicheListItemDto, value: string) {
    const industryId = value === UNASSIGNED ? null : value;
    if (industryId === (niche.industryId ?? null)) return;
    const industryName =
      industries.find((i) => i.id === industryId)?.name ?? null;
    assignIndustry.mutate(
      { nicheId: niche.id, industryId },
      {
        onSuccess: () =>
          toast.success(
            industryName
              ? t('assignToast', { niche: niche.name, industry: industryName })
              : t('unassignToast', { niche: niche.name }),
          ),
        onError: (error) => toast.error(error.message ?? t('assignError')),
      },
    );
  }

  function handleCreate() {
    const name = newName.trim();
    if (!name) return;
    createIndustry.mutate(name, {
      onSuccess: () => {
        toast.success(t('industry.newToast', { name }));
        setCreateOpen(false);
        setNewName('');
      },
      onError: (error) => toast.error(error.message ?? t('industry.createError')),
    });
  }

  function handleRename() {
    if (!renaming) return;
    const name = renameValue.trim();
    if (!name || name === renaming.name) {
      setRenaming(null);
      return;
    }
    renameIndustry.mutate(
      { id: renaming.id, name },
      {
        onSuccess: () => {
          toast.success(t('industry.renameToast', { name }));
          setRenaming(null);
        },
        onError: (error) =>
          toast.error(error.message ?? t('industry.renameError')),
      },
    );
  }

  function handleDelete(industry: IndustryListItemDto) {
    deleteIndustry.mutate(industry.id, {
      onSuccess: () => toast.success(t('industry.deleteToast', { name: industry.name })),
      // The API returns 409 with "Reassign its niches first" — surface its message,
      // falling back to the localized equivalent.
      onError: (error) =>
        toast.error(
          error instanceof ApiError && error.status === 409
            ? error.message
            : (error.message ?? t('industry.deleteError')),
        ),
    });
  }

  function handleCreateNiche() {
    const name = nicheName.trim();
    if (!name) return;
    const industryId = nicheIndustry === UNASSIGNED ? null : nicheIndustry;
    createNiche.mutate(
      { name, industryId },
      {
        onSuccess: () => {
          toast.success(t('niche.newToast', { name }));
          setNicheCreateOpen(false);
          setNicheName('');
          setNicheIndustry(UNASSIGNED);
        },
        // A duplicate niche name is a 409 — surface the server message verbatim,
        // falling back to the localized equivalent.
        onError: (error) =>
          toast.error(
            error instanceof ApiError && error.status === 409
              ? error.message
              : (error.message ?? t('niche.createError')),
          ),
      },
    );
  }

  function handleRenameNiche() {
    if (!nicheRenaming) return;
    const name = nicheRenameValue.trim();
    if (!name || name === nicheRenaming.name) {
      setNicheRenaming(null);
      return;
    }
    renameNiche.mutate(
      { id: nicheRenaming.id, name },
      {
        onSuccess: () => {
          toast.success(t('niche.renameToast', { name }));
          setNicheRenaming(null);
        },
        // A clashing name is a 409 — surface the server message verbatim.
        onError: (error) =>
          toast.error(
            error instanceof ApiError && error.status === 409
              ? error.message
              : (error.message ?? t('niche.renameError')),
          ),
      },
    );
  }

  function handleDeleteNiche(niche: NicheListItemDto) {
    deleteNiche.mutate(niche.id, {
      onSuccess: () => toast.success(t('niche.deleteToast', { name: niche.name })),
      // The API returns 409 ("…campaigns or prospects — reassign or archive…")
      // when blocked — surface its message verbatim, falling back to the localized
      // equivalent.
      onError: (error) =>
        toast.error(
          error instanceof ApiError && error.status === 409
            ? error.message
            : (error.message ?? t('niche.deleteError')),
        ),
    });
  }

  const isLoading = nichesQuery.isLoading || industriesQuery.isLoading;

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title={t('header.title')}
        description={t('header.description')}
        actions={
          <>
            <Button variant="outline" onClick={() => setNicheCreateOpen(true)}>
              <Plus />
              {t('niche.new')}
            </Button>
            <Button onClick={() => setCreateOpen(true)}>
              <Plus />
              {t('industry.new')}
            </Button>
          </>
        }
      />

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
        <StatTile
          label={t('stat.industries')}
          value={isLoading ? <Skeleton className="h-6 w-8" /> : industries.length}
        />
        <StatTile
          label={t('stat.niches')}
          value={isLoading ? <Skeleton className="h-6 w-8" /> : niches.length}
        />
        <StatTile
          label={t('stat.targets')}
          value={isLoading ? <Skeleton className="h-6 w-8" /> : totalTargets}
        />
        <StatTile
          label={t('stat.campaigns')}
          value={isLoading ? <Skeleton className="h-6 w-8" /> : totalCampaigns}
        />
        <StatTile
          label={t('stat.prospects')}
          value={isLoading ? <Skeleton className="h-6 w-8" /> : totalProspects}
        />
      </div>

      {isLoading ? (
        <Skeleton className="h-64 w-full rounded-lg" />
      ) : nichesQuery.isError ? (
        <p className="text-sm text-destructive">
          {t('loadError', { message: nichesQuery.error.message })}
        </p>
      ) : niches.length === 0 && industries.length === 0 ? (
        <EmptyState
          icon={<Layers />}
          title={t('empty.title')}
          description={t('empty.description')}
        />
      ) : (
        <div className="flex flex-col gap-6">
          {sections.map((section) => (
            <IndustrySection
              key={section.industry?.id ?? UNASSIGNED}
              section={section}
              industries={industries}
              onAssign={handleAssign}
              onSelectNiche={setSelected}
              onRename={(industry) => {
                setRenaming(industry);
                setRenameValue(industry.name);
              }}
              onDelete={handleDelete}
              deleting={deleteIndustry.isPending}
              onRenameNiche={(niche) => {
                setNicheRenaming(niche);
                setNicheRenameValue(niche.name);
              }}
              onDeleteNiche={handleDeleteNiche}
              deletingNiche={deleteNiche.isPending}
            />
          ))}
        </div>
      )}

      {/* Per-niche targets management (unchanged drill-in). */}
      <Dialog
        open={!!selected}
        onOpenChange={(open) => {
          if (!open) setSelected(null);
        }}
      >
        <DialogContent className="max-h-[85vh] max-w-3xl overflow-y-auto">
          {selected ? (
            <>
              <DialogHeader>
                <DialogTitle>{selected.name}</DialogTitle>
                <DialogDescription>{t('manage.description')}</DialogDescription>
              </DialogHeader>
              <NicheTargets nicheId={selected.id} />
            </>
          ) : null}
        </DialogContent>
      </Dialog>

      {/* New industry. */}
      <Dialog
        open={createOpen}
        onOpenChange={(open) => {
          setCreateOpen(open);
          if (!open) setNewName('');
        }}
      >
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>{t('industry.createDialogTitle')}</DialogTitle>
            <DialogDescription>
              {t('industry.createDialogDescription')}
            </DialogDescription>
          </DialogHeader>
          <Input
            autoFocus
            value={newName}
            placeholder={t('industry.namePlaceholder')}
            maxLength={120}
            onChange={(e) => setNewName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') handleCreate();
            }}
          />
          <DialogFooter>
            <Button variant="ghost" onClick={() => setCreateOpen(false)}>
              {t('industry.cancel')}
            </Button>
            <Button
              onClick={handleCreate}
              disabled={!newName.trim() || createIndustry.isPending}
            >
              {createIndustry.isPending
                ? t('industry.creating')
                : t('industry.create')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Rename industry. */}
      <Dialog
        open={!!renaming}
        onOpenChange={(open) => {
          if (!open) setRenaming(null);
        }}
      >
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>{t('industry.renameDialogTitle')}</DialogTitle>
          </DialogHeader>
          <Input
            autoFocus
            value={renameValue}
            placeholder={t('industry.namePlaceholder')}
            maxLength={120}
            onChange={(e) => setRenameValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') handleRename();
            }}
          />
          <DialogFooter>
            <Button variant="ghost" onClick={() => setRenaming(null)}>
              {t('industry.cancel')}
            </Button>
            <Button
              onClick={handleRename}
              disabled={!renameValue.trim() || renameIndustry.isPending}
            >
              {renameIndustry.isPending
                ? t('industry.saving')
                : t('industry.save')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* New niche — name + an industry to group it under (or Unassigned). */}
      <Dialog
        open={nicheCreateOpen}
        onOpenChange={(open) => {
          setNicheCreateOpen(open);
          if (!open) {
            setNicheName('');
            setNicheIndustry(UNASSIGNED);
          }
        }}
      >
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>{t('niche.createDialogTitle')}</DialogTitle>
            <DialogDescription>
              {t('niche.createDialogDescription')}
            </DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-3">
            <Input
              autoFocus
              value={nicheName}
              placeholder={t('niche.namePlaceholder')}
              maxLength={120}
              onChange={(e) => setNicheName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') handleCreateNiche();
              }}
            />
            <Select value={nicheIndustry} onValueChange={setNicheIndustry}>
              <SelectTrigger
                className="w-full"
                aria-label={t('niche.industryLabel')}
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={UNASSIGNED}>{t('unassigned')}</SelectItem>
                {industries.map((i) => (
                  <SelectItem key={i.id} value={i.id}>
                    {i.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <DialogFooter>
            <Button
              variant="ghost"
              onClick={() => setNicheCreateOpen(false)}
            >
              {t('niche.cancel')}
            </Button>
            <Button
              onClick={handleCreateNiche}
              disabled={!nicheName.trim() || createNiche.isPending}
            >
              {createNiche.isPending ? t('niche.creating') : t('niche.create')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Rename niche. */}
      <Dialog
        open={!!nicheRenaming}
        onOpenChange={(open) => {
          if (!open) setNicheRenaming(null);
        }}
      >
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>{t('niche.renameDialogTitle')}</DialogTitle>
          </DialogHeader>
          <Input
            autoFocus
            value={nicheRenameValue}
            placeholder={t('niche.namePlaceholder')}
            maxLength={120}
            onChange={(e) => setNicheRenameValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') handleRenameNiche();
            }}
          />
          <DialogFooter>
            <Button variant="ghost" onClick={() => setNicheRenaming(null)}>
              {t('niche.cancel')}
            </Button>
            <Button
              onClick={handleRenameNiche}
              disabled={!nicheRenameValue.trim() || renameNiche.isPending}
            >
              {renameNiche.isPending ? t('niche.saving') : t('niche.save')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// A single industry group: a header (name + niche-count badge + rename/delete for
// real industries) over a table of its niche rows. The Unassigned bucket passes a
// null industry and renders the header without management controls.
function IndustrySection({
  section,
  industries,
  onAssign,
  onSelectNiche,
  onRename,
  onDelete,
  deleting,
  onRenameNiche,
  onDeleteNiche,
  deletingNiche,
}: {
  section: Section;
  industries: IndustryListItemDto[];
  onAssign: (niche: NicheListItemDto, value: string) => void;
  onSelectNiche: (niche: NicheListItemDto) => void;
  onRename: (industry: IndustryListItemDto) => void;
  onDelete: (industry: IndustryListItemDto) => void;
  deleting: boolean;
  onRenameNiche: (niche: NicheListItemDto) => void;
  onDeleteNiche: (niche: NicheListItemDto) => void;
  deletingNiche: boolean;
}) {
  const t = useTranslations('growth.niches');
  const { industry, niches } = section;
  const count = industry?.nicheCount ?? niches.length;

  return (
    <section className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="text-sm font-semibold tracking-tight">
          {industry ? industry.name : t('unassigned')}
        </h2>
        <Badge variant="secondary">{t('nicheCount', { count })}</Badge>
        {industry ? (
          <div className="ml-auto flex items-center gap-1">
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label={t('industry.renameAriaLabel', { industry: industry.name })}
              onClick={() => onRename(industry)}
            >
              <Pencil />
            </Button>
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label={t('industry.deleteAriaLabel', { industry: industry.name })}
              disabled={deleting}
              onClick={() => onDelete(industry)}
            >
              <Trash2 />
            </Button>
          </div>
        ) : null}
      </div>

      {niches.length === 0 ? (
        <p className="rounded-lg border border-dashed px-4 py-6 text-center text-sm text-muted-foreground">
          {t('empty.title')}
        </p>
      ) : (
        <div className="overflow-hidden rounded-lg border">
          <Table className="table-fixed">
            <TableHeader>
              <TableRow>
                <TableHead>{t('column.niche')}</TableHead>
                <TableHead className="w-44">{t('column.slug')}</TableHead>
                <TableHead className="w-48">{t('column.industry')}</TableHead>
                <TableHead className="w-24 text-right">{t('column.prospects')}</TableHead>
                <TableHead className="w-24 text-right">{t('column.targets')}</TableHead>
                <TableHead className="w-28 text-right">{t('column.campaigns')}</TableHead>
                <TableHead className="w-20" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {niches.map((n) => (
                <TableRow
                  key={n.id}
                  className="cursor-pointer"
                  onClick={() => onSelectNiche(n)}
                  tabIndex={0}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') onSelectNiche(n);
                  }}
                >
                  <TableCell className="font-medium">
                    <span className="flex items-center gap-2">
                      <Target className="size-4 text-muted-foreground" />
                      {n.name}
                    </span>
                  </TableCell>
                  <TableCell className="text-muted-foreground">{n.slug}</TableCell>
                  {/* The assign Select is interactive — stop row-level click/key
                      handlers from also opening the targets dialog. */}
                  <TableCell
                    onClick={(e) => e.stopPropagation()}
                    onKeyDown={(e) => e.stopPropagation()}
                  >
                    <Select
                      value={n.industryId ?? UNASSIGNED}
                      onValueChange={(v) => onAssign(n, v)}
                    >
                      <SelectTrigger
                        size="sm"
                        className="w-full"
                        aria-label={t('assignAriaLabel', { niche: n.name })}
                      >
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value={UNASSIGNED}>
                          {t('unassigned')}
                        </SelectItem>
                        {industries.map((i) => (
                          <SelectItem key={i.id} value={i.id}>
                            {i.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {n.prospectCount}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {n.targetCount}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {n.campaignCount}
                  </TableCell>
                  {/* Rename + delete are interactive — stop row-level
                      click/key handlers from also opening the targets dialog. */}
                  <TableCell
                    onClick={(e) => e.stopPropagation()}
                    onKeyDown={(e) => e.stopPropagation()}
                  >
                    <div className="flex items-center justify-end gap-1">
                      <Button
                        size="icon"
                        variant="ghost"
                        className="size-8 text-muted-foreground"
                        aria-label={t('niche.renameAriaLabel', { niche: n.name })}
                        onClick={() => onRenameNiche(n)}
                      >
                        <Pencil />
                      </Button>
                      <ConfirmButton
                        trigger={
                          <Button
                            size="icon"
                            variant="ghost"
                            className="size-8 text-muted-foreground hover:text-destructive"
                            aria-label={t('niche.deleteAriaLabel', {
                              niche: n.name,
                            })}
                          >
                            <Trash2 />
                          </Button>
                        }
                        title={t('niche.deleteConfirmTitle', { name: n.name })}
                        description={t('niche.deleteConfirmDescription')}
                        confirmLabel={t('niche.delete')}
                        pending={deletingNiche}
                        onConfirm={() => onDeleteNiche(n)}
                      />
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </section>
  );
}
