import path from 'node:path';
import { dialog, nativeImage } from 'electron';
import { handle } from './registry';
import { CHANNELS } from '../../shared/channels';
import { zNoPayload, zUpdateSettings } from '../../shared/validation';
import { getAllRaw, getShopSettings, setSettings } from '../services/settings.service';
import { recordAudit } from '../services/audit.service';
import { requireUser } from '../session';
import { errors } from '../../shared/errors';
import { logger } from '../utils/logger';
import {
  PUBLIC_SETTING_KEYS,
  settingValueLimit,
  type SettingKey,
} from '../../shared/settings';

/**
 * The longest edge a stored logo may have.
 *
 * It is printed at 18 mm on an invoice and drawn at 72 px on the sign-in screen,
 * so 512 px is already more than any of those need at print resolution. The point
 * of the limit is the database: a shop picking a 12-megapixel photo would other-
 * wise inline several megabytes into every backup and every settings read.
 */
const MAX_LOGO_EDGE = 512;

export function registerSettingsIpc(): void {
  /**
   * The shop-wide values every screen needs to render prices and receipts.
   * Available to any signed-in user — a cashier cannot show a total without it.
   */
  handle(CHANNELS.settings.getShop, { access: 'authenticated' }, zNoPayload, () => getShopSettings());

  /**
   * The full raw map. Non-admins receive only the non-sensitive subset, so a
   * cashier's renderer never holds values like the backup path.
   */
  handle(CHANNELS.settings.getAll, { access: 'authenticated' }, zNoPayload, (_payload, ctx) => {
    const all = getAllRaw();
    if (ctx.user?.role === 'ADMIN') return all;

    const limited: Partial<Record<SettingKey, string>> = {};
    for (const key of PUBLIC_SETTING_KEYS) limited[key] = all[key];
    return limited;
  });

  handle(CHANNELS.settings.update, { access: 'permission', permission: 'settings.manage' }, zUpdateSettings, (input) => {
    const actor = requireUser();
    const before = getAllRaw();

    setSettings(input.values, actor.id);

    const changed: Record<string, { from: string; to: string }> = {};
    for (const [key, value] of Object.entries(input.values)) {
      const previous = before[key as SettingKey];
      if (previous !== value) changed[key] = { from: previous, to: value };
    }

    recordAudit({
      userId: actor.id,
      action: 'SETTINGS_UPDATE',
      entityName: 'Setting',
      summary: `Updated ${Object.keys(changed).length} setting(s)`,
      oldValues: Object.fromEntries(Object.entries(changed).map(([k, v]) => [k, v.from])),
      newValues: Object.fromEntries(Object.entries(changed).map(([k, v]) => [k, v.to])),
    });

    return getShopSettings();
  });

  /**
   * Picks an image file and turns it into something storable (spec §58).
   *
   * The conversion happens here rather than in the renderer for two reasons: the
   * renderer has no file access at all by design, and nativeImage is the only
   * image decoder already in the process. It doubles as the validator — a file
   * that is not really an image, whatever its extension, decodes to an empty
   * image and is refused.
   *
   * Writes nothing. The screen previews what comes back and saves it through
   * settings.update like any other value, so one code path does the storing.
   */
  handle(
    CHANNELS.settings.chooseLogo,
    { access: 'permission', permission: 'settings.manage' },
    zNoPayload,
    async () => {
      const picked = await dialog.showOpenDialog({
        title: 'Choose a logo image',
        properties: ['openFile'],
        filters: [{ name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'webp'] }],
      });

      if (picked.canceled || picked.filePaths.length === 0) return null;
      const file = picked.filePaths[0];

      let image = nativeImage.createFromPath(file);
      if (image.isEmpty()) {
        throw errors.validation(
          'That file could not be read as an image. Choose a PNG, JPEG or WebP file.',
        );
      }

      const { width, height } = image.getSize();
      // Downscale the long edge and let the other follow, so nothing is squashed.
      if (Math.max(width, height) > MAX_LOGO_EDGE) {
        image = image.resize(
          width >= height ? { width: MAX_LOGO_EDGE, quality: 'best' } : { height: MAX_LOGO_EDGE, quality: 'best' },
        );
      }

      const dataUri = image.toDataURL();
      const size = image.getSize();

      // A PNG of a photograph can still be large after downscaling; refusing here
      // is better than a save that fails validation with a length message.
      const limit = settingValueLimit('shopLogo');
      if (dataUri.length > limit) {
        throw errors.validation(
          'That image is too detailed to store even after resizing. A simple logo with flat ' +
            'colours, or a smaller image, will work.',
        );
      }

      logger.info('Logo image prepared', {
        file: path.basename(file),
        from: `${width}x${height}`,
        to: `${size.width}x${size.height}`,
        bytes: dataUri.length,
      });

      return {
        dataUri,
        width: size.width,
        height: size.height,
        bytes: dataUri.length,
        fileName: path.basename(file),
      };
    },
  );
}
