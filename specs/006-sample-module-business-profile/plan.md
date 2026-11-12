# Implementation Plan: Module mẫu trọn luồng màn hình → CSDL – khung "Hồ sơ kinh doanh"

**Branch**: `impl/006-sample-module-business-profile` | **Date**: 2026-11-11 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `specs/006-sample-module-business-profile/spec.md`

## Summary

Dựng lát dọc nghiệp vụ đầu tiên đi trọn màn hình → API → module `context` → CSDL → hàng chờ → Worker, để đội chép
theo (WBS K6, chuẩn bị T7). Phạm vi gồm: hồ sơ kinh doanh có phiên bản, quyền tách `context.view` / `context.edit`,
khóa lạc quan, sự kiện `context.profile_changed` tạo trong cùng giao dịch, bộ xử lý mẫu ở Worker, bộ kiểm thử mẫu
(a)–(h) và hướng dẫn `docs/sample-module.md`. Hướng kỹ thuật: dùng lại toàn bộ khung 002–004 (`tenantTable`,
`updateVersioned`, `tenantTx`, `enqueue`/`registerJobHandler`, `@CustomerAccess`, lược đồ Zod dùng chung). Phần thêm
mới chỉ gồm 2 bảng, 1 hàm của `AccountPublicApi`, một tùy chọn thông điệp xung đột, kiểm thử bao phủ truy cập chéo và
công cụ kiểm thử trình duyệt Playwright (research R1–R15).

## Technical Context

**Language/Version**: TypeScript 5.9.3, Node.js 24 (pnpm 10.34.9, monorepo `apps/server`, `apps/web`, `packages/shared`)

**Primary Dependencies**: NestJS 11.2.8, Drizzle ORM 0.45.4 / drizzle-kit 0.31.11, pg-boss 12.38.0 (bọc trong module
`queue`), Zod 4.6.7, pino; React 19.3.1, React Router 8.5.1, Vite 8.3.6. **Thêm (chỉ dev)**: `@playwright/test`,
`@axe-core/playwright`, phiên bản chính xác cố định lúc implement (R12).

**Storage**: PostgreSQL có RLS – schema `context`: `business_profiles`, `profile_versions` (data-model.md). Không
dùng kho tệp ở tính năng này.

**Testing**: Vitest 5.1.0 (đơn vị, e2e API bằng supertest, `test:db`, `test:queue` trên PostgreSQL thật), Testing
Library + `vitest-axe` (web), Playwright (trình duyệt, gói `e2e/` mới).

**Target Platform**: API + Worker trên Kubernetes (Linux container); SPA trên trình duyệt di động/máy tính từ 360 px.

**Project Type**: Ứng dụng web (SPA + API/Worker), modular monolith.

**Performance Goals**: chuyển sang trang hồ sơ hiển thị ≤ 1 giây; lưu và thấy xác nhận ≤ 1 giây (SC-001). Truy vấn
đều theo chỉ mục `(account_id, …)`, ≤ 3 câu lệnh mỗi lần lưu.

**Constraints**: không cache hồ sơ (FR-015); mã tài khoản chỉ từ phiên/việc; payload việc chỉ mã tham chiếu; migration
chỉ thêm (FR-024); nhật ký không chứa nội dung hồ sơ; WCAG 2.1 AA.

**Scale/Scope**: 1 hồ sơ/tài khoản; vài chục phiên bản/tài khoản/năm; 2 bảng, 4 điểm cuối, 2 tuyến web, 1 loại việc,
~8 tệp kiểm thử mới, 1 tài liệu hướng dẫn.

## Constitution Check

*GATE: đánh giá trước Phase 0, đánh giá lại sau Phase 1 – cả hai lần ĐẠT, không có vi phạm cần biện minh.*

