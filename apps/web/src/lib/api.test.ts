import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError, NetworkError, api, getAccessToken, request, setAccessToken } from './api';

const json = (status: number, body?: unknown) =>
  new Response(body === undefined ? null : JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });

const session = (token: string) => ({
  accessToken: token,
  user: {
    id: '11111111-1111-4111-8111-111111111111',
    email: 'a@b.co',
    name: null,
    timezone: 'Asia/Kolkata',
  },
});

describe('api client', () => {
  const fetchMock = vi.fn<typeof fetch>();

  beforeEach(() => {
    vi.stubGlobal('fetch', fetchMock);
    fetchMock.mockReset();
    setAccessToken(null);
  });
  afterEach(() => vi.unstubAllGlobals());

  it('sends the bearer token and cookies', async () => {
    setAccessToken('tok');
    fetchMock.mockResolvedValueOnce(json(200, { ok: true }));
    await request('/me');
    const [, init] = fetchMock.mock.calls[0]!;
    expect(new Headers(init!.headers).get('Authorization')).toBe('Bearer tok');
    expect(init!.credentials).toBe('include');
  });

  it('refreshes once on 401 and retries with the new token', async () => {
    setAccessToken('expired');
    fetchMock
      .mockResolvedValueOnce(json(401, { message: 'expired' }))
      .mockResolvedValueOnce(json(200, session('fresh')))
      .mockResolvedValueOnce(json(200, { hello: 'world' }));

    await expect(request('/me')).resolves.toEqual({ hello: 'world' });
    expect(
      fetchMock.mock.calls.map(([url]) => String(url).replace(/^.*localhost:4000/, '')),
    ).toEqual(['/me', '/auth/refresh', '/me']);
    const retry = fetchMock.mock.calls[2]![1]!;
    expect(new Headers(retry.headers).get('Authorization')).toBe('Bearer fresh');
    expect(getAccessToken()).toBe('fresh');
  });

  it('shares one refresh between concurrent 401s', async () => {
    setAccessToken('expired');
    let refreshCalls = 0;
    fetchMock.mockImplementation(async (input, init) => {
      const url = String(input);
      if (url.endsWith('/auth/refresh')) {
        refreshCalls++;
        return json(200, session('fresh'));
      }
      const auth = new Headers(init?.headers).get('Authorization');
      return auth === 'Bearer fresh' ? json(200, { ok: true }) : json(401, { message: 'expired' });
    });
    await Promise.all([request('/a'), request('/b'), request('/c')]);
    expect(refreshCalls).toBe(1);
  });

  it('throws the 401 when the session cannot be refreshed', async () => {
    setAccessToken('expired');
    fetchMock
      .mockResolvedValueOnce(json(401, { message: 'expired' }))
      .mockResolvedValueOnce(json(401, { message: 'Refresh token already used' }));
    await expect(request('/me')).rejects.toMatchObject({ status: 401 });
    expect(getAccessToken()).toBeNull();
  });

  it('surfaces the server message on errors', async () => {
    fetchMock.mockResolvedValueOnce(json(409, { message: 'Email already registered' }));
    const error = await api
      .register({ email: 'a@b.co', password: 'longenough-pw' })
      .catch((e) => e);
    expect(error).toBeInstanceOf(ApiError);
    expect(error.message).toBe('Email already registered');
  });

  it('reports an unreachable server as NetworkError, not a sign-out', async () => {
    fetchMock.mockRejectedValueOnce(new TypeError('Failed to fetch'));
    await expect(request('/me')).rejects.toBeInstanceOf(NetworkError);
  });

  it('stores the access token after login and clears it on logout', async () => {
    fetchMock.mockResolvedValueOnce(json(200, session('abc')));
    await api.login({ email: 'a@b.co', password: 'x' });
    expect(getAccessToken()).toBe('abc');

    fetchMock.mockResolvedValueOnce(new Response(null, { status: 204 }));
    await api.logout();
    expect(getAccessToken()).toBeNull();
  });
});
