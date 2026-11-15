# Implementation Plan: Nền tảng kiến trúc giao diện (011)

**Branch**: `011-ui-architecture-foundation` (worktree `impl/011-ui-architecture-foundation`) | **Date**: 2026-11-15 | **Spec**: [spec.md](spec.md)

**Input**: Feature specification từ `specs/011-ui-architecture-foundation/spec.md`

## Summary

Dựng **một nền giao diện duy nhất** cho ứng dụng web một trang: (1) bộ giá trị thiết kế (Tailwind v4 `@theme`) là nguồn
duy nhất của màu/cỡ chữ/khoảng cách; (2) bộ thành phần khớp Figma (class-variance-authority + Radix Primitives, 26 biểu tượng
SVG) xem được trong danh mục `/_catalog`; (3) khung ứng dụng (thanh bên 7 mục / thanh dưới 5 mục) sinh từ một bảng điều hướng
có quyền; (4) nền tảng biểu mẫu (react-hook-form + lược đồ Zod dùng chung với máy chủ) có sẵn chống gửi trùng, chặn mất dữ
liệu, xung đột phiên bản, chỉ xem, nhiều bước, tải tệp; (5) quản lý dữ liệu dùng chung bằng TanStack Query bọc sau `lib/api`
với khóa phân cấp, ma trận vô hiệu hóa, lớp làm mới theo loại dữ liệu và **không** lưu dữ liệu tài khoản ra bộ lưu lâu dài;
(6) xử lý hết phiên **tại chỗ** (hộp thoại đăng nhập lại, giữ bản nháp trong RAM); (7) kỷ luật chất lượng: kiểm tra
`check-web-rules` (cấm giá trị cứng, cấm số tiền AI), axe trong CI, ngân sách gói; (8) chuyển các trang 004/006/009 sang nền
mới mà không đổi hành vi. **Không thêm chức năng nghiệp vụ, bảng CSDL hay điểm cuối** — duy nhất một thay đổi lược đồ dùng
chung cộng thêm (`error.reason`, research R13). Hướng kỹ thuật và lý do từng thư viện: [research.md](research.md).

## Technical Context

**Language/Version**: TypeScript 5.x strict (đã có), React 19.3.1, Node 24 (công cụ), ESM

**Primary Dependencies** (cố định phiên bản chính xác – bảng ở research.md): `react-router` 8.5.1 (đã có), `tailwindcss` +
`@tailwindcss/vite` 4.3.5, `class-variance-authority` 0.7.1, `clsx` 2.1.1, `tailwind-merge` 3.7.0, `@radix-ui/react-{dialog 1.3.1,
tabs 1.2.1, tooltip 1.4.1, switch 1.4.1}`, `@tanstack/react-query` 5.107.1, `react-hook-form` 7.92.0, `@hookform/resolvers`
7.0.6, `sonner` 2.0.8, `react-error-boundary` 6.1.6, `@fontsource/be-vietnam-pro` 5.3.0; dev: `vite-plugin-svgr` 5.2.0,
`msw` 3.0.6, `eslint-plugin-jsx-a11y` 6.10.2, `@playwright/test` 1.65.1, `@axe-core/playwright` 4.14.0. `zod` 4.6.7 từ
`@app/shared` (đã có). **Hoãn**: zustand, dnd-kit, TanStack Virtual, date-fns, Uppy, Storybook.

**Storage**: N/A phía máy chủ. Phía trình duyệt: **chỉ RAM** (QueryClient, DraftStore) + `safe-storage` danh sách trắng cờ giao
diện (`data-model.md` mục 8); không dữ liệu tài khoản ở `localStorage`/`sessionStorage`/IndexedDB.

**Testing**: Vitest 5 + jsdom + Testing Library + `vitest-axe` (đã có) + MSW; kiểm thử hợp đồng biểu mẫu dùng chung; kiểm thử
tương phản màu từ `tokens.css`; Playwright + `@axe-core/playwright` trên danh mục ở 360/768/1280 px; kiểm thử hai tab và hai
tài khoản; chụp ảnh so sánh chỉ cho `PostCard`/`CalendarItem` (FR-035 "MAY").

