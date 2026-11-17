---

description: "Danh sách việc cho 014 – Thư viện media cơ bản"
---

# Tasks: Thư viện media cơ bản – tải thẳng (nhiều tệp, có tiếp tục), chuẩn hóa JPEG, ảnh thu nhỏ, giới hạn 5 GB, đường dẫn công khai có hạn

**Input**: `specs/014-media-library-basic/` — plan.md, spec.md, research.md (R1–R15), data-model.md, contracts/ (4 tệp), quickstart.md

**Prerequisites**: plan.md, spec.md (đã có). Phụ thuộc đã hoàn thành: 002 (RLS), 003 (pg-boss), 004 (quyền), 005 (kho tệp), 011 (khung web).

**Tests**: **Có** — hiến pháp bắt buộc kiểm thử theo vùng rủi ro (truy cập chéo, việc nền chạy lại hai lần, hợp đồng kho/giao diện công khai, hạn mức đồng thời) và plan.md/quickstart.md liệt kê nhóm kiểm thử cụ thể. Kiểm thử của mỗi câu chuyện viết **trước** và phải thất bại trước khi cài đặt.

**Organization**: gom theo user story (US1…US7 theo spec.md). Thư viện chỉ "Sẵn sàng" end-to-end khi US1 + US3 cùng xong; MVP = bốn câu chuyện P1 (US1–US4) — xem mục Implementation Strategy.

## Format: `- [ ] [ID] [P?] [Story?] Mô tả kèm đường dẫn tệp`

- **[P]**: chạy song song được (khác tệp, không phụ thuộc việc chưa xong)
- **[USn]**: thuộc user story n (chỉ ở phase user story)
- Đường dẫn tính từ gốc worktree `D:\ToolHangNgay\AppDangNenTang\.claude\worktrees\014-media-library-basic`; tài liệu `TaiLieuDacTa/` **không theo dõi bằng git** — sửa ở **repo chính** `D:\ToolHangNgay\AppDangNenTang\TaiLieuDacTa\`.
- Định danh mã nguồn dùng tiếng Anh theo bảng thuật ngữ ở data-model.md mục 6.

## Path Conventions

Web app (monorepo): `apps/server/` (NestJS, module `modules/media/`), `apps/web/` (React + Vite), `packages/shared/` (`@app/shared/media`), `e2e/` (Playwright). Module `media` đã có khung rỗng (`apps/server/src/modules/media/{index.ts,media.module.ts,public-api.ts,internal/}`) và `packages/shared/src/modules/media/index.ts`.

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: phụ thuộc, công cụ xử lý, tệp mẫu và sửa tài liệu gốc (hiến pháp: mâu thuẫn tài liệu phải được giải quyết).

- [X] T001 Thêm `sharp` và một bộ giải mã HEIC WASM (`libheif-js` hoặc `heic-decode`, chọn theo kết quả T029) vào `apps/server/package.json` với **phiên bản chính xác cố định** (không dùng `^`/`~` — hiến pháp IX), cập nhật `pnpm-lock.yaml`; không thêm thư viện nào vào `apps/web`
- [X] T002 Cài gói `ffmpeg` (kèm `ffprobe`) vào tầng chạy của `apps/server/Dockerfile`; thêm vào manifest triển khai Worker (tìm tệp manifest trong `infra/`) `emptyDir` ≥ 2 GiB cho việc `media` và bộ nhớ Worker ≥ 1 GiB (D6, R1, R5)
- [X] T003 [P] Tạo tệp mẫu nhỏ trong `apps/server/test/fixtures/media/`: jpg xoay bằng EXIF (có GPS), jpg thường, png, webp, heic, webp động, gif, mp4 có `moov` ở cuối, mov, mp4 xoay 90°, tệp `.jpg` giả chứa HTML, tệp `.jpg` giả chứa EXE, SVG có script, ảnh 0 byte, ảnh hỏng cắt dở; kèm `README.md` ghi nguồn/giấy phép từng tệp (tệp tự tạo, không dùng ảnh có bản quyền)
- [X] T004 [P] D1–D3: sửa ở repo chính `TaiLieuDacTa/` — Đặc tả yêu cầu FR-03 (ảnh ≤ **20 MB**, nén phía máy chủ, bản chuẩn hóa cạnh dài ≤ 2048 px); ADR-07 mục 7a (ghi chú 2026-11-16: tải nhiều phần cho tệp > 8 MiB, dấu tệp tính ở Worker, xác nhận ở API chỉ `stat` + dò nội dung); mục 3.1 phân quyền thêm `media.view`, `media.delete` (cộng tác viên: chỉ tệp mình tải) và neo `#pq-media-*`, bỏ ghi chú "chốt ở WBS 2.6"
- [X] T005 [P] D4: sửa ở repo chính `TaiLieuDacTa/` — Kiến trúc dữ liệu D-5, mục 5 (`media.media`, bảng bộ đếm → `media.storage_quotas`, thêm `upload_sessions`, `dau_tep` tính ở Worker), mục 8.1 ("trả lại sau 1 giờ" → **24 giờ kể từ hoạt động cuối**, phiên tiếp tục được)
- [X] T006 D5: sửa `.specify/memory/architecture.md` (có theo dõi git): §4 bảng module thêm `upload_sessions`, `storage_quotas`; §6 việc dọn "bản ghi tải lên dở > 1 giờ" → 24 giờ và thêm `media.cleanup`/`media.sweep`; §7.3 hash ở Worker + multipart; §8 dòng "Bộ đếm"; §11 thêm thuật ngữ từ data-model.md mục 6; tăng phiên bản lên v1.6
- [X] T007 [P] D6: sửa `infra/docs/p6-cau-hoi-nha-cung-cap.md` mục V5 — nêu thêm `UploadPart` ký sẵn, ghép phần (`CompleteMultipartUpload`), `AbortIncompleteMultipartUpload` (luật vòng đời bucket hủy tải dở)

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: quyền, hợp đồng dùng chung, mở rộng kho tệp, CSDL, các khối dùng chung và ba thử nghiệm kỹ thuật. **Không user story nào bắt đầu trước khi xong phase này.**

**⚠️ CRITICAL**: T008–T031 phải xong trước Phase 3.

### Quyền và hợp đồng dùng chung (`@app/shared/media`)

- [X] T008 Thêm `media.view` (owner: true, collaborator: true, support: false, admin: false) và `media.delete` (owner: true, collaborator: true — điều kiện "chỉ tệp mình tải" kiểm ở dịch vụ, support: false, admin: false) vào `packages/shared/src/auth/permissions.ts` (đã có `media.upload`); cập nhật bộ kiểm thử ma trận quyền hiện có (`packages/shared/test/auth.spec.ts`, `apps/server/test/auth/access-declarations.spec.ts`, `apps/server/test/auth/access-matrix.e2e.spec.ts`) cho hai quyền mới
- [X] T009 [P] Tạo `packages/shared/src/modules/media/limits.ts`: `MEDIA_LIMITS` đúng data-model.md mục 5 (`imageMaxBytes` 20×1024², `videoMaxBytes` 500×1024², `imageMaxPixels` 50.000.000, `singleUploadMaxBytes` 8×1024², `partSizeBytes` 8×1024², `sessionTtlSec` 86.400, `parallelUploads` 3, `normalizedMaxEdge` 2048, `thumbMaxEdge` 480, `normalizedQuality` 82, `thumbQuality` 75, `nearFullPercent` 80), `MEDIA_ACCEPTED` (JPEG, PNG, WebP, HEIC/HEIF; MP4, MOV — HEIC chốt theo T029), `AllowedContentType`, `MEDIA_QUOTA_BYTES_DEFAULT` = 5 × 1024³; không số thực cho dung lượng
- [X] T010 [P] Tạo `packages/shared/src/modules/media/errors.ts`: mã lỗi `MEDIA_TYPE_UNSUPPORTED`, `MEDIA_TOO_LARGE`, `MEDIA_QUOTA_EXCEEDED`, `MEDIA_PLAN_EXPIRED`, `UPLOAD_INCOMPLETE`, `UPLOAD_REJECTED` (+ `failureCode ∈ size_mismatch | type_mismatch | type_unsupported | animated`), `MEDIA_IN_USE`, `MEDIA_USED_CONFIRM_REQUIRED`, `MEDIA_DELETE_NOT_OWNER`, `STORAGE_UNAVAILABLE` cùng thông điệp tiếng Việt và hành động khắc phục đúng chữ trong `contracts/media-http-api.md` (mỗi thông báo có ≥ 1 hành động — hiến pháp VI); bảng `failure_code` → `{ title, action }` cho `unprocessable` (`corrupt | unsupported | too_many_pixels | animated | no_video_stream | storage_mismatch`)
- [X] T011 Tạo `packages/shared/src/modules/media/schemas.ts` (Zod 4, `z.strictObject`): `StartUploadBody` (`fileName` 1..255, `sizeBytes` int > 0, `contentType: AllowedContentType`, `fingerprint` `/^[0-9a-f]{64}$/`), `PartUrlsBody` (`partNumbers` 1–20 phần, 1..partCount), `ListQuery` (`kind?`, `from?`, `to?`, `q?` ≤ 100, `cursor?`, `limit` 1..60 mặc định 40), `MediaItem`, `Quota` (`percent = floor((used + reserved)/limit × 100)`; `near_full` ≥ 80%; `full` khi used+reserved ≥ limit), `UploadState`, `MediaUsage`, các phản hồi của 10 điểm cuối theo `contracts/media-http-api.md`; không trường nhận mã tài khoản (depends on T009, T010)
- [X] T012 Cập nhật `packages/shared/src/modules/media/index.ts` xuất `limits`, `errors`, `schemas`; kiểm tra `packages/shared/package.json` có lối vào `@app/shared/media` (thêm `exports` nếu thiếu); chạy `pnpm build:shared` (depends on T011)
- [X] T013 [P] Viết `packages/shared/test/media-schemas.spec.ts`: từ chối trường lạ, `fingerprint` sai định dạng, `partNumbers` ngoài 1–20, `percent`/`state` của `Quota` ở các ngưỡng 79/80/99/100%, hằng số khớp data-model.md mục 5

