// T056 (013 US5, quickstart S17) – màn hình Tiến trình đăng trên TRÌNH DUYỆT THẬT ở 360 px: dòng thời gian bước DỌC, vùng chạm
// ≥ 44 × 44 px, không cuộn ngang, "Chi tiết cho hỗ trợ" thu gọn, quét axe 0 vi phạm nghiêm trọng. Đăng nhập thật (chủ
// tài khoản mồi); dữ liệu tiến trình được giả ở tầng mạng của trình duyệt (route) vì Worker đăng thật chạy riêng.
import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { readState, type E2eState } from '../state';

const hasDb = (process.env.TEST_DATABASE_ADMIN_URL ?? '') !== '';
test.skip(!hasDb, 'Chưa đặt TEST_DATABASE_ADMIN_URL');

const POST = '0190a000-0000-7000-8000-0000000000e1';
const ATTEMPT = '0190a000-0000-7000-8000-0000000000f1';

const KEYS = ['precheck', 'prepare_media', 'submit', 'await_processing', 'confirm'] as const;
const step = (i: number, state: string, extra: Record<string, unknown> = {}) => ({
  stepNo: i + 1,
  key: KEYS[i],
  state,
  at: state === 'not_run' ? null : '2026-11-20T02:00:00.000Z',
  note: null,
  messageVi: null,
  remedies: [],
  ...extra,
});

const progress = {
  postId: POST,
  overall: 'needs_action',
  channels: [
    {
      attemptId: ATTEMPT,
      channelType: 'facebook_page',
      displayName: 'Cửa hàng Hoa Mai',
      status: 'needs_action',
      needsKind: 'needs_user',
      scheduledAt: '2026-11-20T02:00:00.000Z',
      permalink: null,
      message: 'Ảnh không phù hợp với Facebook.',
      remedies: [{ action: 'edit_media', labelVi: 'Chọn ảnh khác' }],
      allowedActions: ['edit_media', 'republish', 'contact_support'],
      version: 3,
      steps: [
        step(0, 'succeeded'),
        step(1, 'failed', {
          messageVi: 'Ảnh không phù hợp với Facebook.',
          remedies: [{ action: 'edit_media', labelVi: 'Chọn ảnh khác' }],
        }),
        step(2, 'skipped'),
        step(3, 'skipped'),
        step(4, 'skipped'),
      ],
    },
  ],
};

let state: E2eState;
test.beforeAll(async () => {
  state = await readState();
});

async function openProgress(page: Page): Promise<void> {
  await page.route('**/api/v1/posts/*/publish-progress', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(progress) }),
  );
  await page.goto(`/login?next=${encodeURIComponent(`/posts/${POST}/progress`)}`);
  await page.getByLabel('Email').fill(state.owner.email);
  await page.getByLabel('Mật khẩu', { exact: true }).fill(state.owner.password);
  await page.getByRole('button', { name: 'Đăng nhập' }).click();
  await expect(page.getByRole('heading', { name: 'Tiến trình đăng' })).toBeVisible();
}

test.describe('Tiến trình đăng ở 360 px', () => {
  test.use({ viewport: { width: 360, height: 740 } });

  test('dòng thời gian dọc, không cuộn ngang, vùng chạm ≥ 44 px, chi tiết hỗ trợ thu gọn, axe sạch', async ({
    page,
  }) => {
    await openProgress(page);
    await expect(page.getByText('Cần bạn xử lý').first()).toBeVisible();

    // Không cuộn ngang trên trang.
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(0);

    // 5 bước xếp DỌC (cùng lề trái, mỗi bước thấp hơn bước trước).
    const items = page.getByRole('list', { name: /Các bước đăng lên/ }).getByRole('listitem');
    await expect(items).toHaveCount(5);
    const boxes = [];
    for (let i = 0; i < 5; i++) boxes.push(await items.nth(i).boundingBox());
    for (let i = 1; i < 5; i++) {
      expect(Math.abs((boxes[i]?.x ?? 0) - (boxes[0]?.x ?? 0))).toBeLessThan(2);
      expect(boxes[i]?.y ?? 0).toBeGreaterThan(boxes[i - 1]?.y ?? 0);
    }

    // Mọi nút/liên kết thao tác có vùng chạm ≥ 44 × 44 px.
    const controls = page.getByRole('main').locator('button, a[href], summary');
    const count = await controls.count();
    expect(count).toBeGreaterThan(0);
    for (let i = 0; i < count; i++) {
      const box = await controls.nth(i).boundingBox();
      if (box === null) continue;
      expect(box.height, `điều khiển #${String(i)}`).toBeGreaterThanOrEqual(43.5);
    }

    // "Chi tiết cho hỗ trợ" thu gọn mặc định.
    await expect(page.locator('details').first()).not.toHaveAttribute('open', '');

    const result = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21aa'])
      .analyze();
    const serious = result.violations.filter(
      (v) => v.impact === 'serious' || v.impact === 'critical',
    );
    expect(serious.map((v) => `${v.id}: ${v.help}`)).toEqual([]);
  });
});
