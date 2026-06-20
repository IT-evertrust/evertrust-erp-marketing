export type ActivateTab = 'booker' | 'research' | 'aftersales';

// A connected Google account — the email-account toggle axis for the Meeting Booker.
export type MeetingAccount = {
  id: string;
  email: string;
  displayName: string | null;
  status: string;
};

export type MeetingAttendee = {
  name: string | null;
  email: string | null;
  responseStatus: string | null;
};

export type CalendarMeeting = {
  id: string;
  day: string;
  time: string;
  company: string;
  contact: string;
  title: string;
  // ---- detail (the popup) ----
  startsAt?: string | null;
  endsAt?: string | null;
  durationMinutes?: number | null;
  location?: string | null;
  description?: string | null;
  joinUrl?: string | null;
  htmlLink?: string | null;
  attendees?: MeetingAttendee[];
  organizer?: string | null;
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

// A coaching persona (the After-Sales analysis lens).
export type Persona = {
  id: string;
  name: string;
};

export type ScoreItem = {
  label: string;
  score: number | null;
};

export type TechniqueItem = {
  label: string;
  score: number | null; // 0-10
  recommendation: string;
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
  // ---- richer, persona-aware detail ----
  persona?: string | null;
  hasTranscript?: boolean;
  analyzed?: boolean;
  performance?: ScoreItem[];
  technique?: TechniqueItem[];
  strengths?: string[];
  weaknesses?: string[];
};
