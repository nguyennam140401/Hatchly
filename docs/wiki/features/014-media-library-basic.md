---
type: feature
title: 014 Thư viện media cơ bản
sources:
  [
    specs/014-media-library-basic/spec.md,
    specs/014-media-library-basic/plan.md,
    specs/014-media-library-basic/tasks.md,
    specs/014-media-library-basic/research.md,
    specs/014-media-library-basic/data-model.md,
    specs/014-media-library-basic/contracts/media-http-api.md,
    specs/014-media-library-basic/contracts/media-public-api.md,
    specs/014-media-library-basic/contracts/storage-multipart.md,
    apps/server/drizzle/migrations/0022_media_tables.sql,
    apps/server/drizzle/migrations/0023_media_functions.sql,
    apps/server/src/modules/media/jobs.ts,
    apps/server/docs/media.md,
    ops/alerts/media.rules.yml,
  ]
updated: 2026-11-18
status: draft
related:
  [
    modules/media.md,
    modules/content.md,
    modules/publishing.md,
    concepts/queues.md,
    concepts/tenant-rls.md,
    concepts/feature-status.md,
    open-questions.md,
  ]
---

# 014 Thư viện media cơ bản

> **CÒN VIỆC CHƯA LÀM.** 92/94 việc xong. Còn: **T090** (đo SC-001/002/003/007/010 trên 4G và vStorage thật, ghi vào `research.md`) và
> **T093** (14 bước thử tay + 6 thử nghiệm kỹ thuật của `quickstart.md`). T094 (wiki) là lần ingest này. Đã merge `dev` ngày 2026-11-18 (`f82e80b`);
> nhánh `impl/014-media-library-basic` và worktree được **giữ**. Chi tiết ở "Điểm cần xem lại" trong `specs/014-media-library-basic/tasks.md`.

## Mục tiêu

Mỗi tài khoản có một thư viện ảnh/video: tải nhiều tệp **thẳng lên kho tệp** bằng đường dẫn ký sẵn (không qua API), tiếp tục được khi gián đoạn, chặn
**5 GB/tài khoản** ngay lúc bắt đầu tải, xử lý nền (ảnh chuẩn hóa JPEG cạnh dài ≤ 2048 px, ảnh thu nhỏ, khung hình đại diện cho video), chống trùng nội
dung, xóa mềm có cảnh báo bài đang dùng, và cấp **đường dẫn công khai có hạn** cho tính năng Đăng bài. Không làm: gán nhãn AI, tìm theo nhãn, chỉnh sửa,
album (T11 trở đi).

## Mã FR/NFR

FR-03 (phần cơ bản; ảnh nhận tới **20 MB**, lệch FR-03 ghi 10 MB — đã sửa tài liệu gốc), FR-07 (nền tảng tải media qua đường dẫn công khai có hạn),
FR-14 (xóa media khi xóa tài khoản), NFR dung lượng/hiệu năng; hiến pháp I, IV, V, VII, VIII (II và III không áp dụng trực tiếp).

## Trạng thái

`draft` (92/94). Kiểm thử trên PostgreSQL thật (2026-11-18): nhóm `test/media` + `test/db/media-*` + `account-deletion` 91/91 đạt; `pnpm verify` đạt
`test:db`, `test:e2e`, `test:web-e2e`, `db:compat`, `check:image`. Lỗi có sẵn ngoài phạm vi 014: `typecheck` (`test/check-wiki.spec.ts`), `test` tooling và
`infra:check` (thiếu `tooling/infra/commands/kubeconfig.mjs`), `test:queue` `purge-account` chỉ lỗi khi chạy cả bộ.

## Quyết định chính

- **Hai chế độ tải**: ≤ 8 MiB một lần POST ký sẵn; lớn hơn dùng **S3 multipart** (phần 8 MiB, URL ký sẵn từng phần). Nhận lại phiên bằng
  `fingerprint` = SHA-256(tên|dung lượng|lastModified); phần đã lên lấy từ `ListParts` của kho (R1, R2).
- **Dấu tệp tính ở Worker**, chống trùng bằng chỉ mục duy nhất `(account_id, file_hash)`; trùng ⇒ hoàn dung lượng, báo "đã có" (R3).
- **Bộ đếm 5 GB nằm ở schema `media`** (`storage_quotas`), cập nhật có điều kiện cùng giao dịch, CHECK là chốt chặn cuối; không ghi vào schema `account` (R6).
- **Xử lý nền**: `sharp` (HEIC qua bộ giải mã WASM, đã kiểm chứng T029) và `ffmpeg`/`ffprobe` trong ảnh container; khóa đối tượng cố định theo `mediaId` nên chạy
  lại an toàn. Lỗi vĩnh viễn ⇒ `unprocessable` + `noRetry`, không vào `dead_jobs` (R4, R5).
