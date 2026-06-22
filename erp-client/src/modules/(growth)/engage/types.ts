export type ReplyCategory = 'INTERESTED' | 'UNSURE' | 'NOT INTERESTED';

export type AiAgentMode = 'write' | 'train';

export type EngageCampaign = {
  id: string;
  name: string;
  niche: string;
  region: string;
  replies: number;
  status: 'NEW' | 'IN CAMPAIGN' | 'OVER';
};

export type ReplyThreadMessage = {
  id: string;
  direction: 'inbound' | 'outbound';
  header: string;
  subject: string;
  body: string;
};

export type CampaignReply = {
  id: string;
  campaignId: string;
  company: string;
  contact: string;
  time: string;
  category: ReplyCategory;
  inboundPreview: string;
  inboundBody: string;
  draftSubject: string;
  draftBody: string;
  thread: ReplyThreadMessage[];
};