import { createZodDto } from 'nestjs-zod';
import {
  CreateLineItemDto as CreateLineItemSchema,
  CreatePriceObservationDto as CreatePriceObservationSchema,
  UpdateLineItemDto as UpdateLineItemSchema,
  UpsertPricingDto as UpsertPricingSchema,
} from '@evertrust/shared';

// nestjs-zod request DTOs for the Phase 5a pricing core — validated by the global
// ZodValidationPipe against the single-source-of-truth schemas in @evertrust/shared.
export class CreateLineItemBodyDto extends createZodDto(CreateLineItemSchema) {}
export class UpdateLineItemBodyDto extends createZodDto(UpdateLineItemSchema) {}
export class CreatePriceObservationBodyDto extends createZodDto(
  CreatePriceObservationSchema,
) {}
export class UpsertPricingBodyDto extends createZodDto(UpsertPricingSchema) {}
