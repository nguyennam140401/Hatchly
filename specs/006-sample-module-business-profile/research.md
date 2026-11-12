# Research – 006 Module mẫu "Hồ sơ kinh doanh"

Mọi quyết định dựa trên khung đã có ở 001–005 (đã đọc mã: `core/db`, `core/auth`, `modules/queue`, `apps/web`).
Không có mục "NEEDS CLARIFICATION" còn mở.

## R1. Mô hình phiên bản: một dòng hồ sơ + bảng phiên bản chỉ-thêm

- **Decision**: `context.business_profiles` (1 dòng/tài khoản, `versioned: true`; cột `version` = số phiên bản hiện
  hành) + `context.profile_versions` (bất biến, chứa toàn bộ nội dung mỗi lần lưu). Nội dung hiện hành = dòng
  `profile_versions` có `version_number = business_profiles.version`.
- **Rationale**: Dùng lại `updateVersioned` của 002 cho khóa lạc quan (FR-005) – cột `version` vừa là khóa vừa là số
  phiên bản liên tục (FR-002), nên không có lỗ/trùng số (SC-004). Bảng phiên bản chỉ thêm → lịch sử không sửa được.
- **Alternatives**: (a) Một bảng phiên bản, "hiện hành" = `max(version_number)` → không có điểm khóa lạc quan, cạnh
  tranh phải dùng khóa hàng/khóa tư vấn; (b) Lưu nội dung trên `business_profiles` + bảng lịch sử bằng trigger → ẩn
  logic trong CSDL, đội khó chép.

## R2. Lần lưu đầu tiên và cạnh tranh tạo hồ sơ

- **Decision**: `expectedVersion = 0` nghĩa là "chưa có hồ sơ" → `INSERT business_profiles (version = 1)`; chỉ mục
  duy nhất `business_profiles_account_id_key (account_id)` chặn bản thứ hai; vi phạm duy nhất → `VERSION_CONFLICT`.
  `expectedVersion ≥ 1` → `updateVersioned`.
- **Rationale**: Một quy tắc cho cả tạo và sửa; CSDL bảo đảm "tối đa một hồ sơ/tài khoản" (FR-001).
- **Alternatives**: `INSERT … ON CONFLICT DO NOTHING` rồi đọc lại – che mất xung đột, khó kiểm thử.

## R3. Thông điệp xung đột theo ngữ cảnh

- **Decision**: Mở rộng `versionConflict(message?)` / `updateVersioned(…, { conflictMessage })` trong
  `core/db/versioned.ts` (giữ mặc định cũ). Hồ sơ dùng "Hồ sơ vừa được cập nhật ở nơi khác. Tải bản mới nhất để
  xem." với hành động `retry` "Tải bản mới nhất".
- **Rationale**: Thông điệp hiện tại nói "Bài…", sai ngữ cảnh (nguyên tắc VI). Thay đổi tương thích ngược.

## R4. "Không có thay đổi" (FR-003)

- **Decision**: Chuẩn hóa ở lược đồ dùng chung (cắt khoảng trắng đầu/cuối mỗi trường, chuỗi rỗng → `null` cho trường
  tùy chọn, từ khóa cắt khoảng trắng, giữ thứ tự). So sánh nội dung đã chuẩn hóa với phiên bản hiện hành **trong
  cùng giao dịch, trước** khi cập nhật; giống → trả `{ changed: false }`, không ghi, không tạo việc.
- **Rationale**: Đơn giản, tất định; so sánh bằng hàm thuần `sameProfileContent(a, b)` kiểm thử đơn vị được.
- **Alternatives**: Băm nội dung lưu cột `content_hash` – thêm cột, không cần ở quy mô này.
- **Lưu ý cạnh tranh**: nếu so sánh dựa trên bản đã cũ, `updateVersioned` vẫn chặn → xung đột; không có ghi sai.

## R5. Danh mục ngành là hằng số dùng chung, không phải bảng

- **Decision**: `INDUSTRIES` (mã + nhãn tiếng Việt) trong `@app/shared/context`; CSDL lưu `industry_code text` không
  CHECK theo danh sách (chỉ CHECK độ dài); lược đồ Zod kiểm `z.enum`. Mã ban đầu: `fashion` Thời trang, `food_beverage`
  Ăn uống, `cosmetics` Mỹ phẩm, `education` Giáo dục, `beauty_services` Dịch vụ làm đẹp, `other` Khác.
- **Rationale**: Spec: "bổ sung mục mới không cần đổi cấu trúc". Hằng số dùng chung cho web và máy chủ, không cần bảng
  dùng chung + migration REVOKE. Mã đã dùng không được xóa (dữ liệu cũ vẫn hiển thị được).
- **Alternatives**: Bảng `context.industries` (`sharedTable`) – thêm migration, quyền chỉ đọc, API đọc danh mục; chưa
  cần khi danh mục đổi theo phát hành.

