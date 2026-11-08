import { z } from 'zod';
import { UnitName, UtcDateTime } from './primitives.js';

// Kiểm tra sống / sẵn sàng (data-model.md mục 2.3). Không trường nào chứa dữ liệu tenant (FR-003).

export const HealthResponse = z.object({
  status: z.literal('ok'),
  unit: UnitName,
  version: z.string(),
  time: UtcDateTime,
});
export type HealthResponse = z.infer<typeof HealthResponse>;

export const ReadinessCheckResult = z.object({
  name: z.string(),
  status: z.enum(['pass', 'fail']),
});
export type ReadinessCheckResult = z.infer<typeof ReadinessCheckResult>;

export const ReadinessResponse = z.object({
  status: z.enum(['ready', 'not_ready']),
  checks: z.array(ReadinessCheckResult),
});
export type ReadinessResponse = z.infer<typeof ReadinessResponse>;
