'use client';

import { useState } from 'react';
import { RefreshCw } from 'lucide-react';

import { useGoogleAccounts } from '@/hooks/use-arsenal';
import { GrowthCard, Spinner } from '@/modules/(growth)/shared';

import { EngageCampaignTable } from '../components/engage-campaign-table';
import { PersonaDialog } from '../components/persona-create-dialog';
import { ReplyDetail } from '../components/reply-detail';
import { ReplyList } from '../components/reply-list';
import { useEngage } from '../hooks/use-engage';

export function EngagePage() {
  const engage = useEngage();
  // The org's connected Google accounts (from Settings → Configuration). The
  // account picker below chooses which one's Gmail the Reply Sorter scans/shows
  // (includes colleagues' linked mailboxes).
  const googleAccounts = useGoogleAccounts();
  const connectedAccounts = (googleAccounts.data ?? []).filter(
    (account) => account.status === 'CONNECTED',
  );
  // The persona dialog is shared for create + edit; null = closed. Opened from the
  // per-email persona toggle inside the reply detail.
  const [personaDialog, setPersonaDialog] = useState<
    { mode: 'create' } | { mode: 'edit'; id: string; name: string } | null
  >(null);

  // The persona this reply will be drafted in: its own override, else the campaign's
  // default, else the default (Hanna) voice.
  const replyPersonaId =
    engage.selectedReply?.personaId ??
    engage.selectedCampaign?.personaId ??
    null;

  return (
    <main className="px-6 py-5 duration-300 animate-in fade-in">
      <div className="mb-4 border-b border-border">
        <button
          type="button"
          className="mb-[-1px] border-b-2 border-foreground px-4 py-3 text-[13px] font-bold text-foreground"
        >
          Reply Sorter
        </button>
      </div>

      <div className="flex flex-col gap-4">
        <div className="flex flex-wrap items-center gap-4">
          {/* Choose which connected Google account (from Configuration) the Reply
              Sorter fetches Gmail from — any linked mailbox, incl. colleagues'.
              Selecting one filters to that mailbox's campaigns and points Scan at
              it. The Scan control lives in the Reply Sorter card header below. */}
          {connectedAccounts.length > 0 && (
            <div className="flex items-center gap-2">
              <span className="text-[9.5px] font-bold uppercase tracking-[0.1em] text-muted-foreground">
                Google account
              </span>
              <select
                value={engage.inboxFilter}
                onChange={(event) => engage.setInboxFilter(event.target.value)}
                className="rounded-[8px] border border-border bg-card px-3 py-1.5 text-[12.5px] text-foreground"
              >
                <option value="">All accounts</option>
                {connectedAccounts.map((account) => (
                  <option key={account.id} value={account.email}>
                    {account.email}
                  </option>
                ))}
              </select>
            </div>
          )}
        </div>

        <EngageCampaignTable
          campaigns={engage.campaigns}
          selectedCampaignId={engage.selectedCampaignId}
          onSelectCampaign={engage.setSelectedCampaignId}
          loading={engage.loadingCampaigns}
        />

        <GrowthCard
          title="Reply Sorter"
          hint={
            <button
              type="button"
              onClick={engage.scanNow}
              disabled={
                (!engage.selectedCampaignId && !engage.inboxFilter) ||
                engage.scanning
              }
              title="Scan this inbox for new replies (auto-scan also runs hourly)"
              className="inline-flex items-center gap-1.5 rounded-[7px] border border-border bg-card px-[11px] py-[7px] text-[10px] font-bold uppercase tracking-[0.08em] text-foreground transition-colors hover:border-foreground disabled:cursor-not-allowed disabled:opacity-50"
            >
              {engage.scanning ? (
                <Spinner inline size={14} />
              ) : (
                <RefreshCw className="size-3.5" />
              )}
              {engage.scanning ? 'Scanning…' : 'Scan'}
            </button>
          }
        >
          <div className="grid min-h-[560px] grid-cols-[320px_1fr] overflow-hidden rounded-[10px] border border-border">
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
              personas={engage.personas}
              replyPersonaId={replyPersonaId}
              onSelectPersona={engage.selectReplyPersona}
              onRedraftPersona={engage.redraftSelectedReply}
              redrafting={engage.redrafting}
              onCreatePersona={() => setPersonaDialog({ mode: 'create' })}
              onEditPersona={(id, name) =>
                setPersonaDialog({ mode: 'edit', id, name })
              }
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
