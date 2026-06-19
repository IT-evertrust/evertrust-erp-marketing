import {
  DAILY_SENDS,
  REACH_CAMPAIGNS,
  REACH_EMAILS,
  REACH_LEADS,
  SENDER_SCHEDULE,
} from '../constant';

export function getReachCampaigns() {
  return REACH_CAMPAIGNS;
}

export function getCampaignLeads(campaignId: string) {
  return REACH_LEADS[campaignId] ?? [];
}

export function getCampaignEmails(campaignId: string) {
  return REACH_EMAILS[campaignId] ?? REACH_EMAILS.wohnbau;
}

export function getSenderSchedule() {
  return SENDER_SCHEDULE;
}

export function getDailySends() {
  return DAILY_SENDS;
}