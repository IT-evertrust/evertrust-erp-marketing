'use client';

// The blend: rework's Activate tabbed UI. The Meeting Booker tab renders the new
// Saloot-design week-grid booker (MeetingBookerV2). The original full-featured
// Calendar component is intentionally kept on disk (components/activate/calendar)
// and untouched — it is simply no longer mounted here. Research + After-Sales stay
// as rework's panels.
import { useEffect, useState } from 'react';

import { MeetingBookerV2 } from '@/components/activate/meeting-booker-v2/meeting-booker';

import { ActivateTabs } from '../components/activate-tabs';
import { AfterSalesAnalysisPanel } from '../components/aftersales-analysis-panel';
import { CompanyResearchPanel } from '../components/company-research-panel';
import { useActivate } from '../hooks/use-activate';

export function ActivatePage() {
  const activate = useActivate();

  // Deep-link from a Nurture contract's company → that company's research here.
  // Read the URL client-side (no useSearchParams, so no Suspense requirement): open
  // the Research tab on arrival, then select the matching dossier once they load.
  const [companyParam, setCompanyParam] = useState<string | null>(null);
  const { setActiveTab, setSelectedDossierId, dossiers } = activate;

  useEffect(() => {
    const sp = new URLSearchParams(window.location.search);
    const company = sp.get('company');
    setCompanyParam(company);
    if (company || sp.get('tab') === 'research') setActiveTab('research');
  }, [setActiveTab]);

  useEffect(() => {
    if (!companyParam) return;
    const match = dossiers.find(
      (d) => (d.company ?? '').toLowerCase() === companyParam.toLowerCase(),
    );
    if (match) setSelectedDossierId(match.id);
  }, [companyParam, dossiers, setSelectedDossierId]);

  return (
    <main className="px-6 py-5 duration-300 animate-in fade-in">
      <ActivateTabs
        activeTab={activate.activeTab}
        onChange={activate.setActiveTab}
      />

      {activate.activeTab === 'booker' ? <MeetingBookerV2 /> : null}

      {activate.activeTab === 'research' ? (
        <CompanyResearchPanel
          dossiers={activate.dossiers}
          selectedDossierId={activate.selectedDossierId}
          onSelectDossier={activate.setSelectedDossierId}
          selectedDossier={activate.selectedDossier}
          loading={activate.loadingDossiers}
          generating={activate.generating}
          clientResearch={activate.clientResearch}
          loadingClientResearch={activate.loadingClientResearch}
          generatingClientResearch={activate.generatingClientResearch}
          onGenerateClientResearch={activate.generateClientResearch}
        />
      ) : null}

      {activate.activeTab === 'aftersales' ? (
        <AfterSalesAnalysisPanel
          analyses={activate.callAnalyses}
          selectedAnalysisId={activate.selectedCallAnalysisId}
          onSelectAnalysis={activate.setSelectedCallAnalysisId}
          selectedAnalysis={activate.selectedCallAnalysis}
          loading={activate.loadingAnalyses}
          personas={activate.personas}
          selectedPersona={activate.selectedPersona}
          onSelectPersona={activate.setSelectedPersona}
          analyzing={activate.analyzing}
          onAnalyze={activate.runAnalysis}
          query={activate.analysisQuery}
          onQuery={activate.setAnalysisQuery}
          date={activate.analysisDate}
          onDate={activate.setAnalysisDate}
          onSyncReadAi={activate.syncReadAi}
          syncingReadAi={activate.syncingReadAi}
        />
      ) : null}
    </main>
  );
}
