import type { PipeTransform } from '@nestjs/common';
import { ERROR_CODES, toFieldErrors } from '@app/shared/core';
import type { z } from 'zod';
import { AppError } from '../errors/app-error';

/**
 * Kiểm tra đầu vào HTTP bằng lược đồ Zod dùng chung (FR-013a, R8).
 * Đây là nơi DUY NHẤT phía máy chủ gọi Zod cho đầu vào HTTP; controller dùng qua
 * `@ValidBody` / `@ValidQuery` / `@ValidParam`.
 */
export class ZodValidationPipe<S extends z.ZodType> implements PipeTransform<unknown, z.infer<S>> {
  constructor(private readonly schema: S) {}

  transform(value: unknown): z.infer<S> {
    const result = this.schema.safeParse(value);
    if (result.success) return result.data;
    throw new AppError({
      code: ERROR_CODES.VALIDATION_FAILED,
      httpStatus: 400,
      message: 'Thông tin gửi lên chưa đúng. Vui lòng kiểm tra lại các ô được đánh dấu.',
      actions: [{ kind: 'fix_input', label: 'Sửa thông tin' }],
      fieldErrors: toFieldErrors(result.error),
      // Mã issue Zod đầu tiên – cho "Chi tiết cho hỗ trợ", không chứa giá trị người dùng gửi.
      ...(result.error.issues[0] ? { detail: result.error.issues[0].code } : {}),
    });
  }
}
