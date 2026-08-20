/**
 * Local rotating file logger. No network transport of any kind.
 *
 * Files: %APPDATA%\MobileShopPOS\logs\app-YYYY-MM-DD.log
 * Retention: LOG_RETENTION_DAYS days, pruned on startup.
 *
 * Deliberately has no dependency on Electron: the log directory is injected via
 * configureLogger() during startup. That keeps every module which logs — the
 * whole database and service layer included — runnable under plain Node for
 * tests. Until configured, output goes to the console only.
 *
 * Never log passwords, password hashes, or session tokens.
 */
import fs from 'node:fs';
import path from 'node:path';

const LOG_RETENTION_DAYS = 30;

type Level = 'INFO' | 'WARN' | 'ERROR' | 'DEBUG';

let logDirectory: string | null = null;
let stream: fs.WriteStream | null = null;
let streamDate = '';
let quiet = false;

/** Points the logger at a directory and starts writing files. */
export function configureLogger(directory: string, options: { quiet?: boolean } = {}): void {
  logDirectory = directory;
  quiet = options.quiet ?? false;
  try {
    fs.mkdirSync(directory, { recursive: true });
  } catch {
    logDirectory = null;
  }
}

/** Silences console output. Used by the test suite. */
export function silenceLogger(): void {
  quiet = true;
  logDirectory = null;
}

function today(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function currentStream(): fs.WriteStream | null {
  if (!logDirectory) return null;
  const date = today();
  if (stream && streamDate === date) return stream;
  try {
    stream?.end();
    stream = fs.createWriteStream(path.join(logDirectory, `app-${date}.log`), { flags: 'a' });
    streamDate = date;
    return stream;
  } catch {
    // Logging must never take the application down.
    stream = null;
    return null;
  }
}

function safeStringify(value: unknown): string {
  if (value instanceof Error) {
    return JSON.stringify({ name: value.name, message: value.message, stack: value.stack });
  }
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function write(level: Level, message: string, meta?: unknown): void {
  const time = new Date().toISOString();
  let line = `${time} [${level}] ${message}`;
  if (meta !== undefined) line += ` ${safeStringify(meta)}`;

  if (!quiet) {
    if (level === 'ERROR') console.error(line);
    else if (level === 'WARN') console.warn(line);
    else console.log(line);
  }
  currentStream()?.write(line + '\n');
}

export const logger = {
  info: (message: string, meta?: unknown) => write('INFO', message, meta),
  warn: (message: string, meta?: unknown) => write('WARN', message, meta),
  error: (message: string, meta?: unknown) => write('ERROR', message, meta),
  debug: (message: string, meta?: unknown) => {
    if (process.env.NODE_ENV === 'development') write('DEBUG', message, meta);
  },
  /** Deletes log files older than the retention window. */
  prune(): void {
    if (!logDirectory) return;
    try {
      const cutoff = Date.now() - LOG_RETENTION_DAYS * 86_400_000;
      for (const name of fs.readdirSync(logDirectory)) {
        if (!/^app-\d{4}-\d{2}-\d{2}\.log$/.test(name)) continue;
        const file = path.join(logDirectory, name);
        if (fs.statSync(file).mtimeMs < cutoff) fs.unlinkSync(file);
      }
    } catch (err) {
      write('WARN', 'Log pruning failed', err);
    }
  },
  close(): void {
    stream?.end();
    stream = null;
  },
};
