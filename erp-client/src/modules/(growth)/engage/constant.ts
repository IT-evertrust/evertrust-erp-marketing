import type { CampaignReply, EngageCampaign } from './types';

export const ENGAGE_CAMPAIGNS: EngageCampaign[] = [
  {
    id: 'housing',
    name: 'Housing Co-ops ≥ 500 units',
    niche: 'Housing',
    region: 'Bavaria',
    replies: 0,
    status: 'NEW',
  },
  {
    id: 'nrw',
    name: 'Property Mgmt Firms (Metro)',
    niche: 'Property Mgmt',
    region: 'NRW',
    replies: 3,
    status: 'IN CAMPAIGN',
  },
  {
    id: 'muni',
    name: 'Municipal Utilities w/ Housing Arm',
    niche: 'Municipality',
    region: 'DE',
    replies: 2,
    status: 'IN CAMPAIGN',
  },
  {
    id: 'inst',
    name: 'Installers (Resale)',
    niche: 'Installer',
    region: 'DE-South',
    replies: 2,
    status: 'OVER',
  },
  {
    id: 'fm',
    name: 'Facility Management Groups',
    niche: 'Property Mgmt',
    region: 'Bavaria',
    replies: 1,
    status: 'IN CAMPAIGN',
  },
  {
    id: 'wholesale',
    name: 'Electrical Wholesalers',
    niche: 'Wholesale',
    region: 'NRW',
    replies: 2,
    status: 'OVER',
  },
];

