import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';

// Danh mục thành phần (FR-033, SC-003/SC-004): ở 360/768/1280 px (3 project của playwright.config) không có vi phạm
// trợ năng mức nghiêm trọng, không cuộn ngang, vùng chạm ≥ 44 px, và công tắc "cỡ chữ 200%" không cắt nút.
// Danh mục chỉ chạy khi VITE_ENABLE_CATALOG=1 (webServer của cấu hình đã bật).

const PAGES = [
  { path: '/_catalog', heading: 'Danh mục thành phần' },
  { path: '/_catalog/sample', heading: 'Màn hình mẫu' },
] as const;
const MIN_TOUCH = 44;

async function seriousViolations(page: Page) {
  const result = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
    .analyze();
  return result.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical');
}

async function hasHorizontalScroll(page: Page) {
  return page.evaluate(
    () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
  );
}

/** Nút/liên kết hiện ra nhưng nhỏ hơn 44 px (bỏ qua phần tử nằm trong vùng cuộn riêng của khung xem). */
async function smallTargets(page: Page) {
  return page.evaluate((min) => {
    const out: string[] = [];
    for (const el of document.querySelectorAll<HTMLElement>(
      'button, a[href], [role="button"], [role="tab"], [role="switch"]',
    )) {
      const r = el.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) continue;
      if (el.closest('[data-catalog-skip-target]') !== null) continue;
      if (r.height < min || r.width < min) {
        out.push(
          `${el.tagName.toLowerCase()} "${(el.textContent ?? '').trim().slice(0, 30)}" ${String(Math.round(r.width))}×${String(Math.round(r.height))}`,
        );
      }
    }
    return out;
  }, MIN_TOUCH);
}

for (const { path, heading } of PAGES) {
  test.describe(`danh mục ${path}`, () => {
    test('0 vi phạm trợ năng nghiêm trọng', async ({ page }) => {
      await page.goto(path);
      await expect(page.getByRole('heading', { level: 1, name: heading })).toBeVisible();
      expect(await seriousViolations(page)).toEqual([]);
    });

    test('không cuộn ngang', async ({ page }) => {
      await page.goto(path);
      await expect(page.getByRole('heading', { level: 1, name: heading })).toBeVisible();
      expect(await hasHorizontalScroll(page)).toBe(false);
    });

    test('vùng chạm ≥ 44 px', async ({ page }) => {
      await page.goto(path);
      await expect(page.getByRole('heading', { level: 1, name: heading })).toBeVisible();
      expect(await smallTargets(page)).toEqual([]);
    });
  });
}

test('cỡ chữ 200% không cắt nút và không cuộn ngang trang', async ({ page }) => {
  await page.goto('/_catalog');
  await page.getByRole('button', { name: 'Cỡ chữ 200%' }).click();
  await expect(page.locator('html[data-catalog-text="200"]')).toHaveCount(1);
  expect(await hasHorizontalScroll(page)).toBe(false);
  // Nút không bị cắt: nội dung không rộng hơn khung của chính nó.
  const clipped = await page.evaluate(() =>
    [...document.querySelectorAll<HTMLElement>('button')]
      .filter((b) => b.getBoundingClientRect().width > 0 && b.scrollWidth > b.clientWidth + 1)
      .map((b) => (b.textContent ?? '').trim().slice(0, 30)),
  );
  expect(clipped).toEqual([]);
  expect(await seriousViolations(page)).toEqual([]);
});

test('tương phản cao vẫn không có vi phạm nghiêm trọng', async ({ page }) => {
  await page.goto('/_catalog');
  await page.getByRole('button', { name: 'Tương phản cao' }).click();
  expect(await seriousViolations(page)).toEqual([]);
});
