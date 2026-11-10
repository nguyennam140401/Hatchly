# Implementation Plan: Xác thực tối thiểu – email + mật khẩu, phiên, 4 vai trò, chặn quyền ở API

**Branch**: `impl/004-minimal-auth-rbac` | **Date**: 2026-11-08 | **Spec**: [spec.md](spec.md)

**Input**: Feature specification from `specs/004-minimal-auth-rbac/spec.md`

## Summary

Thêm cửa vào cho mọi tính năng khách hàng (WBS 2.1, phần xác thực của FR-15). Gồm: đăng ký, đăng nhập,
đăng xuất bằng email + mật khẩu, xác minh email, quên và đổi mật khẩu, 4 vai trò, và **một lớp chặn
quyền dùng chung, mặc định từ chối**.

Cách làm:
- **Bộ thư viện nhỏ** thay cho khung trọn gói (R1): argon2id qua `@node-rs/argon2`, mã phiên ngẫu nhiên
  lưu dạng SHA-256, `nodemailer`. Khung trọn gói tự truy vấn ngoài ngữ cảnh tenant nên không hợp RLS.
- **Phiên phía máy chủ** trong cookie `__Host-sid` (R3). Bộ nhớ đệm trong tiến trình 60 giây, nên thu
  hồi có hiệu lực ≤ 60 giây.
- **Giữ RLS** trên mọi bảng danh tính khách hàng. Phần truy cập trước khi biết tenant đi qua 4 hàm
  `SECURITY DEFINER` hẹp, `authTx` và `runInAccountScope`, cả ba có quy tắc ranh giới tự động (R4).
- **Lõi `core/auth`**: danh mục 13 quyền, bộ trang trí `@Public`/`@CustomerAccess`/`@StaffAccess`,
  `AccessGuard` toàn cục là nơi duy nhất gọi `bindAccountToRequest`, kiểm tra nguồn gửi (CSRF), và
  `currentActor()`. Lõi không nhập module: nó gọi module `account` qua giao diện `SessionResolver`.
- **Module `account`** sở hữu bảng, dịch vụ, controller, mẫu thư, nhân viên nội bộ, chống dò và lệnh
  vận hành.
- **Giao diện web**: 7 trang auth, có router và "cổng phiên".
- **Gửi thư**: `core/mail` với hai cách gửi `smtp` và `memory`; dev dùng Mailpit.

## Technical Context

**Language/Version**: TypeScript 5.9 (strict), Node.js 24 LTS – như 001/002

**Primary Dependencies**:
- Có sẵn: NestJS 11, Drizzle 0.45, `pg`, Zod 4, pino, React 19, Vite 8.
- Mới (khóa phiên bản chính xác): `@node-rs/argon2`, `nodemailer` (+ `@types/nodemailer` dev),
  `cookie-parser` (+ types) hoặc đọc cookie thủ công (chọn ở tasks), `react-router` (web),
  `vitest-axe` (dev, web).
- `arctic`: chỉ ghi nhận cho tính năng sau, chưa cài.

**Storage**: PostgreSQL (schema `account`): 5 bảng tenant mới, 3 bảng shared, 4 hàm `SECURITY DEFINER`,
mở rộng `CHECK` của `infra.audit_log` ([data-model.md](data-model.md))

**Testing**: Vitest. Đơn vị (`pnpm test`); tích hợp CSDL thật (`pnpm test:db`, khuôn của 002); e2e API
bằng supertest trên CSDL thật với `MAIL_TRANSPORT=memory`; web dùng Testing Library + `vitest-axe`

**Target Platform**: Container Linux trên Kubernetes (API). SPA phục vụ tĩnh, **cùng site** với API qua
ingress `/api`. Máy dev Windows/Linux

**Project Type**: Web application – monorepo: `apps/server`, `apps/web`, `packages/shared`, `tooling`

**Performance Goals**: p95 đăng nhập ≤ 2 giây; guard thêm ≤ 20 ms p95 khi bộ nhớ đệm trúng (SC-002).
argon2 ~20–60 ms mỗi lần băm trên 1 vCPU

**Constraints**:
- Không vai trò CSDL nào vượt RLS; mã tài khoản chỉ đến từ phiên đã xác minh.
- Không lộ email đã đăng ký (đăng ký, đăng nhập, quên mật khẩu, gửi lại).
- Không lưu mã gốc; không có bí mật trong nhật ký.
- Không thêm hạ tầng chạy thật (Mailpit chỉ ở dev).
- Migration chỉ thêm.

