/**
 * The only bridge between the renderer and the main process.
 *
 * Runs with sandbox: true, so it may use nothing but Electron's own
 * contextBridge/ipcRenderer. No fs, no child_process, no database handle and no
 * process object is ever handed to React — only the channels listed in
 * shared/channels.ts.
 *
 * WHY THIS RETURNS AN ENVELOPE RATHER THAN THROWING
 *
 * contextBridge serialises values structurally: a custom Error subclass thrown
 * here reaches the renderer with its message but WITHOUT its own properties, so
 * an error `code` would silently arrive as undefined. Every handler therefore
 * resolves with a plain { ok, data } | { ok, error } object, and src/lib/api.ts
 * turns that back into a typed throw inside the renderer's own realm — where the
 * code, message and field errors all survive intact.
 */
import { contextBridge, ipcRenderer } from 'electron';
import { CHANNELS } from '../shared/channels';
import type { IpcResult } from '../shared/errors';

type BridgeFn = (payload?: unknown) => Promise<IpcResult<unknown>>;

/**
 * Builds the bridge from the manifest. Channel names come only from CHANNELS —
 * the renderer can never supply one — and each call forwards exactly one
 * argument, so there is no positional payload that escapes validation.
 */
function buildBridge(): Record<string, Record<string, BridgeFn>> {
  const bridge: Record<string, Record<string, BridgeFn>> = {};

  for (const [namespace, methods] of Object.entries(CHANNELS)) {
    bridge[namespace] = {};
    for (const [method, channel] of Object.entries(methods)) {
      bridge[namespace][method] = (payload?: unknown) =>
        ipcRenderer.invoke(channel, payload) as Promise<IpcResult<unknown>>;
    }
  }

  return bridge;
}

contextBridge.exposeInMainWorld('posBridge', buildBridge());
