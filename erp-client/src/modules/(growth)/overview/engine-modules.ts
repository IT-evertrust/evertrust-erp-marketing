// The 9 engine modules shown on the Overview "Engine Modules" wheel — a faithful
// port of the Saloot demo's MODULES list (R.E.A.N. phases). This is a static map
// of what each module DOES (the wheel is an always-on engine diagram); hovering a
// module filters the live Engine Activity feed to that module's runs.
export type EngineModule = {
  id: string;
  stage: string;
  tag: string;
  key: string;
  name: string;
  desc: string;
  status: string;
  // Upper-cased substrings used to match a real activity item's `source`
  // (e.g. "REACH · SENDER") to this module so the wheel can filter the feed.
  match: string[];
};

export const ENGINE_MODULES: EngineModule[] = [
  {
    id: '01',
    stage: 'REACH',
    tag: 'REA',
    key: 'scraper',
    name: 'Lead Scraper',
    desc: 'Pulls and dedupes target companies from iBau, housing registries and directories.',
    status: 'LIVE',
    match: ['SCRAPER', 'LEAD SCRAPER'],
  },
  {
    id: '02',
    stage: 'REACH',
    tag: 'REA',
    key: 'generator',
    name: 'Email Generator',
    desc: 'Drafts the 3-round outreach emails per campaign, ready for review.',
    status: 'LIVE',
    match: ['GENERATOR', 'EMAIL GENERATOR'],
  },
  {
    id: '03',
    stage: 'REACH',
    tag: 'REA',
    key: 'sender',
    name: 'Sequence Sender',
    desc: 'Sends the cadence and tracks opens, clicks and replies.',
    status: 'ALWAYS LIVE',
    match: ['SENDER', 'SEQUENCE SENDER'],
  },
  {
    id: '04',
    stage: 'ENGAGE',
    tag: 'ENG',
    key: 'sorter',
    name: 'Reply Sorter',
    desc: 'Classifies inbound replies and drafts the right response.',
    status: 'ALWAYS LIVE',
    match: ['SORTER', 'REPLY SORTER', 'ENGAGE'],
  },
  {
    id: '05',
    stage: 'ACTIVATE',
    tag: 'ACT',
    key: 'booker',
    name: 'Meeting Booker',
    desc: 'Proposes slots and books meetings into Google Calendar.',
    status: 'LIVE',
    match: ['BOOKER', 'MEETING BOOKER'],
  },
  {
    id: '06',
    stage: 'ACTIVATE',
    tag: 'ACT',
    key: 'research',
    name: 'Company Research',
    desc: 'Builds a one-page dossier on each company before the call.',
    status: 'LIVE',
    match: ['RESEARCH', 'COMPANY RESEARCH'],
  },
  {
    id: '07',
    stage: 'ACTIVATE',
    tag: 'ACT',
    key: 'aftersales',
    name: 'After-Sales Analysis',
    desc: 'Analyses call recordings via Read AI and extracts next steps.',
    status: 'LIVE',
    match: ['AFTERSALES', 'AFTER-SALES', 'READ AI', 'ANALYSIS'],
  },
  {
    id: '08',
    stage: 'NURTURE',
    tag: 'NUR',
    key: 'pipeline',
    name: 'Sales Pipeline',
    desc: 'Tracks every deal across the six stages with live values.',
    status: 'ALWAYS LIVE',
    match: ['PIPELINE', 'SALES PIPELINE', 'NURTURE'],
  },
  {
    id: '09',
    stage: 'NURTURE',
    tag: 'NUR',
    key: 'contract',
    name: 'Contract Assist',
    desc: 'Generates Vollmacht / Vertrag / NDA from the agreed terms.',
    status: 'LIVE',
    match: ['CONTRACT', 'CONTRACT ASSIST'],
  },
];

// True when a live activity item belongs to the given module (by matching its
// `source` label against the module's tokens). Used to filter the feed on hover.
export function activityMatchesModule(source: string, mod: EngineModule): boolean {
  const upper = source.toUpperCase();
  return mod.match.some((token) => upper.includes(token));
}
