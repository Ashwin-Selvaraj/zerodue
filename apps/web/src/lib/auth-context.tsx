'use client';

import type { UserDto } from '@zerodue/shared';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { api, NetworkError, refreshSession } from './api';
import { clearLocalData, readMeta, writeMeta } from './db';

type Status = 'loading' | 'authenticated' | 'offline' | 'unauthenticated';

interface AuthState {
  status: Status;
  user: UserDto | null;
  login: (email: string, password: string) => Promise<void>;
  register: (email: string, password: string, name?: string) => Promise<void>;
  logout: () => Promise<void>;
}

const PROFILE_KEY = 'profile';
const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<Status>('loading');
  const [user, setUser] = useState<UserDto | null>(null);

  // On load, restore the session from the refresh cookie. If the server is unreachable, open from the
  // cached profile so the app stays usable offline (data syncs once the network is back).
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const session = await refreshSession();
        if (cancelled) return;
        if (session) {
          setUser(session.user);
          setStatus('authenticated');
          void writeMeta(PROFILE_KEY, session.user);
        } else {
          setUser(null);
          setStatus('unauthenticated');
        }
      } catch (error) {
        if (cancelled) return;
        const cached =
          error instanceof NetworkError ? await readMeta<UserDto>(PROFILE_KEY) : undefined;
        if (cancelled) return;
        setUser(cached ?? null);
        setStatus(cached ? 'offline' : 'unauthenticated');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const adopt = useCallback((next: UserDto) => {
    setUser(next);
    setStatus('authenticated');
    void writeMeta(PROFILE_KEY, next);
  }, []);

  const value = useMemo<AuthState>(
    () => ({
      status,
      user,
      login: async (email, password) => adopt((await api.login({ email, password })).user),
      register: async (email, password, name) =>
        adopt((await api.register({ email, password, name: name || undefined })).user),
      logout: async () => {
        try {
          await api.logout();
        } catch {
          /* offline: the local session is dropped anyway; the cookie expires or is revoked later */
        }
        await clearLocalData();
        setUser(null);
        setStatus('unauthenticated');
      },
    }),
    [status, user, adopt],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside <AuthProvider>');
  return ctx;
}
