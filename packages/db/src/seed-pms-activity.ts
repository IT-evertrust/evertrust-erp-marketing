import 'dotenv/config';
import { and, eq, gte, inArray, like, lt } from 'drizzle-orm';
import { db } from './client';
import {
  kpiDefinitions,
  kpiValues,
  leads,
  meetings,
  organizations,
  pricings,
  submissionReceipts,
  tenders,
  users,
} from './schema';

// LOCAL DEMO ONLY — seeds real upstream ERP ACTIVITY (tenders, submission receipts,
// pricing decisions, meetings, leads) so the PMS *collectors* derive scores the same
// way prod would. KPIs that genuinely have no source are seeded as MANUAL/NA values.
// Idempotent for the current week. Never run in prod.
//
//   DATABASE_URL=... pnpm --filter @evertrust/db exec tsx src/seed-pms-activity.ts

type Src = 'AUTO' | 'MANUAL' | 'PARTIAL' | 'NA';
type Cat = 'OUTPUT' | 'QUALITY' | 'SPEED' | 'COMPLIANCE' | 'REVENUE';

const DEPT_KPIS: Record<string, { key: string; label: string; category: Cat; weightPct: number; target: string; source: Src }[]> = {
  OPERATIONS: [
    { key: 'submissions_per_week', label: 'Submissions / week', category: 'OUTPUT', weightPct: 30, target: '10', source: 'AUTO' },
    { key: 'profit_maximization', label: 'Profit maximization', category: 'REVENUE', weightPct: 30, target: '80', source: 'AUTO' },
    { key: 'risk_free_compliance', label: 'Risk-free compliance', category: 'COMPLIANCE', weightPct: 25, target: '95%', source: 'PARTIAL' },
    { key: 'ai_validation_accuracy', label: 'AI validation accuracy', category: 'QUALITY', weightPct: 15, target: '90%', source: 'PARTIAL' },
    { key: 'deadline_compliance', label: 'Submission deadline compliance', category: 'SPEED', weightPct: 0, target: '95%', source: 'AUTO' },
  ],
  BUSINESS: [
    { key: 'meetings_booked', label: 'Meetings booked', category: 'OUTPUT', weightPct: 40, target: '12', source: 'AUTO' },
    { key: 'proposal_conversion', label: 'Proposal conversion', category: 'QUALITY', weightPct: 30, target: '25%', source: 'PARTIAL' },
    { key: 'pipeline_value', label: 'Pipeline value created', category: 'REVENUE', weightPct: 20, target: '1.0', source: 'PARTIAL' },
    { key: 'crm_accuracy', label: 'CRM accuracy', category: 'COMPLIANCE', weightPct: 10, target: '90%', source: 'MANUAL' },
  ],
  MARKETING: [
    { key: 'leads_generated', label: 'Leads generated', category: 'OUTPUT', weightPct: 40, target: '60', source: 'AUTO' },
    { key: 'qualified_leads', label: 'Qualified leads', category: 'QUALITY', weightPct: 30, target: '20', source: 'AUTO' },
    { key: 'content_published', label: 'Content published', category: 'SPEED', weightPct: 20, target: '8', source: 'NA' },
    { key: 'cost_per_lead', label: 'Cost per qualified lead', category: 'REVENUE', weightPct: 10, target: '40', source: 'NA' },
  ],
  CONSULTING: [
    { key: 'qualified_tenders', label: 'Qualified tenders found', category: 'OUTPUT', weightPct: 40, target: '18', source: 'PARTIAL' },
    { key: 'tender_volume', label: 'Tender volume identified', category: 'REVENUE', weightPct: 30, target: '5', source: 'PARTIAL' },
    { key: 'qualification_accuracy', label: 'Qualification accuracy', category: 'QUALITY', weightPct: 20, target: '90%', source: 'NA' },
    { key: 'data_completeness', label: 'Data completeness', category: 'COMPLIANCE', weightPct: 10, target: '95%', source: 'PARTIAL' },
  ],
  IT: [
    { key: 'features_delivered', label: 'Features delivered', category: 'OUTPUT', weightPct: 40, target: '8', source: 'NA' },
    { key: 'bugs_resolved', label: 'Bugs resolved', category: 'QUALITY', weightPct: 30, target: '15', source: 'NA' },
    { key: 'erp_stability', label: 'ERP stability (uptime)', category: 'SPEED', weightPct: 20, target: '99.5', source: 'PARTIAL' },
    { key: 'documentation_quality', label: 'Documentation quality', category: 'COMPLIANCE', weightPct: 10, target: '85', source: 'MANUAL' },
  ],
};

