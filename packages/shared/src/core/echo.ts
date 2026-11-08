import { z } from 'zod';
import { UtcDateTime } from './primitives.js';

// Hợp đồng chẩn đoán (chỉ có khi APP_ENV ≠ production) – chứng minh web và API kiểm tra đầu vào
// bằng cùng một lược đồ và ra cùng fieldErrors (data-model.md mục 2.4).

export const EchoRequest = z.object({
  message: z.string().trim().min(1).max(200),
  sentAt: UtcDateTime,
});
export type EchoRequest = z.infer<typeof EchoRequest>;

export const EchoResponse = z.object({
  message: z.string(),
  receivedAt: UtcDateTime,
});
export type EchoResponse = z.infer<typeof EchoResponse>;