| Nguyên tắc | Đánh giá | Bằng chứng trong thiết kế |
|---|---|---|
| I. Cô lập tenant | ĐẠT | Hai bảng `tenantTable` (RLS `tenant_isolation`, `account_id` NOT NULL, đầu chỉ mục); truy cập chỉ qua `tenantTx`; API không nhận mã tài khoản (`z.strictObject`); `versionId` của tài khoản khác → 404; kiểm thử truy cập chéo + bao phủ tự nhận diện (R13); hỗ trợ không xem hồ sơ (Clarifications Q2). |
| II. Đăng bài tin cậy | Không áp dụng | Tính năng không đăng bài. |
| III. Cổng AI & ngân sách | Không áp dụng | Không gọi AI. T7 gắn AI tóm tắt vào bộ xử lý `context.profile_changed`, qua Cổng AI. |
| IV. Ranh giới module | ĐẠT | Schema `context` riêng; FK nội bộ (`profile_versions → business_profiles`) và tới `accounts`; người lưu tham chiếu bằng mã, đọc tên qua `AccountPublicApi.describeMembers` (thêm `account` vào `allowedDeps`, không vòng); `ContextPublicApi.getCurrentProfile`; sự kiện = việc tạo trong cùng giao dịch. |
| V. Việc nền bền vững | ĐẠT | `enqueue` trong `tenantTx` (hoàn tác → không có việc); hàng chờ `ai_batch` có giới hạn theo tenant sẵn có; bộ xử lý không ghi → chạy lại an toàn, kiểm `expectIdempotent` + 2 Worker; bỏ qua việc của phiên bản cũ. |
| VI. AI đề xuất, người quyết định | ĐẠT | Quyền kiểm ở API (`@CustomerAccess('context.edit')`), web chỉ ẩn/hiện; thông điệp tiếng Việt kèm hành động; trạng thái chữ + biểu tượng; WCAG AA, 44 px, 360 px; không chặn khi gói hết hạn (Clarifications Q3). |
| VII. Bí mật & dữ liệu cá nhân | ĐẠT | Không gửi dữ liệu ra ngoài; payload việc và nhật ký không chứa nội dung; giao diện công khai không trả thông tin liên hệ chủ tài khoản; dữ liệu xóa theo CASCADE khi xóa tài khoản. |
| VIII. Quan sát được | ĐẠT | Nhật ký có cấu trúc gắn `account_id`, `trace_id` (tự có trong giao dịch/việc); sự kiện `context.profile.saved|rejected`, `context.profile_changed.processed|superseded` (R14). |
| IX. Đơn giản, chuẩn mở | ĐẠT | Không thêm thành phần chạy; danh mục ngành là hằng số (không bảng); không thêm thư viện biểu mẫu/trạng thái; Playwright chỉ là công cụ kiểm thử, cố định phiên bản. |
| Quy ước dữ liệu | ĐẠT | UUID v7, `timestamptz` UTC, xóa mềm trên `business_profiles`, cột `version` chặn ghi đè, không số thực, không cache trạng thái. `profile_versions` là lịch sử bất biến (như nhật ký): không xóa mềm, REVOKE UPDATE/DELETE, chỉ mất theo CASCADE khi xóa tài khoản theo vòng đời dữ liệu (90 ngày / ≤ 30 ngày) – không có thao tác xóa phiên bản đơn lẻ nên quy tắc "xóa mềm 30 ngày" không có đối tượng áp dụng. |
| Cổng CI | ĐẠT | Truy cập chéo, `db:check`, ranh giới, kiểu + lint, quét bí mật đều chạy qua `pnpm verify`; thêm `test:e2e`. Cổng số 3 (không truy cập schema module khác) được bổ sung quy tắc quét SQL trong `check:boundaries` (R16) – trước 006 chỉ có quy tắc import. |

## Project Structure

### Documentation (this feature)

```text
specs/006-sample-module-business-profile/
├── spec.md
├── plan.md                     # tệp này
├── research.md                 # R1–R15
├── data-model.md               # bảng, quy tắc hợp lệ, chuyển trạng thái, việc nền
├── quickstart.md               # lệnh kiểm chứng theo nhóm (a)–(h)
├── contracts/
│   ├── context-http-api.md     # 4 điểm cuối, mã lỗi, thông điệp
│   ├── context-public-api.md   # ContextPublicApi, việc context.profile_changed, describeMembers
│   └── business-profile-ui.md  # tuyến, trạng thái, khả năng truy cập
├── checklists/requirements.md
└── tasks.md                    # /speckit-tasks
```

### Source Code (repository root)