- **Loại tệp theo nội dung thật** (hàm dò magic bytes của dự án, không thêm thư viện) lúc xác nhận (R8).
- **Không có cửa HTTP nào trả đường dẫn `public`**: chỉ `MediaPublicApi.issuePublicUrl` (module `publishing` gọi); ảnh dùng bản JPEG chuẩn hóa, video dùng tệp gốc (R9).
- **Đảo phụ thuộc** "bài nào đang dùng media": `media` định nghĩa `MediaUsageProvider`, `content` đăng ký — tránh vòng `content ↔ media` (R10).
- Giới hạn đồng thời việc `media` = 1 việc/tài khoản qua `infra.queue_settings` (R11); `UploadGate` nội bộ mặc định `allowed: true` cho tới khi có mô hình gói (R12).
- **FR-023 (nhật ký)**: URL ký sẵn, `post.fields`, mã phiên của kho và tên tệp không vào nhật ký. Mã phiên `uploadId` của ứng dụng vẫn nằm trong đường dẫn của
  nhật ký truy cập chung của core; kiểm thử chỉ cấm nó ở dòng do module `media` ghi và thông điệp lỗi.

## Chạm tới

| Loại                                            | Nội dung                                                                                                                                                                                                 |
| ----------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Bảng (schema `media`, migration `0022`, `0023`) | `media` (xóa mềm), `upload_sessions`, `storage_quotas`; hàm `media.list_cleanup_accounts` (`SECURITY DEFINER`, chỉ `system`)                                                                             |
| Hàng chờ                                        | `media.process`, `media.purge_files`, `media.cleanup` (queue `media`, theo tenant); `media.sweep` (queue `scheduled`, cron `7 * * * *` UTC, `full` mỗi Chủ nhật)                                         |
| API                                             | `GET /media/quota`; `POST /media/uploads`, `…/part-urls`, `…/complete`, `GET`/`DELETE …/uploads/:id`; `GET /media`, `/media/:id`, `/media/:id/usages`, `DELETE /media/:id`                               |
| Quyền                                           | `media.view`, `media.upload`, `media.delete` (cộng tác viên: chỉ tệp mình tải)                                                                                                                           |
| Kho tệp                                         | `tenants/{acc}/media/{mediaId}/original`, `normalized/jpeg`, `thumb`; `ObjectStorage` thêm 5 thao tác multipart                                                                                          |
| Module khác                                     | `content` (`MEDIA_DESCRIBER`, `MediaUsageRegistrar`), `publishing` (`getPublishableMedia` ở bước 2); `modules.manifest.json` đã có `media` trong `allowedDeps` của cả hai                                |
| Giao diện                                       | `/media` (`features/media/`), dùng lại hàng đợi tải `lib/upload` của 011                                                                                                                                 |
| Quan sát                                        | chỉ số OpenTelemetry `media_uploads_total`, `media_processed_total`, `media_process_duration_seconds`, `media_storage_bytes_by_kind`, `media_quota_drift_total`; cảnh báo ở `ops/alerts/media.rules.yml` |

## Điểm cần biết khi sửa tiếp

- `getPublishableMedia` trả `format` dạng **ngắn** (`jpeg`, `png`, `mp4`, `mov`) vì quy tắc kênh so với tên ngắn; bản đầu trả MIME (`image/jpeg`) làm mọi lần đăng thật
  báo sai định dạng — đã sửa ở T091. Logic đổi MIME → tên ngắn đang lặp ở `media/internal/public-api.impl.ts` (`formatOf`) và `content/internal/media-describer.ts`.
- `MediaUsageRegistrar` đăng ký nhà cung cấp lúc khởi động và bỏ qua nếu đã có (nhiều ứng dụng Nest trong một tiến trình kiểm thử). Test cần nhà cung cấp giả phải gọi
  `resetMediaUsageProviderForTests()` trước.
- SQL của nhà cung cấp dùng `IN (…)` với `sql.join`: drizzle bung mảng thành danh sách tham số nên `unnest(…::text[])` sẽ hỏng.
- Bộ kiểm thử CSDL cần `TEST_DATABASE_ADMIN_URL` (xem [run-tests](../howto/run-tests.md)); thiếu biến này các kiểm thử `test/media` bị bỏ qua, không báo lỗi.
- Ngân sách kho: phái sinh có thể vượt ước lượng 10–20% của spec ở kịch bản toàn ảnh nhỏ (bảng "Ngân sách kho" trong `plan.md`); T090 phải đối chiếu số thực.

## Nguồn

- specs/014-media-library-basic/spec.md, plan.md, research.md, data-model.md, tasks.md
- specs/014-media-library-basic/contracts/ (media-http-api, media-public-api, media-ui, storage-multipart)
- apps/server/docs/media.md (hướng dẫn cho module khác)
- apps/server/drizzle/migrations/0022_media_tables.sql, 0023_media_functions.sql
- apps/server/src/modules/media/jobs.ts, apps/server/src/modules/content/internal/media-usage.provider.ts
