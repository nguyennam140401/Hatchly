// T089 (014 US1/US2/US4, quickstart mục 2) – màn hình "Thư viện ảnh & video" trên TRÌNH DUYỆT THẬT ở 360 px:
//   (1) tải 3 ảnh ⇒ lưới hiện "Sẵn sàng"; (2) chọn lại video đang dở ⇒ chỉ tải phần còn thiếu;
//   (3) hết chỗ ⇒ "Thư viện đã đầy" + lối tới danh sách để xóa; không cuộn ngang.
// Đăng nhập thật (chủ tài khoản mồi). API media và kho tệp được giả ở tầng mạng của trình duyệt (route) vì kho thật là
// bản memory của máy chủ kiểm thử, trình duyệt không tới được đường dẫn ký sẵn.
import { expect, test, type Page, type Route } from '@playwright/test';
import { readState, type E2eState } from '../state';

const hasDb = (process.env.TEST_DATABASE_ADMIN_URL ?? '') !== '';
test.skip(!hasDb, 'Chưa đặt TEST_DATABASE_ADMIN_URL');

const MIB = 1024 * 1024;
const LIMIT = 5 * 1024 * MIB;
const STORAGE = 'http://storage.test';
const CORS = { 'access-control-allow-origin': '*', 'access-control-expose-headers': 'ETag' };
const NOW = '2026-11-20T02:00:00.000Z';

const uuid = (n: number): string => `0190a000-0000-7000-8000-${n.toString(16).padStart(12, '0')}`;

interface FakeItem {
  id: string;
  kind: 'image' | 'video';
  displayName: string;
  originalBytes: number;
}

const quotaOf = (used: number) => ({
  usedBytes: used,
  reservedBytes: 0,
  limitBytes: LIMIT,
  percent: Math.floor((used / LIMIT) * 100),
  state: used >= LIMIT ? 'full' : used >= LIMIT * 0.9 ? 'near_full' : 'ok',
});

const itemJson = (i: FakeItem) => ({
  id: i.id,
  kind: i.kind,
  displayName: i.displayName,
  status: 'ready',
  originalBytes: i.originalBytes,
  width: 640,
  height: 480,
  durationMs: i.kind === 'video' ? 4000 : null,
  createdAt: NOW,
  uploadedBy: { userId: null, displayName: null },
  thumbUrl: null,
  failure: null,
  canDelete: true,
});

const json = (route: Route, body: unknown, status = 200) =>
  route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });

let state: E2eState;
test.beforeAll(async () => {
  state = await readState();
});

async function login(page: Page): Promise<void> {
  await page.goto(`/login?next=${encodeURIComponent('/media')}`);
  await page.getByLabel('Email').fill(state.owner.email);
  await page.getByLabel('Mật khẩu', { exact: true }).fill(state.owner.password);
  await page.getByRole('button', { name: 'Đăng nhập' }).click();
}

