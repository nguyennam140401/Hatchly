import { expect } from 'vitest';

// Kiểm bền thông điệp khách của Cổng AI (hiến chương III, VI): có hành động khắc phục, không số tiền,
// không tên nhà cung cấp. Không so khớp chuỗi chính xác để chỉnh câu chữ không làm vỡ test.
const REMEDY = /thử lại|soạn|đợi|kiểm tra lại|liên hệ|chờ/i;
const FORBIDDEN = /\d|\$|usd|micro|₫|vnd|anthropic|openai|AI_[A-Z_]+/i;

/** Thông điệp phải có hành động khắc phục và không lộ tiền/nhà cung cấp/mã lỗi gốc. */
export function expectCustomerSafeRemedy(message: string, label?: string): void {
  expect(message, label).toMatch(REMEDY);
  expect(message, label).not.toMatch(FORBIDDEN);
}
