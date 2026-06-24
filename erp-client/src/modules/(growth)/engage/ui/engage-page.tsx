'use client';

import { useState } from 'react';
import { Pencil, Plus, RefreshCw } from 'lucide-react';

import { GrowthCard, Spinner } from '@/modules/(growth)/shared';

import { EngageCampaignTable } from '../components/engage-campaign-table';
import { PersonaDialog } from '../components/persona-create-dialog';
import { ReplyDetail } from '../components/reply-detail';
import { ReplyList } from '../components/reply-list';
import { useEngage } from '../hooks/use-engage';

export function EngagePage() {
  const engage = useEngage();
  // The persona dialog is shared for create + edit; null = closed.
  const [personaDialog, setPersonaDialog] = useState<
    { mode: 'create' } | { mode: 'edit'; id: string; name: string } | null
  >(null);
  const activePersonaId = engage.selectedCampaign?.personaId ?? null;
  const activePersona = engage.personas.find((p) => p.id === activePersonaId);

  return (
    <main className="px-6 py-5 duration-300 animate-in fade-in">
      <div className="mb-4 border-b border-[#e4e7eb]">
        <button
          type="button"
          className="mb-[-1px] border-b-2 border-[#15171c] px-4 py-3 text-[13px] font-bold text-[#15171c]"
        >
          Reply Sorter
        </button>
      </div>

      <div className="flex flex-col gap-4">
        <div className="flex flex-wrap items-center gap-4">
          {engage.inboxes.length > 1 && (
            <div className="flex items-center gap-2">
              <span className="text-[9.5px] font-bold uppercase tracking-[0.1em] text-[#959ca7]">
                Inbox
              </span>
              <select
                value={engage.inboxFilter}
                onChange={(event) => engage.setInboxFilter(event.target.value)}
                className="rounded-[8px] border border-[#e4e7eb] bg-white px-3 py-1.5 text-[12.5px] text-[#15171c]"
              >
                <option value="">All inboxes</option>
                {engage.inboxes.map((inbox) => (
                  <option key={inbox} value={inbox}>
                    {inbox}
                  </option>
                ))}
              </select>
            </div>
          )}

          {/* F4: the salesperson persona reply drafts are written in. Switching the
              persona re-drafts the campaign's replies in that voice; the "+" creates a
              new persona (name + rules) and applies it. */}
          {engage.selectedCampaign && (
            <div className="flex items-center gap-2">
              <span className="text-[9.5px] font-bold uppercase tracking-[0.1em] text-[#959ca7]">
                Draft persona
              </span>
              <select
                value={engage.selectedCampaign.personaId ?? ''}
                onChange={(event) =>
                  void engage.changePersona(event.target.value || null)
                }
                disabled={engage.redrafting}
                className="rounded-[8px] border border-[#e4e7eb] bg-white px-3 py-1.5 text-[12.5px] text-[#15171c] disabled:opacity-50"
              >
                <option value="">Default voice</option>
                {engage.personas.map((persona) => (
                  <option key={persona.id} value={persona.id}>
                    {persona.name}
                  </option>
                ))}
              </select>
              <button
                type="button"
                onClick={() => setPersonaDialog({ mode: 'create' })}
                disabled={engage.redrafting}
                title="Create a new draft persona"
                className="inline-flex size-[30px] items-center justify-center rounded-[8px] border border-[#d6dade] bg-white text-[#15171c] transition-colors hover:border-[#15171c] disabled:opacity-50"
              >
                <Plus className="size-3.5" />
              </button>
              {activePersona && (
                <button
                  type="button"
                  onClick={() =>
                    setPersonaDialog({
                      mode: 'edit',
                      id: activePersona.id,
                      name: activePersona.name,
                    })
                  }
                  disabled={engage.redrafting}
                  title={`Edit the ${activePersona.name} persona`}
                  className="inline-flex size-[30px] items-center justify-center rounded-[8px] border border-[#d6dade] bg-white text-[#15171c] transition-colors hover:border-[#15171c] disabled:opacity-50"
                >
                  <Pencil className="size-3.5" />
                </button>
              )}
              {engage.redrafting && (
                <span className="inline-flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-[0.06em] text-[#959ca7]">
                  <Spinner inline size={14} />
                  Re-drafting…
                </span>
              )}
            </div>
          )}

          {/* Manual "Scan now" — classify the selected campaign's mailbox for new
              replies. Slow on the local model, so it shows a spinner while running. */}
          <button
            type="button"
            onClick={engage.scanNow}
            disabled={
              (!engage.selectedCampaignId && !engage.inboxFilter) ||
              engage.scanning
            }
            className="ml-auto inline-flex items-center gap-1.5 rounded-[7px] border border-[#15171c] bg-[#15171c] px-[11px] py-[7px] text-[10px] font-bold uppercase tracking-[0.08em] text-white transition-colors hover:bg-[#2a2d33] disabled:cursor-not-allowed disabled:opacity-50"
            title="Scan this campaign's inbox for new replies"
          >
            {engage.scanning ? (
              <Spinner inline size={14} />
            ) : (
              <RefreshCw className="size-3.5" />
            )}
            {engage.scanning ? 'Scanning…' : 'Scan now'}
          </button>
        </div>

        <EngageCampaignTable
          campaigns={engage.campaigns}
          selectedCampaignId={engage.selectedCampaignId}
          onSelectCampaign={engage.setSelectedCampaignId}
          loading={engage.loadingCampaigns}
        />

        <GrowthCard title="Reply Sorter">
          <div className="grid min-h-[560px] grid-cols-[320px_1fr] overflow-hidden rounded-[10px] border border-[#e4e7eb]">
            <ReplyList
              replies={engage.replies}
              selectedReplyId={engage.selectedReplyId}
              onSelectReply={engage.setSelectedReplyId}
              categoryFilter={engage.categoryFilter}
              onSelectCategory={engage.setCategoryFilter}
              loading={engage.loadingReplies}
              counts={engage.counts}
            />

            <ReplyDetail
              reply={engage.selectedReply}
              aiMode={engage.aiMode}
              onChangeAiMode={engage.setAiMode}
              mailboxAccountId={engage.selectedCampaign?.mailboxAccountId ?? null}
            />
          </div>
        </GrowthCard>
      </div>

      <PersonaDialog
        open={personaDialog !== null}
        onClose={() => setPersonaDialog(null)}
        mode={personaDialog?.mode ?? 'create'}
        personaId={personaDialog?.mode === 'edit' ? personaDialog.id : null}
        initialName={personaDialog?.mode === 'edit' ? personaDialog.name : ''}
        onSubmit={(name, rules) =>
          personaDialog?.mode === 'edit'
            ? engage.updatePersona(personaDialog.id, name, rules)
            : engage.createPersona(name, rules)
        }
      />
    </main>
  );
}