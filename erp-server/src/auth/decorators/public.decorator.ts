import { SetMetadata } from '@nestjs/common';

// Marks a route as not requiring authentication. The global JwtAuthGuard reads
// this metadata and skips token verification (used by /health and /auth/login).
export const IS_PUBLIC_KEY = 'isPublic';
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);
