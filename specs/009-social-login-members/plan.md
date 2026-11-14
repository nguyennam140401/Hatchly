# Implementation Plan: Tài khoản & đăng nhập đầy đủ – Google / Facebook, liên kết cách đăng nhập, mời / gỡ cộng tác viên

**Branch**: `impl/009-social-login-members` | **Date**: 2026-11-13 | **Spec**: [spec.md](spec.md)

**Input**: Feature specification from `specs/009-social-login-members/spec.md`

## Summary

Hoàn thiện FR-15 cho người dùng khách hàng (WBS T1) trên nền 004: đăng nhập Google/Facebook, tự quản lý
nhiều cách đăng nhập, xác nhận trước khi liên kết khi trùng email, chủ tài khoản mời/gỡ cộng tác viên,
xử lý thông báo gỡ ứng dụng của Meta và xóa người dùng không thuộc tài khoản nào sau 90 ngày.

Cách làm ([research.md](research.md)):

- **Giao thức đăng nhập** qua `arctic`, bọc sau `IdentityProvider`, có bản giả lập cho dev/test (R1, R12).
  Không lưu mã quyền của lượt đăng nhập (R2).
- **Độ tin của email**: Google theo `email_verified`; Facebook: có trả email thì coi là đã xác minh (R3).
  Email đã xác minh trùng người dùng → màn hình xác nhận; email chưa xác minh/tự nhập (Facebook không
  trả email) → luôn "Hãy kiểm tra email", không lộ email đã đăng ký (R4).
- **Một bảng dùng chung `oauth_flows`** cho lượt đi – về và phần chờ xác nhận, gắn trình duyệt bằng cookie
  `__Host-oauth`, chuyển giai đoạn bằng cập nhật có điều kiện (R5).
- **Người không thuộc tài khoản nào = chủ một "tài khoản chờ"** (`accounts.status = 'unclaimed'`): giữ
  nguyên mọi cơ chế tenant của 004; lớp chặn quyền từ chối mặc định với cờ `allowDetached` (R6, R7). Tên
  người tạo giữ ở `former_members` (R8).
- **Chỗ cộng tác viên**: ghế trên lời mời + khóa theo tài khoản + chỉ mục duy nhất (R9); chấp nhận lời
  mời là một hàm `SECURITY DEFINER` nguyên vẹn (R10).
- **Thư**: thư có mã gửi như 004; thư không mã đi hàng chờ `notify` trong cùng giao dịch (R16). Hai việc
  định kỳ: xóa người ở tài khoản chờ quá hạn, dọn lời mời/lượt hết hạn (R18).

## Technical Context

**Language/Version**: TypeScript 5.9 (strict), Node.js 24 LTS – như 001–006

**Primary Dependencies**: có sẵn – NestJS 11, Drizzle 0.45, `pg`, pg-boss 12.38.0, Zod 4, `@node-rs/argon2`
2.2.2, `nodemailer` 10.4.0, React 19, Vite 8, `react-router` 8.5.1. **Mới**: `arctic` (khóa phiên bản
chính xác; bọc sau `IdentityProvider`). Không thêm gói nào khác (kiểm `signed_request` bằng `node:crypto`).

**Storage**: PostgreSQL, schema `account`: 2 bảng tenant mới (`invitations`, `former_members`), 2 bảng
dùng chung mới (`oauth_flows`, `meta_deletion_requests`), cột mới trên 3 bảng, mở rộng 3 `CHECK`, 8 hàm
`SECURITY DEFINER` cho `app` và 3 cho `system` ([data-model.md](data-model.md))

**Testing**: Vitest – đơn vị (`pnpm test`); tích hợp CSDL thật (`pnpm test:db`); e2e API bằng supertest
với `OAUTH_DRIVER=fake`, `MAIL_TRANSPORT=memory`; bộ thử hàng chờ của 003; web bằng Testing Library +
`vitest-axe`

**Target Platform**: Container Linux trên Kubernetes (API + Worker); SPA cùng site với API qua `/api`. API
cần đường ra tới `accounts.google.com`, `oauth2.googleapis.com`, `graph.facebook.com`

