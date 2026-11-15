---
type: concept
title: Đăng bài không trùng (thiết kế)
sources:
  [
    .specify/memory/constitution.md,
    .specify/memory/architecture.md,
    TaiLieuDacTa/ADR_App_AI_Content_MXH.md,
    TaiLieuDacTa/ADD_Module_Dang_bai.md,
    apps/server/docs/gateways.md,
    apps/server/src/modules/publishing/public-api.ts,
  ]
updated: 2026-11-14
status: draft
related:
  [modules/publishing.md, modules/platform_gateway.md, concepts/queues.md, decisions/index.md]
---

# Đăng bài không trùng (hiến pháp II, ADR-03/04)

**Trạng thái: thiết kế; `publishing` mới là khung rỗng** (không bảng, không bộ xử lý). Hiện thực được: hợp đồng
`platform_gateway` (`submit`/`reconcile`/`classifyError`/`contentHash`) và bản giả để kiểm thử.

Thiết kế (ADD Đăng bài; architecture.md mục 7.1):

- Mỗi cặp (bài, kênh) tối đa một `publish_attempt` hiệu lực (ràng buộc duy nhất); chuyển trạng thái bằng UPDATE có điều kiện.
- Duyệt bài + tạo lượt đăng + tạo việc trong **một** giao dịch; khóa việc `publish:{attemptId}`; loại việc `publish` đặt
  `allowGenericRetry: false` (hỗ trợ không chạy lại chung).
- Ghi "đã gửi, chờ phản hồi" **trước** khi gửi; lưu `contentHash` cùng lượt đăng.
- Ba loại lỗi: chắc chắn chưa nhận -> thử lại giãn cách (≤ 5 lần/30 phút); cần người dùng -> dừng + báo kèm cách khắc phục;
  không xác định -> KHÔNG gửi lại, đối soát (`reconcile`, nếu kênh hỗ trợ), không được -> "Cần kiểm tra".
- Ghi đủ 5 bước (`publish_steps`: kiểm tra trước, chuẩn bị media, gửi, chờ xử lý, xác nhận); bộ hẹn giờ chung, không dùng
  hẹn giờ của nền tảng; mã theo dõi xuyên API -> hàng chờ -> Worker -> nền tảng.

**Cần kiểm chứng**: khả năng đối soát từng nền tảng (POC), tỷ lệ "Cần kiểm tra" > 1% là điều kiện xem lại ADR-04.

## Nguồn

- .specify/memory/constitution.md (nguyên tắc II)
- TaiLieuDacTa/ADD_Module_Dang_bai.md
- apps/server/docs/gateways.md (mục 1)