### Mở rộng kho tệp `core/storage` (5 thao tác multipart)

- [X] T014 Mở rộng `apps/server/src/core/storage/storage.ts` và `index.ts` đúng `contracts/storage-multipart.md` §1: kiểu `MultipartHandle`, `PartInfo`, 5 thao tác `createMultipart/presignPart/listParts/completeMultipart/abortMultipart`, `MultipartIncompleteError` (`code = 'MULTIPART_INCOMPLETE'`, không chứa khóa/uploadId), `MAX_MULTIPART_BYTES = 5 * 1024 ** 3`; quy tắc §2: chỉ `media_original` được mở phiên (`job_tmp`/loại khác ⇒ `InvalidRequestError`), `partNumber` ∈ [1, 10.000], `partSizeBytes` ≥ 5 MiB (trừ khi một phần), `ttlSec` > 900 ⇒ `InvalidRequestError`
- [X] T015 [P] Cài đặt giả `apps/server/src/core/storage/memory/memory-storage.ts`: Map `uploadId → { loc, parts }`, URL `memory://…` có chữ ký HMAC + hạn, `simulateBrowserUploadPart(url, bytes)` kiểm hạn/`contentLength`/số phần, `completeMultipart` ghép theo thứ tự phần và kiểm "mọi phần 1..N có mặt, mọi phần trừ phần cuối đúng `partSizeBytes`, tổng đúng `expect.bytes`" (sai ⇒ `MultipartIncompleteError`, không ghép; gọi lại khi đã ghép ⇒ trả `{bytes}` đúng) (depends on T014)
- [X] T016 [P] Cài đặt thật `apps/server/src/core/storage/s3/s3-storage.ts` bằng `CreateMultipartUploadCommand`/`UploadPartCommand` + `getSignedUrl` (ký `content-length` khi nhà cung cấp cho phép, R1)/`ListPartsCommand` (phân trang `PartNumberMarker`, trả đủ)/`CompleteMultipartUploadCommand`/`AbortMultipartUploadCommand`; không thêm phụ thuộc mới; kiểu SDK AWS không lộ ra giao diện (depends on T014)
- [X] T017 Viết bộ kiểm thử hợp đồng `apps/server/test/contracts/storage/multipart.contract.ts` đủ 9 mục của `contracts/storage-multipart.md` §4 (đủ phần ⇒ `stat` đúng + SHA-256; thiếu phần ⇒ `MultipartIncompleteError` rồi bù phần ghép được; ghi đè phần; URL hết hạn/`ttlSec` > 900; phần sai `contentLength`; `abortMultipart` gọi lặp không lỗi; **truy cập chéo A↔B cho cả 5 thao tác**; `deleteAllForCurrentAccount` hủy phiên multipart đang mở; mục 9 chỉ chạy ở `infra`: 25 MiB/4 phần ngắt giữa chừng trên MinIO) và hai tệp chạy: `apps/server/test/contracts/storage/multipart.memory.contract.spec.ts` (`pnpm test`) + `multipart.infra.contract.spec.ts` (`pnpm test:infra`, MinIO); cập nhật `deleteAllForCurrentAccount` ở cả hai bản để hủy phiên multipart mở (depends on T015, T016)

### CSDL schema `media` (RLS)

- [X] T018 [P] Tạo `apps/server/src/modules/media/internal/db/schema.ts` bằng `tenantTable` (tự có `id` UUID v7, `account_id NOT NULL` FK → `account.accounts` CASCADE, `created_at`, `updated_at`, chỉ mục đầu `account_id`, RLS `tenant_isolation`) cho ba bảng đúng data-model.md mục 1: `media.media` (`softDelete: true`; `kind` CHECK `'image' | 'video'`; `status` CHECK `'uploading' | 'processing' | 'ready' | 'unprocessable'`; `display_name` 1–255 ký tự; `original_bytes bigint > 0`; `file_hash char(64)` NULL tới khi Worker tính, CHECK `~ '^[0-9a-f]{64}$'`; `duration_ms` CHECK `kind = 'video' OR duration_ms IS NULL`; `uploaded_by_user_id uuid` **không FK**; `failure_code` NULL trừ khi `unprocessable`; `processed_at`, `files_purged_at`; các CHECK `status <> 'ready' OR (file_hash IS NOT NULL AND width IS NOT NULL AND height IS NOT NULL AND processed_at IS NOT NULL)`, `status <> 'ready' OR kind <> 'image' OR normalized_bytes IS NOT NULL`, `status <> 'ready' OR thumb_bytes IS NOT NULL`, `status <> 'unprocessable' OR failure_code IS NOT NULL`; chỉ mục `UNIQUE (account_id, file_hash) WHERE file_hash IS NOT NULL AND deleted_at IS NULL AND status IN ('processing','ready')`, `(account_id, created_at DESC, id) WHERE deleted_at IS NULL AND status <> 'uploading'`, `(account_id, kind, created_at DESC) WHERE …`, `(account_id, uploaded_by_user_id)`), `media.upload_sessions` (`media_id` FK nội bộ → `media.media` ON DELETE CASCADE; `created_by_user_id` không FK; `fingerprint char(64)`; `mode` `'single' | 'multipart'`; `declared_bytes bigint > 0`; `declared_content_type`; `multipart_upload_id` chỉ khi multipart; `part_size_bytes`, `part_count`; `state` CHECK `open | completing | completed | cancelled | expired | failed | duplicate`; `failure_code` ∈ `size_mismatch | type_mismatch | type_unsupported | animated | missing_object | plan_expired`; `duplicate_of_media_id` không FK; `last_activity_at`, `expires_at`, `completed_at`; chỉ mục `UNIQUE (account_id, created_by_user_id, fingerprint) WHERE state IN ('open','completing')`, `(account_id, expires_at) WHERE state = 'open'`, `(account_id, media_id)`), `media.storage_quotas` (`used_bytes`, `reserved_bytes`, `limit_bytes` bigint; `UNIQUE (account_id)`; `CHECK (used_bytes >= 0 AND reserved_bytes >= 0 AND used_bytes + reserved_bytes <= limit_bytes)`); đăng ký schema `media` vào cấu hình Drizzle/`db:check` nếu cần
- [X] T019 Sinh migration `apps/server/drizzle/migrations/NNNN_media_tables.sql` bằng `pnpm db:generate`; soát tay RLS đủ 3 bảng, FK CASCADE, CHECK, chỉ mục từng phần; migration **chỉ thêm** (tương thích ngược — hiến pháp); chạy `pnpm db:setup`, `pnpm db:check`, `pnpm db:lint-migrations` (depends on T018)
- [X] T020 Viết migration tay `apps/server/drizzle/migrations/NNNN_media_functions.sql`: `media.list_cleanup_accounts(kind text, cutoff timestamptz, lim int) RETURNS SETOF uuid` — `SECURITY DEFINER`, `SET search_path = media, pg_temp`, `REVOKE ALL … FROM PUBLIC`, `GRANT EXECUTE … TO system`; chỉ chọn `DISTINCT account_id` (không cột nghiệp vụ); `kind ∈ ('stale_sessions','pending_purge','full')`; vượt thứ tự migration phải qua `migration-order.db.spec.ts` (depends on T019)
- [X] T021 [P] Viết `apps/server/test/db/media-isolation.db.spec.ts`: với mỗi bảng trong 3 bảng, tài khoản A đọc/sửa/xóa dòng của B ⇒ thất bại; thiếu biến phiên ⇒ không thấy dòng; thử vi phạm từng CHECK/chỉ mục duy nhất ở trên; hàm `list_cleanup_accounts` chỉ trả mã tài khoản và vai trò khác `system` bị từ chối; đảm bảo bảng mới được `cross-tenant-coverage.db.spec.ts` và `access-path-inventory.db.spec.ts` tự nhận diện (depends on T019, T020)

### Khối dùng chung của module (internal)

