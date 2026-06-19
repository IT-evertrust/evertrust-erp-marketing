export type ReplyCategory = 'INTERESTED' | 'UNSURE' | 'NOT_INTERESTED';

export type ReplyStatus = 'NEEDS_REPLY' | 'DRAFT_SAVED' | 'SENT';

export type EngageReply = {
  id: string;
  campaignId: string;
  company: string;
  contact: string;
  recipientEmail: string;
  category: ReplyCategory;
  inboundSubject: string;
  inboundBody: string;
  draftSubject: string;
  draftBody: string;
  status: ReplyStatus;
  savedAt?: string;
  sentAt?: string;
  createdAt: string;
  updatedAt: string;
};