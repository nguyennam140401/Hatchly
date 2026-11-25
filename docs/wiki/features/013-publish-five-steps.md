---
type: feature
title: 013 Đăng bài 5 bước, Đăng lại, Tiến trình đăng
sources:
  [
    specs/013-publish-five-steps/spec.md,
    specs/013-publish-five-steps/plan.md,
    specs/013-publish-five-steps/tasks.md,
    specs/013-publish-five-steps/data-model.md,
    specs/013-publish-five-steps/contracts/publishing-http-api.md,
    specs/013-publish-five-steps/contracts/publishing-public-api.md,
    specs/013-publish-five-steps/acceptance-report.md,
    apps/server/src/modules/publishing/internal/state-machine.ts,
    apps/server/src/modules/publishing/internal/attempt-actions.service.ts,
    apps/web/src/features/publish-progress/PublishProgress.tsx,
  ]
updated: 2026-11-25
status: draft
related:
  [
    modules/publishing.md,
    modules/platform_gateway.md,
    concepts/publish-idempotency.md,
    concepts/queues.md,
    features/012-manual-compose-approval-calendar.md,
    open-questions.md,
  ]
---

# 013 Đăng bài 5 bước, Đăng lại, Tiến trình đăng

> **CÒN MỞ – đừng bỏ sót.** 91/92 việc xong. Còn **T085**: chưa kiểm chứng với Facebook/Instagram thật (cần 010 có kho kết nối thật,
> tài khoản thử Meta, staging). Mọi kết quả kiểm thử hiện dùng bộ chuyển đổi giả lập (`PLATFORM_ADAPTER_MODE=fake`). Đây cũng là đầu vào
> của POC-2 (đọc lại bài đã đăng để đối soát). Merge `dev` ngày 2026-11-25 (`e9277e6`), nhánh `impl/013-…` đã xóa.

## Mục tiêu

Thay bộ thực thi tạm của 012 bằng module `publishing` thật: lượt đăng duy nhất mỗi (bài, kênh), bộ thực thi 5 bước chạy ở Worker,
phân loại ba loại lỗi, thử lại, đối soát, trạng thái "Cần kiểm tra", bộ chuyển đổi Facebook Page/Instagram và khu vực **Tiến trình đăng**
trên giao diện, kèm **"Đăng lại" một thao tác** và **"Đã đăng"**.

## Mã FR/NFR

FR-07 (đăng), FR-08 (5 bước có nhật ký), FR-09 (lỗi, thử lại, "Đăng lại", "Cần kiểm tra"), phần dữ liệu của FR-10; quyền `post.republish`,
`status.view`, `support.lookup` (FR-031). Hiến pháp II (không đăng trùng), V (việc nền chạy lại an toàn), I, VI, VII, VIII.

## Trạng thái

`draft` (91/92 việc, còn T085). Kiểm thử cuối: web 530, server 911, `test:db` 1650, `test:queue` 241; `lint`, `typecheck`, `check:boundaries`,
`check:secrets`, `test:web-e2e` đạt. Hai ca chập chờn khi chạy dồn tải, **không thuộc 013**: `purge-account.queue.spec.ts` (003) và
`ComposePage.spec.tsx` (012); chạy riêng đều đạt. Chi tiết: `acceptance-report.md`.

## Quyết định chính

- **Máy trạng thái** nằm trọn trong `publishing`: mọi chuyển trạng thái là `UPDATE … WHERE status = :expected` và kiểm số dòng ảnh hưởng
  (`state-machine.ts`, hàm `transition()`). Chỉ mục duy nhất một phần `(account_id, post_id, connection_id) WHERE status <> 'cancelled'`.
- **Một loại việc** `publishing.execute_attempt` (hàng chờ `publish`, khóa `publish:{attemptId}`, không tự thử lại chung). Bộ xử lý rẽ nhánh
  theo giai đoạn: chưa gửi → bước 1–3; đã ghi "Đã gửi, chờ phản hồi" → chỉ đối soát, **không bao giờ gửi lại**; chờ xử lý → bước 4–5.
- Dấu "đã gửi" được ghi **trước** khi gọi nền tảng; việc gọi nền tảng nằm **ngoài** giao dịch CSDL. Lỗi "không xác định" → `unknown` → đối soát;
  `unknown` không có đường sang `scheduled`, nên không gửi lại ngay.
