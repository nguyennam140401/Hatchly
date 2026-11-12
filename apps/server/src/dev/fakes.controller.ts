import { Controller, Delete, Get, HttpCode, Inject, Post, Put } from '@nestjs/common';
import { z } from 'zod';
import {
  APP_CONFIG,
  AppError,
  CustomerAccess,
  uuidV7,
  ValidBody,
  ValidParam,
  type AppConfig,
} from '../core';
import { loc, OBJECT_STORAGE, type ObjectStorage, type PresignedUpload } from '../core/storage';
import {
  AI_FAKE_BUNDLE,
  AI_GATEWAY,
  AI_TASKS,
  AiError,
  fakeAi,
  FakeAiStep,
  type AiGatewayPublicApi,
  type AiResult,
  type FakeAiBundle,
  type FakeBudgetView,
} from '../modules/ai_gateway';
import {
  NOTIFICATION_STORE,
  type DeliveredNotification,
  type NotificationStore,
} from '../modules/notifications';
import { fakePlatform, PlatformScenarioSpec } from '../modules/platform_gateway';
import { FAKE_COMPONENTS, type FakeScenario } from './fake-components';
import { getScenarioStore } from './scenarios';

// Endpoint quản trị bản giả lập (005, contracts/runtime-config.md mục 3) – CHỈ development/test (ghép có
// điều kiện qua `shouldRegisterDevRoutes`; môi trường khác: không có route → 404). Mọi route gắn tài khoản
// trong PHIÊN (`status.view`) – không nhận mã tài khoản (thân yêu cầu strictObject → 400 nếu có).

const PutScenario = z.strictObject({
  component: z.enum(FAKE_COMPONENTS),
  target: z.string().min(1).max(200),
  spec: z.record(z.string(), z.unknown()),
  remainingUses: z.int().min(1).max(1000).optional(),
});
type PutScenario = z.infer<typeof PutScenario>;

const PutBudget = z.strictObject({
  used: z.int().min(0).optional(),
  reserved: z.int().min(0).optional(),
  cycleStart: z.iso.date().optional(),
});

const Generate = z.strictObject({
  task: z.enum(AI_TASKS),
  delta: z.string().min(1).max(4000),
});

const UploadUrl = z.strictObject({
  contentType: z.enum([
    'image/jpeg',
    'image/png',
    'image/webp',
    'image/heic',
    'video/mp4',
    'video/quicktime',
  ]),
  maxBytes: z.int().min(1).max(1_000_000_000),
});

const idParam = z.strictObject({ id: z.uuid() });

function invalidSpec(): AppError {
  return new AppError({
    code: 'VALIDATION_FAILED',
    httpStatus: 400,
    message: 'Kịch bản không đúng khuôn của thành phần.',
    actions: [{ kind: 'fix_input', label: 'Sửa kịch bản' }],
  });
}

function aiErrorToHttp(err: unknown): never {
  if (err instanceof AiError) {
    throw new AppError({
      code: err.code,
      httpStatus:
        err.code === 'AI_INVALID_REQUEST'
          ? 400
          : err.code === 'AI_PROVIDER_UNAVAILABLE'
            ? 503
            : 409,
      message: err.messageVi,
      actions: [{ kind: 'retry', label: 'Thử lại sau' }],
    });
  }
  throw err;
}

@Controller('dev/fakes')
@CustomerAccess('status.view')
export class DevFakesController {
  constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    @Inject(AI_GATEWAY) private readonly ai: AiGatewayPublicApi,
    @Inject(AI_FAKE_BUNDLE) private readonly aiBundle: FakeAiBundle | null,
    @Inject(OBJECT_STORAGE) private readonly storage: ObjectStorage | null,
    @Inject(NOTIFICATION_STORE) private readonly notifications: NotificationStore | null,
  ) {}

  private get mode() {
    return this.config.FAKE_STATE_STORE ?? 'memory';
  }

  @Get('scenarios')
  async listScenarios(): Promise<FakeScenario[]> {
    return (await getScenarioStore(this.mode)).list();
  }

  @Put('scenarios')
  async putScenario(@ValidBody(PutScenario) body: PutScenario): Promise<FakeScenario> {
    const schema =
      body.component === 'platform'
        ? PlatformScenarioSpec
        : body.component === 'ai'
          ? FakeAiStep
          : null;
    if (schema !== null && !schema.safeParse(body.spec).success) throw invalidSpec();
    return (await getScenarioStore(this.mode)).put(body);
  }

  @Delete('scenarios/:id')
  @HttpCode(204)
  async deleteScenario(@ValidParam(idParam) p: z.infer<typeof idParam>): Promise<void> {
    await (await getScenarioStore(this.mode)).delete(p.id);
  }

  @Delete('scenarios')
  @HttpCode(204)
  async clearScenarios(): Promise<void> {
    await (await getScenarioStore(this.mode)).clear();
  }

  @Get('platform/posts')
  async platformPosts() {
    const control = fakePlatform(this.mode);
    const posts = await control.posts();
    const publishedCount: Record<string, number> = {};
    for (const p of posts) {
      if (p.state === 'published')
        publishedCount[p.contentHash] = (publishedCount[p.contentHash] ?? 0) + 1;
    }
    return { posts, publishedCount };
  }

  private bundle(): FakeAiBundle {
    if (this.aiBundle === null) throw new Error('Cổng AI không chạy bản giả lập');
    return this.aiBundle;
  }

  /** Có số tiền – CHỈ dev, không bao giờ ở màn hình khách hàng. */
  @Get('ai/budget')
  getBudget(): Promise<FakeBudgetView> {
    return this.bundle().store.getBudget();
  }

  @Put('ai/budget')
  putBudget(@ValidBody(PutBudget) body: z.infer<typeof PutBudget>): Promise<FakeBudgetView> {
    return fakeAi(this.mode, this.bundle().store).setBudget(body);
  }

  /** Gọi Cổng AI THẬT (đi đủ trình tự giữ chỗ → gọi → quyết toán). */
  @Post('ai/generate')
  @HttpCode(200)
  async generate(@ValidBody(Generate) body: z.infer<typeof Generate>): Promise<AiResult> {
    try {
      return await this.ai.generate({
        task: body.task,
        prompt: { system: 'Bạn là trợ lý viết bài cho chủ kinh doanh nhỏ.', delta: body.delta },
        maxOutputTokens: 200,
      });
    } catch (err) {
      aiErrorToHttp(err);
    }
  }

  @Post('storage/upload-url')
  @HttpCode(200)
  async uploadUrl(
    @ValidBody(UploadUrl) body: z.infer<typeof UploadUrl>,
  ): Promise<PresignedUpload & { mediaId: string }> {
    if (this.storage === null) throw new Error('Kho tệp chưa cấu hình');
    const mediaId = uuidV7();
    const up = await this.storage.presignUpload(loc.mediaOriginal(mediaId), body);
    return { ...up, mediaId };
  }

  @Get('notifications')
  async listNotifications(): Promise<DeliveredNotification[]> {
    if (this.notifications === null) return [];
    return this.notifications.delivered();
  }
}
