# Implementation Plan: Kết nối kênh Facebook Page + Instagram + TikTok

**Branch**: `impl/010-connect-facebook-instagram` | **Date**: 2026-11-17 | **Spec**: [spec.md](./spec.md)

**Input**: Đặc tả `specs/010-connect-facebook-instagram/spec.md` (đã qua `/speckit-clarify` phiên 2026-11-15).

> **Lưu ý nền (quan trọng):** nhánh `impl/010-…` đang dừng ở commit `9d541c9` (trước khi 011–014 vào `dev`). Kế hoạch này
> được viết **theo trạng thái của `dev` @ `1f983dc`** (có 012 soạn/duyệt/lịch, 013 đăng 5 bước + bộ chuyển đổi Meta,
> 011 khung web). `before_implement` sẽ chạy `/speckit-worktree-sync` để merge `dev` vào worktree trước khi viết mã;
> các điểm tiếp giáp với 012/013 ghi ở mục "Ranh giới với các tính năng khác".

## Summary

Biến luồng kết nối kênh **giả lập** của 005 thành luồng **thật** cho Facebook Page, Instagram chuyên nghiệp và (sau công tắc)
TikTok, nằm trọn trong module `platform_gateway`:

1. **OAuth thật + chọn nhiều Page/tài khoản** – `authorizeUrl`/`exchangeCallback` của bộ chuyển đổi Meta và TikTok (gọi API bằng
   `fetch` của Node, không SDK ngoài – cùng quyết định 013 R9), phiên kết nối một lần/10 phút, kiểm tra điều kiện từng ứng viên,
   giới hạn **5 kết nối/nền tảng** (cấu hình), một Page chỉ thuộc một tài khoản.
2. **Kho mã quyền mã hóa thật** – `KmsCredentialVault` (mã hóa phong bì: khóa dữ liệu AES-256-GCM theo từng bản ghi, bọc bằng khóa
   KMS; AAD gắn `account_id`+`connection_id`) thay `FakeCredentialVault`; chỉ `platform_gateway` giải mã.
3. **Bảng thật `platform_gateway.channel_connections`** (+ phiên kết nối, ghi đè công tắc, cấu hình dùng chung) có RLS, khóa lạc
   quan `version`, chỉ mục duy nhất toàn cục "một Page – một tài khoản".
4. **Vòng đời quyền** – ngày hết hạn, việc nền hằng ngày làm mới/kiểm tra từng kết nối (idempotent, đúng ngữ cảnh tenant), nhắc < 7
   ngày/1 ngày/hết hạn (gom thông báo), trạng thái "Cần kết nối lại", kết nối lại giữ nguyên mã kênh, ngắt = xóa mã quyền ngay +
   thu hồi phía nền tảng, Instagram phụ thuộc Page nguồn (FR-042), gói hết hạn dừng gọi nền tảng (FR-033).
5. **Công tắc TikTok theo khách hàng** – cấu hình mặc định (tắt) + ghi đè theo tài khoản, hiệu lực ≤ 1 phút không cần phát hành,
   chặn ở API **và** Worker, chỉ quản trị nội bộ đổi (`feature.manage`), mỗi lần đổi có bản ghi kiểm toán.
6. **Màn hình "Kênh kết nối"** (web) thay trang `comingSoon` ở `/channels`: thẻ theo nền tảng, lọc, cảnh báo đầu trang, chọn
   Page, hộp xác nhận ngắt, chỉ-xem cho cộng tác viên; mã quyền mới `channel.view`.

Bốn điểm kỹ thuật cốt lõi (chi tiết ở [research.md](./research.md)):

- **Tương thích ngược với 012/013**: `ChannelConnection.status` công khai **giữ nguyên 4 giá trị** (`active|expiring|expired|disconnected`);
  trạng thái phong phú (6 giá trị của FR-025) là trường **mới** `state` + `reasonCode`. Mọi trạng thái không dùng được ánh xạ về
  `expired`/`disconnected` để 013 `precheck` không bao giờ đăng bằng quyền hỏng (R3).
