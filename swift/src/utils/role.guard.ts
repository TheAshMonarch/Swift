// // roles.guard.ts
// import { Injectable, CanActivate, ExecutionContext, ForbiddenException } from '@nestjs/common';
// import { Reflector } from '@nestjs/core';
// import { UserRole } from '../modules/users/users.schema';
// import { ROLES_KEY } from './roles.decorator';

// @Injectable()
// export class RolesGuard implements CanActivate {
//   constructor(private reflector: Reflector) {}

//   canActivate(context: ExecutionContext): boolean {
//     const requiredRoles = this.reflector.getAllAndOverride<UserRole[]>(ROLES_KEY, [
//       context.getHandler(),
//       context.getClass(),
//     ]);

//     // If no roles are required, let the request pass
//     if (!requiredRoles) {
//       return true;
//     }

//     const { user } = context.switchToHttp().getRequest();

//     // ERROR CHECK: If user is missing, it means AuthGuard didn't run or failed
//     if (!user) {
//       throw new ForbiddenException('User context not found. Check if AuthGuard is applied.');
//     }

//     const hasRole = requiredRoles.some((role) => user.role?.includes(role));
    
//     if (!hasRole) {
//       throw new ForbiddenException('You do not have admin permissions');
//     }

//     return true;
//   }
// }