```text
packages/shared/src/
├── auth/permissions.ts                       # context.manage → context.view + context.edit (#pq-…)
└── modules/context/
    ├── index.ts                              # lối vào @app/shared/context
    ├── industries.ts                         # INDUSTRIES, INDUSTRY_CODES
    ├── limits.ts                             # PROFILE_LIMITS
    └── profile.ts                            # ProfileFields (chuẩn hóa + hợp lệ), DTO phản hồi
packages/shared/test/context-profile.spec.ts  # (a)

apps/server/src/
├── core/db/versioned.ts                      # + tùy chọn conflictMessage
├── core/auth/permissions.ts                  # PERMISSION_DENIED_MESSAGES
├── modules/modules.manifest.json             # context.allowedDeps += account
├── modules/account/
│   ├── public-api.ts                         # + describeMembers
│   └── internal/members/describe-members.ts
└── modules/context/
    ├── context.module.ts                     # controller (API), handler (Worker), CONTEXT_PUBLIC_API
    ├── index.ts · public-api.ts · jobs.ts    # giao diện công khai + loại việc
    └── internal/
        ├── db/schema.ts                      # business_profiles, profile_versions
        ├── profile.service.ts                # lưu (tenantTx + updateVersioned + enqueue), đọc, lịch sử
        ├── profile-content.ts                # sameProfileContent, ánh xạ dòng ↔ DTO (thuần)
        ├── profile.controller.ts             # 4 điểm cuối, @CustomerAccess
        ├── public-api.impl.ts                # ContextPublicApi
        └── profile-changed.handler.ts        # bộ xử lý mẫu (Worker)
apps/server/drizzle/migrations/
├── NNNN_context_business_profiles.sql        # sinh bởi db:generate (review RLS, FK CASCADE)
└── NNNN_context_profile_versions_immutable.sql # migration tay: REVOKE UPDATE, DELETE
apps/server/test/
├── unit/context/profile-content.spec.ts      # (a)
├── context/profile-api.e2e.spec.ts           # (b)
├── db/context-isolation.db.spec.ts           # (c) + 404 theo versionId, REVOKE
├── db/cross-tenant-coverage.db.spec.ts       # (c) tự nhận diện bảng tenant mới (R13)
├── db/fixtures/cross-tenant-fixtures.ts
├── db/helpers/cross-tenant.ts                # + seedParent?
├── db/context-concurrency.db.spec.ts         # (d)
├── db/account-describe-members.db.spec.ts
├── context/public-api.contract.db.spec.ts    # (e)
└── queue/context-profile-changed.queue.spec.ts # (h)

apps/web/src/
├── app/router.tsx                            # + /business-profile, /business-profile/versions/:versionId
└── features/context/
    ├── context-api.ts                        # gọi API + safeParse
    ├── BusinessProfilePage.tsx · ProfileForm.tsx · KeywordsInput.tsx
    ├── VersionHistory.tsx · VersionDetailPage.tsx
    └── useUnsavedChangesGuard.ts
apps/web/test/context/*.spec.tsx              # (f)

e2e/                                          # gói mới @app/e2e – Playwright (g)
├── package.json · playwright.config.ts
└── tests/business-profile.e2e.ts

docs/sample-module.md                         # hướng dẫn chép mẫu (FR-022)
tooling/verify.mjs                            # + bước test:e2e
TaiLieuDacTa/ (đã cập nhật ở clarify) · apps/server/docs/auth.md (đã cập nhật)
```

**Structure Decision**: Giữ khuôn monorepo hiện có; mọi mã nghiệp vụ trong `modules/context/` (công khai ở gốc,
còn lại trong `internal/`), hợp đồng web ↔ API trong `@app/shared/context`, màn hình trong `features/context/`. Gói
`e2e/` mới ở gốc vì kiểm thử trình duyệt cần cả API lẫn web.

## Thứ tự thực hiện gợi ý (đầu vào cho /speckit-tasks)

1. Nền: quyền `context.view`/`context.edit` (+ kiểm thử quyền), `conflictMessage`, `describeMembers`, tệp kê khai.
2. Hợp đồng dùng chung `@app/shared/context` + kiểm thử (a).
3. CSDL: schema, migration, `db:check`, truy cập chéo + bao phủ (c).
4. Dịch vụ + controller + kiểm thử (b), (d).
5. Giao diện công khai, việc nền, bộ xử lý + (e), (h).
6. Màn hình + (f); Playwright + (g); bước `test:e2e` trong `verify`.
7. `docs/sample-module.md`, trỏ từ README/CLAUDE.md; diễn tập SC-008.

## Rủi ro

| Rủi ro | Giảm thiểu |
|---|---|
| Playwright khó chạy trên Windows/CI (tải trình duyệt) | chỉ Chromium; bước `test:e2e` bỏ qua có thông báo khi thiếu `TEST_DATABASE_ADMIN_URL`; lệnh cài trong quickstart |
| Kiểm thử bao phủ truy cập chéo làm đỏ CI vì bảng cũ chưa có fixture | danh sách miễn trừ có lý do trỏ spec riêng đã có của 002/004 |
| Đổi tên quyền làm hỏng web/phiên | `context.manage` chưa được dùng ở điểm cuối/web nào; quyền tính lúc kiểm, không lưu trong phiên |
| Mẫu bị chép cả phần đặc thù | hướng dẫn tách "khung bắt buộc" và "đặc thù hồ sơ" rõ ràng |

## Complexity Tracking

Không có vi phạm hiến pháp cần biện minh.