- **Trạng thái dẫn xuất** cho hai phụ thuộc: Instagram ← Page nguồn, TikTok ← công tắc. Không ghi trạng thái "phụ" vào CSDL, nên
  bật/tắt công tắc hiệu lực ≤ 1 phút và Page phục hồi thì Instagram tự về đúng (R4).
- **Cổng ngược (port) thay vì phụ thuộc vòng**: `platform_gateway` không import `publishing`; `publishing` đăng ký một
  `ConnectionConsumersPort` (đếm bài đã lên lịch, hủy lượt khi ngắt, nạp bảng ánh xạ lỗi) vào cổng lúc khởi động (R7).
- **Dữ liệu mới của Meta chưa kiểm chứng** (hạn token Page, `data_access_expires_at`, quyền tối thiểu) được thiết kế là
  **cấu hình + khả năng khai báo** (`tokenRefresh`, `expiry: none|token|data_access`), không cứng trong luồng; POC-2/App Review
  chốt số thật (R1, R2).

## Technical Context

**Language/Version**: TypeScript (Node.js ≥ 24 theo `package.json`), NestJS, React + Vite — đúng ngăn xếp đã chốt.

**Primary Dependencies**: NestJS, Drizzle ORM, pg-boss (chỉ qua module `queue`), zod, `@app/shared`; **không thêm thư viện mới**:
gọi Meta Graph và TikTok Open API bằng `fetch` có sẵn (bọc trong `GraphClient`/`TiktokClient`, phiên bản API cố định bằng cấu hình);
mã hóa bằng `node:crypto` (AES-256-GCM) + giao diện `KeyWrapper` mỏng cho KMS (R2). `arctic` (đã cài ở 009) **không** dùng cho kết
nối kênh vì cần quyền Page riêng và đi vòng riêng (R1).

**Storage**: PostgreSQL – schema `platform_gateway` (6 bảng mới: 5 bảng tenant `channel_connections`, `connect_states`, `connect_selections`,
`feature_overrides`, `feature_override_events` + 1 bảng dùng chung `gateway_settings`); KMS để bọc khóa dữ liệu; không cache mã quyền
và trạng thái quyền (Hiến pháp). Cache trong tiến trình ≤ 60 giây **chỉ** cho công tắc/cấu hình (Assumptions của spec).

**Testing**: Vitest (`pnpm test`, `pnpm test:db`, `pnpm test:queue`), kiểm thử hợp đồng bộ chuyển đổi dùng chung với 013
(`adapter-contract.spec.ts`) cho `FacebookAdapter`, `InstagramAdapter`, `TiktokAdapter`, `FakeAdapter`; máy chủ Graph/TikTok giả
(`graph-stub` mở rộng OAuth, `me/accounts`, `debug_token`); Playwright (011) cho màn hình ở 360/768/1280 px + trợ năng;
kiểm thử truy cập chéo bắt buộc cho mọi bảng mới; quét bí mật trên nhật ký mẫu (SC-003).

**Target Platform**: Linux container (api + worker cùng ảnh), K8s trên cloud Việt Nam; web tĩnh qua CDN; phản hồi ≤ 1 giây cho danh
sách kênh (đọc dữ liệu đã lưu, không gọi nền tảng).

**Project Type**: web-service + SPA (monorepo `apps/server`, `apps/web`, `packages/shared`).

**Performance Goals**: danh sách kênh ≤ 1 giây (SC-007); kiểm tra ngân sách/khóa không liên quan; việc hằng ngày xử lý
~ (số tài khoản × ≤ 15 kết nối) với giới hạn đồng thời theo tenant của hàng chờ; một "Kiểm tra lại" ≤ 10 giây (1 lời gọi nền tảng + 1 ghi).

**Constraints**: mã quyền không rời `platform_gateway`; không giữ giao dịch CSDL khi gọi nền tảng (đọc → gọi → ghi có `version`);
mọi trạng thái đổi bằng `UPDATE … WHERE version = :v`; kết nối lỗi của tạm thời không đổi trạng thái (FR-012); TikTok không bao giờ
được gọi khi công tắc tắt (kể cả Worker).

