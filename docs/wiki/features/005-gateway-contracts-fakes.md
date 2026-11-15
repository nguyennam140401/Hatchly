---
type: feature
title: 005 – Hợp đồng cổng + bản giả lập (nền tảng, AI, thông báo, kho tệp)
sources:
  [
    specs/005-gateway-contracts-fakes/spec.md,
    specs/005-gateway-contracts-fakes/plan.md,
    specs/005-gateway-contracts-fakes/tasks.md,
    specs/005-gateway-contracts-fakes/data-model.md,
    specs/005-gateway-contracts-fakes/research.md,
    specs/005-gateway-contracts-fakes/quickstart.md,
    specs/005-gateway-contracts-fakes/docs-followup.md,
    specs/005-gateway-contracts-fakes/contracts/platform-gateway.md,
    specs/005-gateway-contracts-fakes/contracts/ai-gateway.md,
    specs/005-gateway-contracts-fakes/contracts/notifications.md,
    specs/005-gateway-contracts-fakes/contracts/storage.md,
    specs/005-gateway-contracts-fakes/contracts/runtime-config.md,
  ]
updated: 2026-11-14
status: current
related:
  [
    modules/platform_gateway.md,
    modules/ai_gateway.md,
    modules/notifications.md,
    modules/media.md,
    modules/queue.md,
    concepts/publish-idempotency.md,
    concepts/ai-budget.md,
    concepts/queues.md,
    concepts/module-boundaries.md,
  ]
---

# 005 – Hợp đồng cổng + bản giả lập

## Mục tiêu

Chốt **giao diện công khai** của 4 điểm phụ thuộc ngoài trước khi viết phần bên trong (WBS 1.8): Cổng nền tảng
(7 thao tác, ADR-05), Cổng AI (giữ chỗ → gọi → quyết toán, ADR-06), Thông báo, Kho tệp. Mỗi hợp đồng có
**bản giả lập** chạy cục bộ, điều khiển được kịch bản, cùng **bộ kiểm thử hợp đồng** tham số hóa để bản thật sau
này qua cùng bộ (`specs/005-gateway-contracts-fakes/spec.md`).

## Mã FR/NFR

WBS 1.8 (chuẩn bị WBS 4.3, 2.6); FR-02, 03, 07, 08, 09, 11, 12 của đặc tả gốc; ADR-03, 04, 05, 06, 07a, 08, 10;
hiến pháp II, III, IV, V, VII, VIII, IX. Yêu cầu nội bộ: FR-001…FR-056 (FR-014a dấu nội dung, FR-015 phân loại
lỗi, FR-021/022 kết nối kênh, FR-036 giữ chỗ nguyên tử, FR-046 sửa manifest).

## Trạng thái

Đã merge vào `dev`. `tasks.md`: 99/99 xong. Việc sửa tài liệu theo FR-038 nằm ở `docs-followup.md`.

## Quyết định chính

- Hợp đồng là `interface` TS + kết quả hợp đóng (`kind`); lỗi nghiệp vụ không ném (R1).
- Cổng nền tảng hai tầng: công khai theo `connectionId`; bộ chuyển đổi nội bộ nhận mã quyền giải mã từ
  `CredentialVault`; rẽ nhánh theo `capabilities`; dấu nội dung chuẩn hóa `ch1:`; phân loại lỗi mặc định +
  hàm áp đè cho `publishing.error_mappings` (R2–R5).
- Cổng AI: giữ chỗ bằng cập nhật có điều kiện + `CHECK`, kẹp trần khi quyết toán, sự kiện 80/100% tạo trong
  cùng giao dịch (`settle` + `onCrossed`); ngân sách hệ thống theo tuần cho xu hướng (R7, R8).
- Thông báo: danh mục đóng Zod ở `@app/shared/notifications`, `emit(tx, event)` qua hàng chờ `notify`; chế độ
  bộ nhớ dùng `memoryTx()` + `flush()`; `account` phát qua `enqueueRegistered` để tránh vòng phụ thuộc (R9).
- Kho tệp ở `core/storage` (S3 + presigned POST), mọi khóa dưới `tenants/{acc}/…`, tệp tạm hết hạn theo nhãn (R13).
- Hai kho trạng thái giả lập: `memory` (kiểm thử) và schema `sandbox` (API + Worker chạy chung) (R10).
- Chọn bản cài đặt bằng biến môi trường; staging/production **từ chối** mọi bản giả lập; endpoint quản trị giả
  lập chỉ dev/test (R11, R12, `contracts/runtime-config.md`).

## Chạm tới

- Module: `platform_gateway`, `ai_gateway`, `notifications`, `media` (kho tệp); mở rộng `core/mail` của
  [004](004-minimal-auth-rbac.md) bằng `deliver()` phân loại `sent/transient/permanent` (R14).
- Code: `apps/server/src/core/gateways` (`selection.ts`, `op-log.ts`, `not-configured.ts`), `core/storage`.
- Hàng chờ: `notify` (tạo trong cùng giao dịch). Schema: `sandbox` (`data-model.md`).
- Tệp kê khai `apps/server/src/modules/modules.manifest.json` được sửa (R17, cần SA duyệt).

## Điểm cần biết khi sửa tiếp

- Bản thật (WBS 2.3, 3.1, 4.3, 2.6) MUST qua cùng bộ kiểm thử hợp đồng; thêm nền tảng = thêm bộ chuyển đổi,
  không sửa luồng đăng chính.
- Chưa có: bảng ngân sách/sổ chi phí/bảng giá trong CSDL, `channel_connections` + mã quyền mã hóa KMS, bảng
  thông báo trong ứng dụng (ngoài phạm vi, xem `spec.md`).
- Không hiển thị số tiền chi phí AI cho khách; `AiUsage` cho khách chỉ là phần trăm (`contracts/ai-gateway.md`).
- Không bật bản giả lập ở staging/production; kiểm tra khởi động sẽ từ chối.
- Mô hình AI/speech-to-text chưa chốt (POC-1/POC-4); chỉ code theo giao diện Cổng AI.

## Nguồn

`specs/005-gateway-contracts-fakes/spec.md`, `plan.md`, `tasks.md`, `data-model.md`, `research.md`,
`quickstart.md`, `docs-followup.md`, `contracts/platform-gateway.md`, `contracts/ai-gateway.md`,
`contracts/notifications.md`, `contracts/storage.md`, `contracts/runtime-config.md`.
