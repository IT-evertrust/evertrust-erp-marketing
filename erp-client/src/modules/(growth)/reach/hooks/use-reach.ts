'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';

import {
  createReachAim,
  EMPTY_STATS,
  getCampaignLeads,
  getDailySends,
  getReachCampaigns,
  getSenderSchedule,
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
  const t = useTranslations('reach');
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
  const dailySends = useMemo(() => getDailySends(), []);

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
      const msg = err instanceof Error ? err.message : t('toast.launchFailed');
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
      toast.error(err instanceof Error ? err.message : t('toast.toggleFailed'));
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
        toast.message(t('toast.bazookaNone'));
      } else {
        toast.success(
          t('toast.bazookaSent', {
            total,
            campaigns: summary.campaignsProcessed,
          }),
        );
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t('toast.bazookaFailed'));
    } finally {
      setBazookaRunning(false);
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
        t('toast.roundRecorded', {
          count: updated.stats[round].sent,
          round: t(`generator.step.${round}`),
        }),
      );
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t('toast.sendFailed'));
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

    isCampaignFormOpen,
    openCampaignForm,
    closeCampaignForm,
    createCampaign,
    sendRound,
  };
}
