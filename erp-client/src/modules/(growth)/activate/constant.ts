import type {
  CalendarMeeting,
  CallAnalysis,
  ResearchDossier,
} from './types';

export const CALENDAR_MEETINGS: CalendarMeeting[] = [
  {
    id: 'm1',
    day: 'TUE 17',
    time: '11:00',
    company: 'Dresden Building Co-op',
    contact: 'Mr. Lorenz',
    title: 'Intro call',
  },
  {
    id: 'm2',
    day: 'WED 18',
    time: '09:30',
    company: 'Lippe District Build',
    contact: 'Ms. Otto',
    title: 'Needs assessment',
  },
  {
    id: 'm3',
    day: 'THU 19',
    time: '14:00',
    company: 'GeWoBa Bremen',
    contact: 'Mr. Albers',
    title: '180 units',
  },
  {
    id: 'm4',
    day: 'THU 19',
    time: '16:30',
    company: 'Bayer Electric KG',
    contact: 'Mr. Bayer',
    title: 'Resale discussion',
  },
  {
    id: 'm5',
    day: 'FRI 20',
    time: '10:30',
    company: 'WohnQuartier NRW',
    contact: 'Mr. Cetin',
    title: '320 units',
  },
  {
    id: 'm6',
    day: 'FRI 20',
    time: '15:15',
    company: 'Augsburg Utilities',
    contact: 'Mr. Vogt',
    title: 'Pilot',
  },
];

export const RESEARCH_DOSSIERS: ResearchDossier[] = [
  {
    id: 'd1',
    company: 'GeWoBa Bremen',
    contact: 'Mr. Albers · Technical Lead',
    meetingTime: 'Thu 14:00',
    status: 'Dossier ready',
    profile: [
      { label: 'Type', value: 'Housing association' },
      { label: 'Portfolio', value: '~38,000 units' },
      { label: 'Region', value: 'Bremen / Lower Saxony' },
      { label: 'Relevance', value: 'High · tenant-power program active' },
    ],
    signals: [
      'Tender “PV retrofit 2026” published 3 weeks ago',
      'Press release: climate neutrality by 2035 announced',
      'No balcony-solar supplier listed yet',
    ],
    talkingPoints: [
      'Position tiered pricing from 100 units as the entry point',
      'Stress plug-and-play = no electrician cost for existing balconies',
      'Raise tenant-power funding as a lever',
    ],
  },
  {
    id: 'd2',
    company: 'WohnQuartier NRW',
    contact: 'Mr. Cetin · Procurement',
    meetingTime: 'Fri 10:30',
    status: 'Dossier ready',
    profile: [
      { label: 'Type', value: 'Residential portfolio operator' },
      { label: 'Portfolio', value: '~22,000 units' },
      { label: 'Region', value: 'NRW' },
      { label: 'Relevance', value: 'High · multi-site retrofit potential' },
    ],
    signals: [
      'Recent energy-efficiency procurement activity detected',
      'Several properties have south-facing balcony stock',
      'Procurement team has prior solar retrofit exposure',
    ],
    talkingPoints: [
      'Open with portfolio-wide cost reduction',
      'Offer pilot cluster before full framework agreement',
      'Use delivery certainty and tiered pricing as main levers',
    ],
  },
  {
    id: 'd3',
    company: 'Augsburg Utilities',
    contact: 'Mr. Vogt · Housing Dept',
    meetingTime: 'Fri 15:15',
    status: 'Dossier ready',
    profile: [
      { label: 'Type', value: 'Municipal utilities / housing arm' },
      { label: 'Portfolio', value: '~9,500 units' },
      { label: 'Region', value: 'Bavaria' },
      { label: 'Relevance', value: 'Medium-high · pilot suited' },
    ],
    signals: [
      'Municipal decarbonisation plan active',
      'Tenant-facing energy initiatives mentioned in public materials',
      'Likely procurement concern: compliance and mounting liability',
    ],
    talkingPoints: [
      'Lead with controlled 40-unit pilot',
      'Prepare certificate and mounting documentation',
      'Offer phased scale-up after pilot results',
    ],
  },
];

export const CALL_ANALYSES: CallAnalysis[] = [
  {
    id: 'c1',
    company: 'Augsburg Utilities',
    contact: 'Mr. Vogt',
    date: 'Jun 19, 2026',
    duration: '42 min',
    sentiment: 'Positive',
    closeProbability: 'High',
    talkRatio: '72 / 28',
    summary:
      'Discussed a 40-unit tenant-power pilot. Client sees a Q3 budget release as realistic. Inverter certification and delivery time were the main questions. Follow-up quote promised.',
    actionItems: [
      {
        id: 'a1',
        label: 'Send tiered quote for 40 units by Friday',
        done: true,
      },
      {
        id: 'a2',
        label: 'Attach micro-inverter certificates',
        done: false,
      },
      {
        id: 'a3',
        label: 'Propose Q3 follow-up meeting',
        done: false,
      },
    ],
  },
  {
    id: 'c2',
    company: 'Northern Homebuild Co-op',
    contact: 'Ms. Petersen',
    date: 'Jun 17, 2026',
    duration: '31 min',
    sentiment: 'Positive',
    closeProbability: 'High',
    talkRatio: '64 / 36',
    summary:
      'Client confirmed interest in a 120-unit framework order. Main discussion focused on delivery window, warranty handling, and first installation batch.',
    actionItems: [
      {
        id: 'a4',
        label: 'Send final framework contract',
        done: true,
      },
      {
        id: 'a5',
        label: 'Confirm first batch delivery timing',
        done: true,
      },
    ],
  },
  {
    id: 'c3',
    company: 'ProImmo Mgmt',
    contact: 'Ms. Wagner',
    date: 'Jun 15, 2026',
    duration: '19 min',
    sentiment: 'Neutral',
    closeProbability: 'Medium',
    talkRatio: '55 / 45',
    summary:
      'Client requested pricing only and was not ready to commit to a meeting. Storage option remains the main decision point.',
    actionItems: [
      {
        id: 'a6',
        label: 'Send pricing comparison with and without storage',
        done: false,
      },
      {
        id: 'a7',
        label: 'Follow up after 5 working days',
        done: false,
      },
    ],
  },
];