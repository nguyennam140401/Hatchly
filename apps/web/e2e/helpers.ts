import type { Page } from '@playwright/test';

// Dựng API giả cho E2E: chặn mạng bằng `page.route`, không phụ thuộc máy chủ thật.

export type Role = 'owner' | 'collaborator';

const PERMISSIONS: Record<Role, string[]> = {
  owner: [
    'context.view',
    'context.edit',
    'channel.manage',
    'post.edit',
    'media.upload',
    'post.approve',
    'post.reschedule',
    'post.republish',
    'status.view',
    'members.manage',
    'account.delete',
  ],
  collaborator: ['context.view', 'post.edit', 'media.upload', 'post.reschedule', 'post.republish', 'status.view'],
};

export function meBody(role: Role, id = 'u-1', accountId = 'a-1') {
  return {
    user: { id, displayName: 'Chủ Tiệm', email: 'chu@example.test', emailVerified: true },
    account: { id: accountId, status: 'active' },
    role,
    permissions: PERMISSIONS[role],
  };
}

export function errorBody(code: string, extra: Record<string, unknown> = {}) {
  return {
    error: {
      code,
      message: `Thông điệp ${code}`,
      actions: [{ kind: 'navigate', label: 'Đăng nhập', href: '/login' }],
      support: { traceId: 'trace-e2e' },
      ...extra,
    },
  };
}

export async function mockSession(page: Page, role: Role): Promise<void> {
  await page.route('**/api/v1/auth/me', (route) => route.fulfill({ json: meBody(role) }));
  await page.route('**/healthz', (route) =>
    route.fulfill({ json: { status: 'ok', unit: 'api', version: 'e2e', time: '2026-11-15T03:00:00.000Z' } }),
  );
}
