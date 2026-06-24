'use client';

import { useEffect, useState } from 'react';

import { toast } from 'sonner';

import {
  type EngagePersona,
  getCampaignReplies,
  getEngageCampaigns,
  getEngagePersonas,
  setCampaignPersona,
  syncEngageInbox,
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
        const first = data.find((campaign) => campaign.replies > 0) ?? data[0];
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

  // F4: set the selected campaign's drafting persona (optimistic local update).
  function changePersona(personaId: string | null) {
    const aimId = selectedCampaignId;
    if (!aimId) return;
    setCampaigns((prev) =>
      prev.map((c) => (c.id === aimId ? { ...c, personaId } : c)),
    );
    setCampaignPersona(aimId, personaId)
      .then(() => {
        const name = personas.find((p) => p.id === personaId)?.name;
        toast.success(
          personaId
            ? `Drafts will use the ${name ?? 'selected'} persona.`
            : 'Drafts will use the default voice.',
        );
      })
      .catch((err: unknown) => {
        toast.error(
          err instanceof Error ? err.message : 'Could not set the persona.',
        );
      });
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
      visibleCampaigns.find((campaign) => campaign.replies > 0) ??
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
  };
}
