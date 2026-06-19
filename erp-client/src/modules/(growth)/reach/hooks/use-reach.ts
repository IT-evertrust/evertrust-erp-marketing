'use client';

import { useMemo, useState } from 'react';

import {
  getCampaignEmails,
  getCampaignLeads,
  getDailySends,
  getReachCampaigns,
  getSenderSchedule,
} from '../services/reach.service';
import type { Campaign, NewCampaignFormValues, ReachTab } from '../types';

export function useReach() {
  const initialCampaigns = useMemo(() => getReachCampaigns(), []);

  const [campaigns, setCampaigns] = useState<Campaign[]>(initialCampaigns);
  const [activeTab, setActiveTab] = useState<ReachTab>('scraper');
  const [selectedCampaignId, setSelectedCampaignId] = useState(
    initialCampaigns[0]?.id ?? '',
  );
  const [isCampaignFormOpen, setIsCampaignFormOpen] = useState(false);

  const selectedCampaign = campaigns.find(
    (campaign) => campaign.id === selectedCampaignId,
  );

  const leads = useMemo(
    () => getCampaignLeads(selectedCampaignId),
    [selectedCampaignId],
  );

  const emails = useMemo(
    () => getCampaignEmails(selectedCampaignId),
    [selectedCampaignId],
  );

  const senderSchedule = useMemo(() => getSenderSchedule(), []);
  const dailySends = useMemo(() => getDailySends(), []);

  function openCampaignForm() {
    setIsCampaignFormOpen(true);
  }

  function closeCampaignForm() {
    setIsCampaignFormOpen(false);
  }

  function createCampaign(values: NewCampaignFormValues) {
    const newCampaign: Campaign = {
      id: `campaign-${Date.now()}`,
      name: values.name,
      niche: values.niche,
      region: values.region,
      companies: 0,
      status: 'NEW',
    };

    setCampaigns((current) => [newCampaign, ...current]);
    setSelectedCampaignId(newCampaign.id);
    setActiveTab('scraper');
    setIsCampaignFormOpen(false);
  }

  return {
    activeTab,
    setActiveTab,

    campaigns,
    selectedCampaignId,
    setSelectedCampaignId,
    selectedCampaign,

    leads,
    emails,
    senderSchedule,
    dailySends,

    isCampaignFormOpen,
    openCampaignForm,
    closeCampaignForm,
    createCampaign,
  };
}