**Project Type**: Web application – monorepo `apps/server`, `apps/web`, `packages/shared`, `tooling`

**Performance Goals**: đăng nhập lại bằng nhà cung cấp ≤ 5 giây p95 kể từ lúc quay về (SC-002; phần của hệ
thống ≤ 500 ms + một lần gọi nhà cung cấp, hết chờ 10 giây); gửi lời mời ≤ 1 giây phía máy chủ; thông
báo Meta xử lý trong yêu cầu (SC-010 ≤ 1 phút); gỡ có hiệu lực ≤ 60 giây (bộ nhớ đệm phiên của 004)

**Constraints**:
- Không vai trò CSDL nào vượt RLS; mã tài khoản chỉ từ phiên đã xác minh hoặc từ kết quả hàm
  `SECURITY DEFINER`.
- Không tự liên kết theo email; không lộ email đã đăng ký ở đường nhập email tự do và ở màn hình mời.
- Không lưu mã quyền của nhà cung cấp; mã một lần chỉ lưu dạng băm; không bí mật trong nhật ký, dữ liệu
  việc hay chuỗi truy vấn được ghi lại.
- Migration chỉ thêm, ngoại trừ bỏ khóa ngoại `memberships.user_id → users.id` (tương thích ngược – xem
  Theo dõi độ phức tạp); không thêm hạ tầng chạy thật.
- Xoay phiên (`claim`, `accept-existing`) không làm mới mốc xác nhận lại danh tính (FR-012, R11).

**Scale/Scope**: 3.000 tài khoản × ≤ 3 người (thiết kế cho gấp 10 lần); 25 điểm cuối mới + 9 điểm cuối
của 004 được chỉnh; 3 loại việc nền; 7 trang web mới; 2 migration; 17 mã lỗi mới

