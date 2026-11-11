import { render, type RenderResult } from '@testing-library/react';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { vi } from 'vitest';
import { appRoutes } from '../../src/app/router';

// Tiện ích kiểm thử web xác thực: giả lập API theo "PHƯƠNG THỨC đường-dẫn", dựng router trong bộ nhớ.

export type Handler = (body: unknown) => { status: number; body?: unknown };

export interface FakeApi {
  calls: { method: string; path: string; body: unknown; hashAtCall: string }[];
  on: (key: string, handler: Handler) => void;
}

export function fakeApi(routes: Record<string, Handler> = {}): FakeApi {
  const table = new Map(Object.entries(routes));
  const api: FakeApi = {
    calls: [],
    on: (key, handler) => table.set(key, handler),
  };
  vi.stubGlobal(
    'fetch',
    vi.fn((input: string, init?: RequestInit) => {
      const method = (init?.method ?? 'GET').toUpperCase();
      const path = input.split('?')[0] ?? input;
      const body = typeof init?.body === 'string' ? (JSON.parse(init.body) as unknown) : undefined;
      api.calls.push({ method, path, body, hashAtCall: window.location.hash });
      const handler = table.get(`${method} ${path}`);
      const result =
        handler === undefined ? { status: 404, body: apiError('NOT_FOUND') } : handler(body);
      return Promise.resolve(
        result.status === 204
          ? new Response(null, { status: 204 })
          : new Response(JSON.stringify(result.body ?? {}), {
              status: result.status,
              headers: { 'content-type': 'application/json' },
            }),
      );
    }),
  );
  return api;
}

export function apiError(
  code: string,
  extra: {
    message?: string;
    fieldErrors?: { path: string[]; message: string }[];
    href?: string;
  } = {},
) {
  return {
    error: {
      code,
      message: extra.message ?? `Thông điệp ${code}`,
      actions: [{ kind: 'navigate', label: 'Hành động', href: extra.href ?? '/' }],
      ...(extra.fieldErrors !== undefined ? { fieldErrors: extra.fieldErrors } : {}),
      support: { traceId: 'trace-1', detail: 'chi-tiet' },
    },
  };
}

export const me = (
  overrides: { emailVerified?: boolean; role?: 'owner' | 'collaborator' } = {},
) => ({
  user: {
    id: 'u-1',
    displayName: 'Chủ tiệm hoa',
    email: 'lan@example.vn',
    emailVerified: overrides.emailVerified ?? true,
  },
  account: { id: 'a-1', status: 'active' },
  role: overrides.role ?? 'owner',
  permissions: ['post.edit'],
});

export const healthy = {
  status: 'ok',
  unit: 'api',
  version: '0.0.0-test',
  time: '2026-11-10T03:00:00.000Z',
};

export function renderAt(
  path: string,
): RenderResult & { router: ReturnType<typeof createMemoryRouter> } {
  const router = createMemoryRouter(appRoutes, { initialEntries: [path] });
  const view = render(<RouterProvider router={router} />);
  return { router, ...view };
}

/** Mọi điều khiển tương tác dùng được bằng bàn phím: phần tử gốc, không tabIndex âm. */
export function keyboardReachable(container: HTMLElement): boolean {
  const controls = container.querySelectorAll('button, input, a[href], summary');
  return [...controls].every((el) => (el as HTMLElement).tabIndex >= 0);
}
