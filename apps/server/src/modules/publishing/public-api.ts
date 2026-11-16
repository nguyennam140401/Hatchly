/**
 * Giao diện công khai của module Đăng bài (`publishing`) – 012, contracts/module-api.md mục 2.
 *
 * Trách nhiệm (ADD mục 6): lượt đăng (tối đa MỘT lượt hiệu lực cho mỗi cặp bài–kênh), hẹn giờ chung của hệ
 * thống, 5 bước đăng, phân loại lỗi, đối soát, "Cần kiểm tra". 012 chỉ dựng phần *lên lịch / hủy / đổi giờ /
 * đọc trạng thái*; thực thi 5 bước thuộc 013. ĐÂY LÀ HỢP ĐỒNG ỔN ĐỊNH mà 013 giữ nguyên (chỉ thay phần
 * thực thi và bổ sung hàm đọc chi tiết).
 *
 * Hàm nhận `tx: Db` chạy TRONG giao dịch của người gọi, không tự mở giao dịch; không nhận `accountId`;
 * lỗi nghiệp vụ trả kết quả hợp đóng (`kind`).
 */
import type { AttemptStatus, ChannelType, Remedy } from '@app/shared/content';
import type { Db } from '../../core';

export type { AttemptStatus };

export interface AttemptRef {
  attemptId: string;
  connectionId: string;
  channelType: ChannelType;
}

export interface ScheduleInput {
  postId: string;
  /** `posts.version` đã duyệt – 013 dùng để so khớp nội dung lúc đăng. */
  contentVersion: number;
  scheduledAt: Date;
  channels: { connectionId: string; channelType: ChannelType }[];
  traceId?: string;
}

export type ScheduleResult =
  | { kind: 'scheduled'; attempts: AttemptRef[] }
  | { kind: 'quota_exceeded'; connectionId: string; limit: number }
  | { kind: 'already_scheduled' };

export type CancelResult =
  { kind: 'cancelled'; count: number } | { kind: 'already_publishing'; connectionIds: string[] };

export type RescheduleResult =
  | { kind: 'rescheduled'; count: number }
  | { kind: 'already_publishing'; connectionIds: string[] }
  | { kind: 'quota_exceeded'; connectionId: string; limit: number };

export interface AttemptState {
  attemptId: string;
  connectionId: string;
  channelType: ChannelType;
  status: AttemptStatus;
  scheduledAt: Date;
}

export interface PostPublishState {
  /** Trạng thái "xấu nhất" trong các mục (null khi chưa có mục hiệu lực). */
  worst: AttemptStatus | null;
  attempts: AttemptState[];
  /** Mọi mục còn `scheduled` → đổi giờ được (FR-024). */
  allScheduled: boolean;
}

export type PrecheckResult =
  | { ok: true; quotaRemaining: number | null }
  | { ok: false; reason: 'inactive' | 'needs_reconnect' | 'unavailable'; remedies: Remedy[] };

export interface PublishingPublicApi {
  /** Tạo mục lịch đăng + việc `run_attempt` cho mỗi kênh, TRONG tx. Idempotent theo (bài, kênh). */
  schedule(tx: Db, input: ScheduleInput): Promise<ScheduleResult>;
  /** Hủy mọi mục `scheduled` của bài + việc tương ứng. Có mục đã rời `scheduled` → KHÔNG đổi gì. */
  cancelByPost(tx: Db, postId: string): Promise<CancelResult>;
  /** Đổi giờ mọi mục `scheduled` + việc; kiểm lại hạn mức cục bộ ở giờ mới. */
  reschedule(tx: Db, postId: string, scheduledAt: Date): Promise<RescheduleResult>;
  /**
   * 013 – Ngắt kênh / yêu cầu xóa tài khoản (FR-033): hủy mọi lượt CHƯA gửi (`scheduled`, `retry_wait`) của kênh và việc
   * tương ứng; lượt đang `processing`/`unknown` được để chạy xong theo luồng đối soát (không hủy giữa chừng để không
   * mất dấu bài đã gửi). Trả số lượt đã hủy. Chạy trong giao dịch của người gọi.
   */
  cancelAllForConnection(tx: Db, connectionId: string): Promise<{ cancelled: number }>;
  /** Đọc: trạng thái đăng theo bài (xấu nhất + từng kênh). Không cache. */
  statusesByPosts(postIds: readonly string[]): Promise<Map<string, PostPublishState>>;
  /**
   * TRƯỚC giao dịch: kênh còn hoạt động + hạn mức nền tảng báo (gọi `checkAccount`). KHÔNG dùng trong tx
   * (không gọi nền tảng bên ngoài khi đang giữ giao dịch).
   */
  precheckChannels(connectionIds: readonly string[]): Promise<Map<string, PrecheckResult>>;
}

/** Token NestJS của PublishingPublicApi. */
export const PUBLISHING_PUBLIC_API = Symbol('PUBLISHING_PUBLIC_API');
