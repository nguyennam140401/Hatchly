// Khai báo loại việc dùng chung giữa tiến trình kiểm thử và tiến trình con (worker-child.ts).
import type { z as Z } from 'zod';

export const CHILD_JOB = {
  name: 'sandbox.child_long',
  queue: 'ai_batch',
  scope: 'tenant',
  version: 1,
} as const;

export const childJobPayload = (z: typeof Z) =>
  z.strictObject({ durationMs: z.number().int().min(0).max(600_000) });
