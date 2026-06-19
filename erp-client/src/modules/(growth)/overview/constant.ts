import type {
  EngineActivityItem,
  FunnelStage,
  OverviewKpi,
} from './types';

export const FALLBACK_KPIS: OverviewKpi[] = [
  {
    label: 'NEW LEADS',
    value: '1,248',
    delta: '+18%',
    spark: '0,18 14,15 28,16 42,11 56,12 70,7 84,8 100,4',
  },
  {
    label: 'CONTACTED',
    value: '980',
    delta: '+12%',
    spark: '0,16 14,14 28,15 42,12 56,10 70,9 84,7 100,6',
  },
  {
    label: 'REPLY RATE',
    value: '21.8%',
    delta: '+3.1 pp',
    spark: '0,15 14,16 28,12 42,13 56,9 70,10 84,7 100,8',
  },
  {
    label: 'INTERESTED',
    value: '86',
    delta: '+9',
    spark: '0,17 14,15 28,14 42,12 56,11 70,9 84,8 100,5',
  },
  {
    label: 'MEETINGS',
    value: '31',
    delta: '+6',
    spark: '0,16 14,16 28,13 42,14 56,10 70,11 84,9 100,7',
  },
  {
    label: 'PIPELINE VALUE',
    value: '€184.5K',
    delta: '+€42K',
    spark: '0,18 14,17 28,15 42,13 56,12 70,8 84,6 100,3',
  },
];

export const FALLBACK_FUNNEL: FunnelStage[] = [
  { name: 'Reach', value: '1,248', width: 100, conversion: '100%' },
  { name: 'Engage', value: '214', width: 42, conversion: '22%' },
  { name: 'Activate', value: '31', width: 16, conversion: '36%' },
  { name: 'Nurture', value: '86', width: 26, conversion: '40%' },
  { name: 'Won', value: '12', width: 9, conversion: '39%' },
];

export const FALLBACK_ACTIVITY: EngineActivityItem[] = [
  {
    time: '08:42',
    source: 'REACH · SCRAPER',
    message: '42 new targets captured from iBau + housing',
  },
  {
    time: '08:30',
    source: 'REACH · SENDER',
    message: 'Round 2 follow-up sent to 38 contacts',
  },
  {
    time: '08:11',
    source: 'ENGAGE · SORTER',
    message: '3 replies classified as Interested',
  },
  {
    time: '07:58',
    source: 'ACTIVATE · BOOKER',
    message: 'Meeting booked: GeWoBa Bremen, Thu 14:00',
  },
  {
    time: '07:40',
    source: 'REACH · SCRAPER',
    message: '6 tenant-power tenders detected',
  },
  {
    time: '07:22',
    source: 'REACH · GENERATOR',
    message: '54 email drafts created — awaiting approval',
  },
  {
    time: '07:05',
    source: 'ACTIVATE · RESEARCH',
    message: 'Dossier created for WohnQuartier NRW',
  },
  {
    time: '06:48',
    source: 'NURTURE · PIPELINE',
    message: 'Northern Homebuild Co-op moved to Won',
  },
];