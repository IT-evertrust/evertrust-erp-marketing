'use client';

import { useCallback, useEffect, useState } from 'react';
import { toast } from 'sonner';

import {
  analyzeMeeting,
  generateClientResearch,
  getCallAnalyses,
  getCalendarMeetings,
  getClientResearch,
  getMeetingAccounts,
  getPersonas,
  harvestReadAiMeetings,
  mapDossier,
} from '../services/activate-service';
import type {
  ActivateTab,
  CalendarMeeting,
  CallAnalysis,
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

  // ---- after-sales ----
  const [personas, setPersonas] = useState<Persona[]>([]);
  const [selectedPersona, setSelectedPersona] = useState('');
  const [callAnalyses, setCallAnalyses] = useState<CallAnalysis[]>([]);
  const [loadingAnalyses, setLoadingAnalyses] = useState(true);
  const [selectedCallAnalysisId, setSelectedCallAnalysisId] = useState('');
  const [analyzing, setAnalyzing] = useState(false);
  // After-sales search (server-side: by company / contact name).
  const [analysisQuery, setAnalysisQuery] = useState('');

  // Bumped to re-pull the calendar after an edit/move so the grid reflects the change.
  const [refreshTick, setRefreshTick] = useState(0);
  const refreshMeetings = () => setRefreshTick((t) => t + 1);

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
    return () => {
      active = false;
    };
  }, [accountId, refreshTick]);

  // Company Research = the visible meetings' companies, backed by persisted
  // client_research (MBTI + interaction context). When meetings load we build the
  // dossier list, then AUTO-KICKSTART research (Phase E) for any company without a
  // dossier yet — one at a time (each is a slow LLM run), updating as they land.
  useEffect(() => {
    if (meetings.length === 0) {
      setDossiers([]);
      setSelectedDossierId('');
      return;
    }
    let active = true;
    setLoadingDossiers(true);
    (async () => {
      const research = await getClientResearch().catch(() => []);
      if (!active) return;
      const byCompany = new Map(
        research.map((r) => [r.company.toLowerCase(), r]),
      );
      const seen = new Set<string>();
      const list: ResearchDossier[] = [];
      for (const m of meetings) {
        const key = m.company.toLowerCase();
        if (seen.has(key)) continue;
        seen.add(key);
        list.push(
          mapDossier(
            { company: m.company, contact: m.contact, meetingTime: `${m.day} · ${m.time}` },
            byCompany.get(key),
          ),
        );
      }
      setDossiers(list);
      setSelectedDossierId((prev) =>
        list.some((d) => d.id === prev) ? prev : (list[0]?.id ?? ''),
      );
      setLoadingDossiers(false);

      // Phase E: generate the missing dossiers in the background, sequentially.
      for (const d of list) {
        if (!active) break;
        if (d.status === 'Dossier ready') continue;
        setGenerating(true);
        try {
          const r = await generateClientResearch(d.company);
          if (!active) break;
          setDossiers((prev) =>
            prev.map((x) =>
              x.company.toLowerCase() === d.company.toLowerCase()
                ? mapDossier(
                    { company: d.company, contact: d.contact, meetingTime: d.meetingTime },
                    r,
                  )
                : x,
            ),
          );
        } catch {
          // leave it "Being generated"; a later load can retry
        }
      }
      if (active) setGenerating(false);
    })();
    return () => {
      active = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [meetings]);

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

  // Load analyzable calls; re-fetch on search (by name), debounced for the text query.
  useEffect(() => {
    let active = true;
    setLoadingAnalyses(true);
    const timer = setTimeout(() => {
      getCallAnalyses(analysisQuery || undefined)
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
  }, [analysisQuery]);

  const selectedDossier = dossiers.find((d) => d.id === selectedDossierId);
  const selectedCallAnalysis = callAnalyses.find((c) => c.id === selectedCallAnalysisId);

  // Harvest Read AI report emails (Gmail) into the after-sales list, then reload.
  const [syncingReadAi, setSyncingReadAi] = useState(false);
  const syncReadAi = useCallback(async () => {
    setSyncingReadAi(true);
    try {
      const { imported, reason } = await harvestReadAiMeetings();
      const data = await getCallAnalyses(analysisQuery || undefined);
      setCallAnalyses(data);
      if (imported > 0) {
        toast.success(`Synced ${imported} Read AI meeting${imported === 1 ? '' : 's'}.`);
      } else {
        // Surface WHY nothing came in (e.g. a metadata-only Gmail grant blocking search).
        toast.error(reason ?? 'No Read AI meetings found to sync.');
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Read AI sync failed.');
    } finally {
      setSyncingReadAi(false);
    }
  }, [analysisQuery]);

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
    refreshMeetings,

    // research
    dossiers,
    selectedDossierId,
    setSelectedDossierId,
    selectedDossier,
    loadingDossiers,
    generating,

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
    syncingReadAi,
    syncReadAi,
  };
}
