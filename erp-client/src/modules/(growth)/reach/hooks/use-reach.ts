'use client';

import { useQuery } from '@tanstack/react-query';
import { useEffect, useMemo, useRef, useState } from 'react';
import { toast } from 'sonner';

import { queryKeys } from '@/lib/query-keys';

import {
  createReachAim,
  EMPTY_STATS,
  getCampaignLeads,
  getDailySends,
  getReachCampaigns,
  getSenderSchedule,
  promoteReachLead,
  runReachBazooka,
  scrapeReachAim,
  sendCampaignRound,
  setReachAutoSend,
  templatesToEmails,
} from '../services/reach.service';
import type {
  Lead,
  NewCampaignFormValues,
  ReachCampaignView,
  ReachRound,
  ReachTab,
} from '../types';

export function useReach() {
  const [campaigns, setCampaigns] = useState<ReachCampaignView[]>([]);
  const [activeTab, setActiveTab] = useState<ReachTab>('scraper');
  const [selectedCampaignId, setSelectedCampaignId] = useState('');
  const [isCampaignFormOpen, setIsCampaignFormOpen] = useState(false);

  const [leads, setLeads] = useState<Lead[]>([]);
  const [loadingCampaigns, setLoadingCampaigns] = useState(true);
  const [loadingLeads, setLoadingLeads] = useState(false);
  const [creatingAim, setCreatingAim] = useState(false);
  const [scrapingLeads, setScrapingLeads] = useState(false);
  const [bazookaRunning, setBazookaRunning] = useState(false);
  // The lead currently being moved into the Nurture pipeline (its row spinner).
  const [promotingLeadId, setPromotingLeadId] = useState<string | null>(null);

  // When a freshly-created campaign is auto-scraped, we manage its leads directly
  // (via the scrape result) and skip the selection effect's fetch to avoid a race.
  const skipNextLeadsFetch = useRef(false);

  // Load campaigns once.
  useEffect(() => {
    let ignore = false;
    getReachCampaigns()
      .then((data) => {
        if (ignore) return;
        setCampaigns(data);
        setSelectedCampaignId((current) => current || data[0]?.id || '');
      })
      .catch(() => {
        if (!ignore) setCampaigns([]);
      })
      .finally(() => {
        if (!ignore) setLoadingCampaigns(false);
      });
    return () => {
      ignore = true;
    };
  }, []);

  // Load the selected campaign's leads (skipped right after a create+scrape).
  useEffect(() => {
    if (!selectedCampaignId) {
      setLeads([]);
      return;
    }
    if (skipNextLeadsFetch.current) {
      skipNextLeadsFetch.current = false;
      return;
    }
    let ignore = false;
    setLoadingLeads(true);
    getCampaignLeads(selectedCampaignId)
      .then((data) => {
        if (!ignore) setLeads(data);
      })
      .catch(() => {
        if (!ignore) setLeads([]);
      })
      .finally(() => {
        if (!ignore) setLoadingLeads(false);
      });
    return () => {
      ignore = true;
    };
  }, [selectedCampaignId]);

  const selectedCampaign = useMemo(
    () => campaigns.find((c) => c.id === selectedCampaignId),
    [campaigns, selectedCampaignId],
  );

  const emails = useMemo(
    () =>
      templatesToEmails(
        selectedCampaign?.templates ?? null,
        selectedCampaign?.stats ?? EMPTY_STATS,
      ),
    [selectedCampaign],
  );

  const senderSchedule = useMemo(
    () => getSenderSchedule(campaigns),
    [campaigns],
  );
  // "Emails sent per day" chart data — org-scoped backend read.
  const { data: dailySends = [] } = useQuery({
    queryKey: queryKeys.reach.dailySends(),
    queryFn: () => getDailySends(),
    staleTime: 60_000,
  });

  function openCampaignForm() {
    setIsCampaignFormOpen(true);
  }

  function closeCampaignForm() {
    setIsCampaignFormOpen(false);
  }

  // AIM: create the campaign (config + templates + news via Ammo Forge), then
  // immediately activate Lead Satellite to scrape leads. Two loading phases.
  async function createCampaign(values: NewCampaignFormValues) {
    setCreatingAim(true);
    try {
      const view = await createReachAim(values);
      setCampaigns((current) => [view, ...current]);
      skipNextLeadsFetch.current = true;
      setSelectedCampaignId(view.id);
      setActiveTab('scraper');
      setIsCampaignFormOpen(false);
      setLeads([]);
      setCreatingAim(false);

      // Lead Satellite runs right away.
      setScrapingLeads(true);
      const scraped = await scrapeReachAim(view.id);
      setLeads(scraped);
      setCampaigns((current) =>
        current.map((c) =>
          c.id === view.id
            ? {
                ...c,
                companies: scraped.length,
                status: 'IN CAMPAIGN',
                aimStatus: 'COMPLETED',
              }
            : c,
        ),
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Campaign launch failed';
      toast.error(msg);
    } finally {
      setCreatingAim(false);
      setScrapingLeads(false);
    }
  }

  // Toggle Reach Bazooka on/off for a campaign.
  async function toggleAutoSend(aimId: string) {
    const current = campaigns.find((c) => c.id === aimId);
    if (!current) return;
    try {
      const updated = await setReachAutoSend(aimId, !current.autoSend);
      setCampaigns((cs) => cs.map((c) => (c.id === aimId ? updated : c)));
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Toggle failed');
    }
  }

  // Run Reach Bazooka: advance every auto-send campaign one round, then refresh.
  async function runBazooka() {
    setBazookaRunning(true);
    try {
      const summary = await runReachBazooka();
      const fresh = await getReachCampaigns();
      setCampaigns(fresh);
      const total = summary.sends.reduce((acc, s) => acc + s.count, 0);
      if (summary.campaignsProcessed === 0) {
        toast.message('Bazooka: no campaigns due (toggle one on first).');
      } else {
        toast.success(
          `Bazooka sent ${total} email(s) across ${summary.campaignsProcessed} campaign(s). Delivery pending OAuth.`,
        );
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Bazooka run failed');
    } finally {
      setBazookaRunning(false);
    }
  }

  // Reach → Nurture bridge: move a scraped lead into the Nurture pipeline. On
  // success the lead is marked Interested in place (so the row reflects the move)
  // and a toast points to the Nurture board. A lead with no email can't become a
  // prospect — the server rejects it and we surface that message.
  async function promoteLead(leadId: string) {
    const lead = leads.find((l) => l.id === leadId);
    if (!lead || !selectedCampaignId) return;
    setPromotingLeadId(leadId);
    try {
      const result = await promoteReachLead(selectedCampaignId, leadId);
      setLeads((current) =>
        current.map((l) =>
          l.id === leadId ? { ...l, status: 'Interested' } : l,
        ),
      );
      toast.success(
        result.created
          ? `${lead.company} added to the Nurture pipeline.`
          : `${lead.company} is already in the Nurture pipeline.`,
      );
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : 'Could not move lead to pipeline',
      );
    } finally {
      setPromotingLeadId(null);
    }
  }

  // Record a send for one round; updates the campaign's stats in place. Delivery
  // is deferred server-side, so the toast says "recorded", not "delivered".
  async function sendRound(round: ReachRound) {
    if (!selectedCampaignId) return;
    try {
      const updated = await sendCampaignRound(selectedCampaignId, round);
      setCampaigns((current) =>
        current.map((c) => (c.id === updated.id ? updated : c)),
      );
      toast.success(
        `Recorded ${updated.stats[round].sent} ${round} send(s). Gmail delivery pending OAuth.`,
      );
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Send failed');
    }
  }

  return {
    activeTab,
    setActiveTab,

    campaigns,
    selectedCampaignId,
    setSelectedCampaignId,
    selectedCampaign,

    leads,
    emails,
    senderSchedule,
    dailySends,

    loadingCampaigns,
    loadingLeads,
    creatingAim,
    scrapingLeads,

    bazookaRunning,
    toggleAutoSend,
    runBazooka,

    promotingLeadId,
    promoteLead,

    isCampaignFormOpen,
    openCampaignForm,
    closeCampaignForm,
    createCampaign,
    sendRound,
  };
}
