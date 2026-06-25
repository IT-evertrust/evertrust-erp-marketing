'use client';

import { useMemo, useState } from 'react';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { Check, ChevronDown, Loader2 } from 'lucide-react';
import { useCreateNiche, useNiches } from '@/hooks/use-niches';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import { cn } from '@/lib/utils';

// Stop a pointer/click from reaching a draggable wrapper or the card onClick (so the
// pill behaves as a control, not a drag handle / drawer trigger).
function stop(e: React.SyntheticEvent) {
  e.stopPropagation();
}

// The deal "Sector/niche" tag control — a small bordered pill that opens a popover:
// a scrollable list of the org's niches (✓ the active one) plus a bottom "type-or-add"
// input. Picking a name calls onChange(name); typing a NEW name + Enter creates the
// niche (useCreateNiche) then calls onChange(newName). Shared by the Nurture deal card
// and the Contract Assist Sector cell — both store a denormalized niche *name* string.
export function NicheSelect({
  value,
  onChange,
  placeholder = 'PV',
}: {
  value: string | null;
  onChange: (name: string) => void;
  placeholder?: string;
}) {
  const t = useTranslations('nurture.niche');
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState('');
  // Only fetch the catalog once the popover opens (lazy — most cards never open it).
  const nichesQ = useNiches(open);
  const createNiche = useCreateNiche();

  const names = useMemo(() => {
    const list = (nichesQ.data ?? []).map((n) => n.name);
    // De-dupe by slug-ish lowercased name, keep first-seen casing, sort A→Z.
    const seen = new Set<string>();
    const out: string[] = [];
    for (const name of list) {
      const key = name.trim().toLowerCase();
      if (!key || seen.has(key)) continue;
      seen.add(key);
      out.push(name);
    }
    return out.sort((a, b) => a.localeCompare(b));
  }, [nichesQ.data]);

  const current = value?.trim() || null;

  function pick(name: string) {
    onChange(name);
    setDraft('');
    setOpen(false);
  }

  // Add a brand-new niche (Enter from the input). If the typed name already exists
  // (case-insensitive) just pick it instead of creating a duplicate.
  function addNew() {
    const name = draft.trim();
    if (!name) return;
    const existing = names.find(
      (n) => n.toLowerCase() === name.toLowerCase(),
    );
    if (existing) {
      pick(existing);
      return;
    }
    createNiche.mutate(
      { name },
      {
        onSuccess: (niche) => pick(niche.name),
        onError: (err) => toast.error(err.message ?? t('addError')),
      },
    );
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          onPointerDown={stop}
          onClick={stop}
          className={cn(
            'inline-flex max-w-full items-center gap-1 rounded-[5px] border border-[#c2c7ce] bg-white px-[5px] py-px text-[9px] font-bold uppercase tracking-[0.05em] outline-none transition-colors hover:bg-[#f6f7f9] focus-visible:ring-1 focus-visible:ring-[#959ca7]',
            current ? 'text-[#5b626d]' : 'text-[#959ca7]',
          )}
        >
          <span className="truncate">{current ?? placeholder}</span>
          <ChevronDown className="size-2.5 shrink-0 text-[#959ca7]" />
        </button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        sideOffset={4}
        onPointerDown={stop}
        onClick={stop}
        className="w-[200px] rounded-[8px] border-[#d6dade] bg-white p-0 text-[#15171c] shadow-[0_8px_24px_rgba(21,23,28,0.12)]"
      >
        <div className="max-h-[200px] overflow-y-auto py-1">
          {nichesQ.isLoading ? (
            <div className="flex items-center justify-center px-3 py-4 text-[#959ca7]">
              <Loader2 className="size-3.5 animate-spin" />
            </div>
          ) : names.length === 0 ? (
            <p className="px-3 py-3 text-[11px] text-[#959ca7]">{t('empty')}</p>
          ) : (
            names.map((name) => {
              const active = current?.toLowerCase() === name.toLowerCase();
              return (
                <button
                  key={name}
                  type="button"
                  onClick={() => pick(name)}
                  className="flex w-full items-center justify-between gap-2 px-3 py-1.5 text-left text-[12px] text-[#15171c] transition-colors hover:bg-[#f6f7f9]"
                >
                  <span className="truncate">{name}</span>
                  {active ? (
                    <Check className="size-3.5 shrink-0 text-[#15171c]" />
                  ) : null}
                </button>
              );
            })
          )}
        </div>
        <div className="border-t border-[#e4e7eb] p-1.5">
          <input
            type="text"
            value={draft}
            autoFocus
            disabled={createNiche.isPending}
            placeholder={t('addPlaceholder')}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                addNew();
              } else if (e.key === 'Escape') {
                e.preventDefault();
                setOpen(false);
              }
            }}
            className="w-full rounded-[5px] border border-[#d6dade] bg-white px-2 py-1 text-[12px] text-[#15171c] outline-none placeholder:text-[#959ca7] focus:border-[#959ca7] disabled:opacity-50"
          />
        </div>
      </PopoverContent>
    </Popover>
  );
}