**Scale/Scope**: ≤ 5 kết nối × 3 nền tảng = 15/tài khoản; ~ vài nghìn tài khoản ban đầu → vài chục nghìn kết nối; 1 màn hình web
+ 1 trang chọn Page + 1 hộp thoại; 4 điểm cuối khách hàng mới (+ 4 điểm cuối của 005 được mở rộng) + 4 điểm cuối nhân viên; 4 loại việc nền.

## Kiểm tra hiến pháp (cổng trước Phase 0 – đã đạt; xem lại sau Phase 1 ở cuối tài liệu)

| # | Nguyên tắc | Kết luận | Cách tuân thủ trong kế hoạch |
|---|---|---|---|
| I | Cô lập tenant | **Đạt** | `account_id` luôn từ phiên (`requireCustomer`, `tenantTx`); 5 bảng tenant mới có `account_id NOT NULL` + RLS qua `tenantTable`; Worker đặt lại ngữ cảnh bằng `systemTx({tenant})`; chỉ mục duy nhất toàn cục `(channel_type, external_id)` là **ngoại lệ có lý do** của quy tắc "chỉ mục bắt đầu bằng `account_id`" (FR-006) – khai báo ở `indexExceptions`; 404 đồng nhất "không tồn tại / của người khác" (US4-4). Điểm cuối nhân viên nhận `accountId` ở đường dẫn (mẫu hỗ trợ của 004), có kiểm toán. |
| II | Đăng bài tin cậy | **Đạt (liên quan gián tiếp)** | Không đụng luồng đăng. Bảo vệ nó: trạng thái kênh hỏng luôn ra `status ∈ {expired, disconnected}` để `precheck` dừng; ngắt kết nối gọi `cancelAllForConnection` trong **cùng giao dịch**; không bao giờ "gửi lại" từ 010. |
| III | Cổng AI | **N/A** | Không có lời gọi AI. |
| IV | Modular monolith | **Đạt – cần sửa kê khai** | Chỉ ghi schema `platform_gateway`; thêm `account` vào `allowedDeps` của `platform_gateway` (đọc `getPublishingEligibility()` – FR-033); đảo phụ thuộc bằng `ConnectionConsumersPort` do `publishing` đăng ký (không import `publishing` từ `platform_gateway`). Khóa ngoại chỉ trong module (`source_connection_id` → `channel_connections.id`) và tới `accounts`. Sự kiện/thông báo ghi bằng `notifications.emit(tx, …)` cùng giao dịch. Ghi ở ADR-13. |
| V | Việc nền bền vững | **Đạt** | 3 loại việc qua `queue` (xem [contracts/jobs-and-notifications.md](./contracts/jobs-and-notifications.md)): mỗi việc có khóa chống trùng, chạy lại 2 lần cho cùng kết quả, mang `accountId` trong phong bì, giới hạn đồng thời theo tenant của hàng chờ `scheduled`. |
| VI | AI đề xuất, người quyết | **Đạt** | Quyền `channel.manage` kiểm ở API (chủ), `channel.view` cho CTV; thông điệp đời thường + ≥ 1 hành động khắc phục từ bảng lỗi; trạng thái chữ + biểu tượng; 360 px, vùng chạm ≥ 44 px. |
| VII | Bảo vệ bí mật | **Đạt – có điều kiện hạ tầng** | Mã hóa phong bì + KMS (K5); DTO dùng danh sách trường cho phép, không `select *`; `DecryptedCredential` có nhãn (đã có từ 005) chỉ trong adapter; không ghi mã quyền/`code` OAuth vào log, job, thông báo; cấp quyền tối thiểu, không xin quyền đọc người theo dõi (FR-002). **Điều kiện:** nếu KMS của VNG Cloud chưa sẵn sàng thì dùng `env-master-key` **chỉ ở staging**; production từ chối (R2, mục Theo dõi độ phức tạp). Meta đã có trong danh sách bên nhận nước ngoài; **TikTok là bên nhận mới ở nước ngoài → phải ghi vào danh sách chuyển dữ liệu xuyên biên giới (Kiến trúc dữ liệu mục 9)** – việc tài liệu, ghi ở tasks. |
| VIII | Quan sát | **Đạt** | `trace_id` + `account_id` trong log; chỉ số `channel.connections{state}`, `channel.expiring_lt7d`, `channel.refresh{result}`; cảnh báo "quyền còn < 7 ngày" dùng chung; kiểm toán mọi thao tác kênh qua `infra.audit_log` (không mã quyền). |
| IX | Đơn giản, chuẩn mở, có ADR | **Đạt – cần ADR** | Không thành phần mới (không Redis/broker); chỉ dùng OAuth 2.0 chuẩn mở + `fetch`. **ADR-13** (mới): (a) TikTok vào giai đoạn 1 ở dạng tắt – đảo ghi chú "giai đoạn sau" của ADR-05; (b) mã hóa phong bì + `KeyWrapper`; (c) thêm phụ thuộc `platform_gateway → account`. TikTok/KMS chưa kiểm chứng → bản giả + POC-2 (Hiến pháp IX: giả định chưa kiểm chứng phải qua POC trước khi *chốt*). |

