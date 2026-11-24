import { AppError } from '../../../../core';
import { aiAdminErrorCode } from '../db/admin-functions';

// Lỗi nghiệp vụ của điểm cuối quản trị cấu hình Cổng AI (015 US3, contracts/admin-ops.md mục 2). Mã ổn định, lời giải thích
// tiếng Việt, mỗi lỗi kèm ít nhất một hành động khắc phục (hiến chương VI). Trạng thái 422: không phải 401/403/404.
// Chỉ nhân viên admin thấy; thông điệp không chứa bí mật.

/** Đệm TTL bộ nhớ đệm giá (cấu hình kẹp tối đa 60 s ở module): giá mới phải hiệu lực muộn hơn `now + TTL`. */
export const PRICE_CACHE_TTL_MS = 60_000;

export type AdminErrorCode =
  | 'AI_PRICE_IMPLAUSIBLE'
  | 'AI_PRICE_EFFECTIVE_TOO_SOON'
  | 'AI_SETTINGS_INVALID'
  | 'AI_ROUTE_INVALID';

const fix = (label: string): [{ kind: 'fix_input'; label: string }] => [
  { kind: 'fix_input', label },
];

export function adminError(code: AdminErrorCode, message: string, label: string): AppError {
  return new AppError({ code, httpStatus: 422, message, actions: fix(label), detail: code });
}

export const priceImplausible = (why: string): AppError =>
  adminError(
    'AI_PRICE_IMPLAUSIBLE',
    `Giá không hợp lý: ${why}. Giá phải lớn hơn 0 và lệch tối đa 10 lần so với giá hiện hành (tăng hoặc giảm).`,
    'Kiểm tra lại đơn giá rồi gửi lại',
  );

export const effectiveTooSoon = (minIso: string): AppError =>
  adminError(
    'AI_PRICE_EFFECTIVE_TOO_SOON',
    `Thời điểm hiệu lực quá gần. Giá mới phải có hiệu lực từ ${minIso} trở đi để bộ nhớ đệm giá kịp làm mới.`,
    'Chọn thời điểm hiệu lực muộn hơn rồi gửi lại',
  );

export const settingsInvalid = (why: string): AppError =>
  adminError(
    'AI_SETTINGS_INVALID',
    `Cấu hình không hợp lệ: ${why}.`,
    'Sửa giá trị theo hướng dẫn rồi gửi lại',
  );

export const routeInvalid = (why: string): AppError =>
  adminError(
    'AI_ROUTE_INVALID',
    `Tuyến mô hình không hợp lệ: ${why}.`,
    'Sửa tuyến hoặc thêm dòng giá cho mô hình trước',
  );

/**
 * Đổi lỗi SQL nghiệp vụ (22023) sang lỗi 422 tiếng Việt. Lỗi khác (kể cả ghi kiểm toán hỏng) ném lại nguyên văn để thành
 * 5xx; giao dịch đã hoàn tác cả cấu hình lẫn kiểm toán.
 */
export function mapAdminSqlError(
  error: unknown,
  context: 'price' | 'settings' | 'route' | 'invoice',
): never {
  const code = aiAdminErrorCode(error);
  if (code === 'AI_PRICE_IMPLAUSIBLE')
    throw priceImplausible('giá phải lớn hơn 0 và lệch tối đa 10 lần so với dòng giá liền trước');
  if (code === 'AI_PRICE_EFFECTIVE_TOO_SOON') {
    // SQL không trả mốc sớm nhất: tự tính now + 60 s cho thông điệp.
    throw effectiveTooSoon(new Date(Date.now() + PRICE_CACHE_TTL_MS).toISOString());
  }
  if (code === 'AI_ROUTE_INVALID')
    throw routeInvalid('rank phải là 1 hoặc 2 và mô hình phải có dòng giá');
  if (code === 'AI_SETTINGS_INVALID') {
    throw settingsInvalid(
      context === 'invoice'
        ? 'hóa đơn không hợp lệ (nhà cung cấp, ngày hoặc tổng tiền sai; tổng phải ≥ 0)'
        : 'giá trị phải là số nguyên dương và hạn mức mềm phải nhỏ hơn trần',
    );
  }
  throw error;
}
