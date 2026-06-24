import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

import { PipelineStage } from '@evertrust/shared';

// Body for PATCH /growth/reach/leads/:leadId/stage — the Nurture kanban drag. Moves
// a reach lead to another sales-funnel stage. Reuses the shared PipelineStage enum so
// Reach and the (now-retired) prospects board speak the same stages.
export const updateReachLeadStageSchema = z.object({
  stage: PipelineStage,
});
export type UpdateReachLeadStageDto = z.infer<typeof updateReachLeadStageSchema>;
export class UpdateReachLeadStageBodyDto extends createZodDto(
  updateReachLeadStageSchema,
) {}

// Body for PATCH /growth/reach/leads/:leadId/deal — inline-edit the card's deal value
// and contact fields. All optional; only provided fields change.
export const updateReachLeadDealSchema = z.object({
  dealValue: z.number().int().min(0).optional(),
  contactName: z.string().max(200).nullable().optional(),
  contactPhone: z.string().max(80).nullable().optional(),
});
export type UpdateReachLeadDealDto = z.infer<typeof updateReachLeadDealSchema>;
export class UpdateReachLeadDealBodyDto extends createZodDto(
  updateReachLeadDealSchema,
) {}
