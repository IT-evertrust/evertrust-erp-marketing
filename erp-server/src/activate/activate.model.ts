// Backend view shapes the Activate plane assembles for the web client. The frontend maps
// these onto its own local view types (the UI design is untouched; only the data is real).

// One connected Google account = an "email account" the Meeting Booker can show a calendar for
// (the toggle axis, mirroring Engage's inbox switch).
export type ActivateMeetingAccount = {
  id: string;
  email: string;
  displayName: string | null;
  status: string;
  // The account's auto-assigned palette color (hex), for calendar color-coding.
  color: string | null;
};

// A calendar event for an account. The list view uses day/time/company/contact/title; the
// detail popup uses the richer fields (attendees, location, description, joinUrl).
export type ActivateMeeting = {
  id: string;
  day: string; // 'TUE 17' — matches the booker grid's day labels
  time: string; // '11:00'
  company: string;
  contact: string;
  title: string;
  startsAt: string | null; // ISO
  endsAt: string | null; // ISO
  durationMinutes: number | null;
  location: string | null;
  description: string | null;
  joinUrl: string | null; // Google Meet / conferencing link
  htmlLink: string | null; // open-in-calendar link
  attendees: Array<{ name: string | null; email: string | null; responseStatus: string | null }>;
  organizer: string | null;
  // The owning account (which connected mailbox's calendar this event is on) + its color,
  // so the calendar can color-code each event by account (esp. in all-accounts mode).
  // Optional: the calendar reader / repo omit them; the service attaches them.
  accountId?: string | null;
  accountEmail?: string | null;
  accountColor?: string | null;
};

// A coaching persona (the lens After-Sales analysis runs through). From the PG personas table.
export type ActivatePersona = {
  id: string;
  name: string;
};

// A pre-meeting research dossier for an upcoming meeting (Company Research tab).
export type ActivateDossier = {
  id: string; // the source meeting/event id
  company: string;
  contact: string;
  meetingTime: string;
  status: 'Dossier ready' | 'Being generated';
  profile: Array<{ label: string; value: string }>;
  signals: string[];
  talkingPoints: string[];
};

// A scored call (After-Sales Analysis tab). Mirrors the client CallAnalysis plus the richer
// persona-driven detail (technique scores, strengths/weaknesses) the UI now renders.
export type ActivateCallAnalysis = {
  id: string; // meeting id
  company: string;
  contact: string;
  date: string;
  duration: string;
  sentiment: 'Positive' | 'Neutral' | 'Negative';
  closeProbability: 'High' | 'Medium' | 'Low';
  talkRatio: string;
  summary: string;
  actionItems: Array<{ id: string; label: string; done: boolean }>;
  // ---- richer detail (persona-aware) ----
  persona: string | null;
  hasTranscript: boolean;
  analyzed: boolean;
  performance: Array<{ label: string; score: number | null }>;
  technique: Array<{
    label: string;
    score: number | null; // 0-10
    recommendation: string;
  }>;
  strengths: string[];
  weaknesses: string[];
};
