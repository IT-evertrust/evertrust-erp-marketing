'use client';

import { ActivateTabs } from '../components/activate-tabs';
import { AfterSalesAnalysisPanel } from '../components/aftersales-analysis-panel';
import { CompanyResearchPanel } from '../components/company-research-panel';
import { MeetingBookerPanel } from '../components/meeting-booker-panel';
import { useActivate } from '../hooks/use-activate';

export function ActivatePage() {
  const activate = useActivate();

  return (
    <main className="px-6 py-5">
      <ActivateTabs
        activeTab={activate.activeTab}
        onChange={activate.setActiveTab}
      />

      {activate.activeTab === 'booker' ? (
        <MeetingBookerPanel meetings={activate.meetings} />
      ) : null}

      {activate.activeTab === 'research' ? (
        <CompanyResearchPanel
          dossiers={activate.dossiers}
          selectedDossierId={activate.selectedDossierId}
          onSelectDossier={activate.setSelectedDossierId}
          selectedDossier={activate.selectedDossier}
        />
      ) : null}

      {activate.activeTab === 'aftersales' ? (
        <AfterSalesAnalysisPanel
          analyses={activate.callAnalyses}
          selectedAnalysisId={activate.selectedCallAnalysisId}
          onSelectAnalysis={activate.setSelectedCallAnalysisId}
          selectedAnalysis={activate.selectedCallAnalysis}
        />
      ) : null}
    </main>
  );
}