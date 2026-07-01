'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';

import {
  createReachAim,
  deleteReachAim,
  EMPTY_STATS,
  generateReachPrompt,
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
  GenStage,
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
  // The lead-scraping prompt authored for the just-created aim (Generate Prompt). Shown
  // in the AIM modal's copyable text area; null until a prompt is generated / on reopen.
  const [generatedPrompt, setGeneratedPrompt] = useState<string | null>(null);
  // Scraping mode toggle: 'manual' = the copy/paste batch-prompt flow (default);
  // 'auto' = the Lead Satellite agent pipeline. Lets us flip between the two while Lead
  // Satellite is being refined. UI-level (not persisted) — resets to manual on reload.
  const [scrapeMode, setScrapeMode] = useState<'manual' | 'auto'>('manual');
  // Which generation stage the modal is showing: 'prompt' while the prompt is authored,
  // 'ammoforge' while the email templates build in the background after, 'idle' otherwise.
  const [genStage, setGenStage] = useState<GenStage>('idle');
  // The aim whose background Ammo Forge we're polling for during the 'ammoforge' stage.
  const [genAimId, setGenAimId] = useState<string | null>(null);
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

  // 'ammoforge' stage: after the prompt is shown, templates build server-side. Poll the
  // aim until it flips to READY (or FAILED), refreshing the campaign list so the templates
  // land, then end the stage. A hard cap ends it even if the background job never reports.
  useEffect(() => {
    if (genStage !== 'ammoforge' || !genAimId) return;
    let cancelled = false;
    const check = async () => {
      try {
        const fresh = await getReachCampaigns();
        if (cancelled) return;
        setCampaigns(fresh);
        const c = fresh.find((x) => x.id === genAimId);
        if (!c || c.aimStatus === 'READY' || c.aimStatus === 'FAILED') {
          setGenStage('idle');
        }
      } catch {
        // transient — keep polling
      }
    };
    const iv = setInterval(check, 4000);
    const cap = setTimeout(() => {
      if (!cancelled) setGenStage('idle');
    }, 140_000);
    return () => {
      cancelled = true;
      clearInterval(iv);
      clearTimeout(cap);
    };
  }, [genStage, genAimId]);

  // After a batch's leads are saved, refresh the campaign list (companies count) and the
  // selected campaign's leads table so the newly-collected companies appear.
  async function reloadAfterBatch() {
    try {
      const [fresh, ls] = await Promise.all([
        getReachCampaigns(),
        selectedCampaignId
          ? getCampaignLeads(selectedCampaignId)
          : Promise.resolve([] as Lead[]),
      ]);
      setCampaigns(fresh);
      if (selectedCampaignId) setLeads(ls);
    } catch {
      // best-effort refresh
    }
  }

  function openCampaignForm() {
    setGeneratedPrompt(null); // fresh form — clear any prior prompt
    setGenStage('idle');
    setGenAimId(null);
    setIsCampaignFormOpen(true);
  }

  function closeCampaignForm() {
    setIsCampaignFormOpen(false);
    setGeneratedPrompt(null);
    // Note: we DON'T reset genStage here — if templates are still building, the poll
    // effect keeps running so the campaign list updates even after the modal closes.
  }

  // AIM: create the campaign (config + templates + news via Ammo Forge), then have the
  // local model AUTHOR a lead-scraping prompt from the aim's config (Generate Prompt).
  // The modal stays open and reveals the prompt in a copyable text area — Reach no longer
  // runs the (local-model) Lead Satellite scrape itself.
  async function createCampaign(values: NewCampaignFormValues) {
    setCreatingAim(true);
    setGeneratedPrompt(null);
    setGenAimId(null);
    setGenStage('prompt'); // stage 1: authoring the scraping prompt
    try {
      const view = await createReachAim(values);
      setCampaigns((current) => [view, ...current]);
      skipNextLeadsFetch.current = true;
      setSelectedCampaignId(view.id);
      setActiveTab('scraper');
      setLeads([]);

      // Author the prompt (local model, synchronous). On success the aim carries the
      // prompt; surface it in the modal for the operator to copy into OpenAI.
      const withPrompt = await generateReachPrompt(view.id);
      setCampaigns((current) =>
        current.map((c) => (c.id === view.id ? withPrompt : c)),
      );
      setGeneratedPrompt(withPrompt.scrapePrompt ?? '');
      // Stage 2: the prompt is done; the server has now kicked off Ammo Forge (email
      // templates) in the background. Poll until the aim flips to READY (see effect).
      setGenAimId(view.id);
      setGenStage('ammoforge');
    } catch (err) {
      const msg = err instanceof Error ? err.message : t('toast.launchFailed');
      toast.error(msg);
      setGenStage('idle');
    } finally {
      setCreatingAim(false);
    }
  }

  // Automatic mode: run the Lead Satellite agent pipeline for a campaign. Marks the aim
  // RUNNING (server-seeded ETA) immediately; the RUNNING poll effect above picks up the
  // leads + flips the status when the scrape finishes, and selectedScrape drives the
  // countdown — same machinery the batch flow leaves untouched.
  async function runLeadSatellite(aimId: string) {
    try {
      const running = await scrapeReachAim(aimId);
      setCampaigns((cs) => cs.map((c) => (c.id === aimId ? running : c)));
      skipNextLeadsFetch.current = true;
      setLeads([]);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t('toast.scrapeFailed'));
    }
  }

  // Permanently delete a campaign (aim) + its leads. Removes it from the list and, if it
  // was the selected campaign, selects the next one (clearing its leads).
  async function deleteCampaign(aimId: string) {
    try {
      await deleteReachAim(aimId);
      const remaining = campaigns.filter((c) => c.id !== aimId);
      setCampaigns(remaining);
      if (selectedCampaignId === aimId) {
        setSelectedCampaignId(remaining[0]?.id ?? '');
        setLeads([]);
      }
      toast.success(t('toast.campaignDeleted'));
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t('toast.deleteFailed'));
      // Rethrow so the confirm dialog can stop its "Deleting…" spinner and skip the
      // page refresh when the delete didn't actually happen.
      throw err;
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
    deleteCampaign,
    generatedPrompt,
    genStage,
    reloadAfterBatch,
    scrapeMode,
    setScrapeMode,
    runLeadSatellite,
    sendRound,
  };
}
