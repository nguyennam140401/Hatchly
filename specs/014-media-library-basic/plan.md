# Implementation Plan: Thư viện media cơ bản – tải thẳng (nhiều tệp, có tiếp tục), chuẩn hóa JPEG, ảnh thu nhỏ, giới hạn 5 GB, đường dẫn công khai có hạn

**Branch**: `impl/014-media-library-basic` | **Date**: 2026-11-16 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `specs/014-media-library-basic/spec.md` (đã qua `/speckit-clarify`: 5 câu hỏi)

## Summary

Dựng module **Thư viện media** (`media`, WBS T5) cho từng tài khoản: tải nhiều ảnh/video **thẳng lên kho tệp** bằng đường dẫn ký sẵn (không qua API), **tiếp tục** được khi gián đoạn,
chặn **5 GB/tài khoản** bằng giữ chỗ có điều kiện trước khi tải, xử lý nền (chuẩn hóa ảnh thành **JPEG cạnh dài ≤ 2048 px**, **ảnh thu nhỏ**, ảnh đại diện cho video), chống trùng nội dung theo tài khoản,
xóa mềm có cảnh báo bài đang dùng, và cấp **đường dẫn công khai có hạn** cho tính năng Đăng bài. Hướng kỹ thuật (research R1–R15):

- **Hai chế độ tải**: ≤ 8 MiB dùng POST ký sẵn có sẵn từ 005; lớn hơn dùng **S3 multipart** (mở rộng cổng `ObjectStorage` thêm 5 thao tác), nhận lại phiên bằng `fingerprint`, phần đã lên lấy từ `ListParts`.
- **Dấu tệp tính ở Worker** (không ở API), chống trùng bằng chỉ mục duy nhất `(account_id, file_hash)`; trùng ⇒ hoàn dung lượng và báo "đã có".
- **Bộ đếm 5 GB trong schema `media`** (`storage_quotas`), cập nhật có điều kiện cùng giao dịch, CHECK làm chốt chặn cuối; **không** ghi vào schema `account`.
- **Xử lý nền** bằng `sharp` (HEIC qua bộ giải mã WASM, có thử nghiệm kiểm chứng) và `ffmpeg`/`ffprobe` trong ảnh container dùng chung; mọi bước ghi theo khóa cố định theo `mediaId` nên chạy lại an toàn.
- **Phụ thuộc đảo** cho "bài nào đang dùng media" (`MediaUsageProvider`) để tránh vòng `content ↔ media`; `UploadGate` nội bộ cho "gói hết hạn" cho tới khi WBS 2.6 có dữ liệu gói.
- **Giao diện**: dùng lại hàng đợi tải của 011 (`lib/upload`), mở rộng trạng thái và vận chuyển; màn hình mới `features/media/`.

Phần **không** làm (T11 và sau): gán nhãn AI, tìm theo nhãn, gợi ý media, chuẩn hóa video theo kênh, chỉnh sửa, album, chia sẻ giữa tài khoản.

## Technical Context

**Language/Version**: TypeScript 5.9.3, Node.js 24 (pnpm 10.34.9; monorepo `apps/server`, `apps/web`, `packages/shared`)

**Primary Dependencies**: NestJS 11.2.8, Drizzle ORM 0.45.4, pg-boss 12.38.0 (bọc trong `modules/queue`), Zod 4.6.7, `@aws-sdk/client-s3` + `s3-request-presigner` + `s3-presigned-post` 3.1158.0 (đã có);
React 19.3.1, React Router 8.5.1, Vite 8.3.6. **Thêm (server)**: `sharp` và một bộ giải mã HEIC WASM (`libheif-js`/`heic-decode`) — **phiên bản chính xác cố định lúc implement** (hiến pháp IX), gói `ffmpeg` hệ điều hành cài vào ảnh container (R4, R5).
**Không thêm** thư viện web nào (băm `fingerprint` bằng WebCrypto có sẵn).

**Storage**: PostgreSQL có RLS — schema `media`: `media`, `upload_sessions`, `storage_quotas` ([data-model.md](./data-model.md)). Kho tệp S3-tương thích dưới `tenants/{accountId}/media/{mediaId}/…` (MinIO ở dev). Không cache số liệu hạn mức.