**Scale/Scope**: 3.000 tài khoản × ≤ 3 người (thiết kế cho gấp 10 lần); 14 điểm cuối; 13 quyền; 7 trang
web; 3 migration

Không còn mục NEEDS CLARIFICATION. Các điểm spec để cho plan đã chốt ở [research.md](research.md):
thư viện (R1), đường truy cập trước tenant (R4), nơi đếm chống dò (R6).

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Nguyên tắc | Áp dụng vào tính năng | Đánh giá |
|---|---|---|
| I. Cô lập tenant | `users`, `login_identities`, `memberships`, `sessions`, `auth_tokens` đều là `tenantTable` (RLS `tenant_isolation`, `account_id` đứng đầu chỉ mục, trừ các chỉ mục duy nhất toàn cục có ghi lý do). Mã tài khoản chỉ được gắn bởi `AccessGuard` từ phiên đã tra trong CSDL. Guard không đọc path, query hay body. Truy cập trước tenant gói trong 4 hàm `SECURITY DEFINER` (chỉ `app` có `EXECUTE`, trả cột tối thiểu) và `authTx`/`runInAccountScope` (quy tắc ranh giới mới). Bảng nhân viên là `shared`, không có dữ liệu khách hàng. Có bộ kiểm thử truy cập chéo cho mọi bảng mới. Việc xem dữ liệu khách hàng của nhân viên vẫn chỉ qua `supportSearch`/`supportViewAccount` (có kiểm toán) với `staffId` lấy từ phiên | ✅ Đạt (xem Theo dõi độ phức tạp: hàm `SECURITY DEFINER`) |
| II. Đăng bài tin cậy | Không chạm luồng đăng. Đặt sẵn các quyền `post.approve`, `post.reschedule`, `post.republish` theo FR-06/FR-09 | ✅ Không áp dụng trực tiếp |
| III. Cổng AI & ngân sách | Không gọi AI. Thư và phản hồi không chứa số tiền AI. `support.lookup` (được xem chi phí số tiền) chỉ dành cho nhân viên | ✅ Đạt |
| IV. Modular monolith | Bảng thuộc schema `account`, mã ở `modules/account/internal`. Lõi `core/auth` không nhập module (đảo phụ thuộc qua `SessionResolver`). Module khác chỉ dùng khai báo truy cập và `currentActor()` từ `core` | ✅ Đạt |
| V. Việc nền bền vững | Chưa có việc nền. Gửi thư chạy trong tiến trình sau khi giao dịch xác nhận; có nút "Gửi lại", và chuyển sang hàng chờ `notify` khi 003 có mã (Phạm vi giao cho đầu việc sau). Dọn phiên/bộ đếm hết hạn được ghi lại để đăng ký việc định kỳ ở 003 | ⚠️ Đạt có điều kiện – xem Theo dõi độ phức tạp |
| VI. AI đề xuất, con người quyết định | Quyền kiểm tra ở API bằng guard **mặc định từ chối**; CI bắt điểm cuối thiếu khai báo. Chỉ `owner` có `post.approve`. Thông điệp tiếng Việt đời thường kèm hành động; mã gốc chỉ ở `support.detail`. Web đạt WCAG 2.1 AA, chạy từ 360 px, vùng chạm ≥ 44 px | ✅ Đạt |
| VII. Bí mật & dữ liệu cá nhân | Băm bằng argon2id (thư viện đã kiểm chứng), mã ngẫu nhiên từ `node:crypto`, không tự viết thuật toán. Mã phiên và mã một lần chỉ lưu SHA-256; mã nằm ở `#fragment`. Pino che cookie và các trường mật khẩu/mã. Ô đồng ý không đặt sẵn. Dữ liệu lưu trong nước; không có bên nhận nước ngoài mới (SES đã có trong bảng công nghệ). Không gửi mật khẩu ra ngoài (danh sách cấm nằm trong mã). Địa chỉ mạng trong nhật ký kiểm toán được ẩn danh hóa khi xóa tài khoản. Đăng nhập mạng xã hội (FR-15 phần sau) đã có mô hình `login_identities` cho phép xác nhận trước khi liên kết | ✅ Đạt |
| VIII. Quan sát được | `actor_id`, `actor_kind`, `account_id`, `trace_id` có trên mọi dòng nhật ký. Sự kiện có cấu trúc `auth.denied`, `auth.access_not_declared`, `mail.send_failed`. Nhật ký kiểm toán cho mọi sự kiện ở FR-018, kể cả mọi thao tác của nhân viên | ✅ Đạt |
| IX. Đơn giản, chuẩn mở | Không thêm dịch vụ chạy thật. Mailpit chỉ ở dev. SMTP là chuẩn mở. Bộ nhớ đệm phiên tự viết bằng `Map`. Thư viện mới khóa phiên bản và bọc sau `core/mail` và `modules/account/internal/auth/password`. Cụ thể hóa T7 thì cập nhật tài liệu công nghệ (R1), không đi ngược ADR | ✅ Đạt |

