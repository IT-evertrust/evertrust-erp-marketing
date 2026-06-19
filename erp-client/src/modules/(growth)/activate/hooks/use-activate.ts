'use client';

import { useMemo, useState } from 'react';

import {
  getCalendarMeetings,
  getCallAnalyses,
  getResearchDossiers,
} from '../services/activate-service';
import type { ActivateTab } from '../types';

export function useActivate() {
  const [activeTab, setActiveTab] = useState<ActivateTab>('booker');

  const meetings = useMemo(() => getCalendarMeetings(), []);
  const dossiers = useMemo(() => getResearchDossiers(), []);
  const callAnalyses = useMemo(() => getCallAnalyses(), []);

  const [selectedDossierId, setSelectedDossierId] = useState(
    dossiers[0]?.id ?? '',
  );

  const [selectedCallAnalysisId, setSelectedCallAnalysisId] = useState(
    callAnalyses[0]?.id ?? '',
  );

  const selectedDossier = dossiers.find(
    (dossier) => dossier.id === selectedDossierId,
  );

  const selectedCallAnalysis = callAnalyses.find(
    (analysis) => analysis.id === selectedCallAnalysisId,
  );

  return {
    activeTab,
    setActiveTab,

    meetings,

    dossiers,
    selectedDossierId,
    setSelectedDossierId,
    selectedDossier,

    callAnalyses,
    selectedCallAnalysisId,
    setSelectedCallAnalysisId,
    selectedCallAnalysis,
  };
}