**Testing**: Vitest 5.1.0 (đơn vị; hợp đồng kho `memory` + `s3`→MinIO; `test:db`, `test:queue` trên PostgreSQL thật; e2e API bằng supertest); Testing Library + `vitest-axe` (web); Playwright (gói `e2e/`).

**Target Platform**: API + Worker trên Kubernetes (cùng một ảnh container); SPA trên trình duyệt di động/máy tính từ 360 px.

**Project Type**: Ứng dụng web (SPA + API/Worker), modular monolith.

**Performance Goals**: SC-001 (10 ảnh ≤ 5 MB xong ≤ 2 phút trên 4G) · SC-003 (95% ảnh có bản chuẩn + ảnh thu nhỏ ≤ 30 giây với lô ≤ 10; video ≤ 2 phút) · SC-007 (lưới 200 tệp ≤ 3 giây trên 4G; lọc ≤ 1 giây) · SC-010 (100 ảnh liên tiếp không làm việc đăng bài của tài khoản khác trễ > 5 phút).

**Constraints**: tệp không đi qua API (hiến pháp V, FR-002); mọi khóa dưới `tenants/{acc}/` (I); giữ chỗ dung lượng cùng giao dịch (FR-008); không URL ký sẵn trong nhật ký/chỉ số (FR-023); không có điểm cuối HTTP trả đường dẫn `public` (FR-017);
migration chỉ thêm; không thêm dịch vụ chạy mới (IX); ≤ 500 MB ghi đĩa tạm mỗi việc video.

**Scale/Scope**: 100 tài khoản × 5 GB = 500 GB tệp gốc (+ ~10–20% bản phái sinh, kiểm ở bảng "Ngân sách kho"); ~1.700 ảnh/tài khoản; 3 bảng, ~10 điểm cuối HTTP, 4 loại việc, 1 module mở rộng kho tệp (5 thao tác), 3 quyền, 1 màn hình + hộp chi tiết/xóa.

**Ngân sách kho (kiểm lại ở plan, theo spec Assumptions)**: tệp gốc ≤ 5 GB/tài khoản (tính hạn mức); bản chuẩn hóa ảnh ≤ 2048 px JPEG q82 ≈ 0,3–1 MB; ảnh thu nhỏ ≈ 20–40 KB. Với ảnh trung bình gốc 3 MB ⇒ phái sinh ≈ 15–35% **của số ảnh**, tức vượt ước lượng 10–20% của spec ở kịch bản toàn ảnh nhỏ; kịch bản nhiều video (không có bản chuẩn hóa) thấp hơn. Dự phòng ngân sách 500 GB × 1,3 ≈ 650 GB vẫn nằm trong "chịu gấp 10" của hiến pháp; **hành động**: ghi nhận con số thực ở chỉ số `media_storage_bytes_by_kind` sau 1 tháng chạy.

## Constitution Check

*GATE: đánh giá trước Phase 0, đánh giá lại sau Phase 1 — cả hai lần ĐẠT, không có vi phạm cần biện minh.*