**Quy ước dữ liệu**: UUID v7 sinh ở ứng dụng (kể cả mã truyền vào `auth_register`) ✅ · `timestamptz`
UTC ✅ · không có tiền ✅ · không cache hạn mức, ngân sách hay quyền nền tảng; phiên cache 60 giây đã
được chấp nhận ở Kiến trúc dữ liệu mục 8 ✅ · chuyển trạng thái (tiêu thụ mã, ghế thành viên) bằng cập
nhật có điều kiện hoặc ràng buộc duy nhất ✅.

**Quy trình**: migration 0005–0007 chỉ thêm, API/Worker cũ vẫn chạy ✅ · cổng CI 1 (truy cập chéo), 2
(`db:check`), 3 (ranh giới mới), 5 (quét bí mật có mẫu mới) ✅.

**Kiểm tra lại sau Phase 1** (data-model, contracts): mọi bảng có `account_id` đều là `tenantTable` ✅ ·
4 hàm `SECURITY DEFINER` có `search_path` cố định và quyền chỉ cho `app` ✅ · không điểm cuối nào nhận
`accountId` ✅ · phản hồi đăng ký và quên mật khẩu không phân biệt email có hay không (đã sửa trong
Phase 1: đăng ký không tự đăng nhập – Điều chỉnh spec) ✅ · `support` không có quyền mới nào trên schema
`account` ✅. **Đạt.**

**Checklist kiến trúc** (`architecture.md` mục 13): module và giao diện công khai ✅ · bảng mới có
`account_id` + RLS + kiểm thử truy cập chéo ✅ · việc nền – chưa có (ghi đầu việc sau) · AI – không có ·
chuyển trạng thái có điều kiện ✅ · không thêm hạ tầng ✅ · không ghi bí mật vào nhật ký ✅ · migration
tương thích ngược ✅.

## Điều chỉnh spec

| Mục spec | Điều chỉnh | Lý do |
|---|---|---|
| US1 (mô tả, Independent Test, AS1) | Đăng ký **không tự đăng nhập**. Người dùng được đăng nhập khi mở liên kết xác minh, hoặc đăng nhập bằng mật khẩu ở trạng thái chưa xác minh | Nếu chỉ đăng ký mới mới đặt cookie, sự khác biệt đó làm lộ email đã đăng ký, phá FR-008b (R8). Đã sửa `spec.md` trên nhánh này |
| FR-008a | `POST /auth/email/resend` là điểm cuối công khai, nhận email | Hệ quả của dòng trên: người vừa đăng ký chưa có phiên |

## Project Structure

### Documentation (this feature)

```text
specs/004-minimal-auth-rbac/
├── plan.md              # Tệp này
├── research.md          # R1–R14 + thuật ngữ mới
├── data-model.md        # bảng, hàm SECURITY DEFINER, migration, dữ liệu cá nhân
├── quickstart.md        # kịch bản kiểm chứng
├── contracts/
│   ├── auth-http-api.md # điểm cuối, mã lỗi, cookie
│   ├── authz-api.md     # danh mục quyền, khai báo truy cập, currentActor, hàm hạn chế, hành vi guard
│   └── auth-ops.md      # biến môi trường, lệnh staff/seed, compose, CI
├── checklists/requirements.md
└── tasks.md             # Phase 2 (/speckit-tasks – chưa tạo)
```

### Source Code (repository root)

