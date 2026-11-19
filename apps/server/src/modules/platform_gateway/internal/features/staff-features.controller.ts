import { Controller, Get, Inject, Put } from '@nestjs/common';
import { z } from 'zod';
import { requireStaff, StaffAccess, ValidBody, ValidParam } from '../../../../core';
import { FEATURES_SERVICE, type FeatureState, type FeaturesService } from './features.service';

// Điểm cuối nhân viên đổi công tắc TikTok (010 T081, contracts/feature-flags.md mục 5). `@StaffAccess('feature.manage')` = chỉ
// `admin` (chủ/CTV/support ⇒ 403). Lý do bắt buộc 1–500 ký tự. `accountId` từ đường dẫn là ngoại lệ có chủ đích của nhân viên.

const FLAG = 'channel.tiktok' as const;
const accountParam = z.strictObject({ accountId: z.uuid() });
const reason = z.string().trim().min(1).max(500);
const accountBody = z.strictObject({ value: z.enum(['on', 'off', 'default']), reason });
const defaultBody = z.strictObject({ value: z.enum(['on', 'off']), reason });

@Controller('staff')
export class StaffFeaturesController {
  constructor(@Inject(FEATURES_SERVICE) private readonly features: FeaturesService) {}

  @Get('features/channel.tiktok')
  @StaffAccess('feature.manage')
  getDefault(): Promise<FeatureState> {
    return this.features.get(FLAG);
  }

  @Put('features/channel.tiktok/default')
  @StaffAccess('feature.manage')
  async setDefault(
    @ValidBody(defaultBody) body: z.infer<typeof defaultBody>,
  ): Promise<{ flag: typeof FLAG; value: 'on' | 'off'; old: 'on' | 'off' }> {
    const staff = requireStaff();
    const { old } = await this.features.setDefault(
      { staffId: staff.staffId, role: staff.role },
      FLAG,
      body.value === 'on',
      body.reason,
    );
    return { flag: FLAG, value: body.value, old: old ? 'on' : 'off' };
  }

  @Get('accounts/:accountId/features/channel.tiktok')
  @StaffAccess('feature.manage')
  getForAccount(
    @ValidParam(accountParam) params: z.infer<typeof accountParam>,
  ): Promise<FeatureState> {
    return this.features.get(FLAG, params.accountId);
  }

  @Put('accounts/:accountId/features/channel.tiktok')
  @StaffAccess('feature.manage')
  async setForAccount(
    @ValidParam(accountParam) params: z.infer<typeof accountParam>,
    @ValidBody(accountBody) body: z.infer<typeof accountBody>,
  ): Promise<{
    flag: typeof FLAG;
    value: 'on' | 'off' | 'default';
    old: 'on' | 'off' | 'default';
  }> {
    const staff = requireStaff();
    const { old } = await this.features.setForAccount(
      { staffId: staff.staffId, role: staff.role },
      params.accountId,
      FLAG,
      body.value,
      body.reason,
    );
    return { flag: FLAG, value: body.value, old };
  }
}