| Nguyên tắc | Đánh giá | Bằng chứng trong thiết kế |
|---|---|---|
| I. Cô lập tenant | ĐẠT | Ba bảng `tenantTable` (RLS `tenant_isolation`, `account_id` NOT NULL, đầu chỉ mục); truy cập qua `tenantTx`; API không nhận mã tài khoản (`z.strictObject`, tài khoản từ phiên); khóa kho dựng từ `currentAccountId()` + kiểm lần hai `tenants/{acc}/`; URL ký sẵn chỉ cho khóa cụ thể; `mediaId`/`uploadId` của tài khoản khác ⇒ 404 không phân biệt; fingerprint phiên gắn (tài khoản, người dùng); hai tài khoản tải cùng nội dung có bản riêng, không tiết lộ nhau (R3); hàm `SECURITY DEFINER` chỉ trả mã tài khoản (R7); ma trận truy cập chéo mở rộng cho 5 thao tác multipart; hỗ trợ/quản trị không có quyền `media.*`. |
| II. Đăng bài tin cậy | Không áp dụng trực tiếp | Cung cấp `issuePublicUrl` với kết quả phân loại (`not_ready`, `deleted`, …) để bước 2 của 013 phân loại lỗi đúng; không ảnh hưởng ràng buộc duy nhất lượt đăng. |
| III. Cổng AI & ngân sách | Không áp dụng | Không gọi AI, không phụ thuộc ngân sách AI; không hiển thị số tiền nào. Gán nhãn (T11) sẽ đi qua Cổng AI. |
| IV. Ranh giới module | ĐẠT | Schema `media` riêng; FK chỉ nội bộ (`upload_sessions → media`) và tới `accounts`; người tải là mã tham chiếu; **không** ghi bảng `account` (bộ đếm nằm ở `media.storage_quotas` — R6, ghi trong bảng "Sửa tài liệu"); không import `content`: đảo phụ thuộc qua `MediaUsageProvider` (R10); không đổi `modules.manifest.json`; sự kiện nền tạo trong cùng giao dịch dữ liệu. |
| V. Việc nền bền vững | ĐẠT | Tệp lớn tải thẳng bằng URL ký sẵn (không qua API); `media.process` tạo trong **cùng giao dịch** với chốt dung lượng; mọi bộ xử lý idempotent (khóa đối tượng cố định, UPDATE có điều kiện theo trạng thái, kiểm `expectIdempotent` + hai Worker); giới hạn đồng thời theo tenant dùng `infra.queue_settings` (1/tenant); tệp trùng không xử lý lại (đường trùng trước khi tốn CPU); Worker tắt có kiểm soát — `ctx.signal` hủy `ffmpeg`/`sharp`, tệp tạm xóa trong `finally`. |
| VI. AI đề xuất, người quyết định | ĐẠT | Quyền kiểm ở API (`@CustomerAccess('media.view' \| 'media.upload' \| 'media.delete')`) — web chỉ ẩn/hiện; thông điệp tiếng Việt kèm hành động; trạng thái chữ + biểu tượng; WCAG AA, vùng chạm ≥ 44 px, từ 360 px; **không chặn khi không cần** (hết gói/đầy 5 GB chỉ chặn tải; xem/xóa/soạn/đăng vẫn dùng). |
| VII. Bí mật & dữ liệu cá nhân | ĐẠT | Kho trong nước (ADR-10), không bên nhận mới ở nước ngoài, không gửi dữ liệu ra ngoài; EXIF/GPS bị loại ở bản chuẩn hóa/thu nhỏ; `uploadId`, URL ký sẵn, tên tệp không vào nhật ký/chỉ số; xóa tài khoản ⇒ FK CASCADE + `deleteAllForCurrentAccount` (kể cả phiên multipart mở); nhật ký không chứa dữ liệu cá nhân. Lưu ý pháp lý bằng sáng chế HEVC/HEIC ghi ở R4 (không thuộc nhóm Q-D3). |
| VIII. Quan sát được | ĐẠT | Nhật ký có cấu trúc gắn `account_id`, `trace_id`; sự kiện `media.upload.started/completed/rejected/cancelled/expired`, `media.process.ready/duplicate/unprocessable`, `media.delete`, `media.cleanup.*`; chỉ số mục "Quan sát" bên dưới; cảnh báo `media` chờ > 10 phút đã có ở kiến trúc §9. |
| IX. Đơn giản, chuẩn mở | ĐẠT | Không thêm máy chủ/cache/broker/dịch vụ; chỉ chuẩn S3 multipart + POST policy; `sharp`/`ffmpeg` cố định phiên bản và bọc sau giao diện nội bộ của module (`internal/`); tiến trình con có `AbortSignal` và thời hạn; giả định chưa chắc (HEIC, multipart ở vStorage, ký `Content-Length`, ffmpeg) có **thử nghiệm với tiêu chí đạt** (quickstart mục 3) và phương án dự phòng. |
| Quy ước dữ liệu | ĐẠT | UUID v7, `timestamptz` UTC, xóa mềm `media.media` 30 ngày rồi xóa hẳn; `version` không cần (không có chỉnh sửa đồng thời cùng một dòng — chuyển trạng thái đều bằng UPDATE có điều kiện); bộ đếm dung lượng cập nhật có điều kiện + CHECK; **không cache** hạn mức; không số thực. |
| Cổng CI | ĐẠT | Truy cập chéo (3 bảng mới + multipart), `db:check` (RLS), ranh giới, typecheck + lint, quét bí mật; thêm kiểm thử đồng thời hạn mức và quét "không URL public trong phản hồi". |

