export type ReachTab = 'scraper' | 'generator' | 'sender';

export type CampaignStatus = 'NEW' | 'IN CAMPAIGN' | 'OVER';

export type Campaign = {
  id: string;
  name: string;
  niche: string;
  region: string;
  companies: number;
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
};

export type CampaignEmail = {
  id: string;
  step: string;
  round: string;
  subject: string;
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
};

export type NewCampaignFormValues = {
    name: string;
    niche: string;
    region: string;
    segment: string;
    source: string;
}