import { BadRequestException, Inject, Injectable, Logger } from '@nestjs/common';
import { and, desc, eq, sql as dsql } from 'drizzle-orm';
import { schema } from '@evertrust/db';
import { DB, type DbClient } from '../db/db.tokens';
import { tenantScope } from '../common/tenant';
import { ActivateAgentClient } from './activate.agent';

// ===========================================================================
// Activate · Client Research (internal-data-grounded dossier + MBTI).
// ---------------------------------------------------------------------------
// For a company, gather the client's OWN words we already hold (their Engage email
// replies + the thread), pass them to the activate.client_research agent, and persist
// the dossier — profile / signals / talking points PLUS interaction context, a history
// timeline, and a communication-style MBTI read — on client_research (one row per
// org+company). The UI reads the persisted rows. Business metrics / external history
// are deferred to a later web-enrichment phase.
//
// NOTE (this branch): finalized-erp also wrote a discussed deal value back onto
// reach_leads.deal_value (its Nurture-on-reach_leads model). main keeps the
// prospects-based Nurture, so that write-back is intentionally omitted — the dossier
// still records the deal economics in its own columns.
// ===========================================================================

interface AgentMessage {
  direction: 'inbound' | 'outbound';
  text: string;
  date?: string | null;
}

@Injectable()
export class ActivateResearchService {
  private readonly logger = new Logger(ActivateResearchService.name);

  constructor(
    @Inject(DB) private readonly db: DbClient,
    private readonly agent: ActivateAgentClient,
  ) {}

  // All persisted research dossiers for the org (newest first).
  listResearch(orgId: string) {
    return this.db
      .select()
      .from(schema.clientResearch)
      .where(tenantScope(orgId, schema.clientResearch))
      .orderBy(desc(schema.clientResearch.generatedAt));
  }

  // One company's dossier (case-insensitive), or null.
  async getResearch(orgId: string, company: string) {
    const rows = await this.db
      .select()
      .from(schema.clientResearch)
      .where(
        and(
          tenantScope(orgId, schema.clientResearch),
          dsql`lower(${schema.clientResearch.company}) = lower(${company})`,
        ),
      )
      .limit(1);
    return rows[0] ?? null;
  }

  // Generate (or refresh) the research for a company: gather the client's internal
  // messages + context, run the agent, persist, and return the row.
  async generate(orgId: string, company: string, clientEmail?: string) {
    const name = company.trim();
    if (!name) throw new BadRequestException('A company is required.');

    const ctx = await this.gather(orgId, name, clientEmail);

    const result = await this.agent.run('activate.client_research', {
      company: name,
      contact: ctx.contact,
      country: ctx.country,
      region: ctx.region,
      niche: ctx.niche,
      product_or_service:
        'Cloud infrastructure scaling & cost-optimization partnership',
      meeting_time: 'Upcoming',
      known_facts: ctx.knownFacts,
      messages: ctx.messages,
      transcript_excerpts: ctx.transcripts,
    });
    const o = (result.output ?? {}) as Record<string, unknown>;

    // Deal economics — only when pricing was actually discussed in a meeting.
    const deal = (o.deal ?? {}) as {
      value?: number;
      currency?: string;
      basis?: string;
      discussed?: boolean;
    };
    const dealDiscussed = !!deal.discussed && typeof deal.value === 'number';

    const values = {
      organizationId: orgId,
      company: name,
      clientEmail: ctx.email ?? clientEmail ?? null,
      leadId: ctx.leadId,
      campaignId: ctx.campaignId,
      profile: (o.profile ?? []) as never,
      signals: (o.signals ?? []) as never,
      talkingPoints: (o.talking_points ?? []) as never,
      interactionContext: String(o.interaction_context ?? ''),
      history: (o.history ?? []) as never,
      mbti: o.mbti ? String(o.mbti) : null,
      mbtiConfidence:
        typeof o.mbti_confidence === 'number' ? o.mbti_confidence : null,
      mbtiReasoning: String(o.mbti_reasoning ?? ''),
      personality: (o.personality ?? {}) as never,
      // Graduate to POST_MEETING once we have actual call transcripts to ground on.
      stage: ctx.hasTranscript ? 'POST_MEETING' : 'PRE_MEETING',
      dealValue: dealDiscussed ? (deal.value as number) : null,
      dealCurrency: dealDiscussed ? (deal.currency ?? 'EUR') : null,
      dealBasis: dealDiscussed ? (deal.basis ?? null) : null,
      sources: {
        messages: ctx.messages.length,
        transcripts: ctx.transcripts.length,
        meetings: ctx.meetingCount,
      } as never,
      status: 'ready',
      generatedBy: 'activate.client_research',
      generatedAt: new Date(),
      updatedAt: new Date(),
    };

    await this.db
      .insert(schema.clientResearch)
      .values(values)
      .onConflictDoUpdate({
        target: [schema.clientResearch.organizationId, schema.clientResearch.company],
        set: {
          clientEmail: values.clientEmail,
          leadId: values.leadId,
          campaignId: values.campaignId,
          profile: values.profile,
          signals: values.signals,
          talkingPoints: values.talkingPoints,
          interactionContext: values.interactionContext,
          history: values.history,
          mbti: values.mbti,
          mbtiConfidence: values.mbtiConfidence,
          mbtiReasoning: values.mbtiReasoning,
          personality: values.personality,
          stage: values.stage,
          dealValue: values.dealValue,
          dealCurrency: values.dealCurrency,
          dealBasis: values.dealBasis,
          sources: values.sources,
          status: values.status,
          generatedBy: values.generatedBy,
          generatedAt: values.generatedAt,
          updatedAt: values.updatedAt,
        },
      });

    // (finalized wrote a discussed deal value back onto reach_leads.deal_value here —
    // omitted on this branch; see the file header note.)

    return this.getResearch(orgId, name);
  }

