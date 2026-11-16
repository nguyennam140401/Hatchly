import { AppError } from './errors';

// Khóa lạc quan phía giao diện (FR-018) – QUYẾT ĐỊNH CÁCH GỬI PHIÊN BẢN, thống nhất cho mọi tính năng:
//
//   • Thao tác ghi trên bản ghi dùng chung gửi `expectedVersion: number` TRONG THÂN yêu cầu (không dùng tiêu đề If-Match).
//   • Lý do: 006 đã dùng đúng quy ước này (`PUT /context/profile { expectedVersion }`, `core/db/versioned.ts`), thân yêu cầu
//     đi qua cùng lược đồ Zod dùng chung nên dễ kiểm hơn tiêu đề tùy ý (`apiClient` không thêm tiêu đề ngoài accept/content-type).
//   • `0` nghĩa là "chưa có bản ghi" (lần lưu đầu tiên).
//   • Máy chủ trả `409 VERSION_CONFLICT` khi lệch → `AppError.kind === 'version_conflict'`.

export const VERSION_FIELD = 'expectedVersion';

/** Thêm `expectedVersion` vào thân (thân rỗng → chỉ có phiên bản). */
export function withVersion(body: unknown, version: number): Record<string, unknown> {
  if (body === undefined || body === null) return { [VERSION_FIELD]: version };
  if (typeof body !== 'object' || Array.isArray(body)) {
    throw new Error('withVersion: thân yêu cầu phải là đối tượng');
  }
  return { ...(body as Record<string, unknown>), [VERSION_FIELD]: version };
}

export function isVersionConflict(error: unknown): error is AppError {
  return error instanceof AppError && error.kind === 'version_conflict';
}
