export type AimStatus = 'DRAFT' | 'READY' | 'RUNNING' | 'COMPLETED' | 'FAILED';

export type ReachAim = {
  id: string;
  name: string;
  niche: string;
  region: string;
  segment?: string;
  source?: string;
  status: AimStatus;
  companies: number;
  createdAt: string;
  updatedAt: string;
};

export type ReachLeadStatus =
  | 'NEW'
  | 'COLD_OUTREACHED'
  | 'FOLLOWED_UP'
  | 'INTERESTED'
  | 'UNSURE'
  | 'NOT_INTERESTED';

export type ReachLead = {
  id: string;
  aimId: string;
  company: string;
  contactName?: string;
  contactTitle?: string;
  email?: string;
  phone?: string;
  location?: string;
  source?: string;
  status: ReachLeadStatus;
  createdAt: string;
  updatedAt: string;
};