import { useQueryClient } from '@tanstack/react-query';
import { useApiQuery } from '../api/hooks';
import { ensureFresh } from '../api/query-client';
import { queryKeys } from '../api/query-keys';

// Mức sử dụng (FR-031, FR-032): MỘT nguồn dữ liệu cho Tổng quan, "Gói & mức sử dụng" và mọi nút phụ thuộc hạn mức.
// Kiểu KHÔNG có trường tiền ⇒ giao diện không thể hiển thị/tính số tiền AI (chỉ % trên trần – hiến pháp III, FR-012).

export type UsageLevel = 'normal' | 'near' | 'reached';

export interface UsageSnapshot {
  /** Số đếm (bài/chu kỳ), không phải tiền. */
  posts: { used: number; limit: number };
  /** % của trần; KHÔNG có trường tiền. */
  ai: { percent: number; level: UsageLevel; reopensAt?: string };
  storage: { usedBytes: number; limitBytes: number };
}

/** Điểm cuối thật do tính năng "Gói & mức sử dụng" đăng ký; chưa đăng ký → chưa biết mức (không khóa nút). */
let source: (() => Promise<UsageSnapshot>) | undefined;

export function setUsageSource(next: (() => Promise<UsageSnapshot>) | undefined): void {
  source = next;
}

/** Lớp `volatile`: không cache (hiến pháp: không cache ngân sách AI, hạn mức). */
export function useUsage(): { usage: UsageSnapshot | undefined; isLoading: boolean } {
  const query = useApiQuery(
    queryKeys.usage.current(),
    () => (source !== undefined ? source() : Promise.reject(new Error('usage source missing'))),
    { freshness: 'volatile', enabled: source !== undefined },
  );
  return { usage: query.data, isLoading: query.isPending && source !== undefined };
}

/** Bắt buộc gọi TRƯỚC thao tác phụ thuộc hạn mức (vd bấm "Tạo bài bằng AI"): lấy mức mới nhất, không dùng bản cũ. */
export function useEnsureUsageFresh(): () => Promise<UsageSnapshot | undefined> {
  const client = useQueryClient();
  return async () =>
    source === undefined ? undefined : ensureFresh(client, queryKeys.usage.current(), source);
}
