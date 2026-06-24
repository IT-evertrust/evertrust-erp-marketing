// TEMP = interested but the timing isn't right (reply_glock TEMPORARY) — a soft
// "later", distinct from a hard "not interested".
export type ReplyCategory = 'INTERESTED' | 'UNSURE' | 'TEMP' | 'NOT INTERESTED';

export type AiAgentMode = 'write' | 'train';

export type EngageCampaign = {
  id: string;
  name: string;
  niche: string;
  region: string;
  replies: number;
  status: 'NEW' | 'IN CAMPAIGN' | 'OVER';
  // The mailbox this campaign sends from — the axis the inbox filter works on.
  sender: string;
  senderEmail: string;
  // The drafting persona reply_glock writes in (F4). null = default voice.
  personaId: string | null;
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
  // The mailbox this conversation belongs to (from its campaign).
  sender: string;
  senderEmail: string;
  // AI classification context (reply_glock). Optional so the view degrades cleanly.
  confidence?: number;
  reasoning?: string;
  recommendedAction?: string | null;
  followUpWindow?: string | null;
  handled?: boolean;
  // Draft provenance — 'reply_glock' (thread) or 'rag_agent' (knowledge base), plus
  // the KB citations the unsure-drafter pulled from (Phase 4).
  draftSource?: string | null;
  citations?: string[];
};