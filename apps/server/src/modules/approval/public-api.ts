/**
 * Giao diện công khai của module Duyệt & lịch (`approval`) – 012, contracts/module-api.md mục 3.
 *
 * Trách nhiệm (ADD mục 6): thao tác duyệt bài và xếp lịch của chủ tài khoản. `approval` KHÔNG có bảng
 * (schema dành sẵn, để trống): trạng thái duyệt nằm trên `content`, mục lịch đăng nằm trên `publishing`;
 * module này CHỈ điều phối để mọi thao tác đổi trạng thái hoặc đụng lịch xảy ra trong MỘT giao dịch.
 *
 * Hàm tự mở `tenantTx` (mỗi bài một giao dịch); quyền kiểm ở API (`@CustomerAccess`), người thực hiện lấy từ
 * phiên. Lỗi nghiệp vụ ném `AppError` (HTTP); kết quả hàng loạt trả `BulkResult`.
 */
import type { BulkResult, PendingListResponse } from '@app/shared/approval';
import type { SaveFields } from '../content';
import type { PostRecord } from '../content';

export interface ApproveItemInput {
  postId: string;
  expectedVersion: number;
  scheduledAt?: Date | undefined;
}

export interface ApprovalPublicApi {
  /** Gửi duyệt nhiều bài (một `submissionId` → MỘT thông báo + MỘT email cho cả lần gửi). */
  submit(input: { items: ApproveItemInput[] }): Promise<BulkResult>;
  withdraw(postId: string, expectedVersion: number): Promise<PostRecord>;
  approve(postId: string, expectedVersion: number, scheduledAt: Date): Promise<PostRecord>;
  approveBatch(items: ApproveItemInput[]): Promise<BulkResult>;
  returnPost(postId: string, expectedVersion: number, note: string): Promise<PostRecord>;
  returnBatch(
    items: { postId: string; expectedVersion: number }[],
    note: string,
  ): Promise<BulkResult>;
  unschedule(postId: string, expectedVersion: number): Promise<PostRecord>;
  reschedule(postId: string, expectedVersion: number, scheduledAt: Date): Promise<PostRecord>;
  savePost(
    postId: string,
    input: { expectedVersion: number; fields: SaveFields },
  ): Promise<PostRecord>;
  suggestTimes(count: number, after?: Date): Promise<Date[]>;
  listPending(page: { cursor?: string | undefined; limit: number }): Promise<PendingListResponse>;
}

/** Token NestJS của ApprovalPublicApi. */
export const APPROVAL_PUBLIC_API = Symbol('APPROVAL_PUBLIC_API');
