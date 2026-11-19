import { sql } from 'drizzle-orm';
import { getExecutionContext } from '../../../../core';
import { supportCommand } from '../../../../core/db/support';
import { uuidV7 } from '../../../../core/ids/uuid-v7';
import type { FeatureFlagKey, FeatureValue } from '../db/schema';
import type { FeatureGate } from './feature-gate';

// Đổi công tắc tính năng bởi nhân viên nội bộ (010 T081, contracts/feature-flags.md mục 5). Mỗi lần đổi là MỘT hàm SECURITY DEFINER
// (migration 0028): upsert/xóa ghi đè + `feature_override_events` + `infra.audit_log` `feature.set` + `recheck_required` cho kết nối
// TikTok – cùng một giao dịch. Chạy ở bể `support` (không BYPASSRLS, không ngữ cảnh tenant của khách). `accountId` nhận từ đường
// dẫn CHỈ ở điểm cuối nhân viên (ngoại lệ có chủ đích như `supportViewAccount`).

export const FEATURES_SERVICE = Symbol('FEATURES_SERVICE');

export interface StaffIdentity {
  staffId: string;
  role: 'support' | 'admin';
}

export interface FeatureState {
  flag: FeatureFlagKey;
  defaultEnabled: boolean;
  /** `null` khi không có dòng ghi đè ("theo mặc định"); chỉ có khi hỏi theo tài khoản. */
  override: 'on' | 'off' | null;
  /** Giá trị hiệu lực theo quy tắc `resolveFlag`. */
  effective: boolean;
}

const traceId = (): string => getExecutionContext()?.traceId ?? '';

export class FeaturesService {
  constructor(private readonly gate: FeatureGate) {}

  /** Mặc định hệ thống (+ ghi đè của tài khoản khi có `accountId`). */
  async get(flag: FeatureFlagKey, accountId?: string): Promise<FeatureState> {
    const row = await supportCommand(async (db) => {
      const r = await db.execute<{ default_enabled: boolean; override_value: string | null }>(
        sql`SELECT * FROM platform_gateway.get_feature_state(${accountId ?? null}::uuid, ${flag})`,
      );
      return r.rows[0];
    });
    const defaultEnabled = row?.default_enabled === true;
    const override = row?.override_value === 'on' || row?.override_value === 'off' ? row.override_value : null;
    return {
      flag,
      defaultEnabled,
      override,
      effective: override === 'on' ? true : override === 'off' ? false : defaultEnabled,
    };
  }

  /** Đổi ghi đè của MỘT tài khoản. Trả giá trị cũ. Lý do 1–500 ký tự do hàm SQL kiểm (và lớp HTTP). */
  async setForAccount(
    staff: StaffIdentity,
    accountId: string,
    flag: FeatureFlagKey,
    value: FeatureValue,
    reason: string,
  ): Promise<{ old: FeatureValue }> {
    const old = await supportCommand(async (db) => {
      const r = await db.execute<{ set_feature_override: FeatureValue }>(
        sql`SELECT platform_gateway.set_feature_override(
              ${accountId}::uuid, ${flag}, ${value}, ${staff.staffId}::uuid, ${staff.role},
              ${reason}, ${traceId()}, ${uuidV7()}::uuid, ${uuidV7()}::uuid) AS set_feature_override`,
      );
      return r.rows[0]?.set_feature_override ?? 'default';
    });
    this.gate.invalidate(accountId, flag); // hiệu lực ngay ở tiến trình này; tiến trình khác chờ hết TTL ≤ 60 giây
    return { old };
  }

  /** Đổi MẶC ĐỊNH hệ thống (SC-012: bật cho mọi khách khi TikTok duyệt, không phát hành). */
  async setDefault(
    staff: StaffIdentity,
    flag: FeatureFlagKey,
    enabled: boolean,
    reason: string,
  ): Promise<{ old: boolean }> {
    const old = await supportCommand(async (db) => {
      const r = await db.execute<{ set_feature_default: boolean }>(
        sql`SELECT platform_gateway.set_feature_default(
              ${flag}, ${enabled}::boolean, ${staff.staffId}::uuid, ${staff.role},
              ${reason}, ${traceId()}, ${uuidV7()}::uuid) AS set_feature_default`,
      );
      return r.rows[0]?.set_feature_default ?? false;
    });
    this.gate.invalidate();
    return { old };
  }
}
