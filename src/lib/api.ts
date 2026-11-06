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

/**
 * This browser's session on the main computer (network access, electron/network.ts).
 * Kept for the tab only, so closing it is like signing out.
 * getRandomValues, not randomUUID: the latter is missing on plain-http pages.
 */
function sessionToken(): string {
  const make = () =>
    Array.from(crypto.getRandomValues(new Uint8Array(16)), (b) => b.toString(16).padStart(2, '0')).join('');
  try {
    const saved = sessionStorage.getItem('posSession');
    if (saved) return saved;
    const token = make();
    sessionStorage.setItem('posSession', token);
    return token;
  } catch {
    return (memoryToken ??= make());
  }
}
let memoryToken: string | undefined;

/** Outside Electron the same calls go over the shop network to the main computer. */
function overNetwork(channel: string): BridgeFn {
  return async (payload) => {
    let response: Response;
    try {
      response = await fetch(`./api/${encodeURIComponent(channel)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Pos-Session': sessionToken() },
        body: payload === undefined ? '' : JSON.stringify(payload),
      });
    } catch {
      throw new PosApiError('UNKNOWN', 'Cannot reach the main computer. Check it is on and on the same Wi-Fi.');
    }
    if (!response.ok) throw new PosApiError('UNKNOWN', 'The main computer refused this request.');
    return (await response.json()) as IpcResult<unknown>;
  };
}

function bridge(): Bridge {
  const value = (window as unknown as { posBridge?: Bridge }).posBridge;
  if (value) return value;
  if (!networkBridge) {
    networkBridge = {};
    for (const [namespace, methods] of Object.entries(CHANNELS)) {
      networkBridge[namespace] = {};
      for (const [method, channel] of Object.entries(methods)) networkBridge[namespace][method] = overNetwork(channel);
    }
  }
  return networkBridge;
}
let networkBridge: Bridge | undefined;

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
