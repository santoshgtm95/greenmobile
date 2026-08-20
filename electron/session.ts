/**
 * Who is signed in, held in the main process only.
 *
 * The renderer is never trusted to say who it is: it has no way to set this
 * value, and every permission check reads it from here. That means a
 * compromised or buggy renderer cannot escalate its own privileges.
 */
import type { Permission, UserRole } from '../shared/domain';
import { roleHasPermission } from '../shared/domain';
import { errors } from '../shared/errors';

export interface SessionUser {
  id: string;
  username: string;
  fullName: string;
  role: UserRole;
}

let currentUser: SessionUser | null = null;

export function setSessionUser(user: SessionUser | null): void {
  currentUser = user;
}

export function getSessionUser(): SessionUser | null {
  return currentUser;
}

/** Returns the signed-in user or throws the friendly "please sign in" error. */
export function requireUser(): SessionUser {
  if (!currentUser) throw errors.notAuthenticated();
  return currentUser;
}

/** Returns the signed-in user, or throws if they lack the permission. */
export function requirePermission(permission: Permission): SessionUser {
  const user = requireUser();
  if (!roleHasPermission(user.role, permission)) {
    throw errors.notAuthorized(PERMISSION_DESCRIPTIONS[permission] ?? 'perform this action');
  }
  return user;
}

export function sessionHasPermission(permission: Permission): boolean {
  return currentUser ? roleHasPermission(currentUser.role, permission) : false;
}

/** Wording used in the "you do not have permission to …" message. */
const PERMISSION_DESCRIPTIONS: Partial<Record<Permission, string>> = {
  'pos.sell': 'make sales',
  'pos.discount': 'give discounts',
  'sales.cancel': 'cancel sales',
  'sales.refund': 'refund sales',
  'products.manage': 'add or edit products',
  'products.import': 'import products',
  'inventory.adjust': 'adjust stock',
  'customers.manage': 'add or edit customers',
  'services.manage': 'manage service orders',
  'expenses.manage': 'record expenses',
  'expenses.delete': 'delete expenses',
  'reports.view': 'view reports',
  'users.manage': 'manage users',
  'settings.manage': 'change settings',
  'backup.manage': 'manage backups',
  'audit.view': 'view the audit log',
};