**Target Platform**: Trình duyệt hiện đại – 2 bản mới nhất của Chrome, Safari (kể cả iOS), Edge, Cốc Cốc; từ 360 px; 4G tầm trung.

**Project Type**: Web application – chỉ phần `apps/web` (+ một thay đổi nhỏ ở `packages/shared` và điền `reason` ở `apps/server`
nhóm auth).

**Performance Goals**: tải trang đầu ≤ 3 giây trên 4G; chuyển màn hình ≤ 1 giây (dữ liệu có sẵn hiện tức thì); sau thao tác ghi,
mọi nơi cùng dữ liệu cập nhật ≤ 1 giây (SC-005); kiểm ngân sách gói trong `check-web-bundle.mjs` (đặt ngưỡng đo sau khi
có bản dựng đầu, ghi trong tasks).

**Constraints**: WCAG 2.1 AA; vùng chạm ≥ 44 × 44 px; chạy từ 360 px không cuộn ngang; không số tiền AI ở khách hàng; không
cache dữ liệu `volatile`; không làm mới định kỳ/kênh đẩy; không CDN/phông nước ngoài; thư viện cố định phiên bản và bọc sau lớp
nội bộ; kiểm thử 004/006/009 phải vẫn qua; không đổi hành vi trang hiện có.

**Scale/Scope**: ~33 tệp nguồn web hiện có cần chuyển; ~20 nhóm thành phần (≈ 70 biến thể) + 26 biểu tượng; 4 hợp đồng nội
bộ; ≥ 14 màn hình nghiệp vụ tương lai sẽ dùng nền này (UI/UX mục 6).

**Figma đã trích** (figma-extract.md, 2026-11-15): giá trị thiết kế, 18 thành phần, 26 biểu tượng, 8 màn tham chiếu. **Còn thiếu ở Figma (không chặn dựng khung; dựng theo token và đánh dấu `designPending`)**: huy hiệu "Đã hủy"; trạng thái lỗi/khóa/chỉ xem của `Field` và các ô khác; `ChannelTabs` đủ 4 kênh; khung chờ, hộp thoại, trang lỗi; bóng đổ và chuyển động; Figma Variables.

## Constitution Check

*GATE: đạt trước Phase 0; đánh giá lại sau Phase 1 (bên dưới là kết quả sau thiết kế).*

