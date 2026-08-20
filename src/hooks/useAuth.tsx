import { api } from '../lib/api';
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import type { AuthStatus, SessionUser } from '@shared/api';
import type { Permission } from '@shared/domain';
import type { LoginInput, FirstRunSetupInput } from '@shared/validation';

interface AuthContextValue {
  user: SessionUser | null;
  permissions: Permission[];
  requiresFirstRunSetup: boolean;
  /** True until the initial status call has resolved. */
  loading: boolean;
  can(permission: Permission): boolean;
  login(input: LoginInput): Promise<void>;
  logout(): Promise<void>;
  completeFirstRunSetup(input: FirstRunSetupInput): Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

/**
 * Holds the signed-in user for the renderer.
 *
 * This is a cache of what the main process already knows, used to decide which
 * screens and buttons to show. It is never the authority: every IPC handler
 * re-checks the session and the permission on its own, so hiding a button is a
 * courtesy, not the security boundary.
 */
export function AuthProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<AuthStatus | null>(null);

  useEffect(() => {
    let cancelled = false;
    void api.auth
      .status()
      .then((next) => {
        if (!cancelled) setStatus(next);
      })
      .catch(() => {
        if (!cancelled) {
          setStatus({ user: null, permissions: [], requiresFirstRunSetup: false });
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const login = useCallback(async (input: LoginInput) => {
    setStatus(await api.auth.login(input));
  }, []);

  const logout = useCallback(async () => {
    await api.auth.logout();
    setStatus(await api.auth.status());
  }, []);

  const completeFirstRunSetup = useCallback(async (input: FirstRunSetupInput) => {
    setStatus(await api.auth.completeFirstRunSetup(input));
  }, []);

  const value = useMemo<AuthContextValue>(() => {
    const permissions = status?.permissions ?? [];
    return {
      user: status?.user ?? null,
      permissions,
      requiresFirstRunSetup: status?.requiresFirstRunSetup ?? false,
      loading: status === null,
      can: (permission) => permissions.includes(permission),
      login,
      logout,
      completeFirstRunSetup,
    };
  }, [status, login, logout, completeFirstRunSetup]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const value = useContext(AuthContext);
  if (!value) throw new Error('useAuth must be used inside <AuthProvider>');
  return value;
}
