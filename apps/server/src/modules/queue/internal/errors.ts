import { ERROR_CODES } from '@app/shared/core';
import { AppError } from '../../../core';

// Lỗi của lớp hàng chờ (contracts/queue-api.md mục 2): đều là lỗi lập trình/vận hành – khách hàng chỉ
// thấy INTERNAL_ERROR, mã gốc nằm ở `detail` ("Chi tiết cho hỗ trợ").

export type QueueErrorCode =
  | 'QUEUE_TX_REQUIRED'
  | 'QUEUE_TENANT_CONTEXT_REQUIRED'
  | 'QUEUE_SYSTEM_CONTEXT_REQUIRED'
  | 'QUEUE_SYSTEM_TENANT_CONTEXT_REQUIRED'
  | 'QUEUE_JOB_TYPE_UNKNOWN'
  | 'QUEUE_PAYLOAD_INVALID'
  | 'QUEUE_PAYLOAD_TOO_LARGE'
  | 'QUEUE_DUPLICATE_IN_BATCH'
  | 'QUEUE_BATCH_TOO_LARGE'
  | 'QUEUE_DEDUPE_KEY_INVALID'
  | 'QUEUE_DEDUPE_KEY_CONFLICT'
  | 'QUEUE_NOT_STARTED'
  | 'QUEUE_HANDLER_ON_API'
  | 'QUEUE_SCHEMA_VERSION_MISMATCH';

export function queueError(code: QueueErrorCode): AppError {
  return new AppError({
    code: ERROR_CODES.INTERNAL_ERROR,
    httpStatus: 500,
    message: 'Hệ thống gặp lỗi khi xếp việc nền. Vui lòng thử lại sau ít phút.',
    actions: [
      { kind: 'retry', label: 'Thử lại' },
      { kind: 'contact_support', label: 'Liên hệ hỗ trợ' },
    ],
    detail: code,
  });
}

/** Mã gốc của một lỗi hàng chờ (để kiểm thử/nhật ký); undefined khi không phải lỗi hàng chờ. */
export function queueErrorCode(err: unknown): string | undefined {
  return err instanceof AppError ? err.detail : undefined;
}
