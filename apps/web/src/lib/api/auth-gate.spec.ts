import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeMe } from '../../../test/helpers/render';
import { registerAccountDataCleaner } from '../session/clear-account-data';
import { createAuthGate, type AuthGate } from './auth-gate';
import { AppError } from './errors';

const expired = (reason?: AppError['reason']) =>
  new AppError({
    kind: 'session_expired',
    status: 401,
    code: 'UNAUTHENTICATED',
    message: 'Hết phiên',
    actions: [],
    ...(reason !== undefined ? { reason } : {}),
  });

describe('AuthGate – bảng chuyển trạng thái', () => {
  let onNoSession: ReturnType<typeof vi.fn<() => void>>;
  let onEmailNotVerified: ReturnType<typeof vi.fn<() => void>>;
  let gate: AuthGate;

  beforeEach(() => {
    onNoSession = vi.fn();
    onEmailNotVerified = vi.fn();
    gate = createAuthGate({ onNoSession, onEmailNotVerified });
  });

  it('chưa từng có phiên (mở ứng dụng) → chuyển đăng nhập, không có hộp thoại', async () => {
    expect(await gate.onUnauthenticated(expired())).toBe('ended');
    expect(onNoSession).toHaveBeenCalledTimes(1);
    expect(gate.getSnapshot().status).toBe('idle');
  });

  it('idle → reauth_required; nhiều 401 cùng lúc gộp thành MỘT promise', async () => {
    gate.setSession({ userId: 'u-1', accountId: 'a-1' });
    const a = gate.onUnauthenticated(expired());
    const b = gate.onUnauthenticated(expired());
    const c = gate.onUnauthenticated(expired('expired'));
    expect(gate.getSnapshot().status).toBe('reauth_required');
    expect(a).toBe(b);
    expect(b).toBe(c);
    gate.completeReauth(fakeMe());
    expect(await Promise.all([a, b, c])).toEqual(['resumed', 'resumed', 'resumed']);
    expect(gate.getSnapshot().status).toBe('idle');
  });

  it('cùng user.id & account.id → resumed', async () => {
    gate.setSession({ userId: 'u-1', accountId: 'a-1' });
    const p = gate.onUnauthenticated(expired());
    expect(gate.completeReauth(fakeMe())).toBe('resumed');
    expect(await p).toBe('resumed');
  });

  it('khác người → switched: dọn MỌI dữ liệu tài khoản cũ', async () => {
    gate.setSession({ userId: 'u-1', accountId: 'a-1' });
    const cleaner = vi.fn();
    const off = registerAccountDataCleaner(cleaner);
    const p = gate.onUnauthenticated(expired());
    const other = fakeMe('owner', {
      user: {
        id: 'u-2',
        displayName: 'Người khác',
        email: 'khac@example.test',
        emailVerified: true,
      },
    });
    expect(gate.completeReauth(other)).toBe('switched');
    expect(await p).toBe('switched');
    expect(cleaner).toHaveBeenCalled();
    expect(gate.getSnapshot().status).toBe('switched');
    off();
  });

  it('cùng người nhưng khác tài khoản cũng là switched', () => {
    gate.setSession({ userId: 'u-1', accountId: 'a-1' });
    void gate.onUnauthenticated(expired());
    const other = fakeMe('owner', { account: { id: 'a-2', status: 'active' } });
    expect(gate.completeReauth(other)).toBe('switched');
  });

  it.each(['password_changed', 'removed', 'locked', 'revoked'] as const)(
    'reason=%s → ended (không có "tiếp tục")',
    async (reason) => {
      gate.setSession({ userId: 'u-1', accountId: 'a-1' });
      expect(await gate.onUnauthenticated(expired(reason))).toBe('ended');
      expect(gate.getSnapshot()).toEqual({ status: 'ended', reason });
    },
  );

  it('reason=expired hoặc thiếu → vẫn đăng nhập lại tại chỗ', () => {
    gate.setSession({ userId: 'u-1', accountId: 'a-1' });
    void gate.onUnauthenticated(expired('expired'));
    expect(gate.getSnapshot().status).toBe('reauth_required');
  });

  it('người dùng hủy hộp thoại → ended', async () => {
    gate.setSession({ userId: 'u-1', accountId: 'a-1' });
    const p = gate.onUnauthenticated(expired());
    gate.cancelReauth();
    expect(await p).toBe('ended');
    expect(gate.getSnapshot().status).toBe('ended');
  });

  it('EMAIL_NOT_VERIFIED giữ hành vi cũ (chuyển /verify-email)', () => {
    gate.onEmailNotVerified(expired());
    expect(onEmailNotVerified).toHaveBeenCalledTimes(1);
  });

  it('thông báo cho người nghe khi đổi trạng thái', () => {
    gate.setSession({ userId: 'u-1', accountId: 'a-1' });
    const listener = vi.fn();
    gate.subscribe(listener);
    void gate.onUnauthenticated(expired());
    expect(listener).toHaveBeenCalled();
  });
});
