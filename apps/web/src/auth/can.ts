import type { User } from '../api/client';
import { useSession } from './session';

/** Whether the user holds a Control Panel permission. A superuser holds them all. */
export const userCan = (user: User | null | undefined, permission: string): boolean =>
  !!user && (user.is_superuser || user.permissions.includes(permission));

export function useCan(permission: string): boolean {
  return userCan(useSession(), permission);
}
