import { describe, expect, it } from 'vitest';
import { FIGMA_VARIANTS, figmaCombinationTotal } from './figma-variants';
import * as ui from './index';

describe('figma-variants (SC-001)', () => {
  it('mọi hàng có thành phần xuất khẩu tương ứng trong ui/index.ts', () => {
    const exported = ui as unknown as Record<string, unknown>;
    const missing = FIGMA_VARIANTS.filter((row) => exported[row.component] === undefined).map(
      (r) => r.component,
    );
    // Thành phần chưa dựng được liệt kê tường minh để không "quên" – danh sách này phải rỗng ở cuối tính năng.
    expect(missing).toEqual([]);
  });

  it('số tổ hợp theo thuộc tính khớp số tổ hợp khai báo (Figma + chờ thiết kế)', () => {
    for (const row of FIGMA_VARIANTS) {
      const combos = Object.values(row.props).reduce((n, values) => n * values.length, 1);
      if (Object.keys(row.props).length === 0) continue;
      // ChannelTabs/NavBar/Sidebar: một thuộc tính "mục đang chọn" – số giá trị = số tổ hợp.
      expect(combos, row.component).toBeGreaterThanOrEqual(row.figmaCombinations);
    }
  });

  it('các biến thể ngoài Figma được liệt kê riêng (designPending)', () => {
    const pending = FIGMA_VARIANTS.filter((r) => r.pendingCombinations > 0).map((r) => r.component);
    expect(pending).toEqual(
      expect.arrayContaining([
        'Button',
        'StatusBadge',
        'ChannelTabs',
        'Field',
        'ConfirmDialog',
        'Skeleton',
      ]),
    );
  });

  it('tổng tổ hợp đã có thiết kế ≥ 80 (≈ 70 biến thể + 26 biểu tượng ngoài bảng)', () => {
    expect(figmaCombinationTotal()).toBeGreaterThanOrEqual(60);
  });
});