## R6. Ràng buộc độ dài: một nguồn, hai lớp

- **Decision**: Hằng số `PROFILE_LIMITS` trong `@app/shared/context` dùng cho lược đồ Zod (web + máy chủ, cùng thông
  điệp – FR-004). CSDL thêm CHECK `char_length` tương ứng (lớp chặn thứ hai, đổi giới hạn = migration).
  `keywords text[]` CHECK `cardinality ≤ 20`; độ dài từng từ khóa và trùng lặp chỉ kiểm ở ứng dụng.
- **Rationale**: Hiến pháp ưu tiên hai lớp chặn; CHECK độ dài từng phần tử mảng cần hàm, không đáng.

## R7. Người lưu: tham chiếu bằng mã + giao diện công khai của `account`

- **Decision**: `profile_versions.saved_by_user_id uuid NOT NULL` không có FK (users thuộc module `account` – ADR-09).
  Thêm `AccountPublicApi.describeMembers(userIds)` → `{ userId, displayName, status }[]` (chạy trong ngữ cảnh tenant,
  RLS chỉ trả thành viên của tài khoản đó). Thêm `account` vào `allowedDeps` của `context`. Người không còn trong
  kết quả hoặc `status ≠ active` → hiển thị "Thành viên đã rời".
- **Rationale**: Đây là ví dụ mẫu gọi module khác qua giao diện công khai (nguyên tắc IV); không sao chép tên người
  vào bảng của module khác (tối thiểu dữ liệu cá nhân).
- **Alternatives**: Lưu `saved_by_name` – trùng lặp dữ liệu cá nhân, đổi tên không cập nhật.

## R8. Sự kiện "hồ sơ đã thay đổi"

- **Decision**: Loại việc `context.profile_changed` (hàng chờ `ai_batch`, `scope: 'tenant'`, payload
  `{ profileId: uuid, version: int }`, `dedupeKey: profile:<profileId>:v<version>`), tạo bằng `enqueue` trong cùng
  `tenantTx` lưu. Bộ xử lý (Worker): đọc hồ sơ qua `ContextPublicApi.getCurrentProfile()`; `version` của việc < phiên
  bản hiện hành → ghi nhật ký `context.profile_changed.superseded` và kết thúc; ngược lại ghi
  `context.profile_changed.processed`. Không ghi CSDL.
- **Rationale**: `ai_batch` là nơi T7 đặt AI tóm tắt; payload chỉ mã tham chiếu (quy tắc payload 003 cấm nội dung và
  `accountId`). Bộ xử lý không ghi gì nên chạy lại tự nhiên an toàn; kiểm thử `expectIdempotent` vẫn là khuôn mẫu.
- **Alternatives**: Hàng chờ `scheduled`/`notify` – sai mục đích; bảng outbox riêng – cơ chế mới cần ADR (đã loại ở
  Clarifications).

## R9. Quyền `context.view` / `context.edit`

- **Decision**: Thay dòng `context.manage` trong `packages/shared/src/auth/permissions.ts` bằng hai dòng; cập nhật
  `PERMISSION_DENIED_MESSAGES`, `packages/shared/test/auth.spec.ts`, `apps/server/test/auth/permissions.spec.ts`.
  Ma trận e2e tự sinh điểm cuối cho mỗi quyền. Chú thích trỏ mốc `#pq-context-view`, `#pq-context-edit`.
- **Rationale**: `context.manage` chưa có điểm cuối nào dùng → đổi tên an toàn, không cần giai đoạn chuyển tiếp.
  Phiên đã lưu không chứa quyền (quyền tính từ vai trò lúc kiểm) → không cần migrate phiên.

## R10. API HTTP

- **Decision**: `GET /context/profile`, `PUT /context/profile`, `GET /context/profile/versions?page=`,
  `GET /context/profile/versions/:versionId`. Hợp đồng Zod trong `@app/shared/context`, kiểm ở máy chủ bằng
  `@ValidBody`/`@ValidQuery` và ở web bằng `safeParse` (khuôn `api-client.ts`). Chi tiết: `contracts/context-http-api.md`.
- **Rationale**: Một hồ sơ/tài khoản nên đường dẫn không có mã hồ sơ; mã tài khoản không bao giờ xuất hiện (FR-009).
  `versionId` (UUID) để kiểm "đoán mã của tài khoản khác → 404" (FR-011).

## R11. Màn hình

- **Decision**: `apps/web/src/features/context/` – `BusinessProfilePage` (đọc + biểu mẫu), `VersionHistory`,
  `VersionDetailPage`, `context-api.ts`; tuyến `/business-profile`, `/business-profile/versions/:versionId` sau
  `SessionGate`. Quyền đọc từ `/auth/me` (`permissions`) chỉ để ẩn/hiện. Chặn rời trang: `useBlocker` của React Router
  (đã dùng `createBrowserRouter`) + `beforeunload`. Không thêm thư viện biểu mẫu/trạng thái – `useState`/`useReducer`.
