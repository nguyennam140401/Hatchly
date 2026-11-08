import { z } from 'zod';

// Lỗi chuẩn của mọi API (data-model.md mục 2.2, nguyên tắc VI).

export const ErrorAction = z.object({
  kind: z.enum(['retry', 'fix_input', 'contact_support', 'navigate']),
  label: z.string().min(1),
  href: z.string().optional(),
});
export type ErrorAction = z.infer<typeof ErrorAction>;

export const FieldErrorItem = z.object({
  path: z.array(z.string()),
  message: z.string(),
});

export const ErrorResponse = z.object({
  error: z.object({
    /** Mã ổn định cho máy đọc, dạng UPPER_SNAKE_CASE. */
    code: z.string().regex(/^[A-Z][A-Z0-9]*(?:_[A-Z0-9]+)*$/),
    /** Lời giải thích đời thường bằng tiếng Việt, không chứa mã kỹ thuật. */
    message: z.string().min(1),
    /** Mỗi lỗi có ít nhất một hành động khắc phục. */
    actions: z.array(ErrorAction).min(1),
    fieldErrors: z.array(FieldErrorItem).optional(),
    /** "Chi tiết cho hỗ trợ": mã theo dõi + mã lỗi gốc (không bao giờ chứa bí mật). */
    support: z.object({
      traceId: z.string().min(1),
      detail: z.string().optional(),
    }),
  }),
});
export type ErrorResponse = z.infer<typeof ErrorResponse>;

export const ERROR_CODES = {
  VALIDATION_FAILED: 'VALIDATION_FAILED',
  NOT_FOUND: 'NOT_FOUND',
  SERVICE_UNAVAILABLE: 'SERVICE_UNAVAILABLE',
  INTERNAL_ERROR: 'INTERNAL_ERROR',
} as const;
export type ErrorCode = (typeof ERROR_CODES)[keyof typeof ERROR_CODES];
