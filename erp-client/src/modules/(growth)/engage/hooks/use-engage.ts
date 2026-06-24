'use client';

import { useEffect, useState } from 'react';

import { toast } from 'sonner';

import {
  type EngagePersona,
  createEngagePersona,
  getCampaignReplies,
  getEngageCampaigns,
  getEngagePersonas,
  redraftCampaign,
  scanCampaign,
  scanInbox,
  setCampaignPersona,
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
  // Re-drafting the whole campaign in a newly-selected persona voice (F4 switch).
  const [redrafting, setRedrafting] = useState(false);

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

  // F4: switch the selected campaign's drafting persona. Persists the choice, then
  // RE-DRAFTS every unhandled reply in the new voice and refreshes the queue so the
  // drafts on screen immediately reflect the persona. Slow (LLM/reply) — `redrafting`
  // drives the spinner. Optimistic local update keeps the picker snappy.
  async function changePersona(personaId: string | null) {
    const aimId = selectedCampaignId;
    if (!aimId || redrafting) return;
    setCampaigns((prev) =>
      prev.map((c) => (c.id === aimId ? { ...c, personaId } : c)),
    );
    const name = personas.find((p) => p.id === personaId)?.name;
    try {
      await setCampaignPersona(aimId, personaId);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not set the persona.');
      return;
    }
    // No replies yet → nothing to redraft; the next scan will use the new voice.
    if (replies.filter((r) => !r.handled).length === 0) {
      toast.success(
        personaId
          ? `Drafts will use the ${name ?? 'selected'} persona.`
          : 'Drafts will use the default voice.',
      );
      return;
    }
    setRedrafting(true);
    toast.info(
      personaId
        ? `Re-drafting replies in the ${name ?? 'selected'} voice…`
        : 'Re-drafting replies in the default voice…',
    );
    try {
      const r = await redraftCampaign(aimId);
      const data = await getCampaignReplies(aimId);
      setReplies(data);
      toast.success(
        `Re-drafted ${r.redrafted} repl${r.redrafted === 1 ? 'y' : 'ies'}${
          r.failed ? ` · ${r.failed} failed` : ''
        }.`,
      );
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : 'Could not re-draft the replies.',
      );
    } finally {
      setRedrafting(false);
    }
  }

  // F4: create a new persona (name + voice rules), then select it for the campaign
  // (which redrafts the queue in the new voice). Returns true on success.
  async function createPersona(name: string, rules: string): Promise<boolean> {
    try {
      const persona = await createEngagePersona(name, rules);
      setPersonas((prev) =>
        [...prev, persona].sort((a, b) => a.name.localeCompare(b.name)),
      );
      toast.success(`Persona "${persona.name}" created.`);
      await changePersona(persona.id);
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
      toast.success(`Persona "${updated.name}" updated.`);
      const aimId = selectedCampaignId;
      const isActive =
        !!aimId &&
        campaigns.find((c) => c.id === aimId)?.personaId === id;
      if (isActive && replies.filter((r) => !r.handled).length > 0 && !redrafting) {
        setRedrafting(true);
        toast.info(`Re-drafting replies in the updated ${updated.name} voice…`);
        try {
          const r = await redraftCampaign(aimId);
          const data = await getCampaignReplies(aimId);
          setReplies(data);
          toast.success(
            `Re-drafted ${r.redrafted} repl${r.redrafted === 1 ? 'y' : 'ies'}${
              r.failed ? ` · ${r.failed} failed` : ''
            }.`,
          );
        } finally {
          setRedrafting(false);
        }
      }
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

  // Distinct inboxes present across all campaigns (the filter options).
  const inboxes = Array.from(
    new Set(campaigns.map((campaign) => campaign.senderEmail)),
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
    changePersona,
    createPersona,
    updatePersona,
    redrafting,
    scanning,
    scanNow,
  };
}
