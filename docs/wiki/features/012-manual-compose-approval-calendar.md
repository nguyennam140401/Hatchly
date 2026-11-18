---
type: feature
title: 012 Soạn bài tay, duyệt, lịch, Chờ duyệt
sources:
  [
    specs/012-manual-compose-approval-calendar/spec.md,
    specs/012-manual-compose-approval-calendar/plan.md,
    specs/012-manual-compose-approval-calendar/tasks.md,
    specs/012-manual-compose-approval-calendar/data-model.md,
    specs/012-manual-compose-approval-calendar/contracts/http-api.md,
    specs/012-manual-compose-approval-calendar/contracts/module-api.md,
    apps/server/drizzle/migrations/0017_content_posts.sql,
    apps/server/src/modules/approval/internal/approval.service.ts,
  ]
updated: 2026-11-16
status: draft
related:
  [
    modules/content.md,
    modules/approval.md,
    modules/publishing.md,
    modules/platform_gateway.md,
    concepts/feature-status.md,
    concepts/web-ui.md,
    open-questions.md,
  ]
---

# 012 Soạn bài tay, duyệt, lịch, Chờ duyệt

> **CÒN VIỆC CHƯA LÀM – đừng bỏ sót.** 91/95 việc xong. Còn: **T059** (số bài chờ trên điều hướng – bảng điều hướng 011 bị ghim 7 mục,
> hiện chỉ có liên kết "Chờ duyệt" ở màn Bài viết và chưa gắn `setCountSources`), **T066** (tab "Lịch sử" trên màn Soạn bài; API đã có),
> **T093** (toàn bộ kiểm tra xanh trừ 2 lỗi có sẵn từ `dev`: `tooling/test/check-wiki.spec.ts`, prettier `feature-status.md`;
> `pnpm verify` chưa chạy trọn do hết thời gian), **T094** (chưa chạy tay quickstart trên trình duyệt). Còn nhỏ: "tải thêm" ở danh sách
> Bài viết, vùng đính media (chờ thư viện media), nút "Thêm bài" ở Lịch chưa điền sẵn ngày. Nhánh `impl/012-…` và worktree được **giữ**.
> Danh sách đầy đủ ở "Ghi chú thi công" trong `specs/012-manual-compose-approval-calendar/tasks.md`.

## Mục tiêu

Khái niệm "bài viết": bài + nội dung riêng từng kênh, vòng đời Nháp → Chờ duyệt → Đã lên lịch, duyệt từng bài/nhiều bài (mỗi bài một
giao dịch), trả lại kèm ghi chú, đổi giờ không cần duyệt lại, sửa bài đã duyệt tự về Chờ duyệt, và 4 màn hình (Soạn/xem bài, Chờ duyệt,
Lịch, Bài viết). Chưa đăng thật: việc thực thi 5 bước thuộc 013.

## Mã FR/NFR

FR-05 (phần soạn tay), FR-06; hiến pháp I, II (không đăng trùng: chỉ mục duy nhất), IV, V, VI. Không gọi Cổng AI, không trừ hạn mức 100 bài.

## Trạng thái

`draft` (91/95 việc), merge vào `dev` ngày 2026-11-16. Kiểm thử: unit 437, CSDL 738, hàng chờ 107, web 438; `check:boundaries`,
`db:check`, `db:lint-migrations`, `check:secrets`, `check:web-rules` đạt.

## Quyết định chính

- `approval` không có bảng, chỉ **điều phối**: mọi thao tác đổi trạng thái/đụng lịch chạy trong MỘT `tenantTx` qua hàm công khai nhận `tx` của
  `content`/`publishing`; `content` không gọi ngược `publishing` nên `GET /posts/:id` và `GET /calendar` nằm ở `approval`.
- Khóa lạc quan cấp bài (`posts.version`); lệch phiên bản → `VERSION_CONFLICT` kèm bài mới (trường `extra` của `ErrorResponse`).
- Chốt chặn đăng trùng: chỉ mục duy nhất `(account_id, post_id, channel_connection_id) WHERE status <> 'cancelled'`.
- Bộ thực thi tạm `publishing.run_attempt` (`PUBLISH_EXECUTOR=none|fake`); 013 thay thân hàm, giữ hợp đồng.
- Chưa có cổng gói còn hạn (`PLAN_GATE`) và mô tả media (`MEDIA_DESCRIBER`): kênh bắt buộc media báo "chưa thể lên lịch".

## Chạm tới

| Loại      | Nội dung                                                                                                                                                           |
| --------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Bảng      | `content.posts`, `channel_variants`, `post_events` (chỉ thêm), `channel_rules` (dùng chung, app chỉ đọc); `publishing.publish_attempts` – migration `0017`, `0018` |
| Hàng chờ  | `publishing.run_attempt` (`publish`, tenant, `dedupeKey = publish:{attemptId}`)                                                                                    |
| API       | ~19 điểm cuối: `/posts*`, `/approvals/*`, `/calendar`, `/channel-rules`                                                                                            |
| Thông báo | dùng danh mục 005: `post_pending_review`, `post_returned`, `approved_post_rescheduled`                                                                             |
| Kiểm toán | `post.submit                                                                                                                                                       | withdraw | approve | return | unschedule | reschedule | edit_after_approval | delete_draft` |
| Web       | `/posts/new`, `/posts/:id`, `/posts`, `/approvals`, `/calendar`                                                                                                    |
| Khác      | `platform_gateway.listConnections()` mới; `content → platform_gateway` trong tệp kê khai                                                                           |

## Điểm cần biết khi sửa tiếp

- Thêm mã lỗi vào `ERROR_CODES` buộc thêm giải thích ở `apps/web/src/lib/catalogs/error-explanations.ts` (biên dịch bắt).
- Kiểm thử thông báo cần `FAKE_STATE_STORE=sandbox` (chế độ memory từ chối `tx` thật).
- Giá trị `channel_rules` của Instagram/Zalo chưa xác minh (POC-2) – đổi bằng cập nhật dòng.
- Kiểm thử đồng thời nhạy tải CPU: chạy tuần tự, đừng chạy song song với lint/tsc.

## Nguồn

- specs/012-manual-compose-approval-calendar/ (spec, plan, tasks, data-model, contracts)
- apps/server/src/modules/{content,publishing,approval}/
- apps/web/src/features/{posts,approvals,calendar}/
