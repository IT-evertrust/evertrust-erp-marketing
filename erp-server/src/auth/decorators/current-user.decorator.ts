import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import type { Request } from 'express';
import type { AuthUser } from '../auth.types';

// Param decorator that pulls the authenticated principal (set on req.user by
// JwtStrategy) into a handler argument: `me(@CurrentUser() user: AuthUser)`.
export const CurrentUser = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): AuthUser | undefined => {
    const req = ctx.switchToHttp().getRequest<Request>();
    return req.user as AuthUser | undefined;
  },
);