**Kết quả cổng: ĐẠT**, không có vi phạm cần biện minh. Hai việc cần chủ sở hữu quyết (PO/SA) ghi ở mục "Câu hỏi mở".

## Project Structure

### Documentation (this feature)

```text
specs/010-connect-facebook-instagram/
├── plan.md              # Tài liệu này
├── research.md          # Phase 0 – 12 quyết định (R1…R12)
├── data-model.md        # Phase 1 – bảng, máy trạng thái, dẫn xuất, chỉ mục, RLS
├── quickstart.md        # Phase 1 – kịch bản kiểm chứng chạy được
├── contracts/
│   ├── channels-http-api.md          # điểm cuối khách hàng + nhân viên
│   ├── platform-gateway-public-api.md# thay đổi giao diện công khai (cộng thêm) + cổng ngược
│   ├── meta-tiktok-adapters.md       # OAuth, quyền, kiểm tra điều kiện, hết hạn, lỗi
│   ├── feature-flags.md              # công tắc TikTok
│   ├── jobs-and-notifications.md     # việc nền, thông báo, kiểm toán, chỉ số
│   └── web-ui.md                     # màn hình, trạng thái, trợ năng
├── checklists/requirements.md
└── tasks.md             # (do /speckit-tasks tạo – KHÔNG tạo ở bước này)
```

### Source Code (repository root)

