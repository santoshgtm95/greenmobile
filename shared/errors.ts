/**
 * Error contract between the main process and the renderer (spec §75).
 *
 * Users see the friendly `message`. Stack traces and SQL never cross the bridge;
 * they go to the log file only. `code` lets the UI react to specific cases
 * (e.g. focus the IMEI field when a serial is already sold).
 */

export const ERROR_CODES = [
  'VALIDATION',
  'NOT_AUTHENTICATED',
  'NOT_AUTHORIZED',
  'NOT_FOUND',
  'CONFLICT',
  'INSUFFICIENT_STOCK',
  'SERIAL_UNAVAILABLE',
  'DUPLICATE',
  'IN_USE',
  'INVALID_CREDENTIALS',
  'INVALID_STATE',
  'PRINT_FAILED',
  'BACKUP_FAILED',
  'RESTORE_FAILED',
  'IMPORT_FAILED',
  'EXPORT_FAILED',
  'DATABASE',
  'UNKNOWN',
] as const;

export type ErrorCode = (typeof ERROR_CODES)[number];

export interface SerializedError {
  code: ErrorCode;
  message: string;
  /** Per-field messages, for form validation. */
  fields?: Record<string, string>;
}

/** Envelope every IPC handler returns. Preload unwraps it into a value or throw. */
export type IpcResult<T> = { ok: true; data: T } | { ok: false; error: SerializedError };

/**
 * An error whose message is safe and useful to show a shop employee.
 * Anything that is not an AppError is reported as a generic failure.
 */
export class AppError extends Error {
  constructor(
    public readonly code: ErrorCode,
    message: string,
    public readonly fields?: Record<string, string>,
  ) {
    super(message);
    this.name = 'AppError';
  }

  toSerialized(): SerializedError {
    return { code: this.code, message: this.message, fields: this.fields };
  }
}

/** Thrown across the bridge in the renderer so callers can try/catch normally. */
export class PosApiError extends Error {
  constructor(
    public readonly code: ErrorCode,
    message: string,
    public readonly fields?: Record<string, string>,
  ) {
    super(message);
    this.name = 'PosApiError';
  }
}

// Constructors for the messages the spec calls out by name (§75).
export const errors = {
  validation: (message = 'Please check the highlighted fields.', fields?: Record<string, string>) =>
    new AppError('VALIDATION', message, fields),
  notAuthenticated: () => new AppError('NOT_AUTHENTICATED', 'Please sign in to continue.'),
  notAuthorized: (what = 'perform this action') =>
    new AppError('NOT_AUTHORIZED', `You do not have permission to ${what}.`),
  notFound: (what = 'record') => new AppError('NOT_FOUND', `That ${what} no longer exists.`),
  productGone: () => new AppError('NOT_FOUND', 'Product no longer exists.'),
  insufficientStock: (productName?: string) =>
    new AppError(
      'INSUFFICIENT_STOCK',
      productName ? `Insufficient stock for ${productName}.` : 'Insufficient stock.',
    ),
  serialUnavailable: (imei?: string) =>
    new AppError('SERIAL_UNAVAILABLE', imei ? `IMEI ${imei} is already sold.` : 'IMEI is already sold.'),
  duplicate: (what: string) => new AppError('DUPLICATE', `${what} is already in use.`),
  inUse: (what: string) =>
    new AppError('IN_USE', `${what} cannot be deleted because it is used by existing records.`),
  invalidCredentials: () =>
    new AppError('INVALID_CREDENTIALS', 'Incorrect username or password.'),
  invalidState: (message: string) => new AppError('INVALID_STATE', message),
  saleFailed: () => new AppError('DATABASE', 'Unable to complete sale.'),
  printFailed: () => new AppError('PRINT_FAILED', 'Unable to print receipt.'),
  backupFailed: (detail?: string) =>
    new AppError('BACKUP_FAILED', detail ? `Backup failed. ${detail}` : 'Backup failed.'),
  restoreFailed: (detail?: string) =>
    new AppError('RESTORE_FAILED', detail ? `Restore failed. ${detail}` : 'Restore failed.'),
  importFailed: (detail?: string) =>
    new AppError('IMPORT_FAILED', detail ? `Import failed. ${detail}` : 'Import failed.'),
  exportFailed: (detail?: string) =>
    new AppError('EXPORT_FAILED', detail ? `Export failed. ${detail}` : 'Export failed.'),
  database: () => new AppError('DATABASE', 'Database error. Please try again.'),
};
