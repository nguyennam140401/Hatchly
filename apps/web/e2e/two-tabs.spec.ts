import { expect, test } from '@playwright/test';
import { mockSession } from './helpers';

// Hai tab / hai tài khoản (SC-008, FR-027/FR-028): đăng xuất ở tab A → tab B về /login; bộ lưu của trình duyệt KHÔNG chứa
// dữ liệu tài khoản (chỉ cờ giao diện trong danh sách trắng).

test('đăng xuất ở tab A → tab B tự về /login', async ({ context }) => {
  const a = await context.newPage();
  const b = await context.newPage();
  for (const page of [a, b]) {
    await mockSession(page, 'owner');
    await page.route('**/api/v1/auth/logout', (route) => route.fulfill({ status: 204 }));
  }
  await a.goto('/');
  await b.goto('/calendar');
  await expect(b.getByRole('heading', { name: 'Lịch đăng' })).toBeVisible();

  await a.getByRole('button', { name: 'Đăng xuất' }).click();
  await expect(b).toHaveURL(/\/login/);
});

test('bộ lưu của trình duyệt không chứa dữ liệu tài khoản', async ({ page }) => {
  await mockSession(page, 'owner');
  await page.goto('/');
  await expect(page.getByRole('navigation', { name: 'Điều hướng chính' })).toBeVisible();
  const dump = await page.evaluate(async () => ({
    local: Object.entries(window.localStorage),
    session: Object.entries(window.sessionStorage),
    // Phải chờ ngay trong `evaluate`: Promise lồng trong đối tượng trả về không được tuần tự hóa.
    databases: 'databases' in indexedDB ? (await indexedDB.databases()).map((x) => x.name) : [],
  }));
  const text = JSON.stringify({ local: dump.local, session: dump.session });
  expect(text).not.toMatch(/chu@example\.test|u-1|a-1|Chủ Tiệm|token|password/i);
  expect(Object.keys(Object.fromEntries(dump.local)).every((k) => k.startsWith('app:ui.'))).toBe(true);
  expect(dump.databases).toEqual([]);
});
