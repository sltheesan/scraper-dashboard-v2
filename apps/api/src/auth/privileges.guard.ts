import { Injectable, CanActivate, ExecutionContext, SetMetadata } from '@nestjs/common';
import { Reflector } from '@nestjs/core';

export const PRIVILEGES_KEY = 'privileges';
export const Privileges = (...privileges: string[]) => SetMetadata(PRIVILEGES_KEY, privileges);

@Injectable()
export class PrivilegesGuard implements CanActivate {
  constructor(private reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const required = this.reflector.getAllAndOverride<string[]>(PRIVILEGES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!required || required.length === 0) return true;

    const { user } = context.switchToHttp().getRequest();
    if (!user) return false;

    if (user.isSuperAdmin) return true;

    const userPrivileges: string[] = user.privileges || [];
    return required.some((p) => userPrivileges.includes(p));
  }
}