```text
packages/shared/src/
├── auth/permissions.ts                         # + channel.view, feature.manage
└── modules/
    ├── platform_gateway/index.ts               # + tiktok, ChannelStateDto, overview/confirm/recheck/preview DTO, mã lỗi
    └── notifications/events.ts                 # + channel_needs_reconnect; mở rộng channel_token_expiring (stage, connectionIds)

apps/server/
├── drizzle/migrations/NNNN_platform_gateway_010_*.sql   # bảng, RLS, chỉ mục, hàm SECURITY DEFINER, dữ liệu gốc gateway_settings
├── docs/channels.md                            # hướng dẫn lập trình viên (liên kết từ gateways.md)
└── src/modules/platform_gateway/
    ├── public-api.ts                           # cộng thêm: tiktok, state/reasonCode, ConnectionConsumersPort, disconnectAll…
    ├── internal/
    │   ├── db/schema.ts                        # Drizzle: 6 bảng
    │   ├── vault/{kms-credential-vault.ts, key-wrapper.ts, env-master-key.wrapper.ts, kms.wrapper.ts}
    │   ├── connections/
    │   │   ├── pg-connection-store.ts          # ConnectionStore thật (thay bản sandbox khi driver=real)
    │   │   ├── connection-state.ts             # hàm THUẦN: state dẫn xuất (Page nguồn, công tắc, hạn, gói)
    │   │   ├── connections.service.ts          # mở rộng: nhiều Page, kết nối lại, kiểm tra lại, ngắt
    │   │   ├── connections.controller.ts       # + overview, confirm, recheck, disconnect-preview
    │   │   ├── limits.ts                       # giới hạn N/nền tảng (khóa tư vấn + đếm trong giao dịch)
    │   │   └── revoke.ts                       # thu hồi phía nền tảng, thời gian chờ 5 giây, không chặn xóa
    │   ├── features/
    │   │   ├── feature-gate.ts                 # isEnabled(account, key) – cache ≤ 60 s, lỗi → tắt
    │   │   ├── features.service.ts             # đổi cấu hình + sự kiện + kiểm toán
    │   │   └── staff-features.controller.ts    # @StaffAccess('feature.manage')
    │   ├── adapters/meta/                      # + authorize/exchange/checkAccount/refresh/revoke (013 đã có submit…)
    │   ├── adapters/tiktok/{tiktok.adapter.ts, tiktok-client.ts, tiktok-errors.ts}
    │   ├── maintenance/{jobs.ts, due-connections.ts, check-connection.handler.ts, cleanup.handler.ts, disconnect-all.handler.ts}
    │   └── fake/                               # + tiktok, kịch bản "2 Page", "IG cá nhân", "thu hồi"
    └── platform_gateway.module.ts              # chọn driver real|fake; đăng ký việc ở Worker
apps/server/src/modules/modules.manifest.json   # platform_gateway.allowedDeps += account
apps/server/src/modules/publishing/             # + đăng ký ConnectionConsumersPort (đếm lịch, hủy khi ngắt, ánh xạ lỗi)
apps/server/src/ops/                            # lệnh nội bộ `pnpm staff feature …` bọc features.service
apps/server/test/platform-gateway/              # unit, db (cross-tenant, race), contract, queue, secret-scan

apps/web/src/
├── features/channels/                          # ChannelsPage, ChannelCard, ChannelGroup, FilterBar, AttentionBanner,
│                                               # ConnectMenu, SelectPage (chọn Page), DisconnectDialog, SupportDetails, hooks
├── lib/api/endpoints/channels.ts               # + query-keys channels.overview
└── app/routes.tsx, app/shell/nav-registry.ts   # thay comingSoon('/channels'); quyền channel.view; chỉ báo cần chú ý
```

**Structure Decision**: giữ bố cục monorepo hiện có; **không tạo module mới** – toàn bộ ở `platform_gateway` (module duy nhất giải mã
mã quyền, Hiến pháp VII) cộng một khung giao diện `features/channels` trong web. Cấu hình công tắc đặt ở `platform_gateway` (không ở
`account`) để tránh thêm phụ thuộc và vì chỉ cổng mới cần chặn gọi nền tảng (R5).

## Ranh giới với các tính năng khác

