/**
 * The typed client every React component uses.
 *
 * The preload bridge resolves with { ok, data } | { ok, error } envelopes,
 * because a thrown Error loses its custom properties when it crosses
 * contextBridge. This module unwraps them inside the renderer's own realm, so a
 * failed call becomes a real PosApiError carrying its code, message and field
 * errors — which is what forms and TanStack Query need.
 *
 *   import { api } from '@/lib/api';
 *   const status = await api.auth.login({ username, password });
 */
import { CHANNELS } from '@shared/channels';
import { PosApiError, type IpcResult } from '@shared/errors';
import type { PosApi } from '@shared/api';

type BridgeFn = (payload?: unknown) => Promise<IpcResult<unknown>>;
type Bridge = Record<string, Record<string, BridgeFn>>;

function bridge(): Bridge {
  const value = (window as unknown as { posBridge?: Bridge }).posBridge;
  if (!value) {
    throw new Error(
      'The application bridge is missing. This build of the renderer must run inside Electron.',
    );
  }
  return value;
}

function unwrap<T>(result: IpcResult<T>): T {
  if (result?.ok) return result.data;
  const error = result?.error;
  throw new PosApiError(
    error?.code ?? 'UNKNOWN',
    error?.message ?? 'Something went wrong. Please try again.',
    error?.fields,
  );
}

/** Mirrors the channel manifest, so the client can never call an unexposed channel. */
function buildClient(): PosApi {
  const client: Record<string, Record<string, (payload?: unknown) => Promise<unknown>>> = {};

  for (const [namespace, methods] of Object.entries(CHANNELS)) {
    client[namespace] = {};
    for (const method of Object.keys(methods)) {
      client[namespace][method] = async (payload?: unknown) => {
        const fn = bridge()[namespace]?.[method];
        if (!fn) {
          throw new PosApiError('UNKNOWN', `The action "${namespace}.${method}" is not available.`);
        }
        return unwrap(await fn(payload));
      };
    }
  }

  return client as unknown as PosApi;
}

export const api: PosApi = buildClient();

/** True when running inside Electron with the bridge present. */
export function isBridgeAvailable(): boolean {
  return Boolean((window as unknown as { posBridge?: Bridge }).posBridge);
}