**Ghi nhận cho hiến pháp "mâu thuẫn tài liệu phải được giải quyết" (Governance)**: 7 điểm lệch giữa spec/plan và tài liệu gốc nằm ở bảng bên dưới; không điểm nào chạm nguyên tắc I/II/III hay ràng buộc khách hàng (ADR-04, 05, 07b, 10) ⇒ **SA duyệt, không cần PO**.

## Sửa tài liệu gốc (theo hiến pháp, Governance)

Tài liệu trong `TaiLieuDacTa/` là bản **không theo dõi bằng git** (chép sang worktree): sửa ở **repo chính** (`D:\ToolHangNgay\AppDangNenTang\TaiLieuDacTa\…`). `.specify/memory/architecture.md` có theo dõi — sửa trong nhánh này và tăng phiên bản (v1.6).

| # | Tài liệu | Sửa | Lý do |
|---|---|---|---|
| D1 | Đặc tả yêu cầu — FR-03 | Ảnh ≤ **20 MB** (trước: ≤ 10 MB), hệ thống nén phía máy chủ khi chuẩn hóa; bản chuẩn hóa cạnh dài ≤ 2048 px | Clarifications Q4–Q5 |
| D2 | ADR-07 (7a) | Ghi chú cập nhật 2026-11-16: ảnh ≤ 20 MB; tải **nhiều phần** cho tệp > 8 MiB; dấu tệp tính ở Worker, xác nhận ở API chỉ `stat` + dò nội dung. Không cần ADR mới (đổi tham số, không đổi quyết định kiến trúc) | R1, R3 |
| D3 | Đặc tả yêu cầu — mục 3.1 (phân quyền) + neo `#pq-media-*` | Thêm `media.view`, `media.delete` (cộng tác viên: chỉ tệp mình tải); xóa khỏi "chốt ở WBS 2.6" | Clarifications Q1, R12; kéo theo `packages/shared/src/auth/permissions.ts` |
| D4 | Kiến trúc dữ liệu — D-5, mục 5 (`media.media`, bảng bộ đếm), 8.1 | Bộ đếm dung lượng ở `media.storage_quotas` (không phải `account.chu_ky_su_dung`); thêm `upload_sessions`; `dau_tep` tính ở Worker; "trả lại sau 1 giờ" ⇒ **24 giờ kể từ hoạt động cuối** (phiên tiếp tục được) | R3, R6, FR-009 |
| D5 | Kiến trúc triển khai (`architecture.md`) §4, §6, §7.3, §8, §11 | Bảng module: thêm `upload_sessions`, `storage_quotas`; §6: việc dọn "bản ghi tải lên dở > 1 giờ" ⇒ 24 giờ, thêm `media.cleanup/sweep`; §7.3: hash ở Worker, multipart; §8 dòng "Bộ đếm"; §11 thuật ngữ mới (data-model.md mục 6); v1.6 | R3, R6, R7 |
| D6 | `infra/docs/p6-cau-hoi-nha-cung-cap.md` V5 + manifest triển khai | V5 nêu thêm: `UploadPart` ký sẵn, ghép phần, `AbortIncompleteMultipartUpload`; manifest Worker: `ffmpeg` trong ảnh, `emptyDir` ≥ 2 GiB cho việc `media`, bộ nhớ Worker ≥ 1 GiB | R1, R5 |
| D7 | `specs/014/spec.md` | FR-014 và Assumptions: "≤ 2 việc `media`/tài khoản" ⇒ "theo `infra.queue_settings` (hiện 1)"; SC-003 đo với lô ≤ 10 tệp; Assumptions "thời hạn mặc định 24 giờ" đánh dấu đã đối chiếu | R11 |

D7 đã áp dụng trong lần `/speckit-plan` này (sửa spec); D1–D6 là việc trong `tasks.md` (giai đoạn "Nền").

## Project Structure

### Documentation (this feature)