| Với | Quyết định |
|---|---|
| **005** (hợp đồng + bản giả) | Giữ nguyên `PlatformAdapter`, `ConnectionStore`, `CredentialVault`, đường `/api/v1/channels/*`. 010 **thêm** bản thật sau cùng giao diện; `driver=fake` (dev/test) vẫn chạy mọi kiểm thử cũ. Chỉ thay đổi **cộng thêm** (trường mới, loại kênh `tiktok`). |
| **013** (đăng 5 bước, bộ chuyển đổi Meta) | 013 đã có `FacebookAdapter`/`InstagramAdapter` (`submit`, `checkStatus`, `reconcile`, `classifyError`, `mediaRules`) sau `PLATFORM_ADAPTER_MODE=real`. 010 **bổ sung** vào chính hai lớp đó: `authorizeUrl`, `exchangeCallback`, `checkAccount`, `refreshToken`, `revoke`; **không** sửa 5 bước. Hợp đồng tương thích: `status` 4 giá trị, `getConnection`/`checkAccount` giữ nghĩa, `cancelAllForConnection` do 013 cung cấp được gọi lúc ngắt. Cần thêm vào `PublishingPublicApi`: `countScheduledByConnections` (nhỏ, cộng thêm) – ghi vào tasks của 010 và báo 013. |
| **012** (soạn/duyệt/lịch) | `GET /api/v1/channels` (bộ chọn kênh trong `ComposePage`) giữ hình dạng cũ, **loại `tiktok`** (12 `channel_variants` CHECK chưa có `tiktok`); màn hình quản lý dùng `GET /channels/overview`. Đăng TikTok từ trình soạn là tính năng sau (cần sửa CHECK của `content` + quy tắc video) – không thuộc 010. |
| **009** (đăng nhập xã hội) | Độc lập hoàn toàn (FR-005): khác `state`, khác redirect, khác bảng; có thể dùng chung **ứng dụng Meta** (`FACEBOOK_APP_ID/SECRET`) nhưng kết nối kênh dùng cấu hình quyền + redirect riêng. |
| **004** (xác thực) | Thêm `channel.view`, `feature.manage` vào danh mục quyền + ma trận kiểm thử (SC-003 của 004); dùng `@CustomerAccess`, `@StaffAccess`, `staff-audit`. |
| **Notifications (005)** | Mở rộng danh mục đóng: `channel_token_expiring` thêm `stage`/`connectionIds` (tùy chọn – sự kiện cũ vẫn hợp lệ), thêm `channel_needs_reconnect`; quy tắc người nhận (chủ) giữ nguyên. |
| **Xóa tài khoản (FR-14)** | 010 cung cấp `disconnectAllForAccount()` + loại việc `platform_gateway.disconnect_all`; nối từ luồng xóa tài khoản thuộc tính năng FR-14 (chưa có) – kiểm thử gọi trực tiếp. |
| **Quản trị nội bộ UI** | Giai đoạn 1 **không** có màn hình quản trị: đổi công tắc qua điểm cuối `staff` + lệnh `pnpm staff feature` (có kiểm toán). Màn hình quản trị là việc riêng. |

## Rủi ro và việc cần kiểm chứng

| Rủi ro | Giảm thiểu |
|---|---|
| Meta App Review chưa duyệt; hành vi thật của token Page/`data_access_expires_at` chưa kiểm chứng (POC-2) | Hạn hiển thị lấy từ khả năng khai báo `expiry` của bộ chuyển đổi; không có hạn → hiện "không có ngày cố định"; `tokenRefresh` là cấu hình; kiểm tra hằng ngày bắt thu hồi; chế độ thử nghiệm → thông báo thân thiện (spec Edge Cases). |
| TikTok chưa được duyệt, API chưa thử thật | Toàn bộ kiểm thử dùng bản giả + máy chủ giả; tắt mặc định; ghi "đang thử nghiệm"; bộ chuyển đổi chỉ làm phần kết nối + quy tắc media + bảng lỗi (R9). |
| KMS của nhà cung cấp trong nước chưa sẵn sàng | `KeyWrapper` tách rời; `env-master-key` chỉ staging; production từ chối (kiểm bởi `assert-no-fakes`); đổi sang KMS là đổi cấu hình, bản mã có `keyId` để xoay khóa. |
| Hai luồng cùng ghi (Worker làm mới vs người dùng kết nối lại) | Mọi cập nhật quyền dùng `updateVersioned`; kết quả cuối giữ bản mới hơn (so `token_issued_at`), có kiểm thử đua. |
| Vượt giới hạn 5 khi nhiều Page chọn cùng lúc / hai thẻ trình duyệt | Khóa tư vấn theo `(account, channel_type)` + đếm trong cùng giao dịch + chỉ mục duy nhất; kiểm thử đồng thời. |
| Gọi nền tảng làm chậm/treo màn hình | Màn hình chỉ đọc dữ liệu lưu (FR-028); mọi lời gọi nền tảng có `AbortSignal` ≤ 10 giây, không giữ giao dịch; "Kiểm tra lại" giới hạn tần suất bằng cập nhật có điều kiện. |
| Đổi `status`/loại kênh làm hỏng 012/013 | Hợp đồng tương thích + kiểm thử chéo (xem R3, tasks): bộ chọn kênh không bao giờ trả `tiktok`; `status` luôn ∈ 4 giá trị cũ. |

## Câu hỏi mở (cần chủ sở hữu quyết định, không chặn lập kế hoạch)

