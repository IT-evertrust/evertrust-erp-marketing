// The Engage queue shapes the backend assembles from prospects + outreach_messages +
// reply_classifications and returns to the web client. The frontend maps these onto its
// own local view types (the UI is untouched).

// 3-way bucket the Engage UI filters on. A flattening of the DB reply verdict:
//   INTERESTED / MEETING_REQUEST -> INTERESTED
//   UNSURE                       -> UNSURE
//   NOT_INTERESTED / SNOOZE      -> NOT_INTERESTED
export type EngageReplyCategory = 'INTERESTED' | 'UNSURE' | 'NOT_INTERESTED';

export type EngageThreadMessage = {
  id: string;
  direction: 'inbound' | 'outbound';
  subject: string;
  body: string;
  sentAt: string | null;
};

// One conversation in the queue. `id` IS the prospectId — a prospect is one
// conversation, and run/draft/send all key off it.
export type EngageReply = {
  id: string;
  campaignId: string;
  company: string;
  contact: string;
  recipientEmail: string;
  category: EngageReplyCategory;
  confidence: number | null;
  reasoning: string | null;
  inboundSubject: string;
  inboundPreview: string;
  inboundBody: string;
  draftSubject: string;
  draftBody: string;
  receivedAt: string | null;
  thread: EngageThreadMessage[];
  // The mailbox this conversation's campaign sends from (campaigns.sender). `sender`
  // is the stable handle ('info'|'hanna'); `senderEmail` is the resolved address.
  // Lets Engage be filtered by inbox so a user can review another worker's replies.
  sender: string;
  senderEmail: string;
};

// 'NEW' (DRAFT) | 'IN_CAMPAIGN' (ACTIVE/PAUSED) | 'OVER' (ARCHIVED) — derived from the
// campaign lifecycle; the frontend renders its own label.
export type EngageCampaignStatus = 'NEW' | 'IN_CAMPAIGN' | 'OVER';

export type EngageCampaign = {
  id: string;
  name: string;
  niche: string;
  region: string;
  replies: number;
  status: EngageCampaignStatus;
  // The mailbox this campaign sends from (campaigns.sender handle + resolved email).
  sender: string;
  senderEmail: string;
};

// Summary returned by the batch classify / demo-seed actions.
export type EngageActionSummary = {
  campaignId: string;
  processed: number;
  classified: number;
  skipped: number;
  errors: string[];
};
