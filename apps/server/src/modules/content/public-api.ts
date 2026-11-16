/**
 * Giao diện công khai của module Nội dung (`content`) – 012, contracts/module-api.md mục 1.
 *
 * Trách nhiệm (ADD mục 6): bài và phiên bản theo kênh, lịch sử sự kiện, bộ giới hạn theo kênh, cột phiên
 * bản chống ghi đè. `content` KHÔNG gọi `publishing`/`approval`: mọi thao tác đổi trạng thái hoặc đụng
 * lịch đi qua `approval` (cùng một giao dịch).
 *
 * Quy ước: hàm nhận `tx: Db` chạy TRONG giao dịch của người gọi (như `notifications.emit`), không tự mở
 * giao dịch; không nhận `accountId`; lỗi nghiệp vụ trả kết quả hợp đóng (`kind`), chỉ lỗi lập trình/hạ
 * tầng mới ném.
 *
 * Module khác chỉ dùng module này qua `index.ts` và chỉ khi có `content` trong `allowedDeps`.
 */
import type {
  Post,
  PostLabels,
  PostSummary,
  ChannelStatusValue,
  ChannelType,
  MediaRef,
  PostEventData,
  PostEventType,
  PostStatus,
  ValidationIssue,
  VariantInput,
} from '@app/shared/content';
import type { Db } from '../../core';

export type { PostStatus, ChannelType, ValidationIssue };

export interface VariantRecord {
  id: string;
  connectionId: string;
  channelType: ChannelType;
  customized: boolean;
  /** Chỉ có nghĩa khi `customized`. */
  text: string;
  hashtags: string[];
  media: MediaRef[];
  version: number;
}

export interface PostRecord {
  id: string;
  status: PostStatus;
  source: 'manual' | 'ai';
  internalName: string | null;
  sharedText: string;
  scheduledAt: Date | null;
  createdBy: string;
  submittedBy: string | null;
  submittedAt: Date | null;
  submissionId: string | null;
  approvedBy: string | null;
  approvedAt: Date | null;
  returnedNote: string | null;
  returnedBy: string | null;
  returnedAt: Date | null;
  editedAfterApproval: boolean;
  version: number;
  createdAt: Date;
  updatedAt: Date;
  variants: VariantRecord[];
}

export interface ChannelRule {
  channelType: ChannelType;
  maxTextLength: number;
  maxHashtags: number | null;
  mediaRequired: boolean;
  maxPostsPer24h: number | null;
}

/** Các trường bài có thể đặt kèm khi đổi trạng thái (`undefined` = giữ nguyên). */
export interface TransitionSet {
  scheduledAt?: Date | null;
  approvedBy?: string | null;
  approvedAt?: Date | null;
  submittedBy?: string | null;
  submittedAt?: Date | null;
  submissionId?: string | null;
  returnedNote?: string | null;
  returnedBy?: string | null;
  returnedAt?: Date | null;
  editedAfterApproval?: boolean;
}

export interface PostEventInput {
  type: PostEventType;
  actorUserId: string;
  data: PostEventData;
}

export interface TransitionInput {
  postId: string;
  expectedVersion: number;
  from: PostStatus[];
  to: PostStatus;
  set?: TransitionSet;
  event: PostEventInput;
}

export type TransitionResult =
  | { kind: 'ok'; post: PostRecord }
  | { kind: 'conflict'; current: PostRecord }
  | { kind: 'wrong_state'; current: PostRecord }
  | { kind: 'not_found' };

export interface SaveFields {
  internalName: string | null;
  sharedText: string;
  /** `undefined` = giữ nguyên; `null` = bỏ giờ dự kiến. */
  scheduledAt?: Date | null | undefined;
  variants: VariantInput[];
}

export interface SaveContentInput {
  postId: string;
  expectedVersion: number;
  /** Trạng thái được phép sửa; ngoài danh sách → `wrong_state`. */
  allowedStatuses: PostStatus[];
  actorUserId: string;
  fields: SaveFields;
  /**
   * Khi nội dung (chữ, hashtag, media, tập kênh) đổi và bài đang ở `whenStatus` → đổi trạng thái cùng
   * câu lệnh ghi (vd sửa bài đã duyệt → Chờ duyệt, FR-019/R7).
   */
  onContentChanged?: {
    whenStatus: PostStatus;
    to: PostStatus;
    set: TransitionSet;
    event: PostEventInput;
  };
}

export type SaveContentResult =
  | {
      kind: 'ok';
      post: PostRecord;
      contentChanged: boolean;
      /** Bài trước khi lưu (để so khớp kênh/nội dung cũ, hủy mục lịch đăng…). */
      before: PostRecord;
      statusChanged: boolean;
    }
  | { kind: 'conflict'; current: PostRecord }
  | { kind: 'wrong_state'; current: PostRecord }
  | { kind: 'invalid_channels'; connectionIds: string[] }
  | { kind: 'not_found' };

export interface CreateDraftInput {
  actorUserId: string;
  fields: SaveFields;
}

