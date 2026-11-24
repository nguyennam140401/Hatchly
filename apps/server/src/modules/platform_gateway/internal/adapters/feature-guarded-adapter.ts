import { AppError, currentAccountId } from '../../../../core';
import type { PlatformAdapter } from './adapter';

// FeatureGuardedAdapter (010 T079/T080, FR-036…FR-038, SC-011): decorator gọi `requireFeature` TRƯỚC mọi thao tác có thể chạm mạng
// của bộ chuyển đổi bọc bên trong. Công tắc tắt/không đọc được ⇒ từ chối `FEATURE_NOT_ENABLED` và KHÔNG có lời gọi mạng nào – kể cả
// khi đường gọi (Worker, dịch vụ khác) quên tự kiểm. Thao tác thuần (không mạng) đi thẳng xuống để màn hình vẫn dựng được.

/** Cấu trúc: dấu hiệu bộ chuyển đổi đã được bọc (kiểm thử khẳng định `getAdapter('tiktok')` ở chế độ thật luôn đi qua decorator). */
export const GUARDED = Symbol.for('platform_gateway.feature_guarded');

const NETWORK_METHODS = [
  'checkAccount',
  'submit',
  'checkStatus',
  'reconcile',
  'refreshToken',
  'renewToken',
  'revoke',
  'expiryOf',
  'exchangeCallback',
] as const;

export function featureNotEnabledError(): AppError {
  return new AppError({
    code: 'FEATURE_NOT_ENABLED',
    httpStatus: 403,
    message: 'Tính năng này chưa được mở cho tài khoản của bạn.',
    actions: [{ kind: 'navigate', label: 'Quay lại Kênh kết nối', href: '/channels' }],
  });
}

/** Bọc `inner`; `isEnabled(accountId)` là công tắc hiệu lực (lỗi đọc đã được `FeatureGate` đổi thành `false`). */
export function guardAdapter(
  inner: PlatformAdapter,
  isEnabled: (accountId: string) => Promise<boolean>,
): PlatformAdapter {
  const guard = async (): Promise<void> => {
    const accountId = currentAccountId();
    if (accountId === null || !(await isEnabled(accountId))) throw featureNotEnabledError();
  };
  return new Proxy(inner, {
    get(target, prop, receiver) {
      if (prop === GUARDED) return true;
      const value: unknown = Reflect.get(target, prop, receiver);
      if (typeof value !== 'function') return value;
      const bound = (value as (...args: unknown[]) => unknown).bind(target);
      if (!(NETWORK_METHODS as readonly (string | symbol)[]).includes(prop)) return bound;
      return async (...args: unknown[]) => {
        await guard();
        return bound(...args);
      };
    },
  });
}
