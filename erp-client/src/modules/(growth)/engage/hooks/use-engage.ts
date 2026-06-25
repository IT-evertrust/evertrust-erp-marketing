'use client';

import { useEffect, useState } from 'react';

import { toast } from 'sonner';

import {
  type EngageAccount,
  type EngagePersona,
  createEngagePersona,
  getCampaignReplies,
  getEngageAccounts,
  getEngageCampaigns,
  getEngagePersonas,
  redraftReplyPersona,
  scanCampaign,
  scanInbox,
  sendReply,
  setReplyPersona as setReplyPersonaApi,
  syncEngageInbox,
  updateEngagePersona,
} from '../services/engage.service';
import type {
  AiAgentMode,
  CampaignReply,
  EngageCampaign,
  ReplyCategory,
} from '../types';

export type CategoryFilter = ReplyCategory | 'ALL';

export function useEngage() {
  const [campaigns, setCampaigns] = useState<EngageCampaign[]>([]);
  const [selectedCampaignId, setSelectedCampaignId] = useState('');
  const [replies, setReplies] = useState<CampaignReply[]>([]);
  const [selectedReplyId, setSelectedReplyId] = useState('');
  const [aiMode, setAiMode] = useState<AiAgentMode>('write');
  // F4: the org's drafting personas + the per-campaign selection.
  const [personas, setPersonas] = useState<EngagePersona[]>([]);
  // Inbox (sender mailbox) filter. '' = all inboxes. Lets a user review the replies
  // that landed in another worker's mailbox; data is org-scoped, so any inbox is visible.
  const [inboxFilter, setInboxFilter] = useState('');
  // Reply-status filter (the clickable All/Interested/Unsure/Not Interested chips).
  const [categoryFilter, setCategoryFilter] = useState<CategoryFilter>('ALL');
  // Loading flags for the DB-backed reads, so the UI can show a spinner instead of
  // a blank/empty state while data is in flight.
  const [loadingCampaigns, setLoadingCampaigns] = useState(true);
  const [loadingReplies, setLoadingReplies] = useState(false);
  // Manual "Scan now" in flight for the selected campaign.
  const [scanning, setScanning] = useState(false);
  // Re-drafting the whole campaign in the current persona voice. Triggered MANUALLY
  // by the Redraft button — switching persona no longer auto-redrafts.
  const [redrafting, setRedrafting] = useState(false);
  // Mass-send in flight + progress (sent / total) so the button can show "3 / 12".
  const [massSending, setMassSending] = useState(false);
  const [massProgress, setMassProgress] = useState<{ sent: number; total: number } | null>(
    null,
  );
  // The org's connected Google mailboxes (incl. colleagues') — populate the inbox
  // filter so any linked inbox is reviewable, not just campaign senders.
  const [accounts, setAccounts] = useState<EngageAccount[]>([]);

  // Load campaigns once; default the selection to the first with replies. Best-effort
  // inbox sync first so real inbound Gmail (matched to known prospects) is in the queue.
  useEffect(() => {
    let active = true;
    setLoadingCampaigns(true);
    syncEngageInbox()
      .catch(() => undefined)
      .then(() => getEngageCampaigns())
      .then((data) => {
        if (!active) return;
        setCampaigns(data);
        const first = data.find((campaign) => campaign.leadCount > 0) ?? data[0];
        setSelectedCampaignId((prev) => prev || (first?.id ?? ''));
      })
      .catch(() => {
        if (active) setCampaigns([]);
      })
      .finally(() => {
        if (active) setLoadingCampaigns(false);
      });
    return () => {
      active = false;
    };
  }, []);

  // Load the org's drafting personas once.
  useEffect(() => {
    let active = true;
    getEngagePersonas()
      .then((data) => active && setPersonas(data))
      .catch(() => active && setPersonas([]));
    return () => {
      active = false;
    };
  }, []);

  // Load the org's connected Google mailboxes once (for the inbox filter).
  useEffect(() => {
    let active = true;
    getEngageAccounts()
      .then((data) => active && setAccounts(data))
      .catch(() => active && setAccounts([]));
    return () => {
      active = false;
    };
  }, []);

  // Create a new persona (name + voice rules), then select it for the CURRENT reply
  // (per-email persona). Does NOT redraft — the operator hits Redraft when ready.
  async function createPersona(name: string, rules: string): Promise<boolean> {
    try {
      const persona = await createEngagePersona(name, rules);
      setPersonas((prev) =>
        [...prev, persona].sort((a, b) => a.name.localeCompare(b.name)),
      );
      toast.success(`Persona "${persona.name}" created.`);
      await selectReplyPersona(persona.id);
      return true;
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : 'Could not create the persona.',
      );
      return false;
    }
  }

  // F4: edit an existing persona's name/rules. If the EDITED persona is the one the
  // current campaign drafts with, re-draft the queue so the updated voice takes effect
  // immediately (same behaviour as switching to it). Returns true on success.
  async function updatePersona(
    id: string,
    name: string,
    rules: string,
  ): Promise<boolean> {
    try {
      const updated = await updateEngagePersona(id, { name, rules });
      setPersonas((prev) =>
        prev
          .map((p) => (p.id === id ? { ...p, name: updated.name } : p))
          .sort((a, b) => a.name.localeCompare(b.name)),
      );
      const aimId = selectedCampaignId;
      const isActive =
        !!aimId && campaigns.find((c) => c.id === aimId)?.personaId === id;
      // Save only — the operator redrafts manually when ready (Redraft button).
      toast.success(
        isActive && replies.some((r) => !r.handled)
          ? `Persona "${updated.name}" updated. Hit Redraft to apply it to the queue.`
          : `Persona "${updated.name}" updated.`,
      );
      return true;
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : 'Could not update the persona.',
      );
      return false;
    }
  }

  // Load replies whenever the selected campaign changes.
  useEffect(() => {
    if (!selectedCampaignId) {
      setReplies([]);
      setSelectedReplyId('');
      return;
    }
    let active = true;
    setLoadingReplies(true);
    getCampaignReplies(selectedCampaignId)
      .then((data) => {
        if (!active) return;
        setReplies(data);
        setSelectedReplyId(data[0]?.id ?? '');
      })
      .catch(() => {
        if (!active) return;
        setReplies([]);
        setSelectedReplyId('');
      })
      .finally(() => {
        if (active) setLoadingReplies(false);
      });
    return () => {
      active = false;
    };
  }, [selectedCampaignId]);

  // Manual "Scan now": classify the selected campaign's mailbox for new replies,
  // then refresh its queue in place. Slow (local Hermes) — the button shows a spinner.
  async function scanNow() {
    const aimId = selectedCampaignId;
    if (scanning) return;
    // If an inbox is selected in the toggle, rescan that whole inbox (every campaign
    // that sends from it) for new replies; otherwise scan the selected campaign.
    if (!inboxFilter && !aimId) return;
    setScanning(true);
    try {
      if (inboxFilter) {
        const r = await scanInbox(inboxFilter);
        toast.success(
          r.scanned > 0
            ? `Scanned ${inboxFilter}: ${r.scanned} thread${r.scanned === 1 ? '' : 's'} across ${r.aims} campaign${r.aims === 1 ? '' : 's'} · ${r.classified} classified.`
            : `No new replies in ${inboxFilter}.`,
        );
      } else {
        const result = await scanCampaign(aimId);
        if (!result.configured) {
          toast.error(
            result.reason ?? 'This campaign’s mailbox isn’t connected for reading.',
          );
          return;
        }
        toast.success(
          result.scanned > 0
            ? `Scanned ${result.scanned} thread${result.scanned === 1 ? '' : 's'} · ${result.classified} classified.`
            : 'No new replies found.',
        );
      }
      // Re-read the selected campaign's queue so freshly-classified replies show.
      if (aimId) {
        const data = await getCampaignReplies(aimId);
        setReplies(data);
        setSelectedReplyId((prev) =>
          data.some((r) => r.id === prev) ? prev : (data[0]?.id ?? ''),
        );
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Scan failed.');
    } finally {
      setScanning(false);
    }
  }

  // Per-email persona: set the drafting voice for the SELECTED reply. Persisted, no
  // redraft (the operator hits Redraft when ready). Optimistic local update.
  async function selectReplyPersona(personaId: string | null) {
    const id = selectedReplyId;
    if (!id) return;
    setReplies((prev) =>
      prev.map((r) => (r.id === id ? { ...r, personaId } : r)),
    );
    try {
      await setReplyPersonaApi(id, personaId);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not set the persona.');
    }
  }

  // Re-draft the SELECTED reply fresh in its current per-email persona voice.
  async function redraftSelectedReply() {
    const id = selectedReplyId;
    if (!id || redrafting) return;
    setRedrafting(true);
    toast.info('Re-drafting this reply…');
    try {
      const r = await redraftReplyPersona(id);
      setReplies((prev) =>
        prev.map((x) =>
          x.id === id
            ? { ...x, draftSubject: r.draftSubject, draftBody: r.draftBody }
            : x,
        ),
      );
      toast.success('Draft updated.');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not re-draft.');
    } finally {
      setRedrafting(false);
    }
  }

  // Mass-send: send every drafted, unsent reply in the CURRENT view, one at a time,
  // from the BOTTOM of the list upward. Sequential (never parallel) so each Gmail send
  // settles before the next — and a single failure doesn't abort the rest.
  async function massSend() {
    if (massSending) return;
    const pool = (
      categoryFilter === 'ALL'
        ? replies
        : replies.filter((r) => r.category === categoryFilter)
    ).filter((r) => !r.handled && r.draftBody.trim().length > 0);
    if (pool.length === 0) {
      toast.message('No drafted, unsent replies to send here.');
      return;
    }
    const ordered = [...pool].reverse(); // bottom-up
    setMassSending(true);
    setMassProgress({ sent: 0, total: ordered.length });
    let sent = 0;
    let failed = 0;
    for (const reply of ordered) {
      try {
        await sendReply(reply.id, reply.draftSubject, reply.draftBody);
        sent += 1;
        setReplies((prev) =>
          prev.map((r) => (r.id === reply.id ? { ...r, handled: true } : r)),
        );
      } catch {
        failed += 1;
      }
      setMassProgress({ sent: sent + failed, total: ordered.length });
    }
    setMassSending(false);
    setMassProgress(null);
    toast.success(
      `Sent ${sent} repl${sent === 1 ? 'y' : 'ies'}${failed ? ` · ${failed} failed` : ''}.`,
    );
    if (selectedCampaignId) {
      const data = await getCampaignReplies(selectedCampaignId).catch(() => null);
      if (data) setReplies(data);
    }
  }

  // Distinct inboxes the filter can pick: every campaign sender PLUS every connected
  // Google mailbox (so colleagues' inboxes show even when no campaign sends from them).
  const inboxes = Array.from(
    new Set(
      [
        ...campaigns.map((campaign) => campaign.senderEmail),
        ...accounts.map((account) => account.email),
      ].filter(Boolean),
    ),
  ).sort();

  // Campaigns shown for the active inbox filter ('' = all inboxes).
  const visibleCampaigns = inboxFilter
    ? campaigns.filter((campaign) => campaign.senderEmail === inboxFilter)
    : campaigns;

  // Keep the selected campaign inside the visible set when the inbox filter changes;
  // fall back to the first filtered campaign with replies (else the first).
  useEffect(() => {
    if (visibleCampaigns.some((campaign) => campaign.id === selectedCampaignId)) {
      return;
    }
    const next =
      visibleCampaigns.find((campaign) => campaign.leadCount > 0) ??
      visibleCampaigns[0];
    setSelectedCampaignId(next?.id ?? '');
  }, [inboxFilter, campaigns, selectedCampaignId, visibleCampaigns]);

  const selectedCampaign = visibleCampaigns.find(
    (campaign) => campaign.id === selectedCampaignId,
  );

  // Replies shown for the active status filter ('ALL' = all categories).
  const visibleReplies =
    categoryFilter === 'ALL'
      ? replies
      : replies.filter((reply) => reply.category === categoryFilter);

  // Keep the selected reply inside the filtered set when the status filter changes.
  useEffect(() => {
    if (visibleReplies.some((reply) => reply.id === selectedReplyId)) return;
    setSelectedReplyId(visibleReplies[0]?.id ?? '');
  }, [categoryFilter, replies, selectedReplyId, visibleReplies]);

  const selectedReply = visibleReplies.find(
    (reply) => reply.id === selectedReplyId,
  );

  const counts = {
    all: replies.length,
    interested: replies.filter((reply) => reply.category === 'INTERESTED')
      .length,
    unsure: replies.filter((reply) => reply.category === 'UNSURE').length,
    temp: replies.filter((reply) => reply.category === 'TEMP').length,
    notInterested: replies.filter(
      (reply) => reply.category === 'NOT INTERESTED',
    ).length,
  };

  return {
    campaigns: visibleCampaigns,
    selectedCampaignId,
    setSelectedCampaignId,
    selectedCampaign,
    accounts,
    inboxes,
    inboxFilter,
    setInboxFilter,
    replies: visibleReplies,
    selectedReplyId,
    setSelectedReplyId,
    selectedReply,
    counts,
    categoryFilter,
    setCategoryFilter,
    loadingCampaigns,
    loadingReplies,
    aiMode,
    setAiMode,
    personas,
    createPersona,
    updatePersona,
    selectReplyPersona,
    redraftSelectedReply,
    redrafting,
    scanning,
    scanNow,
    massSending,
    massProgress,
    massSend,
  };
}
