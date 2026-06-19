'use client';

import { useEffect, useMemo, useState } from 'react';

import {
  getCampaignReplies,
  getEngageCampaigns,
} from '../services/engage.service';
import type { AiAgentMode } from '../types';

export function useEngage() {
  const campaigns = useMemo(() => getEngageCampaigns(), []);

  const firstCampaignWithReplies =
    campaigns.find((campaign) => campaign.replies > 0) ?? campaigns[0];

  const [selectedCampaignId, setSelectedCampaignId] = useState(
    firstCampaignWithReplies?.id ?? '',
  );

  const replies = useMemo(
    () => getCampaignReplies(selectedCampaignId),
    [selectedCampaignId],
  );

  const [selectedReplyId, setSelectedReplyId] = useState(
    replies[0]?.id ?? '',
  );

  const [aiMode, setAiMode] = useState<AiAgentMode>('write');

  useEffect(() => {
    setSelectedReplyId(replies[0]?.id ?? '');
  }, [selectedCampaignId, replies]);

  const selectedCampaign = campaigns.find(
    (campaign) => campaign.id === selectedCampaignId,
  );

  const selectedReply = replies.find((reply) => reply.id === selectedReplyId);

  const counts = {
    all: replies.length,
    interested: replies.filter((reply) => reply.category === 'INTERESTED')
      .length,
    unsure: replies.filter((reply) => reply.category === 'UNSURE').length,
    notInterested: replies.filter(
      (reply) => reply.category === 'NOT INTERESTED',
    ).length,
  };

  return {
    campaigns,
    selectedCampaignId,
    setSelectedCampaignId,
    selectedCampaign,
    replies,
    selectedReplyId,
    setSelectedReplyId,
    selectedReply,
    counts,
    aiMode,
    setAiMode,
  };
}