```text
specs/014-media-library-basic/
├── spec.md
├── plan.md                         # tệp này
├── research.md                     # R1–R15
├── data-model.md                   # 3 bảng, trạng thái, việc nền, hằng số, thuật ngữ
├── quickstart.md                   # nhóm kiểm thử + 14 bước thử tay + 6 thử nghiệm kỹ thuật
├── contracts/
│   ├── media-http-api.md           # 10 điểm cuối, mã lỗi, thông điệp
│   ├── media-public-api.md         # MediaPublicApi, MediaUsageProvider, UploadGate, việc nền
│   ├── storage-multipart.md        # 5 thao tác mới của ObjectStorage + bộ kiểm thử hợp đồng
│   └── media-ui.md                 # tuyến, bố cục, trạng thái, hộp xóa, hàng đợi tải, a11y
├── checklists/requirements.md
└── tasks.md                        # /speckit-tasks (chưa tạo)
```

### Source Code (repository root)

```text
packages/shared/src/
├── auth/permissions.ts                         # + media.view, media.delete (D3)
└── modules/media/
    ├── index.ts                                # lối vào @app/shared/media
    ├── limits.ts                               # MEDIA_LIMITS, MEDIA_ACCEPTED, hằng số dùng chung web + server
    ├── schemas.ts                              # Zod: StartUpload, PartUrls, ListQuery, MediaItem, Quota… (web safeParse phản hồi)
    └── errors.ts                               # mã lỗi + thông điệp tiếng Việt + hành động
packages/shared/test/media-schemas.spec.ts

apps/server/src/
├── core/storage/
│   ├── storage.ts · location.ts                # + 5 thao tác multipart, MultipartIncompleteError, MAX_MULTIPART_BYTES
│   ├── s3/s3-storage.ts                        # cài đặt thật
│   └── memory/memory-storage.ts                # cài đặt giả + simulateBrowserUploadPart
└── modules/media/
    ├── media.module.ts · index.ts · public-api.ts   # MEDIA_PUBLIC_API, registerMediaUsageProvider (không export internal)
    ├── jobs.ts                                 # media.process · media.purge_files · media.cleanup · media.sweep (+ lịch)
    └── internal/
        ├── db/schema.ts                        # media, upload_sessions, storage_quotas
        ├── quota.store.ts                      # reserve/commit/release/refund – UPDATE có điều kiện
        ├── upload.service.ts · upload.controller.ts     # start / part-urls / complete / status / cancel
        ├── library.service.ts · library.controller.ts   # list / get / usages / delete
        ├── sniff.ts                            # dò nội dung thật (thuần, có bảng kiểm thử)
        ├── upload-gate.ts                      # UploadGate mặc định (R12)
        ├── usage-registry.ts                   # MediaUsageProvider (R10)
        ├── public-api.impl.ts                  # describe · assertAttachable · getPreviewUrls · issuePublicUrl
        ├── process.handler.ts                  # media.process (điều phối, chạy lại an toàn)
        ├── image-pipeline.ts · heic.ts         # sharp + bộ giải mã HEIC
        ├── video-pipeline.ts                   # ffprobe/ffmpeg qua child_process, có AbortSignal
        └── cleanup.handler.ts · sweep.ts       # media.cleanup · media.sweep
apps/server/drizzle/migrations/
├── NNNN_media_tables.sql                       # sinh bởi db:generate (soát RLS, FK CASCADE, CHECK, chỉ mục)
└── NNNN_media_functions.sql                    # migration tay: media.list_cleanup_accounts (SECURITY DEFINER + GRANT system)
apps/server/docs/media.md                       # hướng dẫn module (cách đính media, cấp URL công khai, đăng ký nhà cung cấp "bài dùng media")
apps/server/test/
├── unit/media/*.spec.ts                        # sniff, phần/part, tên hiển thị, quyền xóa
├── contracts/storage/multipart.contract.ts     # memory + s3 (MinIO)
├── db/media-isolation.db.spec.ts               # truy cập chéo 3 bảng; bao phủ tự nhận diện
├── db/media-quota-concurrency.db.spec.ts       # ≥ 20 yêu cầu song song, không vượt 5 GB (SC-005), hoàn dung lượng (SC-009)
├── db/media-public-api.contract.db.spec.ts     # MediaPublicApi + nhà cung cấp giả
├── media/*.e2e.spec.ts                         # ma trận quyền, mã lỗi, không URL public
├── queue/media-process.queue.spec.ts           # ảnh/video thật, idempotent, hai Worker, đường trùng, unprocessable
├── queue/media-cleanup.queue.spec.ts
└── fixtures/media/                             # tệp mẫu nhỏ: jpg xoay EXIF, png, webp, heic, webp động, mp4 moov cuối, mov, tệp giả đuôi
Dockerfile                                      # + cài ffmpeg trong tầng chạy; manifest Worker: emptyDir, bộ nhớ (D6)

apps/web/src/
├── app/router.tsx · routes.tsx                 # + /media
├── lib/upload/
│   ├── queue.ts · validate.ts                  # + trạng thái waiting_network/processing/duplicate; + heic/heif
│   └── transports/{post.ts,multipart.ts,types.ts} # POST ký sẵn; bật multipart (MULTIPART_SUPPORTED = true)
└── features/media/
    ├── MediaLibraryPage.tsx · UploadPanel.tsx · QuotaMeter.tsx
    ├── MediaGrid.tsx · MediaCard.tsx · MediaFilters.tsx · MediaDetail.tsx · DeleteMediaDialog.tsx
    ├── media-api.ts                            # gọi API + safeParse (lib/api)
    ├── upload-transport.ts · fingerprint.ts    # nối hàng đợi với API, WebCrypto
    └── labels.ts                               # chữ trạng thái + biểu tượng
apps/web/test/media/*.spec.tsx
e2e/tests/media-upload.e2e.ts                   # Playwright 360 px
```

