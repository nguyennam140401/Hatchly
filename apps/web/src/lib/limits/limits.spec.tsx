import { screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { renderWithProviders } from '../../../test/helpers/render';
import { Button } from '../../ui/button/Button';
import { UsageMeter } from '../../ui/cards/UsageMeter';
import { limitOf, LimitGate, useLimit } from './useLimit';
import { setUsageSource, useEnsureUsageFresh, type UsageSnapshot } from './useUsage';

const usage = (ai: UsageSnapshot['ai'], extra: Partial<UsageSnapshot> = {}): UsageSnapshot => ({
  posts: { used: 10, limit: 100 },
  ai,
  storage: { usedBytes: 1, limitBytes: 5 * 1024 ** 3 },
  ...extra,
});

afterEach(() => {
  setUsageSource(undefined);
});

describe('limitOf', () => {
  it('AI: normal → near (≥ 80%) → reached (100%) khóa kèm ngày mở lại', () => {
    expect(limitOf('ai', usage({ percent: 40, level: 'normal' }))).toMatchObject({ locked: false, near: false });
    expect(limitOf('ai', usage({ percent: 85, level: 'near' }))).toMatchObject({ locked: false, near: true });
    const reached = limitOf('ai', usage({ percent: 100, level: 'reached', reopensAt: '2026-12-01T00:00:00Z' }));
    expect(reached.locked).toBe(true);
    expect(reached.reason).toContain('Bạn vẫn soạn tay');
    expect(reached.reopensAt?.toISOString()).toBe('2026-12-01T00:00:00.000Z');
  });
  it('bài/dung lượng khóa khi chạm trần; chưa biết mức → không khóa', () => {
    expect(limitOf('posts', usage({ percent: 0, level: 'normal' }, { posts: { used: 100, limit: 100 } })).locked).toBe(true);
    expect(limitOf('storage', usage({ percent: 0, level: 'normal' }, { storage: { usedBytes: 5, limitBytes: 5 } })).locked).toBe(true);
    expect(limitOf('ai', undefined)).toEqual({ locked: false, near: false, percent: 0 });
  });
});

describe('LimitGate – AI = 100%', () => {
  function Screen() {
    return (
      <main>
        <LimitGate kind="ai">
          {(s) => (
            <Button locked={s.locked} lockedReason={s.reason} reopensAt={s.reopensAt}>
              Tạo bài bằng AI
            </Button>
          )}
        </LimitGate>
        <LimitGate kind="ai">
          {(s) => (
            <Button locked={s.locked} lockedReason={s.reason}>
              Gợi ý chủ đề
            </Button>
          )}
        </LimitGate>
        <Button>Soạn tay</Button>
        <UsageMeter label="Lượt AI" value={100} limit={100} level="exhausted" unit="percent" />
      </main>
    );
  }

  it('mọi nút AI khóa CÙNG LÚC, soạn tay vẫn dùng được, KHÔNG có số tiền', async () => {
    setUsageSource(() =>
      Promise.resolve(usage({ percent: 100, level: 'reached', reopensAt: '2026-12-01T00:00:00Z' })),
    );
    const { container } = renderWithProviders(<Screen />);
    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Tạo bài bằng AI' })).toHaveAttribute('aria-disabled', 'true');
    });
    expect(screen.getByRole('button', { name: 'Gợi ý chủ đề' })).toHaveAttribute('aria-disabled', 'true');
    expect(screen.getByRole('button', { name: 'Soạn tay' })).not.toHaveAttribute('aria-disabled');
    expect(screen.getByRole('button', { name: 'Tạo bài bằng AI' })).toHaveAccessibleDescription(/Mở lại vào 01\/12\/2026/);
    expect(container.textContent).not.toMatch(/\$|USD|VND|đồng/i);
  });
});

describe('useEnsureUsageFresh (FR-026)', () => {
  function Probe({ onResult }: { onResult: (u: UsageSnapshot | undefined) => void }) {
    const ensure = useEnsureUsageFresh();
    const limit = useLimit('ai');
    return (
      <button type="button" onClick={() => void ensure().then(onResult)}>
        {limit.locked ? 'khóa' : 'mở'}
      </button>
    );
  }
  it('luôn lấy mức mới nhất từ máy chủ trước thao tác (không dùng bản cũ)', async () => {
    const source = vi
      .fn<() => Promise<UsageSnapshot>>()
      .mockResolvedValueOnce(usage({ percent: 10, level: 'normal' }))
      .mockResolvedValue(usage({ percent: 100, level: 'reached' }));
    setUsageSource(source);
    const results: (UsageSnapshot | undefined)[] = [];
    renderWithProviders(<Probe onResult={(u) => results.push(u)} />);
    const button = await screen.findByRole('button', { name: 'mở' });
    button.click();
    await waitFor(() => {
      expect(results).toHaveLength(1);
    });
    expect(results[0]?.ai.percent).toBe(100);
    expect(source.mock.calls.length).toBeGreaterThanOrEqual(2);
  });
});
