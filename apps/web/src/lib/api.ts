import type { AuthResponse } from '@zerodue/shared';

/** The server answered with a non-2xx status. */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly body?: unknown,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

/** The server could not be reached (offline, DNS, CORS, server down). */
export class NetworkError extends Error {
  constructor(message = 'Network unavailable') {
    super(message);
    this.name = 'NetworkError';
  }
}

// The access token lives in memory only; the refresh token is an httpOnly cookie the browser holds.
let accessToken: string | null = null;
let refreshInFlight: Promise<AuthResponse | null> | null = null;

export function setAccessToken(token: string | null): void {
  accessToken = token;
}

export function getAccessToken(): string | null {
  return accessToken;
}

function baseUrl(): string {
  return (process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000').replace(/\/$/, '');
}

async function send(
  path: string,
  init: RequestInit & { token?: string | null },
): Promise<Response> {
  const headers = new Headers(init.headers);
  if (init.body !== undefined) headers.set('Content-Type', 'application/json');
  if (init.token) headers.set('Authorization', `Bearer ${init.token}`);
  try {
    return await fetch(`${baseUrl()}${path}`, { ...init, headers, credentials: 'include' });
  } catch {
    throw new NetworkError();
  }
}

async function toApiError(res: Response): Promise<ApiError> {
  let body: unknown;
  try {
    body = await res.json();
  } catch {
    body = undefined;
  }
  const message =
    (body as { message?: unknown } | undefined)?.message &&
    typeof (body as { message: unknown }).message === 'string'
      ? (body as { message: string }).message
      : `Request failed (${res.status})`;
  return new ApiError(res.status, message, body);
}

/**
 * Uses the refresh cookie to get a new access token.
 * Returns null when the session is gone (401); throws NetworkError when the server is unreachable,
 * so callers can distinguish "signed out" from "offline".
 */
export function refreshSession(): Promise<AuthResponse | null> {
  refreshInFlight ??= (async () => {
    try {
      const res = await send('/auth/refresh', { method: 'POST' });
      if (res.status === 401) {
        accessToken = null;
        return null;
      }
      if (!res.ok) throw await toApiError(res);
      const session = (await res.json()) as AuthResponse;
      accessToken = session.accessToken;
      return session;
    } finally {
      refreshInFlight = null;
    }
  })();
  return refreshInFlight;
}

interface RequestOptions {
  method?: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';
  body?: unknown;
  /** Skip the bearer token and the silent refresh (login/register). */
  anonymous?: boolean;
}

export async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const { method = 'GET', body, anonymous = false } = options;
  const init = { method, body: body === undefined ? undefined : JSON.stringify(body) };

  let res = await send(path, { ...init, token: anonymous ? null : accessToken });
  if (res.status === 401 && !anonymous) {
    // Access token expired: refresh once and retry.
    if (await refreshSession()) res = await send(path, { ...init, token: accessToken });
  }
  if (!res.ok) throw await toApiError(res);
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

export const api = {
  register: async (input: { email: string; password: string; name?: string }) => {
    const session = await request<AuthResponse>('/auth/register', {
      method: 'POST',
      body: input,
      anonymous: true,
    });
    accessToken = session.accessToken;
    return session;
  },
  login: async (input: { email: string; password: string }) => {
    const session = await request<AuthResponse>('/auth/login', {
      method: 'POST',
      body: input,
      anonymous: true,
    });
    accessToken = session.accessToken;
    return session;
  },
  logout: async () => {
    try {
      await request<void>('/auth/logout', { method: 'POST', anonymous: true });
    } finally {
      accessToken = null;
    }
  },
};
