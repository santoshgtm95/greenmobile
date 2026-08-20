/**
 * Staff accounts over the bridge (spec §30, §31).
 *
 * Reading needs `users.view`, which a manager has — a manager needs to know who
 * rang up a sale. Every write needs `users.manage`, which only an administrator
 * has: creating accounts, changing roles and resetting passwords are how someone
 * would grant themselves more access than they were given.
 */
import { handle } from './registry';
import { CHANNELS } from '../../shared/channels';
import {
  zCreateUser,
  zUpdateUser,
  zResetPassword,
  zIdOnly,
  zLookupQuery,
} from '../../shared/validation';
import {
  listUsers,
  getUser,
  createUser,
  updateUser,
  deleteUser,
  activeAdminCount,
} from '../services/user.service';
import { resetPassword } from '../services/auth.service';
import { requireUser } from '../session';

export function registerUsersIpc(): void {
  /**
   * The staff list.
   *
   * `activeAdmins` travels with it so the screen can disable the controls that
   * would lock the shop out. The main process refuses those changes regardless —
   * this only spares the user from being told no after trying.
   */
  handle(
    CHANNELS.users.list,
    { access: 'permission', permission: 'users.view' },
    zLookupQuery,
    ({ includeInactive }) => ({
      rows: listUsers({ includeInactive }),
      activeAdmins: activeAdminCount(),
    }),
  );

  handle(CHANNELS.users.get, { access: 'permission', permission: 'users.view' }, zIdOnly, ({ id }) =>
    getUser(id),
  );

  handle(
    CHANNELS.users.create,
    { access: 'permission', permission: 'users.manage' },
    zCreateUser,
    (input) => createUser(input, requireUser()),
  );

  handle(
    CHANNELS.users.update,
    { access: 'permission', permission: 'users.manage' },
    zUpdateUser,
    (input) => updateUser(input, requireUser()),
  );

  /**
   * Resets someone else's password (spec §30).
   *
   * The administrator re-enters their own password, so an unattended session
   * cannot be used to take over an account. That check lives in auth.service.
   */
  handle(
    CHANNELS.users.resetPassword,
    { access: 'permission', permission: 'users.manage' },
    zResetPassword,
    (input) => {
      resetPassword(input, requireUser());
      return { reset: true as const };
    },
  );

  /**
   * Removes an account, or deactivates it when it is named in trading history.
   *
   * A user changing their *own* password is auth:changeOwnPassword — it needs no
   * permission beyond a session, so it does not belong in this namespace.
   */
  handle(
    CHANNELS.users.delete,
    { access: 'permission', permission: 'users.manage' },
    zIdOnly,
    ({ id }) => deleteUser(id, requireUser()),
  );
}
