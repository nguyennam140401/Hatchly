import { z } from 'zod';

// Kiểu nền dùng chung web ↔ API (data-model.md mục 2.1, R16).

/** Mã định danh: UUID v7, sinh ở máy chủ; web chỉ kiểm tra. */
export const Id = z.uuid({ version: 'v7' });
export type Id = z.infer<typeof Id>;

/** Thời điểm ISO 8601 theo UTC, bắt buộc hậu tố `Z` (không nhận offset khác). Hiển thị UTC+7 là việc của web. */
export const UtcDateTime = z.iso.datetime();
export type UtcDateTime = z.infer<typeof UtcDateTime>;

/**
 * Tiền tính bằng micro-USD (số nguyên an toàn ≥ 0).
 * Không dùng trong hợp đồng cho khách hàng – chỉ hợp đồng nội bộ/hỗ trợ (`internal-support.ts`),
 * vì số tiền chi phí AI không bao giờ được hiển thị cho khách (nguyên tắc III, FR-12).
 */
export const MicroUsd = z.int().nonnegative();
export type MicroUsd = z.infer<typeof MicroUsd>;

/** Phần trăm đã dùng trên trần (số nguyên 0–100) – cách duy nhất hiển thị mức dùng AI cho khách. */
export const UsagePercent = z.int().min(0).max(100);
export type UsagePercent = z.infer<typeof UsagePercent>;

/** Đơn vị triển khai. */
export const UnitName = z.enum(['api', 'worker']);
export type UnitName = z.infer<typeof UnitName>;
