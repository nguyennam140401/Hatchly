import { Module } from '@nestjs/common';
import { ApprovalController } from './internal/approval.controller';
import { ApprovalService, PLAN_GATE } from './internal/approval.service';
import { APPROVAL_PUBLIC_API } from './public-api';

/**
 * Module Duyệt & lịch (`approval`) – chỉ chạy ở API, KHÔNG có bảng (schema dành sẵn, để trống).
 * Chỉ điều phối `content` + `publishing` + `notifications` trong một giao dịch. Chỉ export provider thuộc
 * giao diện công khai; mọi thứ khác nằm trong `internal/`.
 * `PLAN_GATE`: cổng kiểm tra gói còn hạn (FR-015) – hiện CHƯA có mô hình gói ở module Tài khoản & Gói nên
 * để trống (mọi gói coi như còn hạn); gắn cổng thật khi có mô hình gói.
 */
@Module({
  controllers: [ApprovalController],
  providers: [
    ApprovalService,
    { provide: APPROVAL_PUBLIC_API, useExisting: ApprovalService },
    { provide: PLAN_GATE, useValue: null },
  ],
  exports: [APPROVAL_PUBLIC_API],
})
export class ApprovalModule {}
