// Nhóm (g) – đầu-cuối qua trình duyệt thật (006 US1, US2, US4, US5, SC-006): màn hình → API → CSDL.
// Chép mẫu này khi: tính năng có luồng chính cần chứng minh trên trình duyệt thật (đăng nhập thật, cookie
// thật, nhiều tab) – giữ ít kịch bản, mỗi kịch bản một luồng người dùng; quét axe trên trang thật.
import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Browser, type Page } from '@playwright/test';
import { readState, type E2eState } from '../state';

const hasDb = (process.env.TEST_DATABASE_ADMIN_URL ?? '') !== '';
test.skip(!hasDb, 'Chưa đặt TEST_DATABASE_ADMIN_URL');
test.describe.configure({ mode: 'serial' });

let state: E2eState;
test.beforeAll(async () => {
  state = await readState();
});

async function login(page: Page, who: { email: string; password: string }): Promise<void> {
  await page.goto('/login?next=%2Fbusiness-profile');
  await page.getByLabel('Email').fill(who.email);
  await page.getByLabel('Mật khẩu', { exact: true }).fill(who.password);
  await page.getByRole('button', { name: 'Đăng nhập' }).click();
  await expect(page).toHaveURL(/\/business-profile$/);
  await expect(page.getByRole('heading', { name: 'Hồ sơ kinh doanh' })).toBeVisible();
}

async function newLoggedInPage(browser: Browser, who: { email: string; password: string }) {
  const context = await browser.newContext();
  const page = await context.newPage();
  await login(page, who);
  return { context, page };
}

async function expectNoSeriousA11yViolations(page: Page): Promise<void> {
  const result = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21aa'])
    .analyze();
  const serious = result.violations.filter(
    (v) => v.impact === 'serious' || v.impact === 'critical',
  );
  expect(serious.map((v) => `${v.id}: ${v.help}`)).toEqual([]);
}

test('chủ: điền → lưu v1 → sửa → v2 → lịch sử 2 dòng → mở v1 "Bản cũ – chỉ xem"', async ({
  page,
}) => {
  await login(page, state.owner);
  await expect(page.getByText(/Chưa có hồ sơ/)).toBeVisible();
  await expect(page.getByText(/AI sẽ viết tốt hơn nếu bạn bổ sung/)).toBeVisible();
  await expectNoSeriousA11yViolations(page);

  // Chọn "Khác" → ô "Tên ngành" bắt buộc.
  await page.getByLabel(/Ngành kinh doanh/).selectOption('other');
  await page.getByLabel(/Tên ngành/).fill('Gốm thủ công');
  await page.getByLabel(/Giới thiệu/).fill('Xưởng gốm nhỏ ở Bát Tràng.');
  const keyword = page.getByLabel('Từ khóa riêng');
  await keyword.fill('gốm');
  await keyword.press('Enter');
  await page.getByRole('button', { name: 'Lưu' }).click();
  await expect(page.getByRole('status')).toHaveText(/Đã lưu phiên bản 1/);

  // Lưu lại không sửa → "Không có thay đổi để lưu".
  await page.getByRole('button', { name: 'Lưu' }).click();
  await expect(page.getByRole('status')).toHaveText(/Không có thay đổi để lưu/);

  await page.getByLabel('Giọng văn mong muốn').fill('Mộc mạc, gần gũi');
  await page.getByRole('button', { name: 'Lưu' }).click();
  await expect(page.getByRole('status')).toHaveText(/Đã lưu phiên bản 2/);
  await expect(
    page.getByText(/Phiên bản 2 · lưu lúc .* \(giờ Việt Nam\) · bởi Chị Lan/),
  ).toBeVisible();

  // Tải lại trang → dữ liệu từ CSDL.
  await page.reload();
  await expect(page.getByLabel('Giọng văn mong muốn')).toHaveValue('Mộc mạc, gần gũi');
  await expect(page.getByText('Lịch sử phiên bản (2)')).toBeVisible();
  await page.getByRole('link', { name: /^Phiên bản 1 ·/ }).click();
  await expect(page.getByRole('heading', { name: 'Bản cũ – chỉ xem' })).toBeVisible();
  await expect(page.getByLabel(/Giới thiệu/)).toHaveValue('Xưởng gốm nhỏ ở Bát Tràng.');
  await expect(page.getByLabel('Giọng văn mong muốn')).toHaveValue('');
  await expect(page.getByRole('button', { name: 'Lưu' })).toHaveCount(0);
  await expectNoSeriousA11yViolations(page);
});

test('cộng tác viên: chỉ xem, không có nút Lưu', async ({ page }) => {
  await login(page, state.collaborator);
  await expect(page.getByText('Bạn đang xem. Chỉ chủ tài khoản mới sửa được hồ sơ.')).toBeVisible();
  await expect(page.getByLabel(/Giới thiệu/)).toHaveValue('Xưởng gốm nhỏ ở Bát Tràng.');
  await expect(page.getByLabel(/Giới thiệu/)).toHaveAttribute('readonly', '');
  await expect(page.getByRole('button', { name: 'Lưu' })).toHaveCount(0);
  // API tự chặn dù gọi thẳng (không qua giao diện).
  const res = await page.request.put('/api/v1/context/profile', {
    data: { expectedVersion: 2, fields: {} },
    headers: { origin: page.url().replace(/\/business-profile.*$/, '') },
  });
  expect(res.status()).toBe(403);
  await expectNoSeriousA11yViolations(page);
});

test('hai tab cùng sửa → tab sau gặp xung đột, nội dung đang gõ còn nguyên', async ({
  browser,
}) => {
  const tab1 = await newLoggedInPage(browser, state.owner);
  const tab2 = await newLoggedInPage(browser, state.owner);
  try {
    await tab1.page.getByLabel('Giọng văn mong muốn').fill('Tab 1 viết');
    await tab2.page.getByLabel('Giọng văn mong muốn').fill('Tab 2 đang gõ');
    await tab1.page.getByRole('button', { name: 'Lưu' }).click();
    await expect(tab1.page.getByRole('status')).toHaveText(/Đã lưu phiên bản 3/);
    await tab2.page.getByRole('button', { name: 'Lưu' }).click();
    await expect(tab2.page.getByRole('alert')).toContainText('Hồ sơ vừa được cập nhật ở nơi khác');
    await expect(tab2.page.getByLabel('Giọng văn mong muốn')).toHaveValue('Tab 2 đang gõ');
    await expect(tab2.page.getByRole('button', { name: 'Tải bản mới nhất' })).toBeVisible();
  } finally {
    await tab1.context.close();
    await tab2.context.close();
  }
});

test('khung nhìn 360 px: không cuộn ngang; thao tác được bằng bàn phím', async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 740 });
  await login(page, state.owner);
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(0);

  // Bàn phím: Tab tới ô giới thiệu, gõ, Tab tới nút Lưu, Enter.
  await page.getByLabel(/Giới thiệu/).focus();
  await page.keyboard.press('Control+A');
  await page.keyboard.type('Xưởng gốm – sửa bằng bàn phím.');
  for (let i = 0; i < 40; i++) {
    const focused = await page.evaluate(() => document.activeElement?.textContent ?? '');
    if (focused === 'Lưu') break;
    await page.keyboard.press('Tab');
  }
  await page.keyboard.press('Enter');
  await expect(page.getByRole('status')).toHaveText(/Đã lưu phiên bản 4/);
  await expectNoSeriousA11yViolations(page);
});