type Manual = Record<string, [number | null, string | null, Src]>;
interface Emp {
  name: string;
  dept: keyof typeof DEPT_KPIS;
  position: string;
  role: string;
  ops?: { submissions: number; late: number; margin: number }; // OPERATIONS activity
  meetingsBooked?: number; // BUSINESS activity
  leads?: { total: number; qualified: number }; // MARKETING activity
  manual: Manual; // values for KPIs with NO collector
}

const EMP: Emp[] = [
  { name: 'Hanna Keller', dept: 'OPERATIONS', position: 'OFFICER', role: 'EMPLOYEE',
    ops: { submissions: 11, late: 0, margin: 88 },
    manual: { risk_free_compliance: [92, '92%', 'PARTIAL'], ai_validation_accuracy: [94, '94%', 'PARTIAL'] } },
  { name: 'Trung Huynh', dept: 'OPERATIONS', position: 'DEPT_MANAGER', role: 'MANAGER',
    ops: { submissions: 9, late: 0, margin: 85 },
    manual: { risk_free_compliance: [90, '90%', 'PARTIAL'], ai_validation_accuracy: [86, '86%', 'PARTIAL'] } },
  { name: 'Marek Wójcik', dept: 'OPERATIONS', position: 'SPECIALIST', role: 'EMPLOYEE',
    ops: { submissions: 8, late: 1, margin: 76 },
    manual: { risk_free_compliance: [88, '88%', 'PARTIAL'], ai_validation_accuracy: [80, '80%', 'PARTIAL'] } },
  { name: 'Lena Bauer', dept: 'BUSINESS', position: 'EXECUTIVE', role: 'EMPLOYEE',
    meetingsBooked: 13,
    manual: { proposal_conversion: [28, '28%', 'PARTIAL'], pipeline_value: [1.3, '€1.3M', 'PARTIAL'], crm_accuracy: [88, '88%', 'MANUAL'] } },
  { name: 'Sofia Rossi', dept: 'BUSINESS', position: 'OFFICER', role: 'EMPLOYEE',
    meetingsBooked: 7,
    manual: { proposal_conversion: [18, '18%', 'PARTIAL'], pipeline_value: [0.5, '€0.5M', 'PARTIAL'], crm_accuracy: [80, '80%', 'MANUAL'] } },
  { name: 'Felix Braun', dept: 'BUSINESS', position: 'EXECUTIVE', role: 'EMPLOYEE',
    meetingsBooked: 4,
    manual: { proposal_conversion: [12, '12%', 'PARTIAL'], pipeline_value: [0.3, '€0.3M', 'PARTIAL'], crm_accuracy: [64, '64%', 'MANUAL'] } },
  { name: 'Jonas Weber', dept: 'MARKETING', position: 'SPECIALIST', role: 'EMPLOYEE',
    leads: { total: 22, qualified: 8 },
    manual: { content_published: [null, null, 'NA'], cost_per_lead: [null, null, 'NA'] } },
  { name: 'Amir Hadid', dept: 'CONSULTING', position: 'SPECIALIST', role: 'EMPLOYEE',
    manual: { qualified_tenders: [19, '19', 'PARTIAL'], tender_volume: [6.2, '€6.2M', 'PARTIAL'], qualification_accuracy: [null, null, 'NA'], data_completeness: [92, '92%', 'PARTIAL'] } },
  { name: 'Priya Nair', dept: 'IT', position: 'SPECIALIST', role: 'EMPLOYEE',
    manual: { features_delivered: [null, null, 'NA'], bugs_resolved: [null, null, 'NA'], erp_stability: [99.7, '99.7%', 'PARTIAL'], documentation_quality: [88, '88', 'MANUAL'] } },
];

const slug = (n: string) =>
  n.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z]+/g, '.');

function week(): { start: Date; end: Date; mid: Date } {
  const start = new Date();
  const day = (start.getUTCDay() + 6) % 7;
  start.setUTCDate(start.getUTCDate() - day);
  start.setUTCHours(0, 0, 0, 0);
  const end = new Date(start); end.setUTCDate(end.getUTCDate() + 7);
  const mid = new Date(start); mid.setUTCDate(mid.getUTCDate() + 2);
  return { start, end, mid };
}