| # | Nguyên tắc | Đánh giá | Cách đáp ứng / bằng chứng |
|---|---|---|---|
| I | Cô lập tenant (không thương lượng) | **Đạt, có ràng buộc** | Giao diện không tạo hay gửi mã tài khoản: khóa truy vấn không có `accountId`, `apiClient` ném lỗi nếu thân/đường dẫn có `accountId`/`tenantId` (FR-010). Dữ liệu tài khoản chỉ ở RAM; `clearAllAccountData()` khi đăng xuất/hết phiên/đổi tài khoản + `BroadcastChannel` giữa tab; `safe-storage` danh sách trắng không chứa mã định danh. Kiểm thử hai tài khoản trên một trình duyệt (SC-008). Không có bảng mới ⇒ không có RLS mới. |
| II | Đăng bài không trùng (không thương lượng) | **Đạt (phía giao diện)** | Không gửi lại thao tác đăng/duyệt/xóa tự động sau đăng nhập lại (chỉ GET và thao tác `safeToReplay`); khóa nút/Enter chống gửi trùng (FR-016); mọi thao tác ghi bài gửi `version` và xử lý `VERSION_CONFLICT` (FR-018); thao tác đắt không lạc quan (FR-025); trạng thái lượt đăng thuộc lớp `volatile` (không cache). Quyền quyết định đăng ở API. |
| III | AI qua Cổng AI, chặn ngân sách (không thương lượng) | **Đạt (phía giao diện)** | Giao diện không gọi AI trực tiếp; `UsageSnapshot` **không có trường tiền** ⇒ không thể hiển thị USD; `check-web-rules` cấm định dạng tiền ở khu vực khách hàng; `LimitGate` khóa nút AI ở 100% kèm ngày mở lại, soạn tay/duyệt/đăng vẫn dùng được (FR-032). |
| IV | Modular monolith, ranh giới cứng | **Đạt** | Không thêm triển khai/dịch vụ; web chỉ nhập `@app/shared` (kiểm `check-boundaries`); trong `apps/web` thêm quy tắc nhập khẩu theo thư mục bằng ESLint (`ui` không nhập `lib/api|session|features`; màn hình không nhập thư viện đã bọc; `lib/api` là nơi duy nhất `fetch`). Thay đổi `packages/shared` là cộng thêm; phần `apps/server` chỉ điền `reason` trong module auth sẵn có. |
| V | Việc nền bền vững, idempotent | **Đạt (liên quan hạn chế)** | Giao diện chỉ theo dõi tiến độ (`useJobProgress`) và tải tệp lớn **thẳng lên kho bằng đường dẫn ký sẵn**, không qua API (ADR-07a). Không tạo hàng chờ. Làm mới ngắn hạn chỉ cho việc đang hiển thị, dừng khi xong/rời màn. |
| VI | AI đề xuất, con người quyết định | **Đạt (trọng tâm)** | Huy hiệu "Nháp/Chờ duyệt" cho nội dung AI; ẩn nút theo quyền chỉ là tiện lợi, API vẫn chặn và giao diện xử lý 403 (FR-009); tiếng Việt đời thường gom về `vi.ts`; **mọi `InlineAlert` lỗi bắt buộc ≥ 1 hành động** (kiểu TypeScript) và mã gốc chỉ trong "Chi tiết cho hỗ trợ" (SC-010); trạng thái luôn chữ + biểu tượng; WCAG 2.1 AA, vùng chạm 44 px, từ 360 px; không chặn người dùng khi hết AI/gán nhãn lỗi. |
| VII | Bảo vệ bí mật và dữ liệu cá nhân | **Đạt** | Không đọc/giữ mã phiên (cookie HttpOnly); không lưu mã quyền kênh/mật khẩu/email ở bộ lưu cục bộ; bản nháp chỉ RAM, trường `sensitive` loại trừ; phông tự lưu (Fontsource), không CDN nước ngoài (ADR-10); không thêm bên nhận dữ liệu ngoài ⇒ không thêm mục chuyển dữ liệu xuyên biên giới; đăng nhập lại dùng điểm cuối xác thực sẵn có của 004, không viết mật mã mới. |
| VIII | Quan sát và truy vết | **Đạt (liên quan hạn chế)** | "Chi tiết cho hỗ trợ" luôn hiển thị `traceId` + nút "Gửi cho hỗ trợ" (sao chép mã, không gửi ra ngoài); không ghi mã/bí mật vào `console`. Chưa thêm OpenTelemetry phía trình duyệt ở giai đoạn này (không có yêu cầu; ghi mở). |
| IX | Đơn giản, chuẩn mở, ADR | **Đạt, có ghi nhận** | Không đổi ngăn xếp đã chốt ⇒ không cần ADR; **không thêm Storybook, Zustand, date-fns, Uppy, dnd-kit** (hoãn đến khi cần); thư viện mã nguồn mở thương mại được, phiên bản chính xác, bọc sau lớp nội bộ (FR-038); không Redux/CSS-in-JS/kênh đẩy; làm mới định kỳ/kênh đẩy sau này phải có ADR. Việc dùng RHF thay lời "không thêm thư viện biểu mẫu" của 006 được ghi lý do ở research R6. |

**Kết quả**: không vi phạm; **Complexity Tracking** có 2 mục để theo dõi (bên dưới), không phải vi phạm.

**Cổng chất lượng CI (hiến pháp)**: mục 1–2 (truy cập chéo tenant, RLS) không áp dụng – không có bảng; mục 3 (ranh giới) giữ
`check-boundaries` + thêm quy tắc web; mục 4 (kiểu chặt + lint) mở rộng cho thư viện mới và `jsx-a11y`; mục 5 (quét bí mật)
giữ nguyên, thêm quét `localStorage` ở E2E.

## Project Structure

### Documentation (this feature)

