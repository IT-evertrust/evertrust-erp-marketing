import { createZodDto } from 'nestjs-zod';
import {
  GoogleCodeLoginDto as GoogleCodeLoginSchema,
  GoogleLoginDto as GoogleLoginSchema,
  LoginDto as LoginSchema,
} from '@evertrust/shared';

// Nest-consumable DTO class generated from the shared Zod schema. The global
// ZodValidationPipe validates request bodies against it, so the Zod schema in
// @evertrust/shared is the single contract for client + server.
export class LoginBodyDto extends createZodDto(LoginSchema) {}

// POST /auth/google body: the Google ID token (the JWT credential from Google
// Identity Services). Same single-source-of-truth pattern as LoginBodyDto.
export class GoogleLoginBodyDto extends createZodDto(GoogleLoginSchema) {}

// POST /auth/google/code body: the GIS authorization code (popup/postmessage
// flow). Exchanged server-side for an ID token, then provisioned exactly like
// the idToken path. Same single-source-of-truth pattern.
export class GoogleCodeLoginBodyDto extends createZodDto(
  GoogleCodeLoginSchema,
) {}
