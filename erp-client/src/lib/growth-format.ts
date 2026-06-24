import type {
  ContractStatus,
  PipelineStage,
  ProspectStatus,
  ReplyVerdict,
} from '@evertrust/shared';

// Display labels + dark-shell semantic tints for the Growth-Engine surfaces.
// Palette is deliberately small (emerald = good/active, amber = attention,
// sky/violet = accent, rose/destructive = negative, slate/muted = neutral) per
// DESIGN.md — never rainbow.

// The board column order (the funnel left→right). Used to render statusCounts
// chips and the status filter consistently.
export const PROSPECT_STATUS_ORDER: readonly ProspectStatus[] = [
  'NEW',
  'EMAILED',
  'REPLIED',
  'INTERESTED',
  'MEETING_SCHEDULED',
  'RE_ENGAGED',
  'NOT_INTERESTED',
  'DO_NOT_CONTACT',
];

export const PROSPECT_STATUS_LABEL: Record<ProspectStatus, string> = {
  NEW: 'New',
  EMAILED: 'Emailed',
  REPLIED: 'Replied',
  INTERESTED: 'Interested',
  MEETING_SCHEDULED: 'Meeting scheduled',
  NOT_INTERESTED: 'Not interested',
  RE_ENGAGED: 'Re-engaged',
  DO_NOT_CONTACT: 'Do not contact',
};

export const PROSPECT_STATUS_CLASS: Record<ProspectStatus, string> = {
  NEW: 'border-slate-500/30 bg-slate-500/10 text-slate-400',
  EMAILED: 'border-sky-500/30 bg-sky-500/10 text-sky-400',
  REPLIED: 'border-violet-500/30 bg-violet-500/10 text-violet-400',
  INTERESTED: 'border-emerald-500/30 bg-emerald-500/10 text-emerald-400',
  MEETING_SCHEDULED: 'border-emerald-500/30 bg-emerald-500/10 text-emerald-400',
  NOT_INTERESTED: 'border-border bg-muted/40 text-muted-foreground',
  RE_ENGAGED: 'border-amber-500/30 bg-amber-500/10 text-amber-400',
  DO_NOT_CONTACT: 'border-rose-500/30 bg-rose-500/10 text-rose-400',
};

// The Nurture sales-pipeline stages (the kanban columns, Interest → Lost). A
// SEPARATE axis from PROSPECT_STATUS — the human deal funnel. WON = emerald,
// LOST = muted, the middle stages ramp sky → violet → amber per DESIGN.md.
export const PIPELINE_STAGE_LABEL: Record<PipelineStage, string> = {
  INTEREST: 'Interest',
  INTENT: 'Intent',
  CONSIDERATION: 'Consideration',
  DECISION: 'Decision',
  WON: 'Won',
  LOST: 'Lost',
};

export const PIPELINE_STAGE_CLASS: Record<PipelineStage, string> = {
  INTEREST: 'border-slate-500/30 bg-slate-500/10 text-slate-400',
  INTENT: 'border-sky-500/30 bg-sky-500/10 text-sky-400',
  CONSIDERATION: 'border-violet-500/30 bg-violet-500/10 text-violet-400',
  DECISION: 'border-amber-500/30 bg-amber-500/10 text-amber-400',
  WON: 'border-emerald-500/30 bg-emerald-500/10 text-emerald-400',
  LOST: 'border-border bg-muted/40 text-muted-foreground',
};

export const REPLY_VERDICT_LABEL: Record<ReplyVerdict, string> = {
  INTERESTED: 'Interested',
  NOT_INTERESTED: 'Not interested',
  SNOOZE: 'Snooze',
  MEETING_REQUEST: 'Meeting request',
  UNSURE: 'Unsure',
  AUTO_REPLY: 'Auto-reply',
  BOUNCE: 'Bounce',
};

export const REPLY_VERDICT_CLASS: Record<ReplyVerdict, string> = {
  INTERESTED: 'border-emerald-500/30 bg-emerald-500/10 text-emerald-400',
  MEETING_REQUEST: 'border-emerald-500/30 bg-emerald-500/10 text-emerald-400',
  SNOOZE: 'border-amber-500/30 bg-amber-500/10 text-amber-400',
  UNSURE: 'border-amber-500/30 bg-amber-500/10 text-amber-400',
  NOT_INTERESTED: 'border-border bg-muted/40 text-muted-foreground',
  AUTO_REPLY: 'border-border bg-muted/40 text-muted-foreground',
  BOUNCE: 'border-rose-500/30 bg-rose-500/10 text-rose-400',
};

export const CONTRACT_STATUS_LABEL: Record<ContractStatus, string> = {
  GENERATED: 'Generated',
  SENT: 'Sent',
  SIGNED: 'Signed',
  FAILED: 'Failed',
};

export const CONTRACT_STATUS_CLASS: Record<ContractStatus, string> = {
  GENERATED: 'border-slate-500/30 bg-slate-500/10 text-slate-400',
  SENT: 'border-sky-500/30 bg-sky-500/10 text-sky-400',
  SIGNED: 'border-emerald-500/30 bg-emerald-500/10 text-emerald-400',
  FAILED: 'border-rose-500/30 bg-rose-500/10 text-rose-400',
};

// Source tint for an AI vs MANUAL niche target.
export const TARGET_SOURCE_CLASS: Record<'AI' | 'MANUAL', string> = {
  AI: 'border-violet-500/30 bg-violet-500/10 text-violet-400',
  MANUAL: 'border-sky-500/30 bg-sky-500/10 text-sky-400',
};
