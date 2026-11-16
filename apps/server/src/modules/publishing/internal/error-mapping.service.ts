// Ánh xạ lỗi nền tảng → thông điệp tiếng Việt + cách khắc phục (FR-016/017, research R11).
// Đọc bảng dùng chung `publishing.error_mappings`, cache TRONG TIẾN TRÌNH 5 phút (đây là cấu hình, KHÔNG phải trạng
// thái lượt đăng – Hiến pháp "không cache" không áp dụng), rồi đưa vào `applyErrorMapping` của Cổng nền tảng.
// Mã không có dòng → giữ phân loại của bộ chuyển đổi (mặc định `unknown`, KHÔNG bao giờ đoán `transient`).
import { Injectable } from '@nestjs/common';
import { and, eq } from 'drizzle-orm';
import { tenantTx } from '../../../core';
import {
  applyErrorMapping,
  type ChannelType,
  type ClassifiedError,
  type ErrorMappingRow,
} from '../../platform_gateway';
import { errorMappings } from './db/schema';

export const ERROR_MAPPING_CACHE_MS = 5 * 60_000;

export interface MappingEntry extends ErrorMappingRow {
  needsReason: string | null;
  retryAfterSec: number | null;
}

export interface MappedError {
  error: ClassifiedError;
  /** Lý do cần xử lý gợi ý từ dòng ánh xạ (khi `user_action`). */
  needsReason: string | null;
}

export type MappingLoader = () => Promise<MappingEntry[]>;

const key = (channelType: string, rawCode: string) => `${channelType}\u0000${rawCode}`;

export const UNKNOWN_GENERIC_MESSAGE = 'Có sự cố khi đăng, chúng tôi đang kiểm tra.';

async function loadFromDb(): Promise<MappingEntry[]> {
  const rows = await tenantTx((db) =>
    db
      .select()
      .from(errorMappings)
      .where(and(eq(errorMappings.enabled, true))),
  );
  return rows.map((r) => ({
    channelType: r.channel_type as ChannelType,
    rawCode: r.raw_code,
    category: r.category as ErrorMappingRow['category'],
    messageVi: r.message_vi,
    remedies: r.remedies as ErrorMappingRow['remedies'],
    needsReason: r.needs_reason,
    retryAfterSec: r.retry_after_sec,
  }));
}

@Injectable()
export class ErrorMappingService {
  private cache: { at: number; byKey: Map<string, MappingEntry> } | null = null;

  /** Nguồn dòng ánh xạ và đồng hồ – kiểm thử thay bằng bản giả (không dùng tham số constructor vì Nest tiêm). */
  loader: MappingLoader = loadFromDb;
  now: () => number = Date.now;

  /** Bỏ cache (dùng sau khi quản trị sửa bảng nếu muốn có hiệu lực ngay; mặc định chờ tối đa 5 phút). */
  invalidate(): void {
    this.cache = null;
  }

  private async table(): Promise<Map<string, MappingEntry>> {
    const t = this.now();
    if (this.cache !== null && t - this.cache.at < ERROR_MAPPING_CACHE_MS) return this.cache.byKey;
    const rows = await this.loader();
    const byKey = new Map(rows.map((r) => [key(r.channelType, r.rawCode), r]));
    this.cache = { at: t, byKey };
    return byKey;
  }

  /** Áp dòng ánh xạ (nếu có) lên kết quả phân loại của bộ chuyển đổi. */
  async map(err: ClassifiedError): Promise<MappedError> {
    const entry = (await this.table()).get(key(err.channelType, err.rawCode));
    if (entry === undefined) return { error: err, needsReason: null };
    const mapped = applyErrorMapping(err, entry);
    const withRetry: ClassifiedError =
      mapped.category === 'transient' && entry.retryAfterSec !== null
        ? { ...mapped, retryAfterSec: entry.retryAfterSec }
        : mapped;
    return { error: withRetry, needsReason: entry.needsReason };
  }
}