- [X] T022 [P] Tạo `apps/server/src/modules/media/internal/sniff.ts`: hàm thuần `sniffMedia(head: Uint8Array, declared)` dò nội dung thật (magic bytes): JPEG, PNG, WebP (phân biệt tĩnh/động), HEIC/HEIF (`ftyp` heic/heif/mif1), MP4/MOV (`ftyp`/`moov`); từ chối GIF, WebP động, SVG, HTML, EXE; trả `{ kind, contentType } | { rejected: 'type_unsupported' | 'animated' }`; so với `declared_content_type` (R8)
- [X] T023 [P] Viết `apps/server/test/unit/media/sniff.spec.ts` (bảng tệp giả bằng fixture T003: `.jpg` chứa HTML/EXE/SVG/GIF/WebP động ⇒ bị loại; tệp thật ⇒ đúng loại; 0 byte ⇒ bị loại)
- [X] T024 [P] Tạo `apps/server/src/modules/media/internal/upload-gate.ts`: interface `UploadGate { canUpload(): Promise<{allowed:true}|{allowed:false;reason:'plan_expired'|'account_suspended'}> }`, token DI, bản mặc định luôn `allowed: true` (R12; WBS 2.6 sẽ thay); chỉ áp cho bắt đầu tải
- [X] T025 [P] Tạo `apps/server/src/modules/media/internal/usage-registry.ts`: `MediaUsageProvider.findUsages(mediaIds ≤ 100)`, `registerMediaUsageProvider` (gọi lần hai ⇒ ném), mặc định trả `[]`, hàm nội bộ `findUsagesOrEmpty`; quy tắc `approved`/`scheduled` ⇒ chặn, `draft`/`pending_review`/`published`/`failed`/`cancelled` ⇒ xóa được sau `confirm=true` đặt ở `media`, không ở nhà cung cấp (R10, `contracts/media-public-api.md` §2)
- [X] T026 Tạo `apps/server/src/modules/media/internal/quota.store.ts` — mọi thao tác là **một câu UPDATE có điều kiện** trong `tenantTx` của chính giao dịch gọi (không giao dịch riêng), đúng bảng data-model.md 1.3: `reserve(n)` (`SET reserved_bytes = reserved_bytes + :n WHERE used_bytes + reserved_bytes + :n <= limit_bytes`; 0 dòng ⇒ `MEDIA_QUOTA_EXCEEDED`; tạo dòng `storage_quotas` với `limit_bytes = MEDIA_QUOTA_BYTES` nếu chưa có — cấu hình `MEDIA_QUOTA_BYTES`), `commit(declared, real)` (`WHERE reserved_bytes >= :d`), `releaseReservation(d)` (`WHERE reserved_bytes >= :d`; phiên đã đóng ⇒ bỏ qua), `refundUsed(b)` (`WHERE used_bytes >= :b`, chỉ gọi khi dòng `media` vừa chuyển trạng thái nhờ `UPDATE … WHERE status IN (…) RETURNING`); `read()` đọc thẳng DB, **không cache** (FR-028); thêm cấu hình `MEDIA_QUOTA_BYTES`, `MEDIA_PUBLIC_URL_TTL_SEC` (86.400, trần 86.400), `MEDIA_PREVIEW_URL_TTL_SEC` (3.600, trần 3.600) vào `apps/server/src/core/config` kèm kiểm thử cấu hình (`apps/server/test/config.spec.ts`)
- [X] T027 Tạo `apps/server/src/modules/media/jobs.ts` bằng `defineJobType` (payload `z.strictObject`, chỉ mã tham chiếu, không `accountId`, không tên tệp): `media.process` (`{ mediaId }`, hàng chờ `media`, scope tenant, dedupe `media_process:{mediaId}`), `media.purge_files` (`{ mediaId }`, dedupe `media_purge:{mediaId}`), `media.cleanup` (`{ scope: 'stale' | 'full' }`, dedupe `media_cleanup:{accountId}:{scope}`), `media.sweep` (hàng chờ `scheduled`, scope system, `defineSchedule` cron `7 * * * *` UTC hằng giờ + `full` mỗi Chủ nhật); xác nhận `infra.queue_settings` cho hàng chờ `media`: 1 việc/tenant, thử lại 3 lần (60 → 300 → 900 giây), nếu thiếu thì thêm bằng migration chỉ-thêm; không xuất qua `index.ts`
- [X] T028 Cập nhật `apps/server/src/modules/media/media.module.ts` theo khuôn `context.module.ts` (`MediaModule.forUnit('api' | 'worker')`: provider `MEDIA_PUBLIC_API`, `UploadGate` mặc định, controllers ở API, bộ xử lý việc đăng ký ở Worker bằng `registerJobHandler` một lần), `public-api.ts` (kiểu `MediaPublicApi` + token `MEDIA_PUBLIC_API`), `index.ts` (xuất `MEDIA_PUBLIC_API`, `MediaPublicApi`, `registerMediaUsageProvider`, `MediaUsageProvider`, **không** xuất `internal/`); đăng ký module ở API và Worker; chạy `pnpm check:boundaries` (không đổi `modules.manifest.json`; `allowedDeps` hiện có `account`, `ai_gateway`, `queue`) (depends on T024, T025, T027)

### Thử nghiệm kỹ thuật sớm (quickstart §3 — quyết định danh sách định dạng chốt)

- [X] T029 Thử nghiệm **HEIC**: ảnh iPhone 12 MP qua bộ giải mã WASM + `sharp` trong Worker — tiêu chí ≤ 5 giây, đúng chiều, RSS đỉnh ≤ 500 MB, màu sRGB; ghi kết quả vào mục "Kết quả thử nghiệm" của `specs/014-media-library-basic/research.md` R4; không đạt ⇒ thử dựng libvips có libheif, vẫn không đạt ⇒ bỏ HEIC khỏi `MEDIA_ACCEPTED` (T009) và sửa spec Assumptions (depends on T001, T003)
- [X] T030 [P] Thử nghiệm **ffmpeg lấy khung hình**: MP4 có `moov` ở cuối, MOV, video xoay 90° — tiêu chí thumbnail đúng chiều và ≤ 2 phút/video 500 MB; ghi kết quả vào research.md R5, chỉnh vị trí lấy khung/`-ss` nếu cần (depends on T002, T003)
- [X] T031 [P] Thử nghiệm **multipart + `Content-Length` ký trong URL phần** trên MinIO (và vStorage nếu có thông tin tại V5): 25 MiB/4 phần ngắt giữa chừng, phần quá cỡ bị kho từ chối hay chỉ bị bác ở `complete`; ghi kết quả vào research.md R1 và rủi ro SC-002 nếu vStorage không đạt (depends on T016, T017)

**Checkpoint**: nền sẵn sàng — các câu chuyện P1 bắt đầu được.

---

## Phase 3: User Story 1 - Tải nhiều ảnh/video lên thư viện (Priority: P1) 🎯 MVP

**Goal**: người dùng kéo thả/chọn nhiều tệp, mỗi tệp có tiến độ riêng, tải thẳng lên kho (chế độ `single` ≤ 8 MiB), lỗi một tệp không chặn tệp khác, tệp hợp lệ vào thư viện.

**Independent Test**: đăng nhập, chọn cùng lúc 5 ảnh hợp lệ + 1 tệp sai loại + 1 ảnh > 20 MB → 5 ảnh lên "Đang xử lý", hai tệp lỗi bị từ chối trước khi tải kèm cách khắc phục; dung lượng đã dùng tăng đúng tổng kích thước; vai trò hỗ trợ gọi `POST /media/uploads` ⇒ 403. (Chuyển "Sẵn sàng" + ảnh thu nhỏ cần US3.)

### Tests for User Story 1 (viết trước, phải thất bại)

