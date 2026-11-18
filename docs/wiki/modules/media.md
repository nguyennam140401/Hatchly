---
type: module
title: Module media (Thư viện media)
sources:
  [
    apps/server/src/modules/modules.manifest.json,
    apps/server/src/modules/media/public-api.ts,
    apps/server/src/modules/media/index.ts,
    apps/server/src/modules/media/jobs.ts,
    apps/server/docs/media.md,
    specs/014-media-library-basic/data-model.md,
    .specify/memory/architecture.md,
  ]
updated: 2026-11-18
status: current
related:
  [
    features/014-media-library-basic.md,
    modules/content.md,
    modules/publishing.md,
    concepts/queues.md,
    concepts/tenant-rls.md,
  ]
---

# media – Thư viện media

## Trách nhiệm

Tải ảnh/video thẳng lên kho tệp bằng đường dẫn ký sẵn (`tenants/{mã}/`), tải nhiều phần và tiếp tục, giới hạn 5 GB/tài khoản, xử lý nền (ảnh chuẩn hóa JPEG ≤ 2048 px,
ảnh thu nhỏ, khung hình video), dấu tệp chống xử lý trùng, xóa mềm và dọn tệp, cấp đường dẫn công khai có hạn cho Đăng bài (FR-03, FR-07). **Chưa có**: gán nhãn AI và
gán nhãn tay (T11), nên bảng `media_labels` trong thiết kế cũ chưa tồn tại.

## Schema/bảng

Schema `media` (migration `0022_media_tables.sql`, `0023_media_functions.sql`): `media` (xóa mềm), `upload_sessions`, `storage_quotas`. Cả ba là `tenantTable` có RLS; FK chỉ
nội bộ (`upload_sessions → media`) và tới `accounts`. Hàm `media.list_cleanup_accounts` (`SECURITY DEFINER`, chỉ `system`) chọn tài khoản cần dọn.

## Giao diện công khai

`MEDIA_PUBLIC_API` (`MediaPublicApi`): `describe`, `assertAttachable`, `getPreviewUrls` (loại `preview`, ≤ 1 giờ), `issuePublicUrl` (loại `public`, mặc định và trần 86.400 giây,
chỉ `publishing` gọi), `getPublishableMedia` (bước 2 của 013, `format` dạng ngắn `jpeg`/`mp4`). Không thao tác nào nhận mã tài khoản. Cổng đảo phụ thuộc
`registerMediaUsageProvider` (`MediaUsageProvider`) để module bài báo "bài nào đang dùng media". Hướng dẫn cho module khác: `apps/server/docs/media.md`.

## Phụ thuộc cho phép

`account`, `ai_gateway`, `queue` (theo manifest). `content` và `publishing` có `media` trong `allowedDeps` của mình.

## Chạy ở

api (controller tải lên/thư viện) + worker (hàng chờ `media`: `media.process`, `media.purge_files`, `media.cleanup`; `media.sweep` ở hàng chờ `scheduled`).

## Tính năng liên quan

[014](../features/014-media-library-basic.md) (toàn bộ module); [012](../features/012-manual-compose-approval-calendar.md) (đính media vào bài qua `content`);
[001](../features/001-monorepo-module-skeleton.md) (khung module).

## Nguồn

- apps/server/src/modules/modules.manifest.json
- apps/server/src/modules/media/public-api.ts, jobs.ts
- apps/server/docs/media.md
- specs/014-media-library-basic/data-model.md
- .specify/memory/architecture.md (mục 4)