**Structure Decision**: Giữ khuôn module của 006 (công khai ở gốc, còn lại trong `internal/`), hợp đồng web ↔ API trong `@app/shared/media`, màn hình ở `features/media/`. Mở rộng **lõi** `core/storage` (không phải module) vì multipart là khả năng của hạ tầng kho tệp dùng chung (chỉ `media` dùng).
Không đổi `modules.manifest.json`. Việc nền, xử lý ảnh/video và HEIC nằm hoàn toàn trong `modules/media/internal/` — thư viện bên ngoài (`sharp`, bộ giải mã HEIC, `ffmpeg`) không lộ ra ngoài module (hiến pháp IX).

## Quan sát (hiến pháp VIII, FR-027)

| Loại | Nội dung |
|---|---|
| Nhật ký có cấu trúc (không URL/khóa/tên tệp) | `media.upload.started{mode,kind}`, `…completed`, `…rejected{failureCode}`, `…cancelled`, `…expired`; `media.process.ready{kind,ms}`, `…duplicate`, `…unprocessable{failureCode}`; `media.delete{blocked|ok}`; `media.cleanup.done{expired,purged,orphans,drift}` — mọi dòng gắn `account_id`, `trace_id` (tự có trong giao dịch/việc) |
| Chỉ số (OpenTelemetry) | `media_uploads_total{result}`, `media_process_duration_seconds{kind}` (histogram), `media_process_queue_age_seconds` (đã có chung ở hàng chờ), `media_storage_bytes_by_kind` và `media_quota_drift_total` (do `media.sweep` ghi, hệ thống) |
| Cảnh báo | `media` chờ > 10 phút (kiến trúc §9, đã có); thêm: `media_quota_drift_total` > 0 trong 24 giờ; tỷ lệ `unprocessable` > 5%/giờ (chất lượng bộ xử lý); p95 `media_process_duration_seconds{kind="video"}` > 2 phút |

## Thứ tự thực hiện gợi ý (đầu vào cho /speckit-tasks)