- [X] T032 [P] [US1] Viết `apps/server/test/media/upload-single.e2e.spec.ts` (supertest): `POST /media/uploads` mode `single` trả `post.url/fields`; loại không nhận ⇒ 400 `MEDIA_TYPE_UNSUPPORTED`; ảnh > 20 MiB / video > 500 MiB ⇒ 400 `MEDIA_TOO_LARGE`; tệp rỗng ⇒ 400; `complete` đạt ⇒ 202 `state: 'completed'`, media `processing`, đúng **một** việc `media.process`; `complete` gọi lặp hai lần ⇒ cùng kết quả, một `media`, một việc; kho chưa có tệp ⇒ 409 `UPLOAD_INCOMPLETE`; lệch dung lượng/loại thật không khớp/ảnh động ⇒ 422 `UPLOAD_REJECTED` + giữ chỗ **đã trả** + tệp dở đã xóa; `DELETE /media/uploads/:id` ⇒ 204 và trả giữ chỗ, gọi lặp ⇒ 204
- [X] T033 [P] [US1] Viết `apps/server/test/media/media-access.e2e.spec.ts`: ma trận quyền mỗi điểm cuối × `owner`/`collaborator`/`support`/`admin` (hỗ trợ/quản trị ⇒ 403 `FORBIDDEN` ở mọi điểm cuối), `uploadId`/`mediaId` của tài khoản khác ⇒ 404 `NOT_FOUND` không phân biệt, thân có `accountId` ⇒ 400 (`z.strictObject`); tệp được **mở rộng** ở T052, T067, T080–T081 khi thêm điểm cuối
- [X] T034 [P] [US1] Viết `apps/server/test/unit/media/media-keys.spec.ts` và tạo `apps/server/src/modules/media/internal/media-keys.ts`: dựng khóa kho **chỉ** từ `currentAccountId()` + `mediaId` (`tenants/{acc}/media/{mediaId}/original`, `…/normalized/jpeg`, `…/thumb`) và `normalizeDisplayName` (bỏ ký tự điều khiển, `/`, `\`, cắt còn 1–255 ký tự, giữ tiếng Việt có dấu; tên rỗng sau chuẩn hóa ⇒ lỗi); tên tệp **không bao giờ** vào khóa (test: `../`, tên rất dài, ký tự đặc biệt)

### Implementation for User Story 1 — API

- [X] T035 [US1] Cài `apps/server/src/modules/media/internal/upload.service.ts` — `start` (chế độ `single`): trong **một** `tenantTx` kiểm `UploadGate` (`plan_expired` ⇒ 403 `MEDIA_PLAN_EXPIRED`), kiểm loại/cỡ lần hai, tạo `media` (`uploading`) + `upload_sessions` (`open`, `expires_at = last_activity_at + 24 giờ`) và `quota.store.reserve`; nhận lại phiên đang mở của cùng người + `fingerprint` (200, `resumed: true`); phiên cũ hết hạn ⇒ tạo phiên mới + `previousExpired: true`; sinh `presignUpload` (POST ký sẵn ≤ 15 phút, khóa `…/original`); URL ký sẵn/`fields` **không** vào nhật ký/chỉ số (FR-023); nhật ký `media.upload.started{mode,kind}` (depends on T026, T034)
- [X] T036 [US1] Mở rộng `upload.service.ts` — `complete`, `status`, `cancel`: `complete` đặt `completing` bằng UPDATE có điều kiện, `stat` kho, so với `declared_bytes`, đọc đầu tệp qua kho và `sniffMedia` khớp `declared_content_type`, rồi **trong một giao dịch**: chốt dung lượng (`commit`), `media → processing`, phiên `completed`, tạo việc `media.process` (dedupe `media_process:{mediaId}`); đường bác ⇒ phiên `failed` + `releaseReservation` + xóa tệp dở + xóa dòng `uploading`; gọi lặp an toàn (`completed` ⇒ kết quả cũ; `completing` do yêu cầu khác ⇒ chờ ngắn rồi trả trạng thái hiện tại; lỗi tạm ⇒ `completing → open`); `status` trả `{ uploadId, state, mediaId, mediaStatus, duplicateOf, failureCode, completedParts?, expiresAt }` (phiên người khác ⇒ 404); `cancel` trả giữ chỗ, xóa dòng `uploading`, hủy multipart nếu có (depends on T035)
- [X] T037 [US1] Tạo `apps/server/src/modules/media/internal/upload.controller.ts`: `POST /media/uploads`, `POST /media/uploads/:uploadId/complete`, `GET /media/uploads/:uploadId`, `DELETE /media/uploads/:uploadId` với `@CustomerAccess('media.upload')`, `@ValidBody/@ValidParam` dùng lược đồ T011, ánh xạ lỗi theo `contracts/media-http-api.md` §11; kho tệp tạm lỗi ⇒ 503 `STORAGE_UNAVAILABLE` hành động `retry` (depends on T036)
- [X] T038 [US1] Tạo `apps/server/src/modules/media/internal/library.service.ts` + `library.controller.ts`: `GET /media` (`media.view`) trả `{ items, nextCursor, quota }` phân trang theo con trỏ `(created_at, id)`, mới nhất trước, **không** hiện `uploading` và dòng xóa mềm, `thumbUrl` bằng `signedUrl(…, 'preview')` hạn `MEDIA_PREVIEW_URL_TTL_SEC` (null khi chưa `ready`), `uploadedBy.displayName` null ⇒ "Thành viên đã rời", `canDelete` theo vai trò + người tải (bộ lọc ở T076); đăng ký controller ở API trong `media.module.ts` (depends on T011, T026)

### Implementation for User Story 1 — Web

- [X] T039 [P] [US1] Tạo `apps/web/src/features/media/media-api.ts` (gọi API qua `lib/api` + `safeParse` bằng lược đồ `@app/shared/media`: `startUpload`, `completeUpload`, `getUploadStatus`, `cancelUpload`, `listMedia`) và `apps/web/src/features/media/labels.ts` (chữ + biểu tượng từng trạng thái theo bảng `contracts/media-ui.md` §3; không chỉ màu)
- [X] T040 [P] [US1] Tạo `apps/web/src/features/media/fingerprint.ts`: SHA-256 hex của `tên|dung lượng|lastModified` bằng WebCrypto (không thêm thư viện), kèm kiểm thử đơn vị
- [X] T041 [US1] Mở rộng `apps/web/src/lib/upload/queue.ts` và `validate.ts`: thêm trạng thái `waiting_network`, `processing`, `duplicate`, trường `mediaId?`/`duplicateOf?`; `validateFile` thêm `heic/heif` và ảnh ≤ 20 MB/video ≤ 500 MB lấy từ `MEDIA_LIMITS`; giữ `MAX_CONCURRENT_UPLOADS = 3`, hủy từng tệp (gọi `DELETE …/uploads/:id`), thử lại tệp lỗi không phải chọn lại; không lưu tên tệp/`post.fields`/URL/`uploadId` vào `localStorage`/`sessionStorage`; cập nhật `apps/web/src/lib/upload/queue.spec.ts`
- [X] T042 [US1] Cập nhật `apps/web/src/lib/upload/transports/types.ts` (`UploadSession` thêm `mode`, `fields?`; vẫn không lưu URL) và `transports/single.ts`: `POST multipart/form-data` tới `post.url` kèm `post.fields`; tạo `apps/web/src/features/media/upload-transport.ts` nối hàng đợi với `media-api.ts` (kiểm cục bộ → `fingerprint` → `startUpload` → tải thẳng → `completeUpload` → hỏi `getUploadStatus` mỗi 2 giây giãn dần tới 10 giây cho tới `mediaStatus ∈ {ready, unprocessable}` hoặc `duplicate`) (depends on T039, T040, T041)
- [X] T043 [P] [US1] Tạo `apps/web/src/features/media/MediaGrid.tsx` và `MediaCard.tsx`: danh sách có `aria-label` = tên + loại + trạng thái, ảnh thu nhỏ `loading="lazy"` kích thước ô cố định, biểu tượng video + thời lượng, trạng thái chữ + biểu tượng, "Đang xử lý" chưa chọn được, "Không xử lý được" + cách khắc phục + nút Xóa (nút xóa nối ở T086), trạng thái trống "Tải ảnh/video đầu tiên" kèm giới hạn
- [X] T044 [US1] Tạo `apps/web/src/features/media/UploadPanel.tsx` (nút **Chọn tệp** + **Chụp ảnh** `capture`, vùng kéo thả luôn có nút thay thế bàn phím, hàng tiến độ từng tệp, vùng chạm ≥ 44 × 44 px, `aria-live="polite"` khi đổi trạng thái, lý do + cách khắc phục theo từng tệp bị từ chối) và `MediaLibraryPage.tsx` (khung bố cục `contracts/media-ui.md` §2; vô hiệu hóa truy vấn danh sách khi một tệp xong, không tải lại trang) (depends on T042, T043)
- [X] T045 [US1] Thêm tuyến `/media` vào `apps/web/src/app/routes.tsx` (nạp lười `features/media/MediaLibraryPage`, quyền `media.view` chỉ ẩn/hiện) và mục "Thư viện" trong thanh điều hướng 011; hỗ trợ/quản trị không thấy mục này
- [X] T046 [P] [US1] Viết kiểm thử web `apps/web/test/media/upload-panel.spec.tsx`, `media-grid.spec.tsx`, `upload-queue.spec.tsx` (Testing Library + `vitest-axe`): 6 tệp → tối đa 3 tải song song, từng tệp lỗi bị từ chối trước khi tải với lý do + cách khắc phục mà tệp khác vẫn chạy, thử lại/hủy, trạng thái trống, axe không vi phạm (depends on T044)

**Checkpoint**: US1 chạy độc lập tới "Đang xử lý"; kết hợp US3 sẽ ra "Sẵn sàng".

---

## Phase 4: User Story 2 - Tải lên bị gián đoạn vẫn tiếp tục được (Priority: P1)

**Goal**: tệp > 8 MiB tải bằng S3 multipart; mất mạng tự tạm dừng/tiếp tục; đóng tab rồi chọn lại đúng tệp thì chỉ tải phần thiếu; quyền hết hạn tự cấp lại.

**Independent Test**: tải video 300 MB, ngắt mạng ở ~50%, bật lại ⇒ tiếp tục từ ~50% (Network chỉ có các phần còn thiếu); đóng tab, mở lại, chọn lại ⇒ tiến độ bắt đầu từ phần đã có; sau 24 giờ ⇒ "Lần tải trước đã hết hạn, đang tải lại từ đầu".

### Tests for User Story 2

- [ ] T047 [P] [US2] Viết `apps/server/test/media/upload-multipart.e2e.spec.ts` (kho `memory`): tệp > 8 MiB ⇒ `mode: 'multipart'` với `partSizeBytes`/`partCount = ceil(declared_bytes / part_size_bytes)`; ≤ 8 MiB ⇒ `single`; tải 3/5 phần ⇒ mở lại cùng `fingerprint` ⇒ 200 `resumed: true` + `completedParts` đúng (lấy từ `listParts`); `part-urls` 1–20 phần, URL ≤ 15 phút, phần đã lên vẫn cấp URL mới; `uploadId` người khác/phiên không `open` ⇒ 404; sau `expires_at` ⇒ 201 `previousExpired: true` + phiên cũ dọn; `complete` thiếu phần ⇒ 409 `UPLOAD_INCOMPLETE` và phiên vẫn `open`; hai `complete` liên tiếp ⇒ một `media`, một việc
- [ ] T048 [P] [US2] Viết `apps/web/test/media/multipart-transport.spec.tsx` (đồng hồ/`fetch` giả): bỏ qua phần có trong `completedParts`, URL hết hạn/HTTP 403 ⇒ xin lại không hiện lỗi, thử lại phần 1/3/10 giây, mất mạng ⇒ `waiting_network` rồi tự tiếp tục khi có sự kiện `online`, tiến độ bắt đầu từ phần đã có

### Implementation for User Story 2

- [ ] T049 [US2] Mở rộng `upload.service.ts` (`start`): tệp > `singleUploadMaxBytes` ⇒ `storage.createMultipart` (`part_size_bytes` = 8 MiB), lưu `multipart_upload_id` (**không** vào nhật ký/chỉ số/phản hồi ngoài `part-urls`), `part_count`; nhận lại phiên multipart ⇒ `listParts` trả `completedParts`; `last_activity_at`/`expires_at` gia hạn mỗi lần bắt đầu/lấy URL phần/xác nhận; `complete` gọi `completeMultipart(expect: { bytes: declared_bytes })` (máy chủ tự lấy ETag; `MultipartIncompleteError` ⇒ 409 `UPLOAD_INCOMPLETE`, phiên vẫn `open`); `cancel` gọi `abortMultipart` (depends on T036)
- [ ] T050 [US2] Thêm `POST /media/uploads/:uploadId/part-urls` vào `upload.controller.ts` + `upload.service.ts` (`media.upload`, chỉ phiên `multipart` đang `open` của cùng người; 1–20 phần; trả `{ parts: { partNumber, url, contentLength, expiresAt }[] }`); mở rộng `media-access.e2e.spec.ts` (T033) cho điểm cuối này (depends on T049)
- [ ] T051 [US2] Cài `apps/web/src/lib/upload/transports/multipart.ts`: đặt `MULTIPART_SUPPORTED = true`; cắt phần 8 MiB, xin lô ≤ 20 URL, bỏ qua phần trong `completedParts`, `PUT` từng phần, URL hết hạn/403 ⇒ xin lại, thử lại 1/3/10 giây, báo tiến độ theo byte cộng dồn; chọn transport theo `mode` trả về từ API trong `upload-transport.ts` (depends on T042, T050)
- [ ] T052 [US2] Mở rộng `apps/web/src/lib/upload/queue.ts`: nghe `online`/`offline` + lỗi mạng liên tiếp ⇒ `waiting_network` ("Tạm dừng – đang chờ mạng", tự tiếp tục không cần bấm), nhận lại phiên khi chọn lại cùng tệp, thông báo "Lần tải trước đã hết hạn, đang tải lại từ đầu" khi `previousExpired`; cập nhật `labels.ts` (depends on T051)

**Checkpoint**: US1 + US2 chạy; tệp lớn tiếp tục được (nếu T031 cho thấy kho thật hỗ trợ, nếu không ghi rủi ro SC-002).

---

## Phase 5: User Story 3 - Ảnh được chuẩn hóa và có ảnh thu nhỏ (Priority: P1)

**Goal**: mỗi ảnh có bản JPEG chuẩn (cạnh dài ≤ 2048 px, đúng chiều, không GPS/EXIF) + ảnh thu nhỏ ≤ 480 px; video có ảnh thu nhỏ + thời lượng và giữ nguyên; xử lý chạy lại an toàn; lỗi hết lần thử ⇒ "Không xử lý được" + trả dung lượng.

**Independent Test**: tải PNG, HEIC, JPEG xoay EXIF, một MP4 ⇒ mỗi ảnh có `normalized/jpeg` và `thumb` đúng chiều, gốc còn nguyên, không có GPS trong bản chuẩn; video có `thumb` + `duration_ms`; chạy lại việc cho cùng kết quả.

### Tests for User Story 3

- [ ] T053 [P] [US3] Viết `apps/server/test/queue/media-process.queue.spec.ts` (PostgreSQL + MinIO/`memory`, tệp T003): ảnh png/webp/jpg/heic ⇒ `ready` với `normalized_bytes`, `thumb_bytes`, `width`, `height` (đúng chiều theo EXIF), cạnh dài ≤ 2048, ảnh nhỏ hơn không phóng to, không còn GPS/EXIF ở bản chuẩn & thumb, gốc nguyên vẹn; video mp4/mov (cả `moov` cuối, xoay 90°) ⇒ `ready` với `thumb` + `duration_ms` và video **không** chuyển mã; ảnh động/hỏng/vượt 50 triệu điểm ảnh/không có luồng hình ⇒ `unprocessable` + `failure_code` đúng + `used_bytes` đã trả + `noRetry` (không vào `dead_jobs`); lỗi tạm của kho ⇒ ném lỗi để hàng chờ thử lại, hết lần ⇒ `onFinalFailure` chuyển `unprocessable`; **`expectIdempotent` chạy hai lần cho cùng kết quả**; hai Worker cùng lấy một việc ⇒ một kết quả, không tệp trùng; Worker bị hủy giữa chừng (`ctx.signal`) ⇒ tiến trình con dừng, tệp tạm bị xóa
- [ ] T054 [P] [US3] Viết `apps/server/test/unit/media/image-pipeline.spec.ts`: bảng ảnh xoay 1–8 theo EXIF ⇒ đúng chiều (SC-004: 0 ảnh sai chiều), kích thước đầu ra, chất lượng JPEG 82/75, `limitInputPixels` 50 triệu + kiểm `metadata()` trước giải mã

### Implementation for User Story 3

- [ ] T055 [P] [US3] Tạo `apps/server/src/modules/media/internal/image-pipeline.ts` (bọc `sharp`, thư viện **không lộ ra ngoài** `internal/`): `metadata()` kiểm điểm ảnh trước khi giải mã, `rotate()` theo EXIF, resize `fit: 'inside'` + `withoutEnlargement` tới `normalizedMaxEdge` 2048 và `thumbMaxEdge` 480, JPEG chất lượng 82/75 cố định, loại metadata (GPS/EXIF) ở cả hai bản, chuyển sRGB; đầu vào/ra là luồng/buffer, nhận `AbortSignal`
- [ ] T056 [P] [US3] Tạo `apps/server/src/modules/media/internal/heic.ts`: bộ giải mã HEIC WASM (theo kết quả T029) trả buffer cho `image-pipeline`; lỗi bộ giải mã ⇒ `failure_code = 'unsupported'`/`'corrupt'`; nếu T029 quyết định bỏ HEIC thì tệp này chỉ trả `unsupported` và `MEDIA_ACCEPTED` đã bỏ HEIC
- [ ] T057 [P] [US3] Tạo `apps/server/src/modules/media/internal/video-pipeline.ts`: `ffprobe` đọc thời lượng/kích thước/xoay (không có luồng hình ⇒ `no_video_stream`) và `ffmpeg` lấy một khung hình đại diện ⇒ `thumb` JPEG ≤ 480 px đúng chiều, qua `child_process` có `AbortSignal` + thời hạn, ghi tệp tạm dưới `emptyDir` ≤ 500 MB và xóa trong `finally`; **không** chuyển mã video
- [ ] T058 [US3] Tạo `apps/server/src/modules/media/internal/process.handler.ts` (bộ xử lý `media.process`, điều phối, chạy lại an toàn): đọc `media` bằng `tenantTx`; `status <> 'processing'` ⇒ bỏ qua; tải gốc về tệp tạm theo luồng; tính **SHA-256 ở Worker** (không ở API — R3) trong lúc đọc; xử lý ảnh/video; ghi `normalized/jpeg` và `thumb` theo **khóa cố định theo `mediaId`** (ghi đè được); rồi một `UPDATE … WHERE status = 'processing' RETURNING` đặt `ready` kèm `file_hash`, `width`, `height`, `duration_ms`, `normalized_bytes`, `thumb_bytes`, `processed_at`; lỗi **vĩnh viễn** ⇒ `UPDATE … SET status='unprocessable'` + `failure_code` + `quota.refundUsed(original_bytes)` rồi `noRetry(code)`; lỗi **tạm** ⇒ ném để hàng chờ thử lại; xóa tệp tạm trong `finally`; nhật ký `media.process.ready{kind,ms}`/`…unprocessable{failureCode}` không chứa tên tệp/URL (depends on T055, T056, T057, T026)
- [ ] T059 [US3] Đăng ký bộ xử lý `media.process` ở nhánh `worker` của `media.module.ts` và `onFinalFailure` (hết lần thử ⇒ `unprocessable` với `storage_mismatch` hoặc mã thực, trả `used_bytes`); xác nhận Worker tắt có kiểm soát (ngừng lấy việc mới, chờ ≤ 30 giây, `ctx.signal` hủy `sharp`/`ffmpeg`) (depends on T058)
- [ ] T060 [US3] Cập nhật web: `MediaCard.tsx`/`labels.ts` hiển thị đúng `processing` → `ready`/`unprocessable` (thông điệp `failure.title/action` từ `errors.ts`), `UploadPanel` coi `mediaStatus ∈ {ready, unprocessable}` là kết thúc hàng; kiểm thử `apps/web/test/media/process-states.spec.tsx` (chữ + biểu tượng, nút Xóa cho `unprocessable`, axe)

**Checkpoint**: US1 + US2 + US3 ⇒ tải → "Sẵn sàng" end-to-end.

---

## Phase 6: User Story 4 - Giới hạn 5 GB mỗi tài khoản và biết mình đã dùng bao nhiêu (Priority: P1)

**Goal**: "Đã dùng x / 5 GB" luôn hiển thị; tệp làm vượt trần bị từ chối **trước khi tải byte nào**; không bao giờ vượt 5 GB dù tải đồng thời; mọi giữ chỗ được trả lại khi hủy/lỗi/quá hạn.

**Independent Test**: tài khoản 4,9 GB tải video 300 MB ⇒ bị từ chối ngay kèm nút "Xem danh sách để xóa"; 2 người tải đồng thời 400 MB khi còn 500 MB ⇒ đúng một tệp được nhận; sau 24 giờ + một chu kỳ dọn, chênh lệch bộ đếm = 0.

### Tests for User Story 4

- [ ] T061 [P] [US4] Viết `apps/server/test/db/media-quota-concurrency.db.spec.ts`: ≥ 20 yêu cầu `reserve` song song vượt chỗ trống ⇒ tổng `used + reserved` **không bao giờ > limit** và đúng số yêu cầu vừa đủ thành công (SC-005); `commit`/`release`/`refund` chạy hai lần không âm; CHECK chặn cuối khi cố tình cập nhật sai; kiểm hoàn dung lượng sau hủy/lỗi/hết hạn/`unprocessable`/xóa (SC-009)
- [ ] T062 [P] [US4] Viết `apps/server/test/media/quota-gate.e2e.spec.ts`: `GET /media/quota` đúng `used/reserved/limit/percent/state` (chưa có dòng ⇒ 0/0/5×1024³); `POST /media/uploads` khi hết chỗ ⇒ 409 `MEDIA_QUOTA_EXCEEDED` + `{ quota }` và **không** tạo `media`/phiên/URL; `UploadGate` giả `plan_expired` ⇒ 403 `MEDIA_PLAN_EXPIRED` nhưng `GET /media` và xóa vẫn dùng được (FR-018); ở 80% ⇒ `near_full`; 100% ⇒ `full`
- [ ] T063 [P] [US4] Viết `apps/server/test/queue/media-cleanup.queue.spec.ts`: phiên `open` quá `expires_at` ⇒ `expired` + `abortMultipart` + trả giữ chỗ + xóa dòng `uploading`; chạy lại hai lần cho cùng kết quả (`expectIdempotent`); `media.sweep` chỉ tạo việc theo tài khoản (dedupe), dùng `list_cleanup_accounts`

### Implementation for User Story 4

- [ ] T064 [US4] Thêm `GET /media/quota` (`media.view`) vào `library.controller.ts`/`library.service.ts`: đọc thẳng từ `media.storage_quotas` (không cache), `Quota` theo T011; `GET /media` đã kèm `quota` (T038) (depends on T038)
- [ ] T065 [US4] Tạo `apps/server/src/modules/media/internal/cleanup.handler.ts` (bộ xử lý `media.cleanup`, `scope: 'stale'`): mỗi bước đọc trạng thái rồi mới làm (chạy lại an toàn) — phiên `open` quá hạn ⇒ UPDATE có điều kiện sang `expired`, `abortMultipart`, xóa tệp dở, `releaseReservation`, xóa dòng `uploading`; nhật ký `media.upload.expired`, `media.cleanup.done{expired,…}` (depends on T026)
- [ ] T066 [US4] Tạo `apps/server/src/modules/media/internal/sweep.ts` + đăng ký lịch `media.sweep` ở Worker: gọi `media.list_cleanup_accounts('stale_sessions' | 'pending_purge' | 'full', cutoff, lim)` ở vai trò `system` rồi tạo `media.cleanup` theo từng tài khoản (dedupe `media_cleanup:{accountId}:{scope}`) (depends on T020, T065)
- [ ] T067 [P] [US4] Tạo `apps/web/src/features/media/QuotaMeter.tsx` ("Đã dùng 1,2 / 5 GB", thanh tiến độ có nhãn truy cập, "Sắp đầy" kèm biểu tượng ở ≥ 80%, "Đầy" ở 100%; định dạng MB/GB cơ số 1024 qua `lib/format`; không hiển thị số tiền nào) và kiểm thử `apps/web/test/media/quota-meter.spec.tsx` (ok/near_full/full chữ + biểu tượng, axe)
- [ ] T068 [US4] Cập nhật `UploadPanel.tsx` + `MediaLibraryPage.tsx`: lỗi `MEDIA_QUOTA_EXCEEDED` ⇒ "Thư viện đã đầy (4,9/5 GB). Hãy xóa bớt ảnh/video cũ rồi tải lại" + nút "Xem danh sách để xóa"; `MEDIA_PLAN_EXPIRED` ⇒ nút "Gia hạn gói"; khi `full` khu tải lên bị chặn kèm giải thích nhưng xem/xóa/soạn/duyệt/đăng vẫn dùng; kiểm thử `apps/web/test/media/upload-blocked.spec.tsx` (depends on T067)

**Checkpoint**: bốn câu chuyện P1 xong — **MVP có thể phát hành**.

---

## Phase 7: User Story 5 - Nền tảng tải media qua đường dẫn công khai có hạn (Priority: P2)

**Goal**: module Đăng bài (013) xin được đường dẫn công khai **có hạn, đúng một tệp** (ảnh ⇒ bản JPEG chuẩn; video ⇒ bản gốc); giao diện chỉ dùng đường dẫn xem trước ≤ 1 giờ; không điểm cuối HTTP nào trả đường dẫn công khai.

**Independent Test**: gọi `issuePublicUrl` ⇒ mở trong cửa sổ ẩn danh thấy đúng tệp; sau khi hết hạn (đồng hồ giả lập) ⇒ bị từ chối; sửa khóa sang tệp khác/tài khoản khác ⇒ không tải được.

### Tests for User Story 5

- [ ] T069 [P] [US5] Viết `apps/server/test/db/media-public-api.contract.db.spec.ts` (PostgreSQL + kho `memory`, nhà cung cấp "bài dùng media" giả): `describe` giữ thứ tự đầu vào (≤ 100 mã; `ok`/`deleted`/`not_found` — `deleted` cho cả xóa mềm lẫn đã xóa hẳn); `assertAttachable` chỉ `ok` khi `ready` (`processing` ⇒ `not_ready`, `unprocessable`, `deleted`, `not_found`); `getPreviewUrls` hạn ≤ 3600 s, chỉ media của tài khoản trong ngữ cảnh; `issuePublicUrl`: ảnh ⇒ `normalized/jpeg`, video ⇒ gốc, hạn mặc định 86.400 s, `ttlSec` > 86.400 ⇒ `InvalidRequestError`, `not_ready`/`unprocessable`/`deleted`/`not_found` đúng; gọi ngoài ngữ cảnh ⇒ `TenantContextError`; A không lấy được URL của media B; sau yêu cầu xóa tài khoản không cấp thêm URL; hết hạn bằng đồng hồ giả ⇒ URL bị kho từ chối (SC-006)
- [ ] T070 [P] [US5] Viết `apps/server/test/media/no-public-url.e2e.spec.ts`: quét mọi phản hồi của 10 điểm cuối — không URL nào là loại `public` (kiểm `SignedUrl.purpose` và hạn ≤ 3600 giây từ tham số URL ký sẵn), mọi URL chỉ cho media của tài khoản trong phiên (FR-017)

### Implementation for User Story 5

- [ ] T071 [US5] Tạo `apps/server/src/modules/media/internal/public-api.impl.ts` cài `MediaPublicApi` đúng `contracts/media-public-api.md` §1: `describe`, `assertAttachable`, `getPreviewUrls`, `issuePublicUrl` (đọc qua `tenantTx`, không nhận mã tài khoản, không nhận `ttlSec` > trần), `signedUrl(…, 'public' | 'preview')` từ khóa dựng bằng `media-keys.ts`; mỗi thao tác ghi một dòng nhật ký `media.<op>` + span OpenTelemetry **không** URL/tên tệp; hoạt động ở cả API lẫn Worker (depends on T034, T026)
- [ ] T072 [US5] Nối `MEDIA_PUBLIC_API` ở `media.module.ts`/`public-api.ts`/`index.ts` (kiểu `MediaSummary`, `DescribeResult`, `PublicUrlResult`, `MediaPublicApi`, `registerMediaUsageProvider` được xuất; `allowedDeps` của `content` và `publishing` thêm `media` ở `modules.manifest.json` **chỉ khi** 012/013 thật sự nhập — nếu chưa thì giữ nguyên và ghi vào T091); chạy `pnpm check:boundaries` (depends on T071)
- [ ] T073 [P] [US5] Tạo `apps/server/docs/media.md`: cách đính media (`assertAttachable`/`describe`/`getPreviewUrls`), cấp đường dẫn công khai (`issuePublicUrl` chỉ cho `publishing`), đăng ký nhà cung cấp "bài đang dùng media" (`registerMediaUsageProvider`), ánh xạ lỗi cho 013 (`not_ready` ⇒ chưa sẵn sàng, `deleted`/`unprocessable`/`not_found` ⇒ "chọn media khác"), cấu hình `MEDIA_*`

**Checkpoint**: giao diện công khai sẵn sàng cho 012/013.

---

## Phase 8: User Story 6 - Xem, tìm, xóa media (Priority: P2)

**Goal**: lọc theo loại/ngày/tên; xem chi tiết; xóa có cảnh báo liệt kê từng bài đang dùng; bài đã duyệt/lên lịch chặn xóa; xóa mềm trả dung lượng ngay, tệp thật xóa nền; cộng tác viên chỉ xóa tệp mình tải.

**Independent Test**: tải 3 tệp ⇒ lọc "Video" chỉ còn video, tìm theo tên đúng; xóa 1 ảnh chưa dùng ⇒ biến mất khỏi lưới và dung lượng giảm; xóa ảnh đang dùng trong bài "Đã lên lịch" ⇒ bị chặn kèm danh sách bài; cộng tác viên xóa tệp của chủ ⇒ `MEDIA_DELETE_NOT_OWNER`.

### Tests for User Story 6

- [ ] T074 [P] [US6] Viết `apps/server/test/media/library-delete.e2e.spec.ts`: lọc `kind`/`from`/`to`/`q` (không phân biệt hoa/thường, chỉ media của tài khoản), phân trang con trỏ; `GET /media/:id` (ảnh ⇒ `previewUrl` bản chuẩn hóa, video ⇒ gốc, ≤ 1 giờ; không có/đã xóa mềm/tài khoản khác ⇒ 404 "Tệp này không còn trong thư viện."); `GET /media/:id/usages` (`blocking` khi có bài `approved`/`scheduled`); `DELETE /media/:id`: không bài ⇒ 204 + dung lượng giảm đúng + tạo `media.purge_files`; bài `approved`/`scheduled` ⇒ 409 `MEDIA_IN_USE` + `{ usages }` và **không** có trạng thái xóa dở; chỉ bài nháp/chờ duyệt/đã đăng, chưa `confirm` ⇒ 409 `MEDIA_USED_CONFIRM_REQUIRED`; `confirm=true` ⇒ 204; cộng tác viên xóa tệp người khác ⇒ 403 `MEDIA_DELETE_NOT_OWNER`, chủ xóa mọi tệp; `uploading` ⇒ 404; lần xóa thứ hai ⇒ 404; `unprocessable` ⇒ 204 không trả `used_bytes` lần nữa; hai người cùng xóa một tệp ⇒ nhất quán, bộ đếm không âm
- [ ] T075 [P] [US6] Viết `apps/server/test/queue/media-purge.queue.spec.ts`: `media.purge_files` xóa `original`, `normalized/jpeg`, `thumb`, đặt `files_purged_at`, chạy lại hai lần không lỗi (xóa đối tượng không có ⇒ không lỗi); `media.cleanup` `full`: xóa hẳn dòng xóa mềm > 30 ngày, phát hiện tệp mồ côi trong kho (không có bản ghi) và bản ghi mất tệp, đối soát `storage_quotas` với tổng `original_bytes` thực (ghi `media_quota_drift_total`, sửa lệch) — idempotent, `expectIdempotent`

### Implementation for User Story 6

- [ ] T076 [US6] Mở rộng `library.service.ts` + `library.controller.ts`: bộ lọc `kind`, `from`, `to`, `q` (`lower(display_name) LIKE '%q%'` trong phạm vi `account_id`, không extension trigram), `GET /media/:mediaId` (chi tiết + `previewUrl`, `mimeType`), `GET /media/:mediaId/usages` (qua `MediaUsageProvider`, `blocking` theo quy tắc T025, chỉ bài của tài khoản); mở rộng `media-access.e2e.spec.ts` (T033) (depends on T038, T025)
- [ ] T077 [US6] Thêm `DELETE /media/:mediaId?confirm=` (`media.delete`): trong **một** `tenantTx` kiểm quyền (chủ: mọi tệp; cộng tác viên: `uploaded_by_user_id` = người gọi ⇒ nếu không ⇒ 403 `MEDIA_DELETE_NOT_OWNER`), tra `findUsages` **lại lúc xóa** (không tin `GET …/usages`), chặn theo quy tắc `MEDIA_IN_USE`/`MEDIA_USED_CONFIRM_REQUIRED`, `UPDATE … SET deleted_at WHERE deleted_at IS NULL AND status IN (…) RETURNING`, `quota.refundUsed` chỉ khi dòng vừa chuyển từ `processing`/`ready`, tạo `media.purge_files` (dedupe `media_purge:{mediaId}`); nhật ký `media.delete{blocked|ok}` (depends on T076)
- [ ] T078 [US6] Tạo `apps/server/src/modules/media/internal/purge.handler.ts` (bộ xử lý `media.purge_files`) và mở rộng `cleanup.handler.ts` cho `scope: 'full'`: xóa hẳn dòng xóa mềm > 30 ngày, quét tệp mồ côi và bản ghi mất tệp (bản ghi mất tệp ⇒ hiện lỗi cho người dùng + cách khắc phục là tải lại, không ô trống), đối soát bộ đếm; đăng ký ở Worker (depends on T065, T077)
- [ ] T079 [P] [US6] Tạo `apps/web/src/features/media/MediaFilters.tsx` (loại, khoảng ngày tải — web đổi sang UTC+7, ô tìm tên; trạng thái bộ lọc nằm trên URL bằng `lib/url-state`: `?kind=&from=&to=&q=`; vùng chạm ≥ 44 px) và nối vào `MediaLibraryPage.tsx`
- [ ] T080 [P] [US6] Tạo `apps/web/src/features/media/MediaDetail.tsx` (hộp phủ mở bằng `/media?item=<mediaId>`; ảnh dùng bản chuẩn hóa, video `<video controls preload="metadata">`; tên, kích thước byte, kích thước điểm ảnh, thời lượng, ngày tải UTC+7, người tải; đường dẫn xem trước hết hạn ⇒ tự gọi lại `GET /media/:id` không hiện lỗi; bàn phím/Esc đóng)
- [ ] T081 [US6] Tạo `apps/web/src/features/media/DeleteMediaDialog.tsx` đúng `contracts/media-ui.md` §4: gọi `GET …/usages`; `blocking = true` ⇒ chỉ thông báo "Ảnh đang dùng trong 2 bài đã lên lịch" + liệt kê từng bài (tiêu đề + trạng thái + liên kết `/posts/:postId`) + hướng dẫn "Mở bài để đổi media rồi quay lại xóa", **không** có nút Xóa; chỉ bài nháp/chờ duyệt/đã đăng ⇒ liệt kê từng bài + hậu quả + hai nút "Xóa"/"Giữ lại" rồi `DELETE …?confirm=true`; không bài ⇒ "Xóa ảnh này? Dung lượng sẽ được trả lại ngay."; nút Xóa chỉ hiện khi `canDelete`; nối vào `MediaCard.tsx`/`MediaDetail.tsx` (depends on T043, T080)
- [ ] T082 [P] [US6] Viết kiểm thử web `apps/web/test/media/filters-detail-delete.spec.tsx`: lọc/tìm cập nhật URL, chuyển bộ lọc, hộp xóa `blocking` không có nút xóa, liệt kê từng bài, cộng tác viên không thấy nút xóa trên tệp của chủ, trạng thái trống/lỗi, axe (depends on T079–T081)

**Checkpoint**: thư viện đầy đủ xem/tìm/xóa; US4 không còn ngõ cụt.

---

## Phase 9: User Story 7 - Tệp trùng nội dung không tốn chỗ và không xử lý lại (Priority: P3)

**Goal**: tải lại đúng nội dung (kể cả đổi tên) trong cùng tài khoản ⇒ không tạo bản thứ hai, không tính thêm dung lượng, không xử lý lại, báo "đã có" kèm liên kết; tài khoản khác tải cùng nội dung có bản riêng, không bị tiết lộ.

**Independent Test**: tải ảnh, tải lại đã đổi tên ⇒ thư viện vẫn một ô, dung lượng không đổi, thông báo "Tệp này đã có trong thư viện" dẫn tới ô hiện có; tài khoản B tải đúng ảnh ⇒ có bản riêng; hai thiết bị cùng tải gần đồng thời ⇒ một media.

### Tests for User Story 7

- [ ] T083 [P] [US7] Viết `apps/server/test/queue/media-duplicate.queue.spec.ts`: tệp trùng trong cùng tài khoản (đổi tên) ⇒ dòng mới bị xóa + tệp dở xóa + `refundUsed` + phiên `completed → duplicate` với `duplicate_of_media_id`, tên hiển thị của tệp có sẵn giữ nguyên, **không** chạy xử lý ảnh/video (kiểm không gọi `sharp`/`ffmpeg`); hai `complete` đồng thời của hai thiết bị ⇒ vi phạm chỉ mục duy nhất được bắt và xử lý như trùng ⇒ còn đúng một media, dung lượng tính một lần; tệp đã xóa rồi tải lại ⇒ xem như tệp mới; tài khoản B tải cùng nội dung ⇒ bản riêng đầy đủ, `GET /media/uploads/:id` của B không chứa dấu hiệu tệp từng có ở A; chạy lại việc hai lần cho cùng kết quả

### Implementation for User Story 7

- [ ] T084 [US7] Mở rộng `process.handler.ts`: ngay sau khi tính `file_hash` (trước mọi xử lý tốn CPU) đặt `file_hash` bằng UPDATE có điều kiện; bắt vi phạm `UNIQUE (account_id, file_hash)` (hoặc tìm thấy media `processing`/`ready` chưa xóa cùng hash) ⇒ trong một giao dịch: phiên `completed → duplicate` + `duplicate_of_media_id`, `quota.refundUsed(original_bytes)`, xóa dòng `media` mới, tạo việc xóa tệp dở `media.purge_files`-tương đương cho khóa `original` của dòng mới (không đụng tệp của media đã có); nhật ký `media.process.duplicate`; `GET /media/uploads/:id` trả `duplicateOf: { mediaId, displayName }` (đã có hình dạng ở T036) (depends on T058)
- [ ] T085 [US7] Cập nhật web: `upload-transport.ts`/`queue.ts` nhận `duplicate` ⇒ trạng thái "Tệp này đã có trong thư viện" + liên kết "Xem tệp đã có" (mở `/media?item=<duplicateOf.mediaId>`) + nút Đóng, **không** có lựa chọn giữ thêm bản; kiểm thử `apps/web/test/media/duplicate.spec.tsx` (axe, chữ + biểu tượng) (depends on T042, T084)

**Checkpoint**: cả bảy câu chuyện hoạt động độc lập.

---

## Phase 10: Polish & Cross-Cutting Concerns

**Purpose**: quan sát, an toàn dữ liệu, kiểm thử trình duyệt, đo hiệu năng, rà hiến pháp.

- [ ] T086 Hoàn thiện quan sát (hiến pháp VIII, plan.md mục "Quan sát"): nhật ký có cấu trúc `media.upload.started/completed/rejected{failureCode}/cancelled/expired`, `media.process.ready/duplicate/unprocessable`, `media.delete`, `media.cleanup.done{expired,purged,orphans,drift}` — mọi dòng gắn `account_id`, `trace_id`, **không** URL/khóa/`uploadId`/tên tệp; chỉ số OpenTelemetry `media_uploads_total{result}`, `media_process_duration_seconds{kind}` (histogram), `media_storage_bytes_by_kind`, `media_quota_drift_total` (do `media.sweep` ghi, hệ thống); thêm cảnh báo `media_quota_drift_total` > 0 trong 24 giờ, tỷ lệ `unprocessable` > 5%/giờ, p95 `media_process_duration_seconds{kind="video"}` > 2 phút vào cấu hình cảnh báo Prometheus/Grafana hiện có (tìm trong `infra/`); cảnh báo `media` chờ > 10 phút đã có ở kiến trúc §9
- [ ] T087 [P] Viết `apps/server/test/media/secrets-in-logs.e2e.spec.ts`: chạy một luồng tải đủ (single + multipart + lỗi) với bộ ghi nhật ký giả ⇒ không dòng nhật ký/chỉ số/thông điệp lỗi nào chứa URL ký sẵn, `post.fields`, `multipart_upload_id`, `uploadId` hay tên tệp (FR-023); chạy quét bí mật ở CI trên mã mới
- [ ] T088 [P] Mở rộng `apps/server/test/db/account-deletion.db.spec.ts` (FR-022): xóa tài khoản ⇒ FK CASCADE xóa 3 bảng, `deleteAllForCurrentAccount` xóa mọi tệp dưới `tenants/{acc}/` (gốc, chuẩn hóa, thu nhỏ, tạm) và hủy phiên multipart đang mở, sau đó `issuePublicUrl`/`getPreviewUrls` không cấp thêm URL
- [ ] T089 [P] Viết Playwright `e2e/tests/media-upload.e2e.ts` ở viewport 360 px: tải 3 ảnh ⇒ thấy "Sẵn sàng" trong lưới; chọn lại video đang dở ⇒ tiếp tục từ phần đã có; hết chỗ ⇒ thấy "Thư viện đã đầy" + nút xóa; chạy bằng `pnpm test:web-e2e`
- [ ] T090 Đo và ghi nhận kết quả vào `specs/014-media-library-basic/research.md` (mục "Kết quả đo"): SC-001 (10 ảnh ≤ 5 MB trên 4G ≤ 2 phút), SC-002 (≤ 5% tải lại khi ngắt), SC-003 (95% ảnh lô ≤ 10 ≤ 30 giây; video ≤ 2 phút), SC-007 (lưới 200 tệp ≤ 3 giây trên 4G, chuyển bộ lọc ≤ 1 giây), SC-010 (100 ảnh liên tiếp không làm `publish` của tài khoản khác trễ > 5 phút; nếu không đạt chỉnh `max_per_tenant` ở `infra.queue_settings`, R11); đối chiếu ngân sách kho thực với bảng "Ngân sách kho" của plan.md
- [ ] T091 Nối với 012/013 **nếu đã có trên `dev` tại thời điểm làm** (nếu chưa: ghi vào mục "Điểm cần xem lại" của tasks.md này và để nguyên): thay media giả lập (005) bằng `MEDIA_PUBLIC_API` ở 012 (đính media, hiển thị, `registerMediaUsageProvider`) và ở 013 bước 2 (`issuePublicUrl`), thêm `media` vào `allowedDeps` của `content`/`publishing` trong `apps/server/src/modules/modules.manifest.json`; chạy lại bộ kiểm thử hợp đồng trên cả bản thật và bản giả của 005
- [ ] T092 Chạy `/constitution-review` trên toàn bộ thay đổi đối chiếu chín nguyên tắc (nhất là I tenant, II không trùng — `issuePublicUrl` phân loại lỗi, III không áp dụng, IV ranh giới module, V idempotent/tải thẳng); cập nhật bảng "Kiểm tra hiến pháp" ở plan.md nếu có lệch
- [ ] T093 Chạy toàn bộ `quickstart.md`: mục 1 (các nhóm kiểm thử tự động), mục 2 (14 bước thử tay), mục 3 (6 thử nghiệm kỹ thuật, đánh dấu T029–T031 và T090 đã ghi kết quả); sau đó `pnpm check:boundaries && pnpm db:check && pnpm db:lint-migrations && pnpm typecheck && pnpm lint` và `pnpm verify` phải xanh; không đưa số tiền AI ra màn hình nào (feature này không gọi AI)
- [ ] T094 [P] Cập nhật `docs/wiki` theo quy trình ở `AGENTS.md` **chỉ khi** người dùng yêu cầu (hook `after_implement` → `/speckit-wiki-ingest 014` sẽ làm sau khi merge); chạy `pnpm wiki:check` nếu có đổi

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: không phụ thuộc — bắt đầu ngay; T004–T007 (tài liệu) độc lập với mã.
- **Foundational (Phase 2)**: sau Setup (T029 cần T001/T003; T030 cần T002/T003) — **chặn mọi user story**.
- **US1 (Phase 3)**: sau Phase 2. Tự đủ tới trạng thái "Đang xử lý".
- **US2 (Phase 4)**: sau US1 (mở rộng `upload.service`, `upload.controller`, hàng đợi web) và T031.
- **US3 (Phase 5)**: sau Phase 2 (chỉ cần T026, T034 + việc `media.process` đã được tạo ở T036 để kiểm end-to-end); có thể làm **song song với US1/US2** vì làm trên tệp khác (`process.handler.ts`, `*-pipeline.ts`).
- **US4 (Phase 6)**: sau US1 (`upload.service`, `library.controller`); T061/T063/T065 có thể bắt đầu ngay sau Phase 2.
- **US5 (Phase 7)**: sau Phase 2 + T034; độc lập với US1–US4 về mã (nhưng kiểm đầy đủ cần media `ready` của US3).
- **US6 (Phase 8)**: sau US1 (`library.service`) và US4 (`cleanup.handler`).
- **US7 (Phase 9)**: sau US3 (mở rộng `process.handler.ts`).
- **Polish (Phase 10)**: sau các câu chuyện cần phát hành.

### User Story Dependencies

- US1, US3, US5: không phụ thuộc story khác (chỉ Phase 2).
- US2: mở rộng US1. US4: dùng bộ đếm (T026) + endpoint của US1. US6: dùng danh sách của US1 + dọn dẹp của US4. US7: mở rộng US3.

### Within Each User Story

- Kiểm thử viết trước và phải thất bại → mô hình/khối dùng chung → dịch vụ → điểm cuối → web → kiểm thử web.
- Cùng một tệp ⇒ **không** `[P]`: `upload.service.ts` (T035 → T036 → T049), `upload.controller.ts` (T037 → T050), `library.service.ts`/`library.controller.ts` (T038 → T064 → T076 → T077), `process.handler.ts` (T058 → T084), `cleanup.handler.ts` (T065 → T078), `queue.ts` (T041 → T052), `media-access.e2e.spec.ts` (T033 → T050 → T076).

### Parallel Opportunities

- Setup: T003, T004, T005, T007 song song.
- Foundational: T009 ∥ T010; T015 ∥ T016; T018 song song với nhóm kho tệp (T014–T017); T022, T023, T024, T025 song song; T030 ∥ T031.
- US3 làm song song với US1/US2 (người khác nhau): T055 ∥ T056 ∥ T057.
- Web của US1 (T039, T040, T043) ∥ nhau; US6 web (T079, T080) ∥ nhau.
- Kiểm thử của các câu chuyện khác nhau (T047, T053, T061, T069, T074, T083) chạy song song.

---

## Parallel Example: User Story 1

```bash
# Viết kiểm thử US1 cùng lúc (khác tệp):
Task: "T032 upload-single.e2e.spec.ts trong apps/server/test/media/"
Task: "T033 media-access.e2e.spec.ts trong apps/server/test/media/"
Task: "T034 media-keys.spec.ts + media-keys.ts trong apps/server/..."

# Web US1 song song:
Task: "T039 media-api.ts + labels.ts trong apps/web/src/features/media/"
Task: "T040 fingerprint.ts trong apps/web/src/features/media/"
Task: "T043 MediaGrid.tsx + MediaCard.tsx trong apps/web/src/features/media/"
```

## Parallel Example: Foundational (kho tệp + CSDL)

```bash
Task: "T015 memory-storage.ts (multipart giả)"
Task: "T016 s3-storage.ts (multipart thật)"
Task: "T018 schema.ts của schema media"
Task: "T022 sniff.ts + T023 sniff.spec.ts"
```

---

## Implementation Strategy

### MVP First (US1 → US4)

1. Phase 1 (Setup) + Phase 2 (Foundational) — chốt kết quả T029–T031 trước khi coi định dạng/chế độ tải là xong.
2. US1 (tải nhiều tệp) → **dừng và kiểm** tới trạng thái "Đang xử lý".
3. US3 song song/ngay sau → "Sẵn sàng" + ảnh thu nhỏ → kiểm độc lập.
4. US2 (tiếp tục tải) + US4 (5 GB, dọn dẹp) → hoàn tất bốn câu chuyện P1 = **MVP**.
5. Triển khai/demo nếu muốn; 012/013 vẫn dùng media giả lập cho tới T091.

### Incremental Delivery

1. Nền → US1 (+US3) → US2 → US4: MVP.
2. US5: mở khóa 013 (đăng thật).
3. US6: xem/tìm/xóa — cần trước khi dùng lâu dài (US4 không còn ngõ cụt).
4. US7: chống trùng (nền cho T11).
5. Polish: quan sát, đo, Playwright, rà hiến pháp.

### Parallel Team Strategy (đội 3–4 người)

Sau Phase 2: A làm US1 → US2 (tải lên); B làm US3 → US7 (Worker/xử lý); C làm US4 → US6 (hạn mức/dọn/xóa) và web; US5 do người rảnh trước. Tệp dùng chung xếp hàng theo mục "Within Each User Story".

---

## Notes

- Tổng quan truy vết: FR-001/007 → T041–T046; FR-002/004–006 → T035–T037, T049–T052; FR-003 → T009/T011/T035; FR-008–010/028 → T026, T061–T068; FR-011–014 → T053–T060; FR-015–017 → T069–T073; FR-018–019 → T008, T033, T077; FR-020 → T083–T085; FR-021 → T074–T078, T081; FR-022 → T088; FR-023/027 → T086–T087.
- `[P]` = khác tệp, không phụ thuộc việc chưa xong. Mỗi việc/nhóm việc nên một commit; dừng ở mỗi Checkpoint để kiểm câu chuyện.
- Không dùng `cd` ra ngoài worktree; không chạy docker compose ở hai checkout cùng lúc (trùng cổng 3000/3001/8080).
- Mọi lệnh Spec Kit PowerShell phải chạy với `-ExecutionPolicy Bypass`.
- Tránh: việc mơ hồ, hai việc cùng sửa một tệp, phụ thuộc chéo phá tính độc lập của câu chuyện.

## Điểm cần xem lại (ghi nhận khi lập danh sách)

- T091 (nối 012/013) phụ thuộc việc 012/013 đã vào `dev` hay chưa — tại thời điểm lập danh sách cả hai chưa có mã.
- `UploadGate` thật (WBS 2.6) chưa có dữ liệu gói; T024 giữ bản mặc định `allowed: true`.
- T029 có thể loại HEIC khỏi `MEDIA_ACCEPTED`; khi đó phải sửa spec Assumptions + SC-004 (bỏ HEIC khỏi "ảnh hợp lệ").
- T031: nếu vStorage không hỗ trợ multipart/URL phần ký sẵn thì SC-002 ghi nhận chưa đạt cho video lớn (chế độ `single` vẫn dùng được; US1/US3/US4 không bị chặn).
