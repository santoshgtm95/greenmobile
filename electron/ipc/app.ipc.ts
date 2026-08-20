import { app } from 'electron';
import { handle } from './registry';
import { zNoPayload } from '../../shared/validation';
import { CHANNELS } from '../../shared/channels';
import { userDataDir } from '../utils/paths';
import { needsFirstRunSetup } from '../database';
import type { StartupContext } from '../bootstrap';
import type { AppInfo } from '../../shared/api';

export function registerAppIpc(context: StartupContext): void {
  handle(CHANNELS.app.getInfo, { access: 'public' }, zNoPayload, (): AppInfo => {
    return {
      version: app.getVersion(),
      isPackaged: app.isPackaged,
      userDataDir: userDataDir(),
      databaseFile: context.database.file,
      schemaVersion: context.database.schemaVersion,
      // Read live rather than cached: the wizard creates the admin during this
      // same session, after which setup is no longer required.
      requiresFirstRunSetup: needsFirstRunSetup(context.database.db),
    };
  });
}