- **Rationale**: Theo khuôn `features/auth`; ít phụ thuộc (nguyên tắc IX).
- **Alternatives**: react-hook-form, TanStack Query – lợi ích chưa đủ cho một màn hình; ghi vào hướng dẫn là điểm
  xem xét lại khi có ≥ 3 màn hình biểu mẫu lớn.

## R12. Kiểm thử đầu-cuối qua trình duyệt (nhóm g)

- **Decision**: Thêm `@playwright/test` (cố định phiên bản chính xác khi implement, chỉ Chromium) ở gói mới
  `e2e/` tại gốc kho (`pnpm test:e2e`). Playwright `webServer` khởi động API (`dev:api`) và web (`vite`) trỏ CSDL kiểm
  thử tạm; bước `test:e2e` trong `pnpm verify` dùng `requiresEnv: TEST_DATABASE_ADMIN_URL`. Kiểm `axe` trong trình
  duyệt bằng `@axe-core/playwright` (cố định phiên bản).
- **Rationale**: Chưa có công cụ e2e trình duyệt; Playwright là chuẩn phổ biến, chỉ là công cụ phát triển (không phải
  thành phần chạy – không cần ADR theo nguyên tắc IX). `vitest-axe` đã có cho kiểm thử thành phần.
- **Alternatives**: Cypress – nặng hơn, khó chạy song song trên Windows; chỉ kiểm thành phần – không đạt nhóm (g).

## R13. Kiểm thử truy cập chéo tự nhận diện bảng mới (FR-023)

- **Decision**: Thêm `test/db/cross-tenant-coverage.db.spec.ts`: lấy mọi bảng `tenant` trong sổ đăng ký bảng; mỗi
  bảng phải có mục trong `test/db/fixtures/cross-tenant-fixtures.ts` (`insertRow`, `updateRow`, dữ liệu cha nếu có);
  thiếu → kiểm thử thất bại, chỉ tên bảng. Kiểm thử chạy `describeCrossTenant` cho mọi mục. Các bảng của 002/004 đã có
  spec riêng được đưa vào danh sách miễn trừ có lý do (trỏ spec hiện có) để không chạy hai lần.
- **Rationale**: Hiện `describeCrossTenant` phải gọi tay – quên là lọt. Bảng có FK nội bộ (`profile_versions` →
  `business_profiles`) cần dữ liệu cha → mở rộng `CrossTenantOptions` thêm `seedParent?` (tương thích ngược).

## R14. Nhật ký và theo dõi

- **Decision**: Logger có cấu trúc của Nest/pino sẵn có; sự kiện: `context.profile.saved` (version, changed); từ chối
  quyền = `auth.denied` (guard 004); từ chối hợp lệ và xung đột = `request.rejected` (`code`, `route`) ghi ở
  `ErrorFilter` cho mọi module (lỗi hợp lệ bị `@ValidBody` chặn trước controller nên module không tự ghi được);
  `context.profile_changed.processed|superseded`.
  Trường: `account_id` (tự có trong giao dịch), `trace_id`, `version`; không bao giờ ghi nội dung trường. Kiểm thử
  quét nhật ký mẫu (`secrets-in-logs` có sẵn) thêm điều kiện "không chứa chuỗi nội dung hồ sơ thử".

## R15. Hướng dẫn chép mẫu

- **Decision**: `docs/sample-module.md` (gốc kho, vì trải cả web và máy chủ), tiếng Việt, cấu trúc theo tầng: CSDL →
  module (public-api, internal, jobs) → API (khai báo truy cập, lược đồ dùng chung) → quyền → web → kiểm thử (a)–(h)
  → danh sách kiểm tra trước review → "điểm gắn kiểm tra gói" (Clarifications Q3) → lịch sử diễn tập (SC-008).
  `README.md` và `CLAUDE.md` thêm một dòng trỏ tới.

## R16. Kiểm tra truy cập schema của module khác

- **Decision**: thêm quy tắc quét định danh SQL (`"<schema>"."…"`, `<schema>.<bảng>`) vào `check:boundaries` – tĩnh,
  theo `modules.manifest.json`; mã của module `<m>` chỉ được nhắc tới schema của chính nó.
- **Rationale**: quy tắc import (001) không bắt SQL viết tay; RLS không chặn được vì cùng tenant. Cổng CI số 3 của
  hiến pháp yêu cầu "không truy cập schema của module khác".
- **Alternatives**: quyền CSDL theo module (mỗi module một vai trò CSDL) – chặt hơn nhưng đổi kiến trúc vai trò,
  cần ADR.
