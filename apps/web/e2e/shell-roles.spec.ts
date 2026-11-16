import { expect, test } from '@playwright/test';
import { mockSession } from './helpers';

// Khung ứng dụng theo vai trò (Story 2): mục điều hướng hiện/ẩn đúng, đổi bố cục theo khung nhìn, không cuộn ngang.

test.describe('khung ứng dụng', () => {
  test('chủ tài khoản thấy đủ mục; điều hướng đổi theo khung nhìn', async ({ page }, info) => {
    await mockSession(page, 'owner');
    await page.goto('/');
    const nav = page.getByRole('navigation', { name: 'Điều hướng chính' });
    await expect(nav).toBeVisible();
    const desktop = (info.project.use.viewport?.width ?? 0) >= 1024;
    await expect(nav.getByRole('link')).toHaveCount(desktop ? 7 : 5);
    if (desktop) await expect(nav.getByRole('link', { name: 'Hồ sơ kinh doanh' })).toBeVisible();
    else await expect(nav.getByRole('link', { name: 'Tạo bài' })).toBeVisible();
  });

  test('không cuộn ngang ở mọi khung nhìn', async ({ page }) => {
    await mockSession(page, 'owner');
    await page.goto('/calendar');
    await expect(page.getByRole('heading', { name: 'Lịch đăng' })).toBeVisible();
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
    );
    expect(overflow).toBe(false);
  });

  test('cộng tác viên vào thẳng /settings/members → bị chặn, không trang trắng', async ({
    page,
  }) => {
    await mockSession(page, 'collaborator');
    await page.goto('/settings/members');
    await expect(
      page.getByText('Chỉ chủ tài khoản mới mời hoặc gỡ được cộng tác viên.'),
    ).toBeVisible();
    await expect(page.getByRole('navigation', { name: 'Điều hướng chính' })).toBeVisible();
  });

  test('đường dẫn lạ → "Không tìm thấy trang" có nút về Tổng quan', async ({ page }) => {
    await mockSession(page, 'owner');
    await page.goto('/khong-co');
    await expect(page.getByRole('heading', { name: 'Không tìm thấy trang' })).toBeVisible();
    await page.getByRole('button', { name: 'Về Tổng quan' }).click();
    await expect(page).toHaveURL(/\/$/);
  });
});
