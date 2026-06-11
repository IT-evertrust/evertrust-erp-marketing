'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  CreateLineItemDto,
  CreatePriceObservationDto,
  LineItemDto,
  PriceAssistResultDto,
  PriceObservationDto,
  TenderPricingDto,
  UpdateLineItemDto,
  UpsertPricingDto,
} from '@evertrust/shared';
import { ApiError, api } from '@/lib/api';
import { queryKeys } from '@/lib/query-keys';

// Phase 5a pricing workbench hooks. Reads use the same @evertrust/shared engine
// output as the API (suggestedPrice/confidence/signal/risk can't drift). Every
// mutation invalidates the tender's pricing AND line-items so the table, the
// per-line suggestion and the totals panel re-derive together.

// ---- Line items (the LV) ----

// The tender's LV line items. `enabled` off for a falsy id so the page can call
// it unconditionally while route params resolve.
export function useLineItems(tenderId: string | undefined) {
  return useQuery<LineItemDto[], ApiError>({
    queryKey: queryKeys.tenders.lineItems(tenderId ?? ''),
    queryFn: ({ signal }) =>
      api.tenders.listLineItems(tenderId as string, signal),
    enabled: Boolean(tenderId),
  });
}

// Re-fetch the pricing view + line-items list of a tender after a mutation. The
// pricing rollup (subtotal/finalPrice/risk/signalCounts) depends on the lines, so
// the two always invalidate together.
function invalidateTenderPricing(
  queryClient: ReturnType<typeof useQueryClient>,
  tenderId: string,
) {
  void queryClient.invalidateQueries({
    queryKey: queryKeys.tenders.lineItems(tenderId),
  });
  void queryClient.invalidateQueries({
    queryKey: queryKeys.tenders.pricing(tenderId),
  });
}

// Add a line. Invalidates the tender's line-items + pricing.
export function useCreateLineItem(tenderId: string) {
  const queryClient = useQueryClient();
  return useMutation<LineItemDto, ApiError, CreateLineItemDto>({
    mutationFn: (input) => api.tenders.createLineItem(tenderId, input),
    onSuccess: () => invalidateTenderPricing(queryClient, tenderId),
  });
}

// Patch a line (setting bidEp recomputes bidGp server-side). tenderId is passed
// for cache invalidation; the request itself addresses the line by its own id.
export function useUpdateLineItem(tenderId: string) {
  const queryClient = useQueryClient();
  return useMutation<
    LineItemDto,
    ApiError,
    { lineId: string; input: UpdateLineItemDto }
  >({
    mutationFn: ({ lineId, input }) => api.lineItems.update(lineId, input),
    onSuccess: () => invalidateTenderPricing(queryClient, tenderId),
  });
}

// Delete a line. Invalidates the tender's line-items + pricing.
export function useDeleteLineItem(tenderId: string) {
  const queryClient = useQueryClient();
  return useMutation<void, ApiError, string>({
    mutationFn: (lineId) => api.lineItems.delete(lineId),
    onSuccess: () => invalidateTenderPricing(queryClient, tenderId),
  });
}

// ---- Price observations (a line's evidence) ----

// A line's price observations. `enabled` lets callers fetch only when a row is
// expanded (lineId set), so the table doesn't fan out N requests on first paint.
export function useLineItemObservations(lineId: string | undefined) {
  return useQuery<PriceObservationDto[], ApiError>({
    queryKey: queryKeys.lineItems.observations(lineId ?? ''),
    queryFn: ({ signal }) =>
      api.lineItems.listObservations(lineId as string, signal),
    enabled: Boolean(lineId),
  });
}

// Add an observation to a line. Invalidates that line's observations AND the
// tender's pricing/line-items (the suggestion + signal recompute from evidence).
export function useAddObservation(tenderId: string, lineId: string) {
  const queryClient = useQueryClient();
  return useMutation<PriceObservationDto, ApiError, CreatePriceObservationDto>({
    mutationFn: (input) => api.lineItems.addObservation(lineId, input),
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: queryKeys.lineItems.observations(lineId),
      });
      invalidateTenderPricing(queryClient, tenderId);
    },
  });
}

// Phase 5b — ask Claude for a price suggestion for one line. A MUTATION (it makes
// a model call + logs an ai_runs row), not a query, and it does NOT invalidate
// pricing: the suggestion never mutates the line. Accepting it goes through
// useAddObservation (AI_ESTIMATE), which handles invalidation. The result carries
// its own { configured, suggestion, error } so callers branch on it, not on throw.
export function usePriceAssist(lineId: string) {
  return useMutation<PriceAssistResultDto, ApiError, void>({
    mutationFn: () => api.lineItems.priceAssist(lineId),
  });
}

// Delete an observation. Same invalidation as add — the line's evidence and the
// tender rollup both change.
export function useDeleteObservation(tenderId: string, lineId: string) {
  const queryClient = useQueryClient();
  return useMutation<void, ApiError, string>({
    mutationFn: (obsId) => api.priceObservations.delete(obsId),
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: queryKeys.lineItems.observations(lineId),
      });
      invalidateTenderPricing(queryClient, tenderId);
    },
  });
}

// ---- Tender pricing (rollup + margin + finalize) ----

// The whole-tender pricing view (per-line engine output + totals + risk +
// signal histogram). `enabled` off for a falsy id while route params resolve.
export function useTenderPricing(tenderId: string | undefined) {
  return useQuery<TenderPricingDto, ApiError>({
    queryKey: queryKeys.tenders.pricing(tenderId ?? ''),
    queryFn: ({ signal }) => api.tenders.getPricing(tenderId as string, signal),
    enabled: Boolean(tenderId),
  });
}

// Set the margin %. Seeds the pricing cache with the fresh rollup the server
// returns (finalPrice recomputed) so the totals panel updates immediately.
export function useSetMargin(tenderId: string) {
  const queryClient = useQueryClient();
  return useMutation<TenderPricingDto, ApiError, UpsertPricingDto>({
    mutationFn: (input) => api.tenders.setMargin(tenderId, input),
    onSuccess: (pricing) => {
      queryClient.setQueryData(queryKeys.tenders.pricing(tenderId), pricing);
    },
  });
}

// Finalize: locks pricing FINAL and moves the tender to CUSTOMER_PRICING. Seeds
// the pricing cache and invalidates the tender detail + lists so the new status
// is reflected everywhere.
export function useFinalizePricing(tenderId: string) {
  const queryClient = useQueryClient();
  return useMutation<TenderPricingDto, ApiError, void>({
    mutationFn: () => api.tenders.finalizePricing(tenderId),
    onSuccess: (pricing) => {
      queryClient.setQueryData(queryKeys.tenders.pricing(tenderId), pricing);
      queryClient.setQueryData(
        queryKeys.tenders.lineItems(tenderId),
        pricing.lines.map((l) => l.lineItem),
      );
      void queryClient.invalidateQueries({
        queryKey: queryKeys.tenders.detail(tenderId),
      });
      void queryClient.invalidateQueries({
        queryKey: queryKeys.tenders.list(),
      });
    },
  });
}
