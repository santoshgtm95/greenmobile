import type { IpcResult } from '@shared/errors';

declare global {
  interface Window {
    /**
     * The raw bridge exposed by electron/preload.ts. Each method resolves with
     * an { ok, data } | { ok, error } envelope.
     *
     * React code should not use this directly — import { api } from '@/lib/api',
     * which unwraps envelopes into values or typed PosApiError throws.
     */
    readonly posBridge?: Record<string, Record<string, (payload?: unknown) => Promise<IpcResult<unknown>>>>;
  }
}

export {};