- **Đăng lại** (`attempt-actions.service.ts`): chỉ từ `needs_user` hoặc `needs_check`, **theo từng kênh**, cùng một lượt (không tạo lượt thứ hai),
  giờ đăng = bây giờ, xóa dấu gửi, tạo việc, ghi `audit_log` `publish.republish` (người thao tác, `trace_id`). Kênh `succeeded` không có nút và
  API từ chối `PUBLISH_NOT_REPUBLISHABLE`. Từ `needs_check` trả cảnh báo `possible_duplicate`.
- **Sửa sau converge (T088):** nếu `enqueue` trả `exists` (khóa `publish:{id}` còn việc created/active/retry) thì giao dịch bị hoàn tác và ném
  `PUBLISH_VERSION_CONFLICT` ("Bài đang được xử lý, thử lại sau ít giây"); trước đó lượt có thể treo ở `scheduled` không có việc. Giữ nguyên khóa chống trùng.
- Nhật ký 5 bước ghi vào `publish_steps` (chỉ thêm, phân vùng tháng, giữ 12 tháng), tách khỏi nhật ký kỹ thuật; không chứa mã quyền, nội dung bài
  hay phản hồi thô.
- Web thăm dò định kỳ 5–10 giây khi còn trạng thái chưa kết thúc, không thêm hạ tầng đẩy (Hiến pháp IX).
- Vai trò hỗ trợ gọi điểm cuối khách hàng nhận **401**, không phải 403 (hợp đồng AS4 của 004); test chấp nhận 401 và cấm mọi 2xx.

## Chạm tới

| Loại                       | Nội dung                                                                                                                                             |
| -------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| Bảng (schema `publishing`) | `publish_attempts`, `publish_steps` (nhật ký phân vùng), `error_mappings`                                                                            |
| Hàng chờ / việc            | hàng `publish`, việc `publishing.execute_attempt`; việc định kỳ `overdue.sweeper` (quá hạn > 5 phút, cảnh báo)                                       |
| API HTTP                   | `GET /api/posts/{postId}/publish-progress`, `POST /api/publish-attempts/{id}/republish`, `…/mark-published`, `GET …/support-details`                 |
| API công khai module       | `PublishingPublicApi` (schedule, cancel, reschedule, trạng thái) cho `approval` (012)                                                                |
| Module khác                | `platform_gateway` (bộ chuyển đổi Facebook/Instagram, `classifyError`), `media` (`getPublishableMedia`, 014), `account` (`getPublishingEligibility`) |
| Web                        | `apps/web/src/features/publish-progress/` (Tiến trình đăng, dòng thời gian 5 bước, "Chi tiết cho hỗ trợ")                                            |

## Điểm cần biết khi sửa tiếp

- Mọi chuyển trạng thái phải đi qua `transition()`; không `UPDATE` trạng thái ở nơi khác. Thêm cặp chuyển mới thì cập nhật bảng trong `data-model.md`
  (đã có `processing → cancelled` để hủy khi bài bị sửa).
- Bảng `error_mappings` sai có thể gây đăng trùng: mã lạ luôn `unknown`; `transient` chỉ khi mã nằm trong bảng và đã qua kiểm thử hợp đồng.
- Mock e2e dùng chung ở `apps/web/e2e/helpers.ts` (`mockSession`); màn mới gọi API mới phải thêm mock.
- Chưa gắn Tiến trình đăng vào chi tiết bài/Lịch (xem `013-nối-UI` ở [open-questions](../open-questions.md)).
- `pnpm verify` chạy `test:db`, `test:queue`, `test:e2e` đồng thời trên một Postgres sẽ gây lỗi kết nối 57P01 giả; chạy tuần tự từng bước.
  Muốn chạy một tệp: `pnpm exec vitest run --config vitest.db.config.mts <tệp>` (`pnpm run test:db -- <tệp>` vẫn chạy cả bộ).

## Nguồn

- specs/013-publish-five-steps/ (spec, plan, tasks, data-model, contracts, acceptance-report, reviews/review-013.md)
- apps/server/src/modules/publishing/internal/ (state-machine, attempt-actions.service, executor/, progress.query)
- apps/web/src/features/publish-progress/PublishProgress.tsx
