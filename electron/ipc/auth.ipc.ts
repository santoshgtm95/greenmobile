import { handle } from './registry';
import { CHANNELS } from '../../shared/channels';
import { zLogin, zFirstRunSetup, zChangeOwnPassword, zNoPayload } from '../../shared/validation';
import {
  authStatus,
  login,
  logout,
  completeFirstRunSetup,
  changeOwnPassword,
} from '../services/auth.service';
import { requireUser } from '../session';

export function registerAuthIpc(): void {
  handle(CHANNELS.auth.status, { access: 'public' }, zNoPayload, () => authStatus());

  handle(CHANNELS.auth.login, { access: 'public' }, zLogin, (input) => login(input));

  // Signing out needs a session to sign out of. Public would make it a no-op
  // that anyone could call, which widens the pre-login surface for nothing.
  handle(CHANNELS.auth.logout, { access: 'authenticated' }, zNoPayload, () => {
    logout();
  });

  handle(CHANNELS.auth.completeFirstRunSetup, { access: 'public' }, zFirstRunSetup, (input) =>
    completeFirstRunSetup(input),
  );

  handle(CHANNELS.auth.changeOwnPassword, { access: 'authenticated' }, zChangeOwnPassword, (input) => {
    changeOwnPassword(input, requireUser());
  });
}