Không còn NEEDS CLARIFICATION. Điểm spec giao cho plan đã chốt: tín hiệu email đã xác minh (R3), tên định
danh của các thực thể mới (research – bảng thuật ngữ), đường truy cập trước khi biết tenant (R5, R10).

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Nguyên tắc | Áp dụng vào tính năng | Đánh giá |
|---|---|---|
| I. Cô lập tenant | `invitations`, `former_members` là `tenantTable` (RLS, có trong kiểm thử truy cập chéo). Người bị gỡ được chuyển hẳn sang tài khoản chờ riêng nên không còn chạy trong ngữ cảnh tenant cũ (R6); guard từ chối mặc định với `detached`. Mã tài khoản ở `/members/*` chỉ từ phiên; `{id}` của tenant khác → 404 nhờ RLS. `member_detach` lấy tài khoản từ `account.current_account_id()`, không nhận tham số. Bước trước tenant đi qua hàm `SECURITY DEFINER` hẹp + `authTx` như 004 | ✅ Đạt – xem Theo dõi độ phức tạp (hàm mới, bảng dùng chung `oauth_flows`) |
| II. Đăng bài tin cậy | Không chạm luồng đăng. Gỡ cộng tác viên không đổi bài, lượt đăng hay việc nền của tài khoản (FR-026) | ✅ Không áp dụng trực tiếp |
| III. Cổng AI & ngân sách | Không gọi AI; thư và màn hình mới không có số tiền | ✅ Đạt |
| IV. Modular monolith | Mọi bảng ở schema `account`, mã ở `modules/account/internal`. `account` chỉ phụ thuộc `queue` (tệp kê khai không đổi). Tên cửa hàng lấy qua cổng đảo phụ thuộc `ACCOUNT_LABEL_RESOLVER` ở lõi, `context` cung cấp (R17). `former_members.user_id` là mã tham chiếu, không khóa ngoại | ✅ Đạt |
| V. Việc nền bền vững | Thư không mã → việc `account.mail_notice` (hàng chờ `notify`) tạo trong cùng giao dịch. Hai việc định kỳ chạy lại an toàn (điều kiện kiểm trong CSDL, cập nhật có điều kiện, khóa chống trùng). Thư **có mã** và thư "bạn đã bị gỡ" vẫn gửi trong tiến trình | ⚠️ Đạt có điều kiện – xem Theo dõi độ phức tạp |
| VI. Con người quyết định | `members.manage` kiểm ở API; cộng tác viên bị từ chối cả màn hình lẫn API. Thông điệp tiếng Việt đời thường, mỗi lỗi có hành động; mã gốc của nhà cung cấp chỉ ở `support.detail`. 7 trang mới đạt WCAG 2.1 AA, 360 px, vùng chạm ≥ 44 px, trạng thái bằng chữ + biểu tượng. Sự cố nhà cung cấp không chặn đăng nhập bằng email | ✅ Đạt |
| VII. Bí mật & dữ liệu cá nhân | Giao thức do `arctic` đảm nhận; kiểm chữ ký Meta bằng hàm chuẩn `node:crypto`. Không tự gộp: trùng email luôn qua mật khẩu hoặc liên kết email (R4). Chỉ lưu mã người dùng, email, tên phía nhà cung cấp; bỏ mã quyền ngay. Mã một lần lưu dạng băm, nằm ở `#fragment`. Ô đồng ý không đặt sẵn. Vòng đời: người ở tài khoản chờ 90 ngày (báo trước 7), `former_members` 12 tháng, `oauth_flows` ≤ 24 giờ. Google, Meta ghi vào danh sách chuyển dữ liệu xuyên biên giới (FR-032) | ✅ Đạt |
| VIII. Quan sát được | 19 hành động kiểm toán (data-model mục 7), metadata không có dữ liệu cá nhân. Nhật ký có cấu trúc kèm `trace_id`; không ghi chuỗi truy vấn của `/auth/oauth/*` (R19). Chỉ số + cảnh báo tỷ lệ lỗi theo nhà cung cấp | ✅ Đạt |
| IX. Đơn giản, chuẩn mở | Một gói mới (`arctic`), khóa phiên bản, bọc sau giao diện nội bộ; OAuth 2.0/OIDC là chuẩn mở. Không thêm dịch vụ. `arctic` đã nằm trong T7 (004) nên không cần ADR mới | ✅ Đạt |

**Quy ước dữ liệu**: UUID v7 sinh ở ứng dụng (kể cả mã truyền vào hàm) ✅ · `timestamptz` UTC ✅ · không có
tiền ✅ · chuyển trạng thái (lời mời, giai đoạn lượt, ghế, nhận tài khoản) bằng cập nhật có điều kiện +
chỉ mục duy nhất làm chốt chặn ✅ · không cache gì mới ngoài phiên 60 giây đã chấp nhận ✅.

**Quy trình**: migration `0014`, `0015` chỉ thêm, hàm tra phiên cũ được giữ (R20) ✅ · cổng CI 1 (truy cập
chéo có bảng mới), 2 (`db:check`), 3 (ranh giới – không quy tắc mới), 5 (quét bí mật thêm mẫu) ✅ · kiểm thử
"chạy lại hai lần" cho 3 loại việc ✅.

**Kiểm tra lại sau Phase 1** (data-model, contracts): mọi bảng có `account_id` là `tenantTable` ✅ · bảng
dùng chung không có cột tên `account_id` (`oauth_flows.target_tenant_id`) và chỉ truy cập qua `authTx` ✅
· hàm `SECURITY DEFINER` có `search_path` cố định, quyền tối thiểu (`app` hoặc `system`, không cả hai) ✅ ·
không điểm cuối nào nhận mã tài khoản ✅ · phản hồi mời và phản hồi nhập email không phân biệt email đã có
hay chưa ✅ · dữ liệu việc không có email, tên, mã ✅ · `support` không có quyền mới ✅. **Đạt.**

**Checklist kiến trúc** (`architecture.md` mục 13): module + giao diện công khai ✅ · bảng mới có
`account_id` + RLS + truy cập chéo ✅ · việc nền qua hàng chờ đúng loại, chạy lại an toàn, tạo cùng giao
dịch ✅ (ngoại lệ thư có mã) · AI – không có · chuyển trạng thái có điều kiện ✅ · không thêm hạ tầng ✅ ·
`trace_id`, không ghi bí mật, có chỉ số ✅ · migration tương thích ngược ✅.

## Điều chỉnh spec (đã được chủ sản phẩm xác nhận 2026-11-14, đã sửa `spec.md`)

| Mục spec | Điều chỉnh | Lý do |
|---|---|---|
| FR-004, US1 kịch bản 1, SC-001 | Email **Facebook có trả về** được coi là đã xác minh như email Google đã xác minh: người mới vào ngay sau 3 thao tác. Lựa chọn "Facebook luôn chưa xác minh" trước đó đã bị thay | R3: chủ sản phẩm chốt; Facebook chỉ trả email đã xác nhận; trùng email vẫn không tự liên kết |
| US2 kịch bản 1 | Màn hình "Email này đã có tài khoản" với hai lựa chọn hiện khi email do Google xác minh **hoặc do Facebook trả về** | R4 |
| US1 kịch bản 4, FR-010a | Khi email do người dùng **tự nhập** (Facebook không trả email, Google chưa xác minh): luôn "Hãy kiểm tra email"; trùng người dùng đã có thì gửi thư xác nhận liên kết, màn hình giống hệt trường hợp email mới | R4: nếu báo trùng cho email chưa chứng minh thì ai cũng dò được email nào đã đăng ký (trái FR-008b của 004) |
| Key Entities | "Lượt đăng nhập qua nhà cung cấp" và "Yêu cầu xác nhận liên kết" là một bảng `oauth_flows`; thêm "Thành viên cũ" (`former_members`); "người không thuộc tài khoản nào" là chủ một tài khoản chờ | R5, R6, R8 – không đổi hành vi nhìn từ người dùng |

Ba dòng đầu đã ghi vào `spec.md`: Clarifications (câu thứ 6, 7), US1 kịch bản 1 và 4, US2 kịch bản 1,
FR-004, FR-010, FR-010a, SC-001, Assumptions. Việc phải làm trước khi phát hành: kiểm giả định "Facebook
chỉ trả email đã xác nhận" với tài liệu Meta và tài khoản thử (quickstart mục 3). Dòng cuối là cách hiện thực, spec giữ nguyên
tên thực thể nghiệp vụ.

## Project Structure

### Documentation (this feature)

```text
specs/009-social-login-members/
├── plan.md              # Tệp này
├── research.md          # R1–R20 + thuật ngữ mới
├── data-model.md        # bảng, hàm SECURITY DEFINER, kiểm toán, migration, dữ liệu cá nhân
├── quickstart.md        # kịch bản kiểm chứng A–H
├── contracts/
│   ├── auth-http-api.md # 25 điểm cuối mới, thay đổi của 004, mã lỗi, cookie
│   └── module-api.md    # core/auth, AccountPublicApi, IdentityProvider, việc nền, thư, cấu hình
├── checklists/requirements.md
└── tasks.md             # Phase 2 (/speckit-tasks) – T001–T094
```

### Source Code (repository root)

