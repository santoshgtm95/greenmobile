/**
 * The one place every IPC call passes through.
 *
 * For each channel this enforces, in order:
 *
 *   1. authentication   — a session must exist (unless `public`)
 *   2. authorization    — the session's role must hold the permission
 *   3. validation       — the payload must satisfy a Zod schema; renderer input
 *                         is never trusted (spec §65)
 *   4. execution        — the handler runs with a typed, validated payload
 *   5. sanitisation     — AppErrors reach the user; anything else is logged in
 *                         full and reported as a generic failure (spec §75)
 *
 * Registering a channel without stating its permission is impossible, so a new
 * feature cannot accidentally ship unprotected.
 */
import { ipcMain, type IpcMainInvokeEvent } from 'electron';
import type { z } from 'zod';
import { AppError, errors, type IpcResult } from '../../shared/errors';
import type { Permission } from '../../shared/domain';
import { getSessionUser, requirePermission, requireUser, type SessionUser } from '../session';
import { logger } from '../utils/logger';

export interface HandlerContext {
  /** The signed-in user. Null only on channels declared `public`. */
  user: SessionUser | null;
}

export interface AuthenticatedContext extends HandlerContext {
  user: SessionUser;
}

interface BaseOptions {
  /** Human description used in log lines. */
  description?: string;
}

interface PublicOptions extends BaseOptions {
  /** Reachable before sign-in: login, first-run setup, app info. */
  access: 'public';
}

interface AuthenticatedOptions extends BaseOptions {
  /** Any signed-in user, regardless of role. */
  access: 'authenticated';
}

interface PermissionOptions extends BaseOptions {
  access: 'permission';
  permission: Permission;
}

export type AccessOptions = PublicOptions | AuthenticatedOptions | PermissionOptions;

/**
 * Channels registered so far, with the access level each was registered under.
 *
 * Recorded rather than merely counted so the security review is machine-checked:
 * tests assert that every channel in the manifest has a handler, and that the
 * set of `public` channels is exactly the three that must work before sign-in.
 * A new channel accidentally shipped as public fails the suite.
 */
const registered = new Map<string, AccessOptions>();

/**
 * The window allowed to make IPC calls. Set once the main window exists.
 *
 * The renderer is the only thing that should ever reach these channels. The
 * offscreen print windows run with javascript disabled and no preload, so they
 * cannot call in — but pinning the sender means that stays true even if a future
 * change gives some other window a bridge by accident.
 */
let trustedWebContentsId: number | null = null;

export function trustWebContents(id: number): void {
  trustedWebContentsId = id;
}

function isTrustedSender(event: IpcMainInvokeEvent): boolean {
  // Until a window is registered (only during startup) nothing is trusted.
  if (trustedWebContentsId === null) return false;
  return event.sender.id === trustedWebContentsId;
}

/**
 * Registers a channel whose payload is validated by `schema`.
 *
 * The renderer always sends exactly one argument. Multi-argument APIs are
 * modelled as an object, which keeps validation total — there is no positional
 * argument that can slip through unchecked.
 */
export function handle<TSchema extends z.ZodTypeAny, TResult>(
  channel: string,
  access: AccessOptions,
  schema: TSchema,
  handler: (payload: z.output<TSchema>, ctx: HandlerContext) => TResult | Promise<TResult>,
): void {
  if (registered.has(channel)) {
    throw new Error(`IPC channel "${channel}" is already registered`);
  }
  registered.set(channel, access);

  ipcMain.handle(channel, async (event, rawPayload: unknown): Promise<IpcResult<TResult>> => {
    try {
      if (!isTrustedSender(event)) {
        logger.warn('IPC call from an untrusted sender rejected', {
          channel,
          senderId: event.sender.id,
          url: event.senderFrame?.url,
        });
        throw errors.notAuthorized('use this application');
      }

      const user = authorize(access);

      const parsed = schema.safeParse(rawPayload);
      if (!parsed.success) {
        logger.warn('IPC payload rejected', {
          channel,
          issues: parsed.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
        });
        throw errors.validation('Please check the highlighted fields.', fieldErrors(parsed.error));
      }

      const data = await handler(parsed.data, { user });
      return { ok: true, data };
    } catch (err) {
      return { ok: false, error: toSerializedError(channel, err) };
    }
  });
}

function authorize(access: AccessOptions): SessionUser | null {
  switch (access.access) {
    case 'public':
      return getSessionUser();
    case 'authenticated':
      return requireUser();
    case 'permission':
      return requirePermission(access.permission);
  }
}

function fieldErrors(error: z.ZodError): Record<string, string> {
  const fields: Record<string, string> = {};
  for (const issue of error.issues) {
    const key = issue.path.join('.') || '_';
    if (!fields[key]) fields[key] = issue.message;
  }
  return fields;
}

/**
 * Converts a thrown value into something safe to show a user.
 * AppErrors are already user-facing; everything else is logged with full detail
 * and replaced with a generic message.
 */
function toSerializedError(channel: string, err: unknown) {
  if (err instanceof AppError) {
    // Expected, business-rule failures are logged at info level only.
    logger.info('IPC rejected', { channel, code: err.code, message: err.message });
    return err.toSerialized();
  }

  logger.error('Unhandled error in IPC handler', {
    channel,
    error: err instanceof Error ? { message: err.message, stack: err.stack } : String(err),
  });

  // SQLite constraint violations are common enough to translate helpfully.
  const message = err instanceof Error ? err.message : String(err);
  if (/UNIQUE constraint failed/i.test(message)) {
    return errors.duplicate('That value').toSerialized();
  }
  if (/FOREIGN KEY constraint failed/i.test(message)) {
    return errors
      .inUse('This record')
      .toSerialized();
  }
  if (/SQLITE_(BUSY|LOCKED)/i.test(message)) {
    return new AppError('DATABASE', 'The database is busy. Please try again.').toSerialized();
  }

  return errors.database().toSerialized();
}

/** For diagnostics and the security review (spec Phase 16). */
export function registeredChannels(): string[] {
  return [...registered.keys()].sort();
}

/**
 * The access level each channel was registered under.
 *
 * This is what makes "every channel is protected" a testable statement rather
 * than a comment: the security suite reads this map back and asserts the shape
 * of the exposed surface.
 */
export function channelAccessLevels(): Record<string, AccessOptions> {
  return Object.fromEntries(registered);
}
