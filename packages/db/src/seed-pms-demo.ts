import 'dotenv/config';
import { and, eq } from 'drizzle-orm';
import { db } from './client';
import {
  kpiDefinitions,
  kpiValues,
  organizations,
  users,
} from './schema';

// LOCAL DEMO ONLY — populates the PMS with sample employees + KPI values so the
// /performance scorecards render with realistic data on localhost. Never run in
// prod (prod scorecards come from real ERP data / manual entry). Idempotent.
//
//   DATABASE_URL=... pnpm --filter @evertrust/db exec tsx src/seed-pms-demo.ts

type Src = 'AUTO' | 'MANUAL' | 'PARTIAL' | 'NA';
type Cat = 'OUTPUT' | 'QUALITY' | 'SPEED' | 'COMPLIANCE' | 'REVENUE';
interface Def {
  key: string;
  label: string;
  category: Cat;
  weightPct: number;
  target: string;
  source: Src;
}

// Per-department KPI catalog (weights from the KPI Scorecards PDF).
const DEPT_KPIS: Record<string, Def[]> = {
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
    { key: 'qualified_tenders', label: 'Qualified tenders found', category: 'OUTPUT', weightPct: 40, target: '18', source: 'AUTO' },
    { key: 'tender_volume', label: 'Tender volume identified', category: 'REVENUE', weightPct: 30, target: '5', source: 'AUTO' },
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

type V = [number | null, string | null];
interface Emp {
  name: string;
  dept: keyof typeof DEPT_KPIS;
  position: string;
  role: string;
  vals: Record<string, V>;
}
const EMP: Emp[] = [
  { name: 'Hanna Keller', dept: 'OPERATIONS', position: 'OFFICER', role: 'EMPLOYEE', vals: { submissions_per_week: [12, '12'], profit_maximization: [79, '79'], risk_free_compliance: [92, '92%'], ai_validation_accuracy: [88, '88%'], deadline_compliance: [100, '100%'] } },
  { name: 'Trung Huynh', dept: 'OPERATIONS', position: 'DEPT_MANAGER', role: 'MANAGER', vals: { submissions_per_week: [9, '9'], profit_maximization: [85, '85'], risk_free_compliance: [90, '90%'], ai_validation_accuracy: [86, '86%'], deadline_compliance: [96, '96%'] } },
  { name: 'Marek Wójcik', dept: 'OPERATIONS', position: 'SPECIALIST', role: 'EMPLOYEE', vals: { submissions_per_week: [8, '8'], profit_maximization: [76, '76'], risk_free_compliance: [88, '88%'], ai_validation_accuracy: [80, '80%'], deadline_compliance: [92, '92%'] } },
  { name: 'Lena Bauer', dept: 'BUSINESS', position: 'EXECUTIVE', role: 'EMPLOYEE', vals: { meetings_booked: [14, '14'], proposal_conversion: [23, '23%'], pipeline_value: [0.95, '€0.95M'], crm_accuracy: [88, '88%'] } },
  { name: 'Sofia Rossi', dept: 'BUSINESS', position: 'OFFICER', role: 'EMPLOYEE', vals: { meetings_booked: [7, '7'], proposal_conversion: [18, '18%'], pipeline_value: [0.5, '€0.5M'], crm_accuracy: [80, '80%'] } },
  { name: 'Jonas Weber', dept: 'MARKETING', position: 'SPECIALIST', role: 'EMPLOYEE', vals: { leads_generated: [58, '58'], qualified_leads: [18, '18'], content_published: [null, null], cost_per_lead: [null, null] } },
  { name: 'Amir Hadid', dept: 'CONSULTING', position: 'SPECIALIST', role: 'EMPLOYEE', vals: { qualified_tenders: [19, '19'], tender_volume: [4.0, '€4.0M'], qualification_accuracy: [null, null], data_completeness: [92, '92%'] } },
  { name: 'Priya Nair', dept: 'IT', position: 'SPECIALIST', role: 'EMPLOYEE', vals: { features_delivered: [null, null], bugs_resolved: [null, null], erp_stability: [99.7, '99.7%'], documentation_quality: [82, '82'] } },
  { name: 'Felix Braun', dept: 'BUSINESS', position: 'EXECUTIVE', role: 'EMPLOYEE', vals: { meetings_booked: [4, '4'], proposal_conversion: [12, '12%'], pipeline_value: [0.3, '€0.3M'], crm_accuracy: [64, '64%'] } },
];

const slug = (n: string) =>
  n
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z]+/g, '.');

function mondayUtc(): Date {
  const d = new Date();
  const day = (d.getUTCDay() + 6) % 7; // 0 = Monday
  d.setUTCDate(d.getUTCDate() - day);
  d.setUTCHours(0, 0, 0, 0);
  return d;
}

async function main(): Promise<void> {
  const [org] = await db
    .select({ id: organizations.id })
    .from(organizations)
    .where(eq(organizations.slug, 'evertrust'))
    .limit(1);
  if (!org) throw new Error('No "evertrust" org — run pnpm db:seed first.');

  // 1. KPI definitions per department (idempotent).
  for (const [dept, defs] of Object.entries(DEPT_KPIS)) {
    await db
      .insert(kpiDefinitions)
      .values(
        defs.map((d) => ({
          organizationId: org.id,
          department: dept as never,
          key: d.key,
          label: d.label,
          category: d.category as never,
          weightPct: d.weightPct,
          period: 'WEEKLY' as never,
          target: d.target,
          source: d.source as never,
        })),
      )
      .onConflictDoNothing();
  }

  const periodStart = mondayUtc();
  const periodEnd = new Date(periodStart);
  periodEnd.setUTCDate(periodEnd.getUTCDate() + 7);

  // 2. Demo employees + their KPI values.
  for (const e of EMP) {
    const email = `${slug(e.name)}@evertrust-germany.de`;
    let [u] = await db
      .select({ id: users.id })
      .from(users)
      .where(and(eq(users.organizationId, org.id), eq(users.email, email)))
      .limit(1);
    if (!u) {
      [u] = await db
        .insert(users)
        .values({
          organizationId: org.id,
          role: e.role as never,
          department: e.dept as never,
          position: e.position as never,
          name: e.name,
          email,
          active: true,
        })
        .returning({ id: users.id });
    }
    const userId = u!.id;

    for (const def of DEPT_KPIS[e.dept] ?? []) {
      const [num, disp] = e.vals[def.key] ?? [null, null];
      await db
        .insert(kpiValues)
        .values({
          organizationId: org.id,
          userId,
          kpiKey: def.key,
          period: 'WEEKLY' as never,
          periodStart,
          periodEnd,
          numericValue: num == null ? null : String(num),
          displayValue: disp,
          source: def.source as never,
          updatedAt: new Date(),
        })
        .onConflictDoUpdate({
          target: [kpiValues.userId, kpiValues.kpiKey, kpiValues.periodStart],
          set: {
            numericValue: num == null ? null : String(num),
            displayValue: disp,
            source: def.source as never,
            updatedAt: new Date(),
          },
        });
    }
  }

  console.log(
    `PMS demo seeded: ${EMP.length} employees, week of ${periodStart.toISOString().slice(0, 10)}.`,
  );
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