```text
apps/server/
├── package.json                          # + arctic (khóa phiên bản)
├── .env.example                          # + biến ở contracts/module-api.md mục 6
├── drizzle/migrations/
│   ├── 0014_account_social_members_tables.sql     # sinh
│   └── 0015_account_social_members_functions.sql  # tay
├── docs/auth.md                          # + đăng nhập nhà cung cấp, tài khoản chờ, allowDetached
├── src/
│   ├── core/
│   │   ├── auth/
│   │   │   ├── access.decorators.ts      # + allowDetached
│   │   │   ├── access.guard.ts           # + chặn detached (NO_ACCOUNT)
│   │   │   ├── origin-check.middleware.ts# + danh sách miễn cho 2 điểm cuối Meta
│   │   │   ├── account-label.ts          # MỚI: ACCOUNT_LABEL_RESOLVER
│   │   │   └── auth-errors.ts            # + NO_ACCOUNT
│   │   ├── context/actor.types.ts        # CustomerActor.detached
│   │   ├── db/tenant-root.ts             # accounts.status + 'unclaimed'
│   │   ├── config/                       # + biến OAuth, lời mời, tài khoản chờ
│   │   └── logging/                      # che code/state/signed_request; bỏ chuỗi truy vấn /auth/oauth/*
│   ├── modules/account/
│   │   ├── account.module.ts             # + controller, provider, đăng ký việc
│   │   ├── jobs.ts                       # MỚI: account.mail_notice, account.detached_users, account.auth_housekeeping
│   │   ├── public-api.ts                 # describeMembers gồm former_members
│   │   └── internal/
│   │       ├── db/schema.ts              # + invitations, former_members, oauth_flows, meta_deletion_requests, cột mới
│   │       ├── members/describe-members.ts
│   │       └── auth/
│   │           ├── oauth/
│   │           │   ├── identity-provider.ts   # giao diện + ProviderProfile
│   │           │   ├── arctic.providers.ts    # Google, Facebook
│   │           │   ├── fake.provider.ts       # + fake-authorize.controller.ts (chỉ fake)
│   │           │   ├── oauth-flow.service.ts  # máy trạng thái oauth_flows
│   │           │   ├── oauth-login.service.ts # đăng nhập, đăng ký, xác nhận liên kết
│   │           │   └── oauth.controller.ts
│   │           ├── login-methods.service.ts   # liệt kê, liên kết, gỡ, reauth
│   │           ├── login-methods.controller.ts
│   │           ├── invitations.service.ts     # mời, gửi lại, hủy, xem trước, chấp nhận
│   │           ├── invitations.controller.ts  # /invitations/*
│   │           ├── members.service.ts         # gỡ qua member_detach; khóa ghế
│   │           ├── members.controller.ts      # /members/*
│   │           ├── account-claim.service.ts   # /account/claim
│   │           ├── meta-callbacks.service.ts  # signed_request, gỡ danh tính
│   │           ├── meta-callbacks.controller.ts
│   │           ├── detached-users.handler.ts  # việc định kỳ (Worker)
│   │           ├── housekeeping.handler.ts
│   │           ├── mail-notice.handler.ts
│   │           ├── session.service.ts         # auth_resolve_session_v2; đăng nhập ở tài khoản chờ
│   │           ├── password-reset.service.ts  # forgot/reset cho người chưa có mật khẩu
│   │           ├── me.ts                      # status 'unclaimed', permissions rỗng
│   │           ├── throttle.service.ts        # + 4 loại bộ đếm
│   │           └── mail/templates.ts          # + 10 mẫu thư
│   ├── modules/context/                  # cung cấp ACCOUNT_LABEL_RESOLVER
│   └── ops/seed-auth.ts                  # + cộng tác viên, lời mời, người ở tài khoản chờ
└── test/
    ├── auth/                             # oauth-login, oauth-link-confirm, login-methods, members-invite,
    │                                     # members-remove, no-account, meta-callbacks (+ access-matrix, secrets)
    ├── db/                               # social-functions, invitations-isolation, seats-concurrency,
    │                                     # last-identity-concurrency
    ├── queue/                            # 3 bộ xử lý: chạy lại hai lần
    └── support/make-signed-request.ts

apps/web/src/
├── app/router.tsx                        # + route mới; SessionGate chuyển unclaimed → /no-account
├── features/auth/
│   ├── ProviderButtons.tsx               # dùng ở LoginPage, RegisterPage, JoinPage
│   ├── ConsentNotice.tsx                 # lời đồng ý nêu Google, Meta (FR-032)
│   ├── OAuthResultPage.tsx               # đồng ý tạo tài khoản / nhập email / xác nhận trùng / lỗi
│   ├── OAuthConfirmPage.tsx              # liên kết trong thư
│   ├── LoginMethodsPage.tsx              # Cài đặt → Cách đăng nhập (+ hộp xác nhận lại danh tính)
│   ├── NoAccountPage.tsx
│   └── DataDeletionStatusPage.tsx
└── features/members/
    ├── MembersPage.tsx                   # Cài đặt → Thành viên (chỉ chủ)
    └── JoinPage.tsx                      # tham gia từ lời mời

packages/shared/src/
├── core/error-response.ts                # + 17 mã lỗi, ErrorAction.kind 'reauth'
└── auth/                                 # lược đồ Zod mới, MeResponse, OAuthPendingResponse, MembersResponse

tooling/scan-secrets.mjs                  # + mẫu quét bí mật
ops/alerts/auth.rules.yml                 # MỚI: cảnh báo tỷ lệ lỗi theo nhà cung cấp
.specify/memory/architecture.md           # v1.5: bảng/thuật ngữ mới, tài khoản chờ, việc định kỳ, Google/Meta
```

