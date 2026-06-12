'use client';

import { useQuery } from '@tanstack/react-query';
import type { ReplyDraftDto } from '@evertrust/shared';
import { ApiError, api } from '@/lib/api';
import { queryKeys } from '@/lib/query-keys';

// The RAG reply-draft review queue: reply_classifications rows that carry a
// suggestedReply, joined to prospect identity. Read-only (there is no server
// "mark handled" endpoint — the reviewer copies the draft / opens the prospect).
export function useReplyDrafts(prospectId?: string) {
  return useQuery<ReplyDraftDto[], ApiError>({
    queryKey: queryKeys.replyDrafts.queue(prospectId),
    queryFn: ({ signal }) =>
      api.replyDrafts.queue({ prospectId, limit: 100 }, signal),
    refetchInterval: 60_000,
  });
}