```text
apps/server/
├── package.json                         # + @node-rs/argon2, nodemailer; scripts staff, dev:seed-auth
├── .env.example                         # + biến của contracts/auth-ops.md mục 1
├── drizzle/migrations/
│   ├── 0005_account_auth_tables.sql     # sinh
│   ├── 0006_account_auth_functions.sql  # tay – 4 hàm SECURITY DEFINER
│   └── 0007_audit_actor_types.sql       # tay
├── src/
│   ├── core/
│   │   ├── auth/
│   │   │   ├── permissions.ts           # PERMISSIONS, permissionsOf, thông điệp từ chối
│   │   │   ├── access.decorators.ts     # @Public, @CustomerAccess, @StaffAccess
│   │   │   ├── access.guard.ts          # AccessGuard (APP_GUARD) – nơi duy nhất gọi bindAccountToRequest
│   │   │   ├── access-declarations.ts   # duyệt route khi khởi động (R7)
│   │   │   ├── origin-check.middleware.ts # CSRF (R3)
│   │   │   ├── session-cache.ts         # Map 60 giây, 10.000 mục
│   │   │   ├── session-resolver.ts      # giao diện + token SESSION_RESOLVER
│   │   │   ├── actor.ts                 # currentActor, requireCustomer, requireStaff, can
│   │   │   ├── account-scope.ts         # runInAccountScope (hạn chế)
│   │   │   ├── client-ip.ts             # lấy địa chỉ mạng theo TRUST_PROXY_HOPS, khớp CIDR
│   │   │   └── auth.module.ts           # đăng ký guard, middleware
│   │   ├── db/auth-tx.ts                # authTx (hạn chế)
│   │   ├── mail/                        # Mailer, smtp.transport.ts, memory.transport.ts, mail.module.ts
│   │   ├── context/execution-storage.ts # + actor
│   │   ├── logging/logging.module.ts    # + actor_id/actor_kind, redact cookie/mật khẩu/mã
│   │   ├── config/config.schema.ts      # + biến mới
│   │   └── index.ts                     # + xuất core/auth công khai, core/mail
│   ├── modules/account/
│   │   ├── account.module.ts            # cung cấp SESSION_RESOLVER, controllers
│   │   ├── public-api.ts                # AccountPublicApi: addMember/removeMember/disableMember (nội bộ) …
│   │   └── internal/
│   │       ├── db/schema.ts             # 8 bảng (data-model)
│   │       └── auth/
│   │           ├── password/            # argon2 wrapper, chính sách, common-passwords.txt
│   │           ├── email.ts             # chuẩn hóa email
│   │           ├── tokens.ts            # sinh mã, SHA-256
│   │           ├── throttle.service.ts  # auth_throttle (R6)
│   │           ├── registration.service.ts
│   │           ├── session.service.ts   # tạo/thu hồi phiên, SessionResolver
│   │           ├── email-verification.service.ts
│   │           ├── password-reset.service.ts
│   │           ├── members.service.ts   # ghế thành viên (R5)
│   │           ├── staff.service.ts     # đăng nhập nhân viên, CIDR
│   │           ├── audit.ts             # ghi infra.audit_log cho sự kiện auth
│   │           ├── mail/templates.ts    # mẫu thư tiếng Việt
│   │           ├── customer-auth.controller.ts
│   │           └── staff-auth.controller.ts
│   ├── ops/staff.ts                     # pnpm staff …
│   ├── ops/seed-auth.ts                 # pnpm dev:seed-auth (chỉ dev/test)
│   └── core/health/*.controller.ts, core/diagnostics/*.controller.ts  # + khai báo @Public / khai báo phù hợp
└── test/
    ├── auth/                            # e2e + đơn vị (quickstart mục 1), AccessMatrixTestModule
    └── db/auth-*.db.spec.ts

apps/web/src/
├── app/router.tsx                       # createBrowserRouter, cổng phiên
├── features/auth/                       # RegisterPage, LoginPage, VerifyEmailPage, ForgotPasswordPage,
│                                        # ResetPasswordPage, SecuritySettingsPage, StaffLoginPage, PasswordField
└── lib/api-client.ts                    # credentials same-origin, xử lý 401/EMAIL_NOT_VERIFIED

packages/shared/src/
├── core/error-response.ts               # + mã lỗi, ErrorAction.kind mới
└── auth/                                # lược đồ Zod đầu vào, PERMISSIONS (dữ liệu thuần), MeResponse

tooling/boundaries/build-rules.cjs       # + auth-tx-restricted, account-scope-restricted; thu hẹp bind-account-restricted
tooling/verify.mjs                       # + mẫu quét bí mật
docker-compose.yml                       # + mailpit (dev); package.json gốc: db:up bật cả mailpit
.specify/memory/architecture.md          # v1.3: T7 cụ thể, thuật ngữ mới, mục API/xác thực
```