**Structure Decision**: giữ bố cục của 004 – mọi thứ đụng dữ liệu danh tính nằm trong
`modules/account/internal/auth`, thêm thư mục con `oauth/` cho phần nhà cung cấp. Lõi chỉ nhận ba thay
đổi nhỏ mà mọi module đều hưởng (cờ `allowDetached`, `CustomerActor.detached`, cổng nhãn tài khoản). Web
thêm thư mục `features/members` vì Thành viên là màn hình của tài khoản, còn Cách đăng nhập là thiết lập
cá nhân nên ở `features/auth`.

## Thứ tự triển khai đề xuất (cho `/speckit-tasks`)

1. **Nền**: migration + hàm, `allowDetached`/`detached`, cấu hình, `IdentityProvider` + bản giả lập,
   `oauth_flows`, việc `account.mail_notice`.
2. **US1** (P1) đăng nhập/đăng ký qua nhà cung cấp → **US2** (P1) xác nhận trùng email.
3. **US3** (P1) mời + tham gia (độc lập với US1/US2 ở nhánh mật khẩu; nhánh Google/Facebook cần US1).
4. **US4** (P2) gỡ + tài khoản chờ + `/account/claim` + xóa sau 90 ngày.
5. **US5** (P2) Cách đăng nhập + xác nhận lại danh tính + tạo mật khẩu.
6. **FR-009a** thông báo Meta; hoàn thiện: kiểm toán, quét bí mật, WCAG, tài liệu, `architecture.md`.

## Phạm vi giao cho đầu việc sau

| Nội dung | Đầu việc |
|---|---|
| Thêm Google, Meta (đăng nhập) vào `TaiLieuDacTa/` Kiến trúc dữ liệu mục 9 và hồ sơ Q-D3; cập nhật trang chính sách quyền riêng tư | Chủ sản phẩm / P5 – trước ra mắt (`TaiLieuDacTa/` nằm ngoài git) |
| Đăng ký ứng dụng Google + Meta, địa chỉ quay về và hai địa chỉ nhận thông báo; bí mật vào kho bí mật | P5 + 007 |
| Ingress bỏ chuỗi truy vấn trong nhật ký truy cập cho `/api/v1/auth/oauth/*` | 007 / 008 |
| Bỏ hàm `auth_resolve_session` cũ | Lần phát hành kế tiếp |
| Chuyển thư có mã sang hàng chờ (cần cách giữ mã không ở dạng rõ) | Khi có nhu cầu – xem Theo dõi độ phức tạp |
| Xóa toàn bộ dữ liệu khi Meta yêu cầu; ẩn danh `former_members` theo yêu cầu | FR-14 |
| Tài khoản `unclaimed` phải bị bỏ qua ở việc mở chu kỳ / kiểm tra gói | Tính năng gói dịch vụ (FR-13) |

## Complexity Tracking

