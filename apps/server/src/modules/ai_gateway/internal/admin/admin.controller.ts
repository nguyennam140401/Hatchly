import { Controller, Inject, Post, Put } from '@nestjs/common';
import { z } from 'zod';
import { getExecutionContext, requireStaff, StaffAccess, ValidBody } from '../../../../core';
import { AI_TASKS, MODEL_TIERS } from '../../public-api';
import type { SettingsPatch } from '../db/admin-functions';
import { InvoicesService } from './invoices.service';
import { PricingService } from './pricing.service';
import { RoutesService } from './routes.service';
import { SettingsService } from './settings.service';

// Điểm cuối quản trị cấu hình Cổng AI (015 US3, contracts/admin-ops.md mục 2). Chỉ `admin` (`ai.pricing.manage`): chủ,
// cộng tác viên, hỗ trợ ⇒ 403. Mã tài khoản KHÔNG nhận từ người gọi: thân yêu cầu nghiêm ngặt (trường lạ bị từ chối). Mã nhân
// viên lấy từ phiên. Lỗi nghiệp vụ → 422 kèm `error.code` + hành động khắc phục; lỗi ghi/kiểm toán → 5xx (đã hoàn tác).

const money = z.number().int();
const text = z.string().trim().min(1).max(100);

const priceBody = z
  .strictObject({
    provider: text,
    modelId: text,
    unit: z.enum(['token', 'audio_minute']),
    inputPerMTok: money.optional(),
    outputPerMTok: money.optional(),
    cachedInputPerMTok: money.optional(),
    perMinute: money.optional(),
    billingGranularitySec: z.number().int().positive().optional(),
    effectiveFrom: z.iso.datetime({ offset: true }),
  })
  .superRefine((b, ctx) => {
    const need = (field: keyof typeof b) => {
      if (b[field] === undefined)
        ctx.addIssue({ code: 'custom', path: [field], message: 'Bắt buộc' });
    };
    if (b.unit === 'token') {
      need('inputPerMTok');
      need('outputPerMTok');
    } else {
      need('perMinute');
    }
  });

const settingsBody = z
  .strictObject({
    accountCapMicroUsd: z.number().int().positive().optional(),
    accountSoftLimitMicroUsd: z.number().int().positive().optional(),
    perIndustryWeeklyMicroUsd: z.number().int().positive().optional(),
  })
  .refine((b) => Object.values(b).some((v) => v !== undefined), {
    message: 'Cần ít nhất một trường cấu hình',
  });

const routeBody = z.strictObject({
  tier: z.enum(MODEL_TIERS),
  rank: z.number().int(),
  provider: text,
  modelId: text,
  enabled: z.boolean(),
});

const fallbackBody = z.strictObject({ task: z.enum(AI_TASKS), enabled: z.boolean() });

const isRealDate = (s: string): boolean => {
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().startsWith(s);
};
const invoiceBody = z.strictObject({
  provider: text,
  invoiceDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .refine(isRealDate, 'Ngày không hợp lệ'),
  totalMicroUsd: z.number().int().min(0),
});

const traceOf = (): string | undefined => getExecutionContext()?.traceId;

@Controller('admin/ai')
export class AiAdminController {
  constructor(
    @Inject(PricingService) private readonly pricing: PricingService,
    @Inject(SettingsService) private readonly settings: SettingsService,
    @Inject(RoutesService) private readonly routes: RoutesService,
    @Inject(InvoicesService) private readonly invoices: InvoicesService,
  ) {}

  @Post('prices')
  @StaffAccess('ai.pricing.manage')
  async addPrice(
    @ValidBody(priceBody) body: z.infer<typeof priceBody>,
  ): Promise<{ priceId: string }> {
    const staff = requireStaff();
    return this.pricing.addPrice(
      {
        provider: body.provider,
        modelId: body.modelId,
        unit: body.unit,
        inputPerMTok: body.inputPerMTok ?? null,
        outputPerMTok: body.outputPerMTok ?? null,
        cachedInputPerMTok: body.cachedInputPerMTok ?? null,
        perMinute: body.perMinute ?? null,
        billingGranularitySec: body.billingGranularitySec ?? null,
        effectiveFrom: new Date(body.effectiveFrom),
      },
      staff.staffId,
      traceOf(),
    );
  }

  @Put('settings')
  @StaffAccess('ai.pricing.manage')
  async changeSettings(
    @ValidBody(settingsBody) body: z.infer<typeof settingsBody>,
  ): Promise<{ changed: number }> {
    const patch: SettingsPatch = {
      ...(body.accountCapMicroUsd !== undefined
        ? { accountCapMicroUsd: body.accountCapMicroUsd }
        : {}),
      ...(body.accountSoftLimitMicroUsd !== undefined
        ? { accountSoftLimitMicroUsd: body.accountSoftLimitMicroUsd }
        : {}),
      ...(body.perIndustryWeeklyMicroUsd !== undefined
        ? { perIndustryWeeklyMicroUsd: body.perIndustryWeeklyMicroUsd }
        : {}),
    };
    return this.settings.change(patch, requireStaff().staffId, traceOf());
  }

  @Put('routes')
  @StaffAccess('ai.pricing.manage')
  async setRoute(@ValidBody(routeBody) body: z.infer<typeof routeBody>): Promise<{ ok: true }> {
    await this.routes.setRoute(body, requireStaff().staffId, traceOf());
    return { ok: true };
  }

  @Put('task-fallback')
  @StaffAccess('ai.pricing.manage')
  async setTaskFallback(
    @ValidBody(fallbackBody) body: z.infer<typeof fallbackBody>,
  ): Promise<{ task: string; enabled: boolean; old: boolean | null }> {
    const { old } = await this.routes.setTaskFallback(
      body.task,
      body.enabled,
      requireStaff().staffId,
      traceOf(),
    );
    return { task: body.task, enabled: body.enabled, old };
  }

  @Post('provider-invoices')
  @StaffAccess('ai.pricing.manage')
  async enterInvoice(
    @ValidBody(invoiceBody) body: z.infer<typeof invoiceBody>,
  ): Promise<{ replaced: boolean }> {
    return this.invoices.enter(body, requireStaff().staffId, traceOf());
  }
}
