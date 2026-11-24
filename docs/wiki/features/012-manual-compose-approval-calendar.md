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
updated: 2026-11-24
status: current
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

> **Đã xong 95/95 (2026-11-24).** T059 (huy hiệu số bài chờ trên menu, chỉ chủ tài khoản – `AppShell` truyền `overrides.pendingReview` cho
> `useNavCounts`) và T066 (tab "Lịch sử" ở màn Soạn bài – `HistoryTab`) làm nốt trong đợt merge thứ hai; dọn 3 lỗi có sẵn từ `dev`.
> **Chưa chạy tay:** kịch bản G (`PUBLISH_EXECUTOR=fake|none`) và H (hết ngân sách AI) của `quickstart.md` – chủ sản phẩm chấp nhận bằng chứng
> từ test tự động (A–F phủ bằng test trên Postgres thật); sẽ phủ lại ở nghiệm thu chung với 013. Các việc nhỏ khác xem "Ghi chú thi công"
> trong `specs/012-manual-compose-approval-calendar/tasks.md`.

## Mục tiêu

Khái niệm "bài viết": bài + nội dung riêng từng kênh, vòng đời Nháp → Chờ duyệt → Đã lên lịch, duyệt từng bài/nhiều bài (mỗi bài một
giao dịch), trả lại kèm ghi chú, đổi giờ không cần duyệt lại, sửa bài đã duyệt tự về Chờ duyệt, và 4 màn hình (Soạn/xem bài, Chờ duyệt,
Lịch, Bài viết). Chưa đăng thật: việc thực thi 5 bước thuộc 013.

## Mã FR/NFR

FR-05 (phần soạn tay), FR-06; hiến pháp I, II (không đăng trùng: chỉ mục duy nhất), IV, V, VI. Không gọi Cổng AI, không trừ hạn mức 100 bài.

## Trạng thái

`current` (95/95 việc). Merge `dev` lần 1 ngày 2026-11-16, lần 2 ngày 2026-11-24 (`4fdc437`). Kiểm thử đợt 2: web 525, tooling 304, e2e trình duyệt 51;
`lint`, `typecheck`, `check:boundaries`, `check:secrets` đạt. `test:db` có 4 test chập chờn khi chạy dồn tải (chạy riêng đều đạt) – theo dõi trong CI.
Mock e2e dùng chung nằm ở `apps/web/e2e/helpers.ts` (`mockSession`): màn nào gọi API mới phải thêm mock, không thì hiện hộp "Phiên đã hết hạn".

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