| Điểm lệch / đánh đổi | Vì sao cần | Phương án đơn giản hơn bị loại vì |
|---|---|---|
| Thêm 8 hàm `SECURITY DEFINER` cho `app` và 3 cho `system` | Tra danh tính, đăng ký qua nhà cung cấp, tra/chấp nhận lời mời xảy ra trước khi biết tenant; gỡ và chấp nhận phải **chuyển người dùng giữa hai tenant** trong một thao tác nguyên vẹn; `app`/`system` không được INSERT/DELETE `accounts` và không vượt RLS | Nhiều câu lệnh rời trong `tenantTx`: không nguyên vẹn và không chuyển được dòng giữa hai tenant dưới RLS. Bù lại: mỗi hàm trả cột tối thiểu, tự kiểm điều kiện, `search_path` cố định, cấp cho đúng một vai trò, có bộ kiểm thử riêng |
| Trạng thái `unclaimed` trên bảng gốc `accounts` (tài khoản không phải khách hàng thật) | Giữ `users.account_id NOT NULL` và mọi cơ chế tenant của 004 cho người không thuộc tài khoản nào | `account_id` NULL hoặc để người dùng lại tenant cũ (R6): phá khuôn bảng tenant hoặc cho người bị gỡ chạy trong ngữ cảnh tenant cũ. Bù lại: guard từ chối mặc định; báo cáo đếm tài khoản phải lọc `unclaimed` |
| Bảng dùng chung `oauth_flows` chứa email/mã nhà cung cấp của lượt đang chờ | Trước tenant; liên kết trong thư phải mở được ở thiết bị khác | Cookie mã hóa (tự làm mật mã) hoặc bảng tenant + thêm hàm tra. Bù lại: ≤ 24 giờ, chỉ qua `authTx`, có việc dọn |
| Thư có mã một lần và thư "bạn đã bị gỡ" gửi trong tiến trình, không qua hàng chờ bền vững (nguyên tắc V) | Dữ liệu việc cấm chứa bí mật; người bị gỡ đã rời tenant của giao dịch nên không tạo được việc cùng giao dịch | Đưa mã rõ vào dữ liệu việc (trái FR-030). Bù lại: gửi sau khi giao dịch xác nhận, có "Gửi lại" cho mọi thư có mã, ghi `mail.send_failed`; thư gỡ chỉ là thông báo, quyền đã bị thu hồi bất kể thư |
| Bỏ khóa ngoại `memberships.user_id → users.id` của 004 (duy nhất một `DROP CONSTRAINT` trong migration) | Sau khi gỡ, `users` sang tài khoản chờ còn dòng `removed` ở tài khoản cũ; khóa ngoại `ON DELETE CASCADE` sẽ xóa dòng đó ở tenant khác khi người dùng bị xóa sau 90 ngày, mất dấu truy vết (chủ sản phẩm chốt 2026-11-14) | Chấp nhận xóa dây chuyền và chỉ dựa `former_members`: mất dòng `removed` mà spec nói giữ lại. Bù lại: `user_id` vẫn `NOT NULL`, mọi ghi vào `memberships` đi qua hàm/dịch vụ của module `account`; tương thích ngược khi phát hành |
| Khóa tư vấn theo tài khoản cho thao tác đổi ghế | Hai chỉ mục duy nhất ở hai bảng không tự loại trừ nhau (R9) | Chỉ dựa chỉ mục: vẫn có khe vượt 2 chỗ khi mời và chấp nhận đan xen. Khóa chỉ giữ trong giao dịch ngắn, theo từng tài khoản |
| Hai điểm cuối Meta miễn kiểm tra nguồn gửi (CSRF) | Máy chủ Meta gọi, không có `Origin` | Không có. Bù lại: danh sách miễn cố định trong mã, bắt buộc chữ ký HMAC hợp lệ, không dùng cookie |
| Tin email Facebook dù không có cờ "đã xác minh" | R3 – chủ sản phẩm chốt; người dùng mục tiêu chủ yếu vào bằng Facebook, thêm bước mở thư làm rớt người mới | Luôn xác minh qua thư: an toàn hơn nhưng chậm hơn một bước. Bù lại: trùng email không bao giờ tự liên kết; độ tin nằm ở một chỗ (`ProviderProfile.emailVerified`) nên đổi lại chỉ sửa một dòng; kiểm giả định trước khi phát hành |