**Structure Decision**: Lõi `core/auth` chứa những gì mọi module cần (khai báo truy cập, guard, danh mục
quyền, người gọi). Như vậy guard chạy được trên mọi controller mà module nghiệp vụ không phải phụ thuộc
module `account`, vốn chỉ có `allowedDeps: ["queue"]` trong tệp kê khai. Mọi thứ đụng tới dữ liệu danh
tính nằm trong `modules/account/internal/auth`. `core/mail` đặt ở lõi để module Thông báo dùng lại
sau. Lệnh vận hành `src/ops/*` biên dịch vào cùng ảnh container, như `src/db/*` của 002.

## Phạm vi giao cho đầu việc sau

| Nội dung | Đầu việc |
|---|---|
| Gửi thư qua hàng chờ `notify` (tạo việc trong cùng giao dịch); việc định kỳ dọn `sessions`/`auth_tokens`/`auth_throttle` hết hạn | Khi 003 có mã / module Thông báo |
| Đăng nhập Google/Facebook bằng `arctic`; liên kết nhiều cách đăng nhập kèm xác nhận khi trùng email | WBS 2.1 (Facebook cơ bản), 4.4 – FR-15 |
| Mời/gỡ cộng tác viên cho người dùng cuối (màn hình + email mời) – dùng `members.service` | WBS 4.4 |
| Bước xác thực thứ hai (TOTP) cho nhân viên (`staff_sessions.assurance`) | **Trước ra mắt**, cùng WBS 5.3 |
| Quản lý nhân viên qua API/màn hình cho `admin`; khung nhìn hỗ trợ thật | FR-10 gốc, WBS 2.x |
| Gỡ cộng tác viên có hiệu lực tức thì trên mọi bản (thay bộ nhớ đệm 60 giây bằng tín hiệu xóa) | Khi cần – xem lại điều kiện ở Kiến trúc dữ liệu mục 8 |

## Complexity Tracking

| Điểm lệch / đánh đổi | Vì sao cần | Phương án đơn giản hơn bị loại vì |
|---|---|---|
| 4 hàm `SECURITY DEFINER` đọc/ghi bảng tenant mà không có ngữ cảnh tenant (`auth_register`, `auth_lookup_email`, `auth_resolve_session`, `auth_find_token`) | Đăng ký, đăng nhập và tra phiên xảy ra trước khi biết tenant. `app` không được vượt RLS, và không được INSERT `accounts` (002) | Bảng danh tính `shared`: `app` đọc được email của mọi khách hàng, trái nguyên tắc I. Mã phiên chứa mã tài khoản: lấy tenant từ dữ liệu chưa xác minh, và không giải được đăng nhập bằng email. Bù lại: mỗi hàm trả cột tối thiểu, `search_path` cố định, chỉ `app` có `EXECUTE`, có kiểm thử riêng (data-model mục 4) |
| `authTx` – giao dịch bể `app` không có tenant, ở API | Ghi bảng `shared` của xác thực và `infra.audit_log` khi chưa có tenant; 002 chỉ có `systemTx` ở Worker | Dùng bể `system` ở API: quyền rộng hơn nhiều. Bù lại: quy tắc `auth-tx-restricted`, và bộ gác truy vấn của 002 vẫn chặn bảng tenant |
| Bộ nhớ đệm phiên + vai trò 60 giây | Không phải tra CSDL ở mọi yêu cầu (SC-002) | Không cache thì thêm một truy vấn CSDL mỗi yêu cầu; vẫn đạt được nhưng tốn kết nối. Kiến trúc dữ liệu mục 8 đã chấp nhận độ trễ ≤ 60 giây |
| Gửi thư trong tiến trình (chưa qua hàng chờ bền vững) – nguyên tắc V | `dev` chưa có mã hàng chờ (003); spec cho phép gửi trực tiếp | Chờ 003: chặn tính năng nền móng này. Bù lại: gửi sau khi giao dịch xác nhận, có "Gửi lại thư" (giới hạn), ghi `mail.send_failed`; đổi sang `notify` đã ghi ở Phạm vi giao cho đầu việc sau |
| Một chỉ mục duy nhất **toàn cục** trên mỗi bảng `users`, `login_identities`, `sessions`, `auth_tokens` (không bắt đầu bằng `account_id`) | Email, mã phiên và mã một lần phải duy nhất trên mọi tài khoản và tra được trước khi biết tenant | Duy nhất theo tài khoản không chống được email trùng giữa các tài khoản. Đã ghi lý do trong `indexExceptions` (quy tắc `d`) |
