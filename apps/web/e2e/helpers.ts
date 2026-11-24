import type { Page } from '@playwright/test';

// Dựng API giả cho E2E: chặn mạng bằng `page.route`, không phụ thuộc máy chủ thật.

export type Role = 'owner' | 'collaborator';

const PERMISSIONS: Record<Role, string[]> = {
  owner: [
    'context.view',
    'context.edit',
    'channel.view',
    'channel.manage',
    'post.edit',
    'media.upload',
    'media.view',
    'media.delete',
    'post.approve',
    'post.reschedule',
    'post.republish',
    'status.view',
    'members.manage',
    'account.delete',
  ],
  collaborator: [
    'context.view',
    'channel.view',
    'post.edit',
    'media.upload',
    'media.view',
    'media.delete',
    'post.reschedule',
    'post.republish',
    'status.view',
  ],
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
  // Mọi lời gọi chưa giả sẽ rơi vào máy chủ dev (trả 401 → hộp "Phiên đã hết hạn"), nên giả các điểm cuối mà khung và màn
  // Lịch gọi: 012 huy hiệu "chờ duyệt" + lịch; 010 dấu chỉ báo kênh (cần `channel.view`).
  await page.route('**/api/v1/approvals/pending/count', (route) =>
    route.fulfill({ json: { count: 0 } }),
  );
  await page.route('**/api/v1/calendar?**', (route) => route.fulfill({ json: { items: [] } }));
  await page.route('**/api/v1/channels/overview', (route) =>
    route.fulfill({
      json: {
        features: { tiktok: false },
        limits: { perPlatform: 5 },
        platforms: [],
        connections: [],
        attention: [],
        planActive: true,
        viewerCanManage: role === 'owner',
      },
    }),
  );
  await page.route('**/healthz', (route) =>
    route.fulfill({
      json: { status: 'ok', unit: 'api', version: 'e2e', time: '2026-11-15T03:00:00.000Z' },
    }),
  );
}