  // Pull the company's lead row (for contact + campaign context) and the client's
  // conversation (the Engage reply thread) to ground the research.
  private async gather(orgId: string, company: string, clientEmail?: string) {
    const rows = await this.db
      .select({
        leadId: schema.reachLeads.id,
        company: schema.reachLeads.company,
        contact: schema.reachLeads.contactName,
        email: schema.reachLeads.email,
        location: schema.reachLeads.location,
        aimId: schema.reachAims.id,
        niche: schema.reachAims.niche,
        region: schema.reachAims.region,
        thread: schema.reachLeadReplies.thread,
        inbound: schema.reachLeadReplies.inboundBody,
        category: schema.reachLeadReplies.category,
      })
      .from(schema.reachLeads)
      .innerJoin(schema.reachAims, eq(schema.reachLeads.aimId, schema.reachAims.id))
      .leftJoin(
        schema.reachLeadReplies,
        eq(schema.reachLeadReplies.leadId, schema.reachLeads.id),
      )
      .where(
        and(
          tenantScope(orgId, schema.reachLeads),
          dsql`lower(${schema.reachLeads.company}) = lower(${company})`,
        ),
      )
      .limit(1);

    const row = rows[0];
    const messages: AgentMessage[] = [];
    if (row?.thread && Array.isArray(row.thread)) {
      for (const m of row.thread as { direction?: string; body?: string }[]) {
        if (m?.body) {
          messages.push({
            direction: m.direction === 'inbound' ? 'inbound' : 'outbound',
            text: String(m.body),
          });
        }
      }
    } else if (row?.inbound) {
      messages.push({ direction: 'inbound', text: String(row.inbound) });
    }

    // Read AI meetings for this company — the strongest signal. Their transcripts
    // feed the agent's transcript slot; their summaries/analysis become known facts.
    // When ANY meeting transcript exists the dossier graduates to POST_MEETING.
    const meetings = await this.db
      .select({
        title: schema.meetings.title,
        summary: schema.meetings.summary,
        transcript: schema.meetings.transcript,
        analysis: schema.meetings.analysis,
        meetingDate: schema.meetings.meetingDate,
      })
      .from(schema.meetings)
      .where(
        and(
          tenantScope(orgId, schema.meetings),
          dsql`lower(${schema.meetings.clientCompany}) = lower(${company})`,
        ),
      )
      .orderBy(desc(schema.meetings.createdAt))
      .limit(5);

    const transcripts: string[] = [];
    const meetingFacts: string[] = [];
    for (const m of meetings) {
      const label = [m.title, m.meetingDate].filter(Boolean).join(' · ') || 'Meeting';
      const body = (m.transcript ?? '').trim() || (m.summary ?? '').trim();
      if (body) transcripts.push(`[${label}] ${body}`);
      if ((m.summary ?? '').trim() && m.summary !== body) {
        meetingFacts.push(`Meeting (${label}): ${m.summary!.trim()}`);
      }
    }

    const knownFacts = [
      ...meetingFacts,
      row?.category ? `Engage reply category: ${row.category}` : null,
      row?.niche ? `Niche: ${row.niche}` : null,
      row?.region ? `Region: ${row.region}` : null,
    ].filter((f): f is string => !!f);

    return {
      leadId: row?.leadId ?? null,
      campaignId: row?.aimId ?? null,
      contact: row?.contact ?? null,
      email: row?.email ?? clientEmail ?? null,
      country: row?.location ?? null,
      region: row?.region ?? null,
      niche: row?.niche ?? null,
      knownFacts,
      messages,
      transcripts,
      meetingCount: meetings.length,
      hasTranscript: transcripts.length > 0,
    };
  }
}