/** Giả API thư viện + kho tệp; trả danh sách nhận được để kiểm. */
async function fakeMedia(page: Page, initial: FakeItem[], used = 0) {
  const items: FakeItem[] = [...initial];
  const started: { id: string; media: FakeItem }[] = [];
  const partRequests: number[][] = [];
  const partPuts: string[] = [];
  let usedBytes = used;

  await page.route('**/api/v1/media/quota', (r) => json(r, quotaOf(usedBytes)));
  await page.route('**/api/v1/media?*', (r) =>
    json(r, { items: items.map(itemJson), nextCursor: null, quota: quotaOf(usedBytes) }),
  );
  await page.route(/\/api\/v1\/media$/, (r) =>
    json(r, { items: items.map(itemJson), nextCursor: null, quota: quotaOf(usedBytes) }),
  );
  await page.route('**/api/v1/media/uploads', async (route) => {
    const body = route.request().postDataJSON() as { fileName: string; sizeBytes: number };
    const media: FakeItem = {
      id: uuid(started.length + 100),
      kind: body.fileName.endsWith('.mp4') ? 'video' : 'image',
      displayName: body.fileName,
      originalBytes: body.sizeBytes,
    };
    const id = uuid(started.length + 500);
    started.push({ id, media });
    const common = {
      uploadId: id,
      mediaId: media.id,
      resumed: media.kind === 'video',
      expiresAt: '2099-01-01T00:00:00.000Z',
    };
    return json(
      route,
      media.kind === 'video'
        ? {
            mode: 'multipart',
            partSizeBytes: 8 * MIB,
            partCount: 2,
            completedParts: [1],
            ...common,
          }
        : {
            mode: 'single',
            post: {
              url: `${STORAGE}/up/${id}`,
              fields: { key: 'k', policy: 'p' },
              expiresAt: common.expiresAt,
            },
            ...common,
          },
      201,
    );
  });
  await page.route('**/api/v1/media/uploads/*/part-urls', async (route) => {
    const { partNumbers } = route.request().postDataJSON() as { partNumbers: number[] };
    partRequests.push(partNumbers);
    return json(route, {
      parts: partNumbers.map((n) => ({
        partNumber: n,
        url: `${STORAGE}/part/${n}`,
        contentLength: n === 1 ? 8 * MIB : MIB,
        expiresAt: '2099-01-01T00:00:00.000Z',
      })),
    });
  });
  await page.route('**/api/v1/media/uploads/*/complete', (route) => {
    const id = route.request().url().split('/').slice(-2)[0] ?? '';
    const hit = started.find((s) => s.id === id);
    if (hit !== undefined) {
      items.unshift(hit.media);
      usedBytes += hit.media.originalBytes;
    }
    return json(
      route,
      { uploadId: id, mediaId: hit?.media.id ?? uuid(1), state: 'completed' },
      202,
    );
  });
  await page.route(/\/api\/v1\/media\/uploads\/[^/]+$/, (route) => {
    if (route.request().method() !== 'GET') return json(route, {}, 204);
    const id = route.request().url().split('/').pop() ?? '';
    const hit = started.find((s) => s.id === id);
    return json(route, {
      uploadId: id,
      state: 'completed',
      mediaId: hit?.media.id ?? null,
      mediaStatus: 'ready',
      duplicateOf: null,
      failureCode: null,
      expiresAt: '2099-01-01T00:00:00.000Z',
    });
  });
  // Kho tệp giả (khác nguồn gốc ⇒ cần tiêu đề CORS).
  await page.route(`${STORAGE}/**`, async (route) => {
    if (route.request().method() === 'OPTIONS') {
      return route.fulfill({
        status: 204,
        headers: {
          ...CORS,
          'access-control-allow-methods': '*',
          'access-control-allow-headers': '*',
        },
      });
    }
    if (route.request().url().includes('/part/')) partPuts.push(route.request().url());
    return route.fulfill({ status: 200, headers: { ...CORS, etag: '"e"' }, body: '' });
  });
  return { items, started, partRequests, partPuts };
}

test.describe('Thư viện media ở 360 px', () => {
  test.use({ viewport: { width: 360, height: 740 } });

  test('tải 3 ảnh ⇒ lưới có 3 ô "Sẵn sàng", không cuộn ngang', async ({ page }) => {
    await fakeMedia(page, []);
    await login(page);
    await expect(page.getByRole('region', { name: 'Tải lên' })).toBeVisible();

    const png = Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
      'base64',
    );
    await page.locator('input[type="file"]:not([capture])').setInputFiles(
      [1, 2, 3].map((n) => ({
        name: `anh-${String(n)}.png`,
        mimeType: 'image/png',
        buffer: png,
      })),
    );

    const grid = page.getByRole('list', { name: 'Ảnh và video' });
    await expect(grid.getByText('Sẵn sàng')).toHaveCount(3, { timeout: 30_000 });
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(0);
  });

  test('chọn lại video đang dở ⇒ chỉ xin và tải phần còn thiếu (phần 2)', async ({ page }) => {
    const fake = await fakeMedia(page, []);
    await login(page);
    await page.locator('input[type="file"]:not([capture])').setInputFiles({
      name: 'video-do-dang.mp4',
      mimeType: 'video/mp4',
      buffer: Buffer.alloc(9 * MIB),
    });
    await expect.poll(() => fake.partPuts.length, { timeout: 30_000 }).toBeGreaterThan(0);
    expect(fake.partRequests.flat()).toEqual([2]);
    expect(fake.partPuts.every((u) => u.endsWith('/part/2'))).toBe(true);
    await expect(
      page.getByRole('list', { name: 'Ảnh và video' }).getByText('Sẵn sàng'),
    ).toHaveCount(1, { timeout: 30_000 });
  });

  test('hết chỗ ⇒ "Thư viện đã đầy", khóa chọn tệp, vẫn có nút xóa và lối tới danh sách', async ({
    page,
  }) => {
    await fakeMedia(
      page,
      [{ id: uuid(1), kind: 'image', displayName: 'cu.png', originalBytes: LIMIT }],
      LIMIT,
    );
    await login(page);
    await expect(page.getByText('Thư viện đã đầy').first()).toBeVisible();
    await expect(page.getByRole('link', { name: 'Xem danh sách để xóa' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Xóa cu.png' })).toBeVisible();
    const box = await page.getByRole('button', { name: 'Xóa cu.png' }).boundingBox();
    expect(box?.height ?? 0).toBeGreaterThanOrEqual(43.5);
  });
});
