// 009 T086: gom kết quả của một lượt callback mà không đổi chữ ký hàm bên trong.
import { describe, expect, it } from 'vitest';
import {
  markCallbackFailed,
  recordDetachedPurged,
  recordInvitation,
  recordMailFailed,
  recordMailSend,
  recordOAuth,
  withCallbackOutcome,
} from '../../../src/modules/account/internal/auth/auth-metrics';

describe('withCallbackOutcome', () => {
  it('không có lỗi nào được ghi → ok', async () => {
    const { value, outcome } = await withCallbackOutcome(async () => Promise.resolve(42));
    expect(value).toBe(42);
    expect(outcome).toBe('ok');
  });

  it('lỗi ghi ở hàm con (qua await) → lý do đầu tiên được giữ', async () => {
    const { outcome } = await withCallbackOutcome(async () => {
      await Promise.resolve();
      markCallbackFailed('provider_error');
      markCallbackFailed('account_unavailable');
    });
    expect(outcome).toBe('provider_error');
  });

  it('hai lượt đồng thời không lẫn kết quả', async () => {
    const [a, b] = await Promise.all([
      withCallbackOutcome(async () => {
        await new Promise((r) => setTimeout(r, 5));
        markCallbackFailed('cancelled');
      }),
      withCallbackOutcome(async () => {
        await new Promise((r) => setTimeout(r, 1));
      }),
    ]);
    expect(a.outcome).toBe('cancelled');
    expect(b.outcome).toBe('ok');
  });

  it('ngoài lượt callback, markCallbackFailed không làm gì và không ném', () => {
    expect(() => {
      markCallbackFailed('expired');
    }).not.toThrow();
  });
});

describe('hàm ghi chỉ số (no-op khi chưa có SDK)', () => {
  it('không ném', () => {
    expect(() => {
      recordOAuth('google', 'ok', 0.2);
      recordInvitation('sent');
      recordInvitation('expired', 0);
      recordDetachedPurged();
      recordMailSend('inviteMember', 0.3);
      recordMailFailed('inviteMember');
    }).not.toThrow();
  });
});