export const ENGAGE_REPLIES: Record<string, CampaignReply[]> = {
  housing: [],

  nrw: [
    {
      id: 'r1',
      campaignId: 'nrw',
      company: 'HV Rheinland GmbH',
      contact: 'Mr. Schmitz · Portfolio Manager',
      time: '2h',
      category: 'INTERESTED',
      inboundPreview:
        'Interesting — could you send a quote for 120 units? Storage optional...',
      inboundBody:
        'Interesting — could you send a quote for 120 units? Storage optional, please include delivery times.',
      draftSubject: 'Re: 600W balcony solar kits - next steps',
      draftBody:
        'Dear Mr. Schmitz,\n\nThank you for your interest. For 120 units, I will prepare a tiered quote including delivery times. Would Thursday at 14:00 suit a short call?\n\nBest regards,\nEvertrust Growth Engine',
      thread: [
        {
          id: 't1',
          direction: 'outbound',
          header: 'SALOOT → HV RHEINLAND GMBH · COLD OUTREACH · MON 09:00',
          subject: '600W balcony solar kits - bulk pricing for your units',
          body:
            'Dear Mr. Schmitz,\n\nWe supply 600W balcony solar kits with integrated micro-inverters. For orders from 100 units, we offer tiered pricing and optional mounting-partner referrals.\n\nWould it be worth a brief look for HV Rheinland GmbH?\n\nBest regards,\nSaloot Sales Team',
        },
        {
          id: 't2',
          direction: 'outbound',
          header: 'SALOOT → HV RHEINLAND GMBH · FOLLOW UP · THU 09:00',
          subject: 'Re: 600W balcony solar kits - following up',
          body:
            'Dear Mr. Schmitz,\n\nJust circling back. I can prepare tiered pricing and delivery times tailored to your portfolio.\n\nShall I send it over?\n\nBest regards,\nSaloot Sales Team',
        },
        {
          id: 't3',
          direction: 'inbound',
          header: 'HV RHEINLAND GMBH → SALOOT · 2h',
          subject: 'Re: 600W balcony solar kits - following up',
          body:
            'Hi,\n\nInteresting — could you send a quote for 120 units? Storage optional, please include delivery times.\n\nBest,\nMr. Schmitz',
        },
      ],
    },
    {
      id: 'r2',
      campaignId: 'nrw',
      company: 'ProImmo Mgmt',
      contact: 'Ms. Wagner · Asset Management',
      time: '5h',
      category: 'UNSURE',
      inboundPreview: 'What does a 600W set incl. storage cost at 50 units?',
      inboundBody: 'What does a 600W set incl. storage cost at 50 units?',
      draftSubject: 'Re: 600W balcony solar kits - pricing indication',
      draftBody:
        'Dear Ms. Wagner,\n\nAt 50 units, the 600W set including storage sits in the mid-tier bracket. I can send the exact tiered breakdown. Should I include mounting options as well?\n\nBest regards,\nEvertrust Growth Engine',
      thread: [
        {
          id: 't4',
          direction: 'outbound',
          header: 'SALOOT → PROIMMO MGMT · COLD OUTREACH · MON 09:00',
          subject: '600W balcony solar kits - bulk pricing for your units',
          body:
            'Dear Ms. Wagner,\n\nWe supply 600W balcony solar kits with optional storage and tiered pricing for property portfolios.\n\nWould you like a pricing indication?\n\nBest regards,\nSaloot Sales Team',
        },
        {
          id: 't5',
          direction: 'inbound',
          header: 'PROIMMO MGMT → SALOOT · 5h',
          subject: 'Re: 600W balcony solar kits - pricing indication',
          body:
            'Hi,\n\nWhat does a 600W set incl. storage cost at 50 units?\n\nBest,\nMs. Wagner',
        },
      ],
    },
    {
      id: 'r3',
      campaignId: 'nrw',
      company: 'Verwaltung Ruhr24',
      contact: 'Ms. Yilmaz · Office',
      time: '1d',
      category: 'NOT INTERESTED',
      inboundPreview: 'Please remove us from your list.',
      inboundBody: 'Please remove us from your list.',
      draftSubject: 'Re: Removal from list',
      draftBody:
        'Understood — I have removed you from the list. Apologies for the interruption.\n\nBest regards,\nEvertrust Growth Engine',
      thread: [
        {
          id: 't6',
          direction: 'outbound',
          header: 'SALOOT → VERWALTUNG RUHR24 · COLD OUTREACH',
          subject: '600W balcony solar kits - portfolio pricing',
          body:
            'Dear Ms. Yilmaz,\n\nWe supply 600W balcony solar kits for property portfolios.\n\nWould this be relevant for your team?\n\nBest regards,\nSaloot Sales Team',
        },
        {
          id: 't7',
          direction: 'inbound',
          header: 'VERWALTUNG RUHR24 → SALOOT · 1d',
          subject: 'Re: 600W balcony solar kits',
          body: 'Please remove us from your list.',
        },
      ],
    },
  ],

  muni: [
    {
      id: 'r4',
      campaignId: 'muni',
      company: 'Augsburg Utilities',
      contact: 'Mr. Vogt · Housing Dept',
      time: '3h',
      category: 'INTERESTED',
      inboundPreview: 'Happy to — does Thursday work for a short call?',
      inboundBody: 'Happy to — does Thursday work for a short call?',
      draftSubject: 'Re: Short call Thursday',
      draftBody:
        'Dear Mr. Vogt,\n\nThursday works. I can send a calendar invite for 14:00 with a short agenda. Talk soon.\n\nBest regards,\nEvertrust Growth Engine',
      thread: [
        {
          id: 't8',
          direction: 'outbound',
          header: 'SALOOT → AUGSBURG UTILITIES · FOLLOW UP',
          subject: '600W balcony solar kits - municipal housing',
          body:
            'Dear Mr. Vogt,\n\nWe can support municipal housing portfolios with balcony solar kits and tiered project pricing.\n\nWould a short call make sense?\n\nBest regards,\nSaloot Sales Team',
        },
        {
          id: 't9',
          direction: 'inbound',
          header: 'AUGSBURG UTILITIES → SALOOT · 3h',
          subject: 'Re: 600W balcony solar kits - municipal housing',
          body: 'Happy to — does Thursday work for a short call?',
        },
      ],
    },
    {
      id: 'r5',
      campaignId: 'muni',
      company: 'City of Ulm Properties',
      contact: 'Ms. Braun · Facilities',
      time: '1d',
      category: 'UNSURE',
      inboundPreview: 'How is mounting handled on older balconies?',
      inboundBody: 'How is mounting handled on older balconies?',
      draftSubject: 'Re: Mounting on older balconies',
      draftBody:
        'Dear Ms. Braun,\n\nMounting is typically handled through adjustable rail clamps that fit older balcony railings without drilling. I can send the mounting specification sheet if useful.\n\nBest regards,\nEvertrust Growth Engine',
      thread: [
        {
          id: 't10',
          direction: 'outbound',
          header: 'SALOOT → CITY OF ULM PROPERTIES · COLD OUTREACH',
          subject: 'Balcony solar for municipal housing stock',
          body:
            'Dear Ms. Braun,\n\nWe support larger housing portfolios with plug-and-play balcony solar kits.\n\nWould this be relevant for your 2026 planning?\n\nBest regards,\nSaloot Sales Team',
        },
        {
          id: 't11',
          direction: 'inbound',
          header: 'CITY OF ULM PROPERTIES → SALOOT · 1d',
          subject: 'Re: Balcony solar for municipal housing stock',
          body: 'How is mounting handled on older balconies?',
        },
      ],
    },
  ],

  inst: [
    {
      id: 'r6',
      campaignId: 'inst',
      company: 'Sonnenschein Electric',
      contact: 'Mr. Klein · Owner',
      time: '4h',
      category: 'INTERESTED',
      inboundPreview: 'We could resell these — what are the margins?',
      inboundBody: 'We could resell these — what are the margins?',
      draftSubject: 'Re: Reseller margins',
      draftBody:
        'Dear Mr. Klein,\n\nReseller margins start in the double digits and scale with volume. I can send the partner terms and a sample order structure.\n\nBest regards,\nEvertrust Growth Engine',
      thread: [
        {
          id: 't12',
          direction: 'outbound',
          header: 'SALOOT → SONNENSCHEIN ELECTRIC · COLD OUTREACH',
          subject: 'Balcony-solar reseller terms',
          body:
            'Dear Mr. Klein,\n\nWe are onboarding selected electrical partners for balcony-solar resale. Would reseller terms be relevant for your team?\n\nBest regards,\nSaloot Sales Team',
        },
        {
          id: 't13',
          direction: 'inbound',
          header: 'SONNENSCHEIN ELECTRIC → SALOOT · 4h',
          subject: 'Re: Balcony-solar reseller terms',
          body: 'We could resell these — what are the margins?',
        },
      ],
    },
  ],

  fm: [],
  wholesale: [],
};