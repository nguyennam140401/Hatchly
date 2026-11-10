import type { Request, Response } from 'express';
import { clientIp } from '../../../../core/auth/client-ip';
import { hashToken, readCookie } from '../../../../core/auth/cookies';
import { LoginThrottledError } from './errors';
import type { RequestMeta } from './session.service';

// Tiện ích HTTP dùng chung cho controller xác thực.

export function requestMeta(req: Request): RequestMeta {
  return { ip: clientIp(req), userAgent: req.headers['user-agent'] };
}

/** Băm mã phiên trong cookie (không bao giờ giữ mã gốc lâu hơn cần thiết). */
export function cookieTokenHash(req: Request, name: string): Buffer | undefined {
  const token = readCookie(req, name);
  return token === undefined ? undefined : hashToken(token);
}

/** 429 LOGIN_THROTTLED → đặt tiêu đề `Retry-After` rồi ném tiếp. */
export async function withRetryAfter<T>(res: Response, fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    if (err instanceof LoginThrottledError)
      res.setHeader('Retry-After', String(err.retryAfterSeconds));
    throw err;
  }
}

/** Số giây còn lại tới `at` (Max-Age của cookie khách hàng = hết hạn tuyệt đối). */
export function secondsUntil(at: Date): number {
  return Math.max(0, Math.floor((at.getTime() - Date.now()) / 1000));
}