async function main(): Promise<void> {
  const [org] = await db.select({ id: organizations.id }).from(organizations).where(eq(organizations.slug, 'evertrust')).limit(1);
  if (!org) throw new Error('No "evertrust" org — run pnpm db:seed first.');
  const orgId = org.id;
  const { start, end, mid } = week();

  // KPI definitions per department (idempotent).
  for (const [dept, defs] of Object.entries(DEPT_KPIS)) {
    await db.insert(kpiDefinitions).values(
      defs.map((d) => ({ organizationId: orgId, department: dept as never, key: d.key, label: d.label, category: d.category as never, weightPct: d.weightPct, period: 'WEEKLY' as never, target: d.target, source: d.source as never })),
    ).onConflictDoNothing();
  }

  // Idempotent: wipe any prior demo activity (marked source/proofUrl/sessionId =
  // 'pms-demo', demo lead emails) + this week's KPI values, then reseed fresh.
  const demoTenders = await db.select({ id: tenders.id }).from(tenders).where(and(eq(tenders.organizationId, orgId), eq(tenders.source, 'pms-demo')));
  const demoTenderIds = demoTenders.map((t) => t.id);
  if (demoTenderIds.length) {
    await db.delete(pricings).where(inArray(pricings.tenderId, demoTenderIds));
    await db.delete(submissionReceipts).where(inArray(submissionReceipts.tenderId, demoTenderIds));
    await db.delete(tenders).where(inArray(tenders.id, demoTenderIds));
  }
  await db.delete(meetings).where(and(eq(meetings.organizationId, orgId), eq(meetings.sessionId, 'pms-demo')));
  await db.delete(leads).where(and(eq(leads.organizationId, orgId), like(leads.email, 'lead.%@example.com')));
  await db.delete(kpiValues).where(and(eq(kpiValues.organizationId, orgId), gte(kpiValues.periodStart, start), lt(kpiValues.periodStart, end)));

  let nTender = 0, nSub = 0, nPricing = 0, nMtg = 0, nLead = 0;
  for (const e of EMP) {
    const email = `${slug(e.name)}@evertrust-germany.de`;
    let [u] = await db.select({ id: users.id }).from(users).where(and(eq(users.organizationId, orgId), eq(users.email, email))).limit(1);
    if (!u) {
      [u] = await db.insert(users).values({ organizationId: orgId, role: e.role as never, department: e.dept as never, position: e.position as never, name: e.name, email, active: true }).returning({ id: users.id });
    }
    const uid = u!.id;

    // OPERATIONS: one tender + submission receipt + pricing per submission.
    if (e.ops) {
      for (let i = 0; i < e.ops.submissions; i++) {
        const late = i < e.ops.late;
        const submittedAt = new Date(mid);
        const deadline = new Date(submittedAt);
        deadline.setUTCDate(deadline.getUTCDate() + (late ? -1 : 2)); // late => deadline before submit
        const [t] = await db.insert(tenders).values({ organizationId: orgId, vergabeId: `PMS-${slug(e.name)}-${i}`, source: 'pms-demo', title: `Demo tender ${i + 1} — ${e.name}`, status: 'SUBMITTED' as never, currency: 'EUR', submissionDeadlineAt: deadline }).returning({ id: tenders.id });
        nTender++;
        await db.insert(submissionReceipts).values({ tenderId: t!.id, submittedBy: uid, submittedAt, proofUrl: 'pms-demo' });
        nSub++;
        await db.insert(pricings).values({ tenderId: t!.id, status: 'FINAL' as never, subtotal: '1000', margin: String(e.ops.margin), finalPrice: '1000', decidedBy: uid, decidedAt: submittedAt });
        nPricing++;
      }
    }

    // BUSINESS (Sales): meetings attributed by AE name.
    if (e.meetingsBooked) {
      for (let i = 0; i < e.meetingsBooked; i++) {
        await db.insert(meetings).values({ organizationId: orgId, aeName: e.name, clientCompany: `Prospect ${i + 1}`, createdAt: mid });
        nMtg++;
      }
    }

    // MARKETING: leads created this week (some qualified).
    if (e.leads) {
      for (let i = 0; i < e.leads.total; i++) {
        const qualified = i < e.leads.qualified;
        await db.insert(leads).values({ organizationId: orgId, email: `lead.${slug(e.name)}.${i}@example.com`, companyName: `Lead Co ${i + 1}`, stage: (qualified ? 'MEETING_SCHEDULED' : 'INTERESTED') as never, source: 'MANUAL' as never, createdBy: uid, createdAt: mid });
        nLead++;
      }
    }

    // MANUAL / NA values for KPIs with no collector.
    for (const [key, [num, disp, src]] of Object.entries(e.manual)) {
      await db.insert(kpiValues).values({ organizationId: orgId, userId: uid, kpiKey: key, period: 'WEEKLY' as never, periodStart: start, periodEnd: end, numericValue: num == null ? null : String(num), displayValue: disp, source: src as never, updatedAt: new Date() })
        .onConflictDoUpdate({ target: [kpiValues.userId, kpiValues.kpiKey, kpiValues.periodStart], set: { numericValue: num == null ? null : String(num), displayValue: disp, source: src as never, updatedAt: new Date() } });
    }
  }

  console.log(`PMS activity seeded for week ${start.toISOString().slice(0, 10)}: ${nTender} tenders, ${nSub} submissions, ${nPricing} pricings, ${nMtg} meetings, ${nLead} leads. Collectors derive AUTO scores on read.`);
}

main().then(() => process.exit(0)).catch((err) => { console.error(err); process.exit(1); });