```text
specs/011-ui-architecture-foundation/
├── spec.md                  # Đặc tả (đã có)
├── library-suggestions.md   # Gợi ý thư viện ban đầu (đã có; quyết định cuối ở research.md)
├── figma-extract.md         # Giá trị thiết kế, thành phần, biểu tượng, màn hình trích từ Figma (2026-11-15)
├── plan.md                  # Tệp này
├── research.md              # Phase 0 – quyết định + thư viện + việc còn mở
├── data-model.md            # Phase 1 – thực thể tầng giao diện
├── quickstart.md            # Phase 1 – kịch bản kiểm chứng
├── contracts/
│   ├── ui-components.md             # thành phần, quy tắc chung, danh mục
│   ├── app-shell-and-session.md     # tuyến, điều hướng, quyền, hết phiên tại chỗ
│   ├── data-layer.md                # lớp API, khóa, vô hiệu hóa, làm mới, hạn mức
│   └── forms.md                     # nền tảng biểu mẫu, tải tệp, kiểm thử hợp đồng
├── checklists/requirements.md
└── tasks.md                 # Phase 2 – /speckit-tasks (chưa tạo)
```

### Source Code (repository root)

Cấu trúc đích của `apps/web/src` (đường kẻ = ranh giới nhập khẩu; mũi tên là hướng được phép: `ui → styles`; `lib/* → ui` khi
dựng thành phần ghép; `features/* → ui, lib`; `app → mọi thứ`; ngược lại bị lint cấm):

```text
apps/web/
├── docs/ui-guide.md                  # FR-037: thêm thành phần/mục điều hướng/biểu mẫu/dữ liệu; đồng bộ Figma; danh sách thư viện
├── src/
│   ├── styles/
│   │   ├── tokens.css                # @theme – NGUỒN DUY NHẤT giá trị thiết kế (phần giữa BEGIN/END sinh từ figma-tokens.json)
│   │   ├── figma-tokens.json         # trích từ Figma (R12) – dữ liệu đầu: figma-extract.md mục 1–3
│   │   ├── tokens.contrast.ts        # cặp (chữ, nền) kiểm tương phản
│   │   └── index.css                 # @import tailwindcss + tokens + phông + reset truy cập (focus-visible, reduced-motion)
│   ├── ui/                           # THUẦN HIỂN THỊ, không nhập lib/api|session|features|router
│   │   ├── figma-variants.ts         # bảng biến thể đồng bộ Figma (SC-001)
│   │   ├── icons/ (svg/, Icon.tsx)   # 26 biểu tượng, svgr
│   │   ├── button/ badge/ cards/ nav/ alert/ chip-tabs/ steps/ calendar/ feedback/ …   # mỗi thư mục: X.tsx, X.catalog.tsx, X.spec.tsx
│   │   ├── form/ (Form, fields…, __tests__/form-contract.ts)
│   │   └── upload/ (UploadQueue, FileField)
│   ├── lib/
│   │   ├── api/ (client.ts, errors.ts, query-keys.ts, query-client.ts, mutations.ts, hooks.ts, endpoints/*, auth-gate.ts, pagination.ts)
│   │   ├── session/ (SessionProvider, useCan, useRole, clear-account-data.ts, tab-sync.ts)
│   │   ├── forms/ (useAppForm, draft-store.ts, useUnsavedChangesGuard.ts [rút từ 006], useWizard, applyServerErrors)
│   │   ├── upload/ (queue.ts, transports/{single,multipart}.ts, validate.ts)
│   │   ├── catalogs/ (post-status.ts, channels.ts, error-explanations.ts)
│   │   ├── i18n/ (vi.ts)  format/ (datetime.ts, number.ts)
│   │   ├── limits/ (useUsage, useLimit, LimitGate)   jobs/ (useJobProgress)
│   │   └── safe-storage.ts   url-state.ts
│   ├── app/
│   │   ├── shell/ (AppShell, nav-registry.ts, useNavItems, MorePage, ComingSoon, ReauthDialog, OfflineBanner)
│   │   ├── routes.tsx (lazy theo nhóm)  errors/ (NotFound, Forbidden, ErrorPage)  SessionGate.tsx
│   ├── features/                     # auth/ context/ members/ – chuyển sang ui+lib, xóa features/auth/ui.tsx (styles cứng)
│   ├── internal/                     # khu vực nhân viên – gói riêng (chỉ khung giữ chỗ; nội dung ở tính năng sau)
│   └── catalog/ (CatalogPage, sample/, fixtures/, msw/)      # DEV hoặc VITE_ENABLE_CATALOG=1, tải lười
├── e2e/ (playwright.config.ts, catalog.a11y.spec.ts, shell-roles.spec.ts, two-tabs.spec.ts, session-expiry.spec.ts)
└── test/ (cũ: auth/ context/ members/ giữ nguyên; mới: ui/ lib/ app/ theo cấu trúc nguồn)

tooling/
├── check-web-rules.mjs               # cấm giá trị cứng + số tiền AI ở khu vực khách hàng (R9) + test fixtures kiểu boundaries/
└── sync-design-tokens.mjs            # figma-tokens.json → khối @theme (R12)

packages/shared/src/core/error-response.ts   # cộng thêm: SESSION_END_REASONS + error.reason (tùy chọn)
apps/server/src/core/auth/auth-errors.ts     # điền reason ở chỗ thu hồi phiên (004/009); không đổi mã/status
eslint.config.mjs                    # thêm jsx-a11y + quy tắc nhập khẩu/toàn cục cho apps/web
```