1. **KMS thật (K5)** – *PO 2026-11-17: tạm thời chưa chốt.* Giữ `KeyWrapper` + `env-master-key` (chỉ staging); production vẫn bị chặn cho đến khi có KMS. Không chặn thi công 010; quyết định lại khi 007 chọn nhà cung cấp.
2. **Phạm vi quyền Meta/TikTok** – *PO 2026-11-17: cần quản lý bài viết/video (thêm, sửa, xem, xóa), thống kê hiệu quả, quản lý quảng cáo (không tạo quảng cáo/tăng ngân sách; nếu tạo thì chỉ bản nháp chờ duyệt), lấy từ khóa xu hướng.*
   Phạm vi này **rộng hơn FR-002 của spec** ("quyền tối thiểu để đăng và đọc trạng thái") và chạm Hiến pháp VII/IX, nên kế hoạch chia **nhóm quyền** (xem [research.md R1a](./research.md)). **Đã chốt bằng `/speckit-clarify` 2026-11-18 (phương án C, FR-002/FR-043 đã sửa):** 010 xin `publish` + `analytics` + `ads` (Meta; chỉ xin quyền, **không gọi API quảng cáo**; "nháp chờ duyệt" do tính năng quảng cáo sau ép); `trends` không xin từ nền tảng. Rủi ro App Review của quyền quảng cáo được chấp nhận; ADR-13 phải ghi thêm việc mở rộng so với Hiến pháp VII và hồ sơ Q-D3/C6.
3. ~~Ghi nhận TikTok là bên nhận dữ liệu nước ngoài mới~~ – *PO 2026-11-17: đồng ý.* Việc còn lại là tài liệu: thêm TikTok vào Kiến trúc dữ liệu mục 9 + hồ sơ Q-D3/C6 (đưa vào tasks); đã đủ điều kiện về mặt quyết định để bật cho khách thử nghiệm sau khi hồ sơ cập nhật.

## Theo dõi độ phức tạp

| Điểm | Vì sao cần | Phương án đơn giản hơn đã loại |
|---|---|---|
| Chỉ mục duy nhất toàn cục không bắt đầu bằng `account_id` | FR-006: một Page chỉ thuộc một tài khoản; chỉ DB chặn được khi hai tài khoản đua nhau (Hiến pháp II/I) | Kiểm tra ở ứng dụng trước khi chèn – không an toàn khi đua; bị RLS che nên không thấy dòng của tenant khác |
| `ConnectionConsumersPort` (đăng ký ngược) | `publishing → platform_gateway` đã có; gateway cần đếm bài/hủy lượt mà không import `publishing` (vòng phụ thuộc) | Cho `platform_gateway` phụ thuộc `publishing` (tạo vòng, vi phạm IV); để màn hình tự ghép từ hai điểm cuối (không bảo đảm nguyên tử lúc ngắt) |
| Hai nhánh KeyWrapper (`kms`, `env-master-key`) | Chưa có KMS thật khi cần staging chạy thật | Chỉ bản giả cố định khóa trong mã – vi phạm VII nếu lọt lên staging có dữ liệu thật |

## Kiểm tra hiến pháp sau thiết kế (Phase 1)

Sau khi viết `data-model.md` và `contracts/`, đối chiếu lại: (I) 5 bảng tenant đều qua `tenantTable`, `gateway_settings` là `sharedTable` không chứa dữ
liệu khách hàng, điểm cuối khách không có tham số tài khoản; (II) ngắt kết nối hủy lượt trong cùng giao dịch, `status` tương thích;
(IV) chỉ thêm `account` vào `allowedDeps`, cổng ngược do `publishing` đăng ký; (V) 3 việc nền đều có khóa chống trùng + kiểm thử chạy lại hai lần;
(VII) DTO không có trường mã quyền, vault bọc phong bì có AAD; (VIII) thông báo gom, không gửi hằng ngày. **Đạt – không phát sinh vi phạm mới.**
Hai việc đã thành điều kiện của `/speckit-tasks`: ADR-13 và cập nhật `modules.manifest.json`.
