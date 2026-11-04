import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import type { Request } from 'express';

export interface AuthUser {
  id: string;
}

export type AuthenticatedRequest = Request & { user: AuthUser };

/** The authenticated user's id, taken from the verified JWT (never from the request body). */
export const CurrentUser = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): AuthUser => {
    return ctx.switchToHttp().getRequest<AuthenticatedRequest>().user;
  },
);
