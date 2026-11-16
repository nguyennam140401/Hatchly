import { http, HttpResponse } from 'msw';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { server } from '../../../test/msw-server';
import { apiClient, setAuthGate } from './client';
import { AppError } from './errors';

const Item = {
  safeParse: (v: unknown) =>
    typeof v === 'object' && v !== null && typeof (v as { id?: unknown }).id === 'string'
      ? { success: true as const, data: v as { id: string } }
      : { success: false as const },
};
const errorBody = (code: string, extra: Record<string, unknown> = {}) => ({
  error: {
    code,
    message: 'Thông điệp',
    actions: [{ kind: 'retry', label: 'Thử lại' }],
    support: { traceId: 'trace-1' },
    ...extra,
  },
});

afterEach(() => {
  setAuthGate(null);
});

describe('apiClient.request', () => {
  it('2xx: trả dữ liệu đã kiểm theo lược đồ; gửi cookie cùng nguồn', async () => {
    server.use(http.get('http://localhost/api/x', () => HttpResponse.json({ id: 'a' })));
    const data = await apiClient.request('GET', 'http://localhost/api/x', { schema: Item });
    expect(data).toEqual({ id: 'a' });
  });

  it('204: trả undefined', async () => {
    server.use(http.post('http://localhost/api/x', () => new HttpResponse(null, { status: 204 })));
    expect(await apiClient.request('POST', 'http://localhost/api/x', { body: {} })).toBeUndefined();
  });

  it('sai hình phản hồi → invalid_response', async () => {
    server.use(http.get('http://localhost/api/x', () => HttpResponse.json({ nope: 1 })));
    await expect(
      apiClient.request('GET', 'http://localhost/api/x', { schema: Item }),
    ).rejects.toMatchObject({ kind: 'invalid_response' });
  });

  it('lỗi chuẩn → AppError có kind, hành động, fieldErrors và mã theo dõi', async () => {
    server.use(
      http.post('http://localhost/api/x', () =>
        HttpResponse.json(
          errorBody('VALIDATION_FAILED', { fieldErrors: [{ path: ['a', 'b'], message: 'Sai' }] }),
          { status: 400 },
        ),
      ),
    );
    const err = await apiClient
      .request('POST', 'http://localhost/api/x', { body: {} })
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(AppError);
    expect(err).toMatchObject({
      kind: 'validation',
      fieldErrors: { 'a.b': 'Sai' },
      support: { traceId: 'trace-1' },
    });
    expect((err as AppError).actions.length).toBeGreaterThanOrEqual(1);
  });

  it('mất mạng → AppError network', async () => {
    server.use(http.get('http://localhost/api/x', () => HttpResponse.error()));
    await expect(apiClient.request('GET', 'http://localhost/api/x')).rejects.toMatchObject({
      kind: 'network',
    });
  });

  it('FR-010: ném lỗi khi thân/đường dẫn chứa accountId hoặc tenantId', async () => {
    await expect(
      apiClient.request('POST', '/api/x', { body: { nested: { accountId: 'a' } } }),
    ).rejects.toThrow(/mã tài khoản/);
    await expect(
      apiClient.request('POST', '/api/x', { body: { TenantId: 't' } }),
    ).rejects.toThrow();
    await expect(apiClient.request('GET', '/api/x?accountId=1')).rejects.toThrow();
  });

  describe('AuthGate', () => {
    const unauth = () => HttpResponse.json(errorBody('UNAUTHENTICATED'), { status: 401 });

    it('GET: sau khi đăng nhập lại (resumed) được phát lại đúng một lần', async () => {
      let calls = 0;
      server.use(
        http.get('http://localhost/api/x', () =>
          calls++ === 0 ? unauth() : HttpResponse.json({ id: 'ok' }),
        ),
      );
      const onUnauthenticated = vi.fn().mockResolvedValue('resumed');
      setAuthGate({ onUnauthenticated, onEmailNotVerified: vi.fn() });
      const data = await apiClient.request('GET', 'http://localhost/api/x', { schema: Item });
      expect(data).toEqual({ id: 'ok' });
      expect(onUnauthenticated).toHaveBeenCalledTimes(1);
      expect(calls).toBe(2);
    });

    it('thao tác ghi KHÔNG tự phát lại (nguyên tắc II), trừ khi safeToReplay', async () => {
      let calls = 0;
      server.use(
        http.post('http://localhost/api/x', () => {
          calls += 1;
          return unauth();
        }),
      );
      setAuthGate({
        onUnauthenticated: () => Promise.resolve('resumed'),
        onEmailNotVerified: vi.fn(),
      });
      await expect(
        apiClient.request('POST', 'http://localhost/api/x', { body: {} }),
      ).rejects.toMatchObject({
        kind: 'session_expired',
      });
      expect(calls).toBe(1);
    });

    it('silentAuth: không vào AuthGate', async () => {
      server.use(http.get('http://localhost/api/x', unauth));
      const onUnauthenticated = vi.fn();
      setAuthGate({ onUnauthenticated, onEmailNotVerified: vi.fn() });
      await expect(
        apiClient.request('GET', 'http://localhost/api/x', { silentAuth: true }),
      ).rejects.toMatchObject({ kind: 'session_expired' });
      expect(onUnauthenticated).not.toHaveBeenCalled();
    });

    it('ended/switched: không phát lại, ném lỗi gốc', async () => {
      server.use(http.get('http://localhost/api/x', unauth));
      setAuthGate({
        onUnauthenticated: () => Promise.resolve('ended'),
        onEmailNotVerified: vi.fn(),
      });
      await expect(apiClient.request('GET', 'http://localhost/api/x')).rejects.toMatchObject({
        kind: 'session_expired',
      });
    });
  });
});