export type CreateDraftResult =
  | { kind: 'ok'; post: PostRecord }
  | { kind: 'no_active_channel' }
  | { kind: 'invalid_channels'; connectionIds: string[] };

export type DeleteResult =
  | { kind: 'ok' }
  | { kind: 'not_found' }
  | { kind: 'conflict'; current: PostRecord }
  | { kind: 'not_draft'; current: PostRecord };

export type ValidationResult =
  | { ok: true }
  | {
      ok: false;
      /** Vướng theo kênh (kênh ngắt, thiếu media, vượt giới hạn…). */
      channelIssues: {
        connectionId: string;
        channelType: ChannelType;
        issues: ValidationIssue[];
      }[];
      /** Vướng chung của bài (bài rỗng). */
      contentIssues: ValidationIssue[];
    };

export interface PendingRecord {
  post: PostRecord;
}

export interface Page {
  /** Con trỏ không trong suốt do chính hàm này trả về. */
  cursor?: string | undefined;
  limit: number;
}

export interface Paged<T> {
  items: T[];
  nextCursor: string | null;
}

export interface CalendarRecord {
  post: PostRecord;
}

export interface PostListFilter {
  status?: PostStatus | undefined;
  q?: string | undefined;
  cursor?: string | undefined;
  limit: number;
}

export interface PostEventRecord {
  id: string;
  type: PostEventType;
  actorUserId: string;
  occurredAt: Date;
  data: PostEventData;
}

export interface ContentPublicApi {
  // ----- đọc -----
  getPost(id: string): Promise<PostRecord | null>;
  getPosts(ids: readonly string[]): Promise<PostRecord[]>;
  listPosts(filter: PostListFilter): Promise<Paged<PostRecord>>;
  listPendingReview(page: Page): Promise<Paged<PendingRecord>>;
  countPendingReview(): Promise<number>;
  calendar(range: { from: Date; to: Date }): Promise<CalendarRecord[]>;
  listEvents(postId: string): Promise<PostEventRecord[]>;
  /** Cấu hình giới hạn theo kênh; cache trong tiến trình 5 phút. */
  channelRules(): Promise<ChannelRule[]>;
  /** Kết quả kiểm tra hiển thị theo kênh (không chặn lưu; tính khi đọc, không lưu). */
  validateForDisplay(
    post: PostRecord,
  ): Promise<{ connectionId: string; issues: ValidationIssue[] }[]>;
  /** Hình dạng phản hồi API của bài (kèm kết quả kiểm tra hiển thị theo kênh khi `withValidation`). */
  presentPost(post: PostRecord, options?: { withValidation?: boolean }): Promise<Post>;
  presentSummaries(posts: readonly PostRecord[]): PostSummary[];
  /** Nhãn hiển thị (Bị trả lại, Đã sửa sau khi duyệt, Giờ đã qua). */
  labelsOf(post: PostRecord): PostLabels;
  /** Trạng thái + tên hiển thị của các kênh (đọc cục bộ qua Cổng nền tảng). */
  channelInfo(
    connectionIds: readonly string[],
  ): Promise<Map<string, { status: ChannelStatusValue; displayName: string | null }>>;

  // ----- thao tác trong giao dịch của `approval` -----
  loadForUpdate(tx: Db, id: string): Promise<PostRecord | null>;
  /**
   * Kiểm tra bài đủ điều kiện lên lịch ở giờ `at`: kênh còn hoạt động, đúng giới hạn chữ/hashtag/media.
   * KHÔNG lưu kết quả. Chạy trong giao dịch nhưng không gọi nền tảng bên ngoài.
   */
  validateForScheduling(tx: Db, post: PostRecord, at: Date): Promise<ValidationResult>;
  transition(tx: Db, input: TransitionInput): Promise<TransitionResult>;
  createDraft(tx: Db, input: CreateDraftInput): Promise<CreateDraftResult>;
  saveContent(tx: Db, input: SaveContentInput): Promise<SaveContentResult>;
  deleteDraft(
    tx: Db,
    id: string,
    expectedVersion: number,
    actor: { userId: string; isOwner: boolean },
  ): Promise<DeleteResult>;
  /** Ghi một sự kiện không đổi trạng thái (vd `rescheduled`). */
  appendEvent(tx: Db, postId: string, event: PostEventInput): Promise<void>;
}

/** Token NestJS của ContentPublicApi. */
export const CONTENT_PUBLIC_API = Symbol('CONTENT_PUBLIC_API');

/**
 * Cổng mô tả media (định dạng, kích thước, thời lượng) – TÙY CHỌN cho tới khi module Thư viện media có
 * thao tác này. Thiếu cổng → kênh bắt buộc media báo "chưa thể lên lịch" (FR-007).
 */
export interface MediaDescriber {
  describe(mediaIds: readonly string[]): Promise<
    {
      mediaId: string;
      kind: 'image' | 'video';
      format: string;
      bytes: number;
      width: number;
      height: number;
      durationSec?: number;
    }[]
  >;
}
export const MEDIA_DESCRIBER = Symbol('MEDIA_DESCRIBER');
