'use client';

import { useCallback, useEffect, useState } from 'react';
import { toast } from 'sonner';

import {
  analyzeMeeting,
  generateClientResearch,
  generateDossier,
  getCallAnalyses,
  getCalendarMeetings,
  getClientResearch,
  getMeetingAccounts,
  getPersonas,
  getResearchDossiers,
  harvestReadAiMeetings,
} from '../services/activate-service';
import type {
  ActivateTab,
  CalendarMeeting,
  CallAnalysis,
  ClientResearch,
  MeetingAccount,
  Persona,
  ResearchDossier,
} from '../types';

export function useActivate() {
  const [activeTab, setActiveTab] = useState<ActivateTab>('booker');

  // ---- accounts (the Meeting Booker email-account toggle) ----
  const [accounts, setAccounts] = useState<MeetingAccount[]>([]);
  const [accountId, setAccountId] = useState('');
  const [loadingAccounts, setLoadingAccounts] = useState(true);

  // ---- booker / research (calendar-derived, per account) ----
  const [meetings, setMeetings] = useState<CalendarMeeting[]>([]);
  const [loadingMeetings, setLoadingMeetings] = useState(false);

  const [dossiers, setDossiers] = useState<ResearchDossier[]>([]);
  const [loadingDossiers, setLoadingDossiers] = useState(false);
  const [selectedDossierId, setSelectedDossierId] = useState('');
  const [generating, setGenerating] = useState(false);

  // ---- client research (persisted deep dossier for the selected company) ----
  const [clientResearch, setClientResearch] = useState<ClientResearch | null>(null);
  const [loadingClientResearch, setLoadingClientResearch] = useState(false);
  const [generatingClientResearch, setGeneratingClientResearch] = useState(false);

  // ---- after-sales ----
  const [personas, setPersonas] = useState<Persona[]>([]);
  const [selectedPersona, setSelectedPersona] = useState('');
  const [callAnalyses, setCallAnalyses] = useState<CallAnalysis[]>([]);
  const [loadingAnalyses, setLoadingAnalyses] = useState(true);
  const [selectedCallAnalysisId, setSelectedCallAnalysisId] = useState('');
  const [analyzing, setAnalyzing] = useState(false);
  // After-sales search (server-side: name + calendar day).
  const [analysisQuery, setAnalysisQuery] = useState('');
  const [analysisDate, setAnalysisDate] = useState('');

  // Load connected accounts once; default to the first.
  useEffect(() => {
    let active = true;
    setLoadingAccounts(true);
    getMeetingAccounts()
      .then((data) => {
        if (!active) return;
        setAccounts(data);
        setAccountId((prev) => prev || (data[0]?.id ?? ''));
      })
      .catch(() => {
        if (active) setAccounts([]);
      })
      .finally(() => {
        if (active) setLoadingAccounts(false);
      });
    return () => {
      active = false;
    };
  }, []);

  // Load calendar meetings + research dossiers whenever the account changes.
  useEffect(() => {
    if (!accountId) {
      setMeetings([]);
      setDossiers([]);
      return;
    }
    let active = true;
    setLoadingMeetings(true);
    getCalendarMeetings(accountId)
      .then((data) => active && setMeetings(data))
      .catch(() => active && setMeetings([]))
      .finally(() => active && setLoadingMeetings(false));

    setLoadingDossiers(true);
    getResearchDossiers(accountId)
      .then((data) => {
        if (!active) return;
        setDossiers(data);
        setSelectedDossierId((prev) =>
          data.some((d) => d.id === prev) ? prev : (data[0]?.id ?? ''),
        );
      })
      .catch(() => {
        if (!active) return;
        setDossiers([]);
        setSelectedDossierId('');
      })
      .finally(() => active && setLoadingDossiers(false));
    return () => {
      active = false;
    };
  }, [accountId]);

  // Load personas once.
  useEffect(() => {
    let active = true;
    getPersonas()
      .then((data) => {
        if (!active) return;
        setPersonas(data);
        setSelectedPersona((prev) => prev || (data[0]?.name ?? ''));
      })
      .catch(() => active && setPersonas([]));
    return () => {
      active = false;
    };
  }, []);

  // Load analyzable calls; re-fetch on search (name / date), debounced for the text query.
  useEffect(() => {
    let active = true;
    setLoadingAnalyses(true);
    const timer = setTimeout(() => {
      getCallAnalyses(analysisQuery || undefined, analysisDate || undefined)
        .then((data) => {
          if (!active) return;
          setCallAnalyses(data);
          setSelectedCallAnalysisId((prev) =>
            data.some((c) => c.id === prev) ? prev : (data[0]?.id ?? ''),
          );
        })
        .catch(() => active && setCallAnalyses([]))
        .finally(() => active && setLoadingAnalyses(false));
    }, 250);
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [analysisQuery, analysisDate]);

  const selectedDossier = dossiers.find((d) => d.id === selectedDossierId);
  const selectedCallAnalysis = callAnalyses.find((c) => c.id === selectedCallAnalysisId);

  // Generate the dossier for the selected upcoming meeting (lazy — only when opened).
  useEffect(() => {
    if (!accountId || !selectedDossier) return;
    if (selectedDossier.status === 'Dossier ready') return;
    let active = true;
    setGenerating(true);
    generateDossier(accountId, selectedDossier.id)
      .then((full) => {
        if (!active) return;
        setDossiers((prev) => prev.map((d) => (d.id === full.id ? full : d)));
      })
      .catch((err) => {
        if (active) toast.error(err instanceof Error ? err.message : 'Could not build dossier.');
      })
      .finally(() => active && setGenerating(false));
    return () => {
      active = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [accountId, selectedDossierId]);

  // Fetch the persisted client research for the selected company (on demand).
  const selectedResearchCompany = selectedDossier?.company ?? '';
  useEffect(() => {
    if (!selectedResearchCompany) {
      setClientResearch(null);
      return;
    }
    let active = true;
    setLoadingClientResearch(true);
    setClientResearch(null);
    getClientResearch(selectedResearchCompany)
      .then((data) => active && setClientResearch(data))
      .catch(() => active && setClientResearch(null))
      .finally(() => active && setLoadingClientResearch(false));
    return () => {
      active = false;
    };
  }, [selectedResearchCompany]);

  // Generate / refresh the client research for the selected company, then store it.
  const generateClientResearchForSelected = useCallback(async () => {
    if (!selectedResearchCompany) return;
    setGeneratingClientResearch(true);
    try {
      const research = await generateClientResearch(
        selectedResearchCompany,
        selectedDossier?.contact?.split(' · ')[1] || undefined,
      );
      setClientResearch(research);
      toast.success(`Research ready for ${selectedResearchCompany}.`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not build client research.');
    } finally {
      setGeneratingClientResearch(false);
    }
  }, [selectedResearchCompany, selectedDossier]);

  // Harvest Read AI report emails (Gmail) into the after-sales list, then reload.
  const [syncingReadAi, setSyncingReadAi] = useState(false);
  const syncReadAi = useCallback(async () => {
    setSyncingReadAi(true);
    try {
      const { imported } = await harvestReadAiMeetings();
      const data = await getCallAnalyses(analysisQuery || undefined, analysisDate || undefined);
      setCallAnalyses(data);
      toast.success(`Synced ${imported} Read AI meeting${imported === 1 ? '' : 's'}.`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Read AI sync failed.');
    } finally {
      setSyncingReadAi(false);
    }
  }, [analysisQuery, analysisDate]);

  // Re-run the sales coach on the selected call with the chosen persona.
  const runAnalysis = useCallback(async () => {
    if (!selectedCallAnalysisId) return;
    setAnalyzing(true);
    try {
      const updated = await analyzeMeeting(selectedCallAnalysisId, selectedPersona || undefined);
      setCallAnalyses((prev) => prev.map((c) => (c.id === updated.id ? updated : c)));
      toast.success(`Analyzed through ${updated.persona ?? 'persona'}.`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Analysis failed.');
    } finally {
      setAnalyzing(false);
    }
  }, [selectedCallAnalysisId, selectedPersona]);

  return {
    activeTab,
    setActiveTab,

    // booker
    accounts,
    accountId,
    setAccountId,
    loadingAccounts,
    meetings,
    loadingMeetings,

    // research
    dossiers,
    selectedDossierId,
    setSelectedDossierId,
    selectedDossier,
    loadingDossiers,
    generating,

    // client research (persisted deep dossier)
    clientResearch,
    loadingClientResearch,
    generatingClientResearch,
    generateClientResearch: generateClientResearchForSelected,

    // after-sales
    personas,
    selectedPersona,
    setSelectedPersona,
    callAnalyses,
    selectedCallAnalysisId,
    setSelectedCallAnalysisId,
    selectedCallAnalysis,
    loadingAnalyses,
    analyzing,
    runAnalysis,
    analysisQuery,
    setAnalysisQuery,
    analysisDate,
    setAnalysisDate,
    syncingReadAi,
    syncReadAi,
  };
}