1. **Nền**: quyền `media.view`/`media.delete` + ma trận kiểm thử; hằng số/lược đồ `@app/shared/media`; sửa tài liệu D1–D6; Dockerfile `ffmpeg`.
2. **Thử nghiệm kỹ thuật sớm** (quickstart §3): HEIC, multipart trên MinIO, ffmpeg khung hình — quyết định danh sách định dạng chốt.
3. **Kho tệp**: 5 thao tác multipart + hợp đồng `memory`/`s3` + truy cập chéo.
4. **CSDL**: schema + migration + hàm `SECURITY DEFINER`; `db:check`; truy cập chéo (3 bảng) + đồng thời hạn mức.
5. **Tải lên (API)**: `quota.store`, `sniff`, `UploadGate`, upload service/controller + e2e (US1, US2, US4).
6. **Xử lý (Worker)**: pipeline ảnh/video, `media.process` (đường trùng, `unprocessable`) + kiểm thử hàng chờ (US3, US7).
7. **Thư viện + xóa**: list/get/usages/delete, `MediaUsageProvider`, `media.purge_files`, `media.cleanup/sweep` (US6, FR-022).
8. **Giao diện công khai**: `MediaPublicApi` (`describe`, `assertAttachable`, `getPreviewUrls`, `issuePublicUrl`) + hợp đồng (US5).
9. **Web**: mở rộng `lib/upload`, màn hình `/media`, hộp chi tiết/xóa + kiểm thử + Playwright.
10. **Quan sát + tài liệu**: chỉ số/cảnh báo, `apps/server/docs/media.md`, đo SC-001/003/007/010, rà hiến pháp.

## Rủi ro

| Rủi ro | Giảm thiểu |
|---|---|
| vStorage HCM04 không hỗ trợ đủ multipart/URL phần ký sẵn (V5) | Chế độ `single` luôn dùng được; kiểm trên MinIO trước; không đạt ⇒ video lớn tải lại cả tệp, SC-002 ghi nhận chưa đạt — không chặn các user story khác |
| HEIC không giải mã nổi bằng WASM hoặc chậm/ngốn RAM | Thử nghiệm có tiêu chí (quickstart §3) + 2 phương án dự phòng (dựng libvips có libheif; hoặc bỏ HEIC khỏi danh sách); lưu ý pháp lý HEVC báo chủ dự án |
| Worker hết bộ nhớ khi giải mã ảnh 50 MP / hết đĩa khi tải video 500 MB | `limitInputPixels` 50 triệu + kiểm `metadata()` trước giải mã; `emptyDir` giới hạn + bộ nhớ ≥ 1 GiB trong manifest; 1 việc/tài khoản; xóa tệp tạm trong `finally` |
| Phần tải vượt kích thước khai báo (nhà cung cấp không ký `Content-Length`) | Bác ở `complete` theo `stat`; luật bucket hủy tải dở; dọn 24 giờ; ngân sách kho theo dõi qua `media_storage_bytes_by_kind` |
| Xóa lọt giữa lúc bài vừa đính media (race) | Chấp nhận có chủ đích (R10): không phá bất biến; 013 phân loại lỗi `deleted` ⇒ "chọn media khác" |
| 012/013 chưa có ⇒ nhà cung cấp "bài dùng media" và `UploadGate` thật chưa thể kiểm bằng dữ liệu thật | Hợp đồng kiểm bằng bản giả; tasks ghi việc "nối" kèm điều kiện khi 012 / WBS 2.6 có mặt |
| Băng thông tải lên lãng phí khi tải lại tệp trùng | Chấp nhận (R3); xem lại nếu số liệu cho thấy nhiều tệp trùng |
| Ngân sách kho vượt ước tính 10–20% | Chỉ số `media_storage_bytes_by_kind`; chỉnh `normalizedMaxEdge/quality` qua hằng số (đổi cần phát hành); xem bảng "Ngân sách kho" |

## Complexity Tracking

Không có vi phạm hiến pháp cần biện minh. Hai lựa chọn phức tạp có chủ đích (không phải vi phạm):

| Lựa chọn | Vì sao cần | Phương án đơn giản hơn đã loại |
|---|---|---|
| Hai chế độ tải (`single` + `multipart`) | Giữ POST đã kiểm cho đa số ảnh; chỉ tệp lớn mới cần tiếp tục tải (FR-005) | Chỉ multipart: bỏ phí hợp đồng POST và tốn 3 yêu cầu/ảnh nhỏ |
| Quét hằng giờ + hàm `SECURITY DEFINER` hẹp | `system` phải biết tài khoản nào cần dọn mà không đọc dữ liệu tenant (I); phiên được gia hạn nên việc hẹn cố định không hợp | Việc hẹn theo từng phiên (như Cổng AI): va chạm khóa chống trùng khi gia hạn, không tự chữa nếu việc mất |
