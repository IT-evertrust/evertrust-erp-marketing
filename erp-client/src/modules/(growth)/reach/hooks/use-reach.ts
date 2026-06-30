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
  DailySend,
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
  const [dailySends, setDailySends] = useState<DailySend[]>([]);
  const [loadingCampaigns, setLoadingCampaigns] = useState(true);
  const [loadingLeads, setLoadingLeads] = useState(false);
  const [creatingAim, setCreatingAim] = useState(false);
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

  // Load the real 10-day daily-sends series once (drives the Sequence Sender
  // chart). On failure we leave it empty so the chart renders blank, not broken.
  useEffect(() => {
    let ignore = false;
    getDailySends()
      .then((data) => {
        if (!ignore) setDailySends(data);
      })
      .catch(() => {
        if (!ignore) setDailySends([]);
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

  // Keep a ref to the latest campaigns so the poller can diff prev→next without
  // re-subscribing its interval on every campaigns change.
  const campaignsRef = useRef<ReachCampaignView[]>(campaigns);
  useEffect(() => {
    campaignsRef.current = campaigns;
  }, [campaigns]);

  // Poll while ANY campaign is scraping. The scrape runs server-side, so this is a
  // pure status mirror: refresh the campaign list (drives the ETA countdown + the
  // SCRAPING badge) and, when the selected campaign finishes, pull its leads + toast.
  // Because it keys off server status, leaving the page and returning re-detects the
  // RUNNING aim and re-attaches the countdown — no local "is scraping" flag needed.
  const anyRunning = useMemo(
    () => campaigns.some((c) => c.aimStatus === 'RUNNING'),
    [campaigns],
  );
  useEffect(() => {
    if (!anyRunning) return;
    let cancelled = false;
    const id = setInterval(async () => {
      const fresh = await getReachCampaigns().catch(() => null);
      if (!fresh || cancelled) return;
      const before = campaignsRef.current.find((c) => c.id === selectedCampaignId);
      const after = fresh.find((c) => c.id === selectedCampaignId);
      setCampaigns(fresh);
      if (before?.aimStatus === 'RUNNING' && after && after.aimStatus !== 'RUNNING') {
        if (after.aimStatus === 'COMPLETED') {
          const ls = await getCampaignLeads(selectedCampaignId).catch(() => []);
          if (!cancelled) {
            setLeads(ls);
            toast.success(t('toast.scrapeDone', { count: ls.length }));
          }
        } else if (after.aimStatus === 'FAILED' && !cancelled) {
          // Show the real reason the server recorded, not just a generic "failed".
          toast.error(after.scrapeError || t('toast.scrapeFailed'));
        }
      }
    }, 6000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [anyRunning, selectedCampaignId, t]);

  const selectedCampaign = useMemo(
    () => campaigns.find((c) => c.id === selectedCampaignId),
    [campaigns, selectedCampaignId],
  );

  // The in-flight scrape for the SELECTED campaign (server-seeded), or null. Drives
  // the ETA countdown in the Lead Scraper panel.
  const selectedScrape = useMemo(
    () =>
      selectedCampaign?.aimStatus === 'RUNNING' && selectedCampaign.scrapeStartedAt
        ? {
            startedAt: selectedCampaign.scrapeStartedAt,
            etaSeconds: selectedCampaign.scrapeEtaSeconds ?? 0,
            progress: selectedCampaign.scrapeProgress ?? null,
          }
        : null,
    [selectedCampaign],
  );

  // The failure reason for the SELECTED campaign (when its last scrape FAILED), so
  // the panel can show WHY instead of an empty state. Null otherwise.
  const selectedScrapeError = useMemo(
    () =>
      selectedCampaign?.aimStatus === 'FAILED'
        ? selectedCampaign.scrapeError || t('toast.scrapeFailed')
        : null,
    [selectedCampaign, t],
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

      // Lead Satellite runs in the BACKGROUND: this returns the campaign marked
      // RUNNING (with the server-seeded ETA) immediately. The polling effect below
      // picks up the leads + flips the status when the scrape finishes.
      const running = await scrapeReachAim(view.id);
      setCampaigns((current) =>
        current.map((c) => (c.id === view.id ? running : c)),
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : t('toast.launchFailed');
      toast.error(msg);
    } finally {
      setCreatingAim(false);
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
    selectedScrape,
    selectedScrapeError,

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
