import { beforeEach, describe, expect, it, vi } from 'vitest';

// T009a (015, R-05, FR-014, contracts/ai-gateway-delta.md): AccountPublicApi.getAiCycleAnchor().
// Hiện thực tạm: tài khoản `active` → ngày (UTC+7) của `created_at`; trạng thái khác / không có dòng → null;
// không cache (Hiến pháp: không cache ngân sách/hạn mức). Kiểm thử đơn vị: giả lập lớp CSDL `tenantTx`.
//
// Giả định vị trí hiện thực (khuôn `internal/publishing-eligibility.ts`):
//   apps/server/src/modules/account/internal/ai-cycle-anchor.ts xuất `getAiCycleAnchor()`.

const state = vi.hoisted(() => ({
  accountId: 'acc-1',
  rows: [] as Record<string, unknown>[],
  tenantTxCalls: 0,
}));

vi.mock('../../src/core', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  /** Chuỗi truy vấn giả: mọi bước trả chính nó, `await` trả về các dòng đã đặt. */
  const chain = (): unknown =>
    new Proxy(() => undefined, {
      get(_t, prop) {
        if (prop === 'then') {
          return (resolve: (v: unknown) => unknown) => resolve(state.rows);
        }
        return () => chain();
      },
    });
  return {
    ...actual,
    currentAccountId: () => state.accountId,
    tenantTx: (fn: (db: unknown) => unknown) => {
      state.tenantTxCalls += 1;
      return Promise.resolve(fn({ select: () => chain() }));
    },
  };
});

import { getAiCycleAnchor } from '../../src/modules/account/internal/ai-cycle-anchor';

/** Dòng tài khoản; đặt cả hai kiểu khóa để không phụ thuộc cách đặt tên cột chọn ra. */
function accountRow(status: string, createdAt: string): Record<string, unknown> {
  const date = new Date(createdAt);
  return { status, createdAt: date, created_at: date, deletedAt: null, deleted_at: null };
}

describe('AccountPublicApi.getAiCycleAnchor', () => {
  beforeEach(() => {
    state.accountId = 'acc-1';
    state.rows = [];
    state.tenantTxCalls = 0;
  });

  it('tài khoản active → ngày tạo dạng YYYY-MM-DD', async () => {
    state.rows = [accountRow('active', '2026-03-15T05:00:00.000Z')];
    await expect(getAiCycleAnchor()).resolves.toEqual({ anchorDate: '2026-03-15' });
  });

  it('ngày tính theo UTC+7: 16:59:59Z vẫn cùng ngày, 17:00:00Z sang ngày kế', async () => {
    state.rows = [accountRow('active', '2026-01-31T16:59:59.000Z')];
    await expect(getAiCycleAnchor()).resolves.toEqual({ anchorDate: '2026-01-31' });
    state.rows = [accountRow('active', '2026-01-31T17:00:00.000Z')];
    await expect(getAiCycleAnchor()).resolves.toEqual({ anchorDate: '2026-02-01' });
  });

  it('ngày tạo 29–31 được giữ nguyên làm mốc (tháng ngắn xử lý ở cycle.ts, không ở đây)', async () => {
    for (const [iso, expected] of [
      ['2026-01-29T03:00:00.000Z', '2026-01-29'],
      ['2026-01-30T03:00:00.000Z', '2026-01-30'],
      ['2026-01-31T03:00:00.000Z', '2026-01-31'],
      ['2024-02-29T03:00:00.000Z', '2024-02-29'],
    ] as const) {
      state.rows = [accountRow('active', iso)];
      await expect(getAiCycleAnchor()).resolves.toEqual({ anchorDate: expected });
    }
  });

  it.each(['suspended', 'expired', 'deleting', 'unclaimed'])(
    'trạng thái %s → null (lời gọi AI bị từ chối như hết hạn mức)',
    async (status) => {
      state.rows = [accountRow(status, '2026-03-15T05:00:00.000Z')];
      await expect(getAiCycleAnchor()).resolves.toBeNull();
    },
  );

  it('không có dòng tài khoản → null', async () => {
    state.rows = [];
    await expect(getAiCycleAnchor()).resolves.toBeNull();
  });

  it('không cache: mỗi lần gọi đọc lại CSDL và phản ánh đổi trạng thái ngay', async () => {
    state.rows = [accountRow('active', '2026-03-15T05:00:00.000Z')];
    await expect(getAiCycleAnchor()).resolves.toEqual({ anchorDate: '2026-03-15' });
    expect(state.tenantTxCalls).toBe(1);

    state.rows = [accountRow('suspended', '2026-03-15T05:00:00.000Z')];
    await expect(getAiCycleAnchor()).resolves.toBeNull();
    expect(state.tenantTxCalls).toBe(2);

    state.rows = [accountRow('active', '2026-03-15T05:00:00.000Z')];
    await expect(getAiCycleAnchor()).resolves.toEqual({ anchorDate: '2026-03-15' });
    expect(state.tenantTxCalls).toBe(3);
  });

  it('mã tài khoản lấy từ ngữ cảnh, hàm không nhận tham số', () => {
    expect(getAiCycleAnchor.length).toBe(0);
  });
});