**Structure Decision**: giữ một ứng dụng web (`apps/web`), thêm ba tầng tách rõ theo nguyên tắc "dữ liệu loại (a)–(d)" của
FR-022: `ui/` (hiển thị thuần, thay `features/auth/ui.tsx`), `lib/` (dữ liệu, phiên, biểu mẫu, danh mục), `app/` (khung, tuyến).
`features/*` còn lại là màn hình nghiệp vụ ghép từ `ui` + `lib`. Không tạo gói workspace mới (`packages/ui`): chỉ một ứng dụng dùng, tách
gói là phức tạp thừa (Complexity Tracking #2); khi có ứng dụng thứ hai (admin riêng) mới tách.

## Thứ tự thi công (gợi ý cho `/speckit-tasks`)

Mỗi pha kết thúc bằng bản chạy được và kiểm thử xanh; pha sau không chặn pha trước đã xong.

1. **Nền (P1, chặn tất cả)** – thêm thư viện (cố định phiên bản) + Tailwind/`tokens.css` (giá trị từ figma-extract.md) + `index.css`; `Icon` + bộ
   SVG tạm; `check-web-rules`, quy tắc ESLint (`jsx-a11y`, nhập khẩu theo thư mục); `tokens.contrast` kiểm thử; khung `/_catalog`.
2. **Thành phần (Story 1, P1)** – theo nhóm: Button/InlineAlert/StatusBadge → thẻ (ChannelTag/IdeaCard/PostCard/UsageMeter) → điều
   hướng/khung → lịch/bước/chip/tab → ô nhập. Mỗi nhóm: thành phần + catalog + spec + axe; hoàn tất `figma-variants.ts`.
3. **Lớp dữ liệu + phiên (Story 4, 2.4)** – `lib/api` (client, errors, query-keys, hooks, mutations), `AuthGate` + `ReauthDialog` +
   `clearAllAccountData` + `tab-sync`; `lib/catalogs`; `useJobProgress`, `useUsage`/`LimitGate`; `OfflineBanner`; `safe-storage`.
   (Thêm `error.reason` ở `@app/shared` + điền ở server nhóm auth.)
4. **Khung ứng dụng (Story 2)** – `nav-registry`, `AppShell`, tuyến lười, `MorePage`, `ComingSoon`, trang lỗi, `useCan`/`<Can>`;
   kiểm thử ma trận quyền theo vai trò.
5. **Nền tảng biểu mẫu (Story 3)** – `useAppForm`, `Form`, các ô, `ConflictNotice`, chặn rời trang, bản nháp RAM, `useWizard`, tải tệp
   + MSW; `testForm()` hợp đồng.
6. **Trạng thái hiển thị (Story 5)** – `AsyncBoundary` (5 mẫu), `EmptyState`, `Skeleton`, `ErrorNotice` chuẩn, `format/datetime`.
7. **Chuyển trang hiện có + hoàn thiện (Story 6, FR-036)** – chuyển lần lượt auth (14 trang) → members → context (`ProfileForm`
   là phép thử RHF, R6), xóa `features/auth/ui.tsx` và khối `style={{}}`, bỏ vỏ `api-client.ts`; E2E (Playwright), `ui-guide.md`,
   ngân sách gói, cập nhật `docs/wiki` (qua `speckit-wiki-ingest`) và ghi lệch Figma ↔ UI/UX vào tài liệu PO.

## Rủi ro và việc theo dõi

| Rủi ro | Mức | Giảm thiểu |
|---|---|---|
| Figma thiếu một số biến thể/trạng thái (Đã hủy, lỗi/khóa của Field, hộp thoại…) và chưa có Variables | Trung bình | Dựng theo token + `designPending`; SC-001 tính trên phần đã thiết kế, phần thiếu theo dõi riêng; người thiết kế bổ sung rồi chạy lại đồng bộ |
| Bảng màu Figma (teal) khác giao diện hiện tại (xanh dương) ⇒ trang 004/006/009 đổi diện mạo khi chuyển | Thấp | Kiểm thử hành vi/DOM không phụ thuộc màu; báo PO trước; không đổi luồng hay chữ |
| RHF làm lệch hành vi 006 (đếm ký tự `aria-live`, xung đột, chỉ xem) | Thấp–TB | Kiểm thử 006 là cổng; nếu hỏng, giữ ô tự viết cho `ProfileForm` và ghi Complexity Tracking |
| Hộp thoại đăng nhập lại: đăng nhập Google/Facebook đòi chuyển trang | Trung bình | Cửa sổ phụ + `BroadcastChannel`; nếu bị chặn → chỉ mật khẩu/thư (cách khác vẫn dùng được); kiểm thử E2E |
| "Tiếp tục khi mạng chập chờn" cần multipart ở kho/máy chủ (chưa có) | Trung bình | `UploadTransport` trừu tượng; bản đầu thử lại cả tệp; chốt ở tính năng Thư viện media |
| Mã trạng thái bài hệ thống chưa có enum trong `@app/shared` | Thấp | Bảng quy đổi nhận chuỗi + test đủ trạng thái UI/UX mục 7; đổi kiểu khi module có enum |
| Gói khởi đầu phình do Tailwind/Radix/RHF | Thấp | Tải lười theo nhóm tuyến; ngân sách trong `check-web-bundle`; Radix chỉ 4 gói; đo bản dựng đầu rồi đặt ngưỡng |
| Cập nhật UI/UX mục 4 (điều hướng 7/5 mục, TikTok, "Đăng tay", "Gợi ý hôm nay") chưa làm | Thấp | Tác vụ tài liệu ở pha 7; PO xác nhận (theo Assumptions của spec) |
| Thay đổi `@app/shared` + server (`error.reason`) | Thấp | Chỉ cộng thêm, tương thích ngược; cần SA duyệt (không thuộc nhóm I–III nên không cần PO) |

## Complexity Tracking

Không có vi phạm hiến pháp. Hai quyết định phức tạp đáng theo dõi (không phải vi phạm):

| Quyết định | Vì sao cần | Phương án đơn giản hơn đã cân nhắc |
|---|---|---|
| Bọc TanStack Query/RHF/Radix sau `lib/api`, `ui/form`, `ui/*` (thêm một lớp) | FR-038 + hiến pháp IX: thư viện chi phối hành vi quan trọng phải bọc để thay một nơi và để ép quy tắc (khóa, vô hiệu hóa, cấm lạc quan thao tác đắt) | Dùng thư viện trực tiếp ở màn hình: nhanh hơn lúc đầu nhưng lặp lại đúng vấn đề hiện tại (mỗi màn tự gọi mạng/biểu mẫu) |
| Danh mục trong ứng dụng thay vì Storybook; không tách gói `packages/ui` | Người làm một mình, nhạy chi phí; dùng chính bộ công cụ sẵn có | Storybook / gói riêng: thêm công cụ và bảo trì khi chỉ có một ứng dụng dùng; sẽ xem lại khi có ứng dụng thứ hai hoặc cần xuất bản danh mục cho người thiết kế |
