import { ENGAGE_CAMPAIGNS, ENGAGE_REPLIES } from '../constant';

export function getEngageCampaigns() {
  return ENGAGE_CAMPAIGNS;
}

export function getCampaignReplies(campaignId: string) {
  return ENGAGE_REPLIES[campaignId] ?? [];
}