import { expect, test } from '@playwright/test';
import { errorBody, meBody, mockSession } from './helpers';

// Hết phiên giữa chừng (FR-011a): hộp thoại đăng nhập lại TẠI CHỖ; cùng tài khoản → tiếp tục; khác → dọn sạch, về Tổng quan.
// Trang "Cách đăng nhập" gọi API ngay khi mở nên dùng làm lời gọi gây 401 giữa chừng.

const METHODS_URL = '**/api/v1/auth/login-methods';

test('hết phiên giữa chừng → hộp đăng nhập lại; cùng tài khoản → đóng hộp, màn hình còn nguyên', async ({
  page,
}) => {
  await mockSession(page, 'owner');
  let loginCalls = 0;
  await page.route('**/api/v1/auth/login', (route) => {
    loginCalls += 1;
    return route.fulfill({ json: meBody('owner') });
  });
  await page.route(METHODS_URL, (route) =>
    route.fulfill({ status: 401, json: errorBody('UNAUTHENTICATED') }),
  );

  await page.goto('/');
  await expect(page.getByRole('navigation', { name: 'Điều hướng chính' })).toBeVisible();
  await page.goto('/settings/login-methods');

  const dialog = page.getByRole('dialog', { name: 'Phiên đã hết hạn' });
  await expect(dialog).toBeVisible();
  // Chỉ MỘT hộp thoại dù nhiều lời gọi 401.
  await expect(page.getByRole('dialog')).toHaveCount(1);

  await dialog.getByLabel(/Mật khẩu/).fill('mat-khau-dung');
  await dialog.getByRole('button', { name: 'Đăng nhập lại' }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  expect(loginCalls).toBe(1);
  await expect(page).toHaveURL(/settings\/login-methods/);
});

test('đăng nhập lại bằng tài khoản khác → về Tổng quan, không còn dữ liệu cũ', async ({ page }) => {
  await mockSession(page, 'owner');
  await page.route('**/api/v1/auth/login', (route) =>
    route.fulfill({ json: meBody('owner', 'u-khac', 'a-khac') }),
  );
  await page.route(METHODS_URL, (route) =>
    route.fulfill({ status: 401, json: errorBody('UNAUTHENTICATED') }),
  );
  await page.goto('/settings/login-methods');
  const dialog = page.getByRole('dialog', { name: 'Phiên đã hết hạn' });
  await dialog.getByLabel(/Mật khẩu/).fill('x');
  await dialog.getByRole('button', { name: 'Đăng nhập lại' }).click();
  await expect(page).toHaveURL(/\/$/);
  await expect(page.getByRole('dialog')).toHaveCount(0);
});

test('mật khẩu bị đổi ở nơi khác (reason=password_changed) → không có "tiếp tục", chỉ về đăng nhập', async ({
  page,
}) => {
  await mockSession(page, 'owner');
  await page.route(METHODS_URL, (route) =>
    route.fulfill({
      status: 401,
      json: errorBody('UNAUTHENTICATED', { reason: 'password_changed' }),
    }),
  );
  await page.goto('/settings/login-methods');
  await expect(page.getByText(/Mật khẩu đã được đổi ở nơi khác/)).toBeVisible();
  await expect(page.getByLabel(/Mật khẩu/)).toHaveCount(0);
  await page.getByRole('button', { name: 'Về trang đăng nhập' }).click();
  await expect(page).toHaveURL(/\/login/);
});
