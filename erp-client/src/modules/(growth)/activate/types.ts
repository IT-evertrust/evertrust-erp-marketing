export type ActivateTab = 'booker' | 'research' | 'aftersales';

export type CalendarMeeting = {
  id: string;
  day: string;
  time: string;
  company: string;
  contact: string;
  title: string;
};

export type ResearchDossier = {
  id: string;
  company: string;
  contact: string;
  meetingTime: string;
  status: 'Dossier ready' | 'Being generated';
  profile: Array<{
    label: string;
    value: string;
  }>;
  signals: string[];
  talkingPoints: string[];
};

export type CallAnalysis = {
  id: string;
  company: string;
  contact: string;
  date: string;
  duration: string;
  sentiment: 'Positive' | 'Neutral' | 'Negative';
  closeProbability: 'High' | 'Medium' | 'Low';
  talkRatio: string;
  summary: string;
  actionItems: Array<{
    id: string;
    label: string;
    done: boolean;
  }>;
};