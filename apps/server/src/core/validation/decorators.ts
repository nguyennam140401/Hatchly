import { Body, Param, Query } from '@nestjs/common';
import type { z } from 'zod';
import { ZodValidationPipe } from './zod-validation.pipe';

// Decorator tham số kiểm tra bằng lược đồ dùng chung. ESLint cấm @Body/@Query/@Param gốc ở mọi nơi
// khác trong apps/server/src để không đầu vào nào lọt qua mà không kiểm tra.

/** Thân yêu cầu, kiểm tra bằng `schema`. */
export const ValidBody = (schema: z.ZodType): ParameterDecorator =>
  Body(new ZodValidationPipe(schema));

/** Toàn bộ query string, kiểm tra bằng `schema`. */
export const ValidQuery = (schema: z.ZodType): ParameterDecorator =>
  Query(new ZodValidationPipe(schema));

/** Toàn bộ tham số đường dẫn, kiểm tra bằng `schema`. */
export const ValidParam = (schema: z.ZodType): ParameterDecorator =>
  Param(new ZodValidationPipe(schema));
