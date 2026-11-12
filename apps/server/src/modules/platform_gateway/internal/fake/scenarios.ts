import { z } from 'zod';

// Khuôn kịch bản của bản giả lập Cổng nền tảng (005, contracts/platform-gateway.md mục 4). Dùng chung cho
// API lập trình (`fakePlatform.script`) và route quản trị `/dev/fakes/scenarios` (component=platform).

export const FakeStep = z.union([
  z.strictObject({
    submit: z.union([
      z.enum([
        'published',
        'processing_then_done',
        'processing_then_failed',
        'timeout_after_publish',
        'timeout_before_publish',
      ]),
      z.strictObject({ fail: z.string().min(1).max(64) }),
    ]),
  }),
  z.strictObject({ alterStoredText: z.enum(['shorten_links', 'nfd', 'whitespace']) }),
  z.strictObject({ reconcile: z.literal('unsupported') }),
  z.strictObject({ refresh: z.enum(['ok', 'fail']) }),
  z.strictObject({ check: z.enum(['eligible', 'not_professional', 'missing_permission']) }),
  z.strictObject({ latencyMs: z.number().int().min(0).max(120_000) }),
]);
export type FakeStep = z.infer<typeof FakeStep>;

/** Kịch bản `target=oauth`: danh sách Page giả sau lượt gọi lại. */
export const FakeOauthPages = z.strictObject({
  pages: z
    .array(
      z.strictObject({
        externalId: z.string().min(1).max(200),
        displayName: z.string().min(1).max(120),
        eligible: z.boolean().default(true),
      }),
    )
    .max(20),
});
export type FakeOauthPages = z.infer<typeof FakeOauthPages>;

/** `spec` hợp lệ cho component=platform: một bước, hoặc danh sách Page giả (target=oauth). */
export const PlatformScenarioSpec = z.union([FakeStep, FakeOauthPages]);

/** Khóa gốc của một bước – dùng để mỗi thao tác chỉ tiêu đúng loại bước của mình. */
export function stepKey(step: FakeStep): string {
  return Object.keys(step)[0] ?? '';
}
