export type ReachTab = 'scraper' | 'generator' | 'sender' | 'templates';

export type CampaignStatus = 'NEW' | 'IN CAMPAIGN' | 'OVER';

export type Campaign = {
  id: string;
  name: string;
  niche: string;
  region: string;
  companies: number;
  // Total emails sent across all rounds (Email Generator table's "Sent" column).
  sent: number;
  status: CampaignStatus;
};

export type LeadStatus =
  | 'New'
  | 'Cold Outreach'
  | 'Followed Up'
  | 'Interested'
  | 'Unsure'
  | 'Not Interested';

export type Lead = {
  id: string;
  company: string;
  contact: string;
  location: string;
  source: string;
  status: LeadStatus;
  // The lead's email (when the scraper found one). Drives the "Move to pipeline"
  // action — a prospect can't be created without an email.
  email?: string;
};

export type CampaignEmail = {
  id: string;
  step: string;
  round: string;
  subject: string;
  body?: string;
  status: 'DRAFT' | 'SENT' | 'SCHEDULED';
  sent: number;
  opened: number;
  clicked: number;
  replied: number;
  bounced: number;
  meetings: number;
};

export type SenderSchedule = {
  id: string;
  campaign: string;
  nicheRegion: string;
  round: string;
  nextSend: string;
  status: string;
  // Aggregate email stats across the three rounds (for the Sequence Sender).
  sent: number;
  opened: number;
  replied: number;
  meetings: number;
  // Reach Bazooka toggle state for this campaign.
  autoSend: boolean;
};

export type NewCampaignFormValues = {
    name: string;
    niche: string;
    region: string;
    segment: string;
    source: string;
    sender: string;
    targetType: string;
    industryFocus: string;
    tenderFocus: string;
}

// A campaign enriched with the Ammo Forge output (templates + news brief) and the
// raw backend status. The campaign tables consume the Campaign subset; the Email
// Generator reads `templates`/`newsBrief`. `aimStatus` is the unmapped lifecycle.
export type EmailBlock = { subject: string; body: string };
export type ReachTemplates = {
  cold_outreach: EmailBlock;
  follow_up: EmailBlock;
  final_push: EmailBlock;
};
export type ReachNewsBrief = { title: string; body: string };
export type AimStatus = 'DRAFT' | 'READY' | 'RUNNING' | 'COMPLETED' | 'FAILED';

export type ReachRound = 'cold' | 'followup' | 'final';
export type RoundStats = {
  sent: number;
  opened: number;
  clicked: number;
  replied: number;
  bounced: number;
  meetings: number;
};
export type ReachStats = {
  cold: RoundStats;
  followup: RoundStats;
  final: RoundStats;
};

// Sequence Sender · "Emails sent per day" chart. One bar per day; `type`
// distinguishes already-sent days, today, and projected future volume.
export type DailySend = {
  date: string;
  value: number;
  type: 'past' | 'today' | 'future';
};

export type ReachCampaignView = Campaign & {
  aimStatus: AimStatus;
  templates: ReachTemplates | null;
  newsBrief: ReachNewsBrief | null;
  stats: ReachStats;
  autoSend: boolean;
  sender: string;
};