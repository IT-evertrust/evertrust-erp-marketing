'use client';

import { useQuery } from '@tanstack/react-query';
import type { PersonaListDto } from '@evertrust/shared';
import { ApiError, api } from '@/lib/api';
import { queryKeys } from '@/lib/query-keys';

// Coaching personas — Google Docs in the Drive "AI Personas" folder, listed via
// the Sales Agent workflow. Returns { folderUrl, personas:[{id,name}] }. Refetch
// to pick up docs added/removed in the folder.
export function usePersonas() {
  return useQuery<PersonaListDto, ApiError>({
    queryKey: queryKeys.personas.list(),
    queryFn: ({ signal }) => api.personas.list(signal),
  });
}
