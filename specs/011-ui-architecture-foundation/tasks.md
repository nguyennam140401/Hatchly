# Tasks: Nền tảng kiến trúc giao diện (011)

**Input**: `specs/011-ui-architecture-foundation/` – plan.md, spec.md, research.md, data-model.md, figma-extract.md, contracts/ (4 tệp), quickstart.md

**Prerequisites**: plan.md, spec.md (đã có). Worktree `impl/011-ui-architecture-foundation`, nhánh gốc `dev`.

**Tests**: **Có** – FR-034/FR-035 và SC-007 yêu cầu kiểm thử từng biến thể, biểu mẫu, dữ liệu, truy cập. Mỗi thành phần có `*.spec.tsx`; kiểm thử viết cùng nhóm với mã và phải đỏ trước khi mã xong.

**Quy ước đường dẫn**: tính từ gốc worktree. `apps/web/src/…` viết tắt `web/…`; kiểm thử cũ ở `apps/web/test/{auth,context,members}` **không được sửa kỳ vọng** (SC-011).

## Format: `[ID] [P?] [Story] Mô tả + đường dẫn`

- **[P]**: chạy song song được (khác tệp, không phụ thuộc việc chưa xong)
- **[Story]**: US1…US6 theo spec.md (Setup/Foundational/Polish không gắn nhãn)
- Mọi giá trị trong ngoặc kép là ràng buộc lấy nguyên văn từ data-model/contracts, không để tùy ý lúc thi công.

## Ánh xạ câu chuyện

| Nhãn | Câu chuyện (spec.md) | Ưu tiên |
|---|---|---|
| US1 | Dựng màn hình từ bộ thành phần dùng chung | P1 🎯 MVP |
| US2 | Khung ứng dụng, điều hướng theo quyền, hết phiên tại chỗ | P1 |
| US3 | Nền tảng biểu mẫu dùng chung | P1 |
| US4 | Quản lý dữ liệu dùng chung (làm mới, vô hiệu hóa, hạn mức, việc nền) | P2 |
| US5 | Mô hình trạng thái hiển thị (tải/trống/lỗi/khóa/một phần) | P2 |
| US6 | Danh mục thành phần, CI, chuyển các trang hiện có | P3 |

---

## Phase 1: Setup (hạ tầng dùng chung)

**Mục đích**: thêm thư viện cố định phiên bản, Tailwind, công cụ kiểm tra. Chưa có thành phần nào.

- [X] T001 Thêm vào `apps/web/package.json` (phiên bản **chính xác**, không `^`/`~`; cập nhật `pnpm-lock.yaml`): dependencies `tailwindcss` 4.3.5, `@tailwindcss/vite` 4.3.5, `class-variance-authority` 0.7.1, `clsx` 2.1.1, `tailwind-merge` 3.7.0, `@radix-ui/react-dialog` 1.3.1, `@radix-ui/react-tabs` 1.2.1, `@radix-ui/react-tooltip` 1.4.1, `@radix-ui/react-switch` 1.4.1, `@tanstack/react-query` 5.107.1, `react-hook-form` 7.92.0, `@hookform/resolvers` 7.0.6, `sonner` 2.0.8, `react-error-boundary` 6.1.6, `@fontsource/be-vietnam-pro` 5.3.0; devDependencies `vite-plugin-svgr` 5.2.0, `msw` 3.0.6, `eslint-plugin-jsx-a11y` 6.10.2, `@playwright/test` 1.65.1, `@axe-core/playwright` 4.14.0. **Không** thêm zustand, dnd-kit, TanStack Virtual, date-fns, Uppy, Storybook.
- [X] T002 [P] Cấu hình `apps/web/vite.config.ts` (plugin `@tailwindcss/vite`, `vite-plugin-svgr`, biến `VITE_ENABLE_CATALOG`) và `apps/web/vitest.config.ts` (đuôi `*.spec.tsx` trong `src/**` và `test/**`, alias svgr, `setupFiles`); cập nhật `apps/web/tsconfig.json` cho `*.svg?react`.
- [X] T003 [P] Mở rộng `eslint.config.mjs` cho `apps/web`: `jsx-a11y` (recommended); `no-restricted-imports` theo thư mục (`ui/**` cấm nhập `lib/api|session|forms|upload`, `features/**`, `react-router` trừ `ui/nav`; màn hình `features/**` và `app/**` cấm nhập `@tanstack/react-query`, `react-hook-form`, `@hookform/resolvers`, `@radix-ui/*`, `sonner`); `no-restricted-globals` cho `fetch`/`XMLHttpRequest` ngoài `lib/api/**` (ngoại lệ có chú thích: `lib/upload/**`); cấm `.role ===` và `=== 'owner'` ngoài `lib/session/**`; cấm lớp `text-spark`.
- [X] T004 [P] Tạo `apps/web/src/styles/figma-tokens.json` từ `specs/011-ui-architecture-foundation/figma-extract.md` mục 1–3 (22 màu, 7 cỡ chữ, khoảng cách `1,2,3,4,6,8` = 4/8/12/16/24/32 px — không có 5 và 7, bo góc 6/10/16/999, `size-touch` 44, `topbar` 56, `navbar` 64, `sidebar` 248, `gutter` 16, `phone` 390, `breakpoint-lg` 1024, `duration-fast` 120 ms / `duration-base` 200 ms, `ease-standard`) và `tooling/sync-design-tokens.mjs` (JSON → khối `@theme` giữa `BEGIN/END` trong `tokens.css`; chạy lại không đổi tệp nếu JSON không đổi).
- [X] T005 Tạo `apps/web/src/styles/tokens.css` (chạy `node tooling/sync-design-tokens.mjs`) và `apps/web/src/styles/index.css` (`@import "tailwindcss"`, tokens, `@fontsource/be-vietnam-pro` các độ đậm 400/500/600/700, reset truy cập: `:focus-visible` vòng tiêu điểm, `@media (prefers-reduced-motion: reduce)` đặt `--duration-*` về 0, biến `--safe-bottom: env(safe-area-inset-bottom)`); nhập `index.css` trong `apps/web/src/main.tsx`. Không bóng đổ (Figma không có) – tách lớp bằng viền `line`.
- [X] T006 [P] `apps/web/src/styles/tokens.contrast.ts` (danh sách cặp chữ/nền: ink/surface-0|100|200, ink-muted/surface-0|100, on-brand/brand|brand-strong, brand/brand-soft, các `{success,warning,danger,info}` trên `-soft`, spark-ink/spark-soft) + `apps/web/src/styles/tokens.contrast.spec.ts` đọc `tokens.css` và **thất bại nếu cặp chữ < 4,5:1 hoặc viền/biểu tượng < 3:1**; thêm kiểm thử cấm `text-spark` (spark 2,47:1 chỉ làm mảng màu).
- [X] T007 [P] `tooling/check-web-rules.mjs` + `tooling/check-web-rules.spec.mjs` (fixtures đúng/sai như `tooling/check-boundaries`): trong `apps/web/src/**` ngoài `styles/` **báo lỗi kèm tệp:dòng** khi gặp màu viết cứng (`#hex`, `rgb(`, `hsl(`), `style={{` có màu/cỡ chữ/khoảng cách/kích thước, giá trị tùy ý `[…px]`/`[#…]` trong `className`, và (khu vực khách hàng, không tính `internal/`) định dạng tiền (`$`, `USD`, `đ`, `VND` đi kèm số, `micro`). Thêm script `check:web-rules` ở `package.json` gốc.
- [X] T008 [P] `tooling/check-web-bundle.mjs` (đọc `apps/web/dist`, báo lỗi nếu gói khởi đầu chứa `/_catalog`, `catalog/`, `/internal`, hoặc vượt `BUNDLE_BUDGET_KB` — giá trị đặt sau bản dựng đầu, ghi vào tệp cùng tên) và script `check:web-bundle`.
- [X] T009 [P] `apps/web/e2e/playwright.config.ts` (3 dự án viewport 360/768/1280 px, `webServer` chạy `vite` với `VITE_ENABLE_CATALOG=1`), script `test:e2e` ở `apps/web/package.json`; thêm `e2e/` vào ignore của vitest.

---

## Phase 2: Foundational (chặn mọi câu chuyện)

**⚠️ QUAN TRỌNG**: lớp gọi API, phiên, danh mục tĩnh, biểu tượng, hạ tầng kiểm thử phải xong trước khi dựng thành phần ghép và khung.

### Lược đồ dùng chung và máy chủ (thay đổi cộng thêm duy nhất – cần SA duyệt)

- [X] T010 `packages/shared/src/core/error-response.ts`: thêm `export const SESSION_END_REASONS = ['expired','revoked','password_changed','removed','locked'] as const` và `reason: z.enum(SESSION_END_REASONS).optional()` trong `ErrorResponse.error`; xuất qua `packages/shared/src/index.ts`; kiểm thử trong `packages/shared/test/` (parse có/không `reason`; phản hồi cũ vẫn hợp lệ). Chỉ cộng thêm, không đổi mã lỗi.
- [X] T011 `apps/server/src/core/auth/auth-errors.ts` (+ nơi thu hồi phiên của 004/009): điền `reason` khi trả `UNAUTHENTICATED` do đổi/đặt lại mật khẩu (`password_changed`), bị gỡ khỏi tài khoản (`removed`), bị khóa (`locked`), phiên bị thu hồi (`revoked`), hết hạn (`expired`); kiểm thử đơn vị server cho từng lý do; không đổi mã/status. Thêm một dòng vào bảng mục 3 của `specs/004-minimal-auth-rbac/contracts/auth-http-api.md`.

### Danh mục tĩnh, chuỗi chữ, định dạng (loại d)

- [X] T012 [P] `web/lib/i18n/vi.ts` (mọi chuỗi hiển thị ở một nơi, kiểu `ViKey`) + `web/lib/i18n/t.ts`; chứa nhãn riêng của thành phần ("Chi tiết cho hỗ trợ", "Gửi cho hỗ trợ", "Đang tải", "Thử lại", "Dữ liệu có thể chưa mới"…).
- [X] T013 [P] `web/lib/format/datetime.ts` (ISO UTC → hiển thị **UTC+7**, định dạng ngày tiếng Việt thống nhất bằng `Intl`, không thêm date-fns) và `web/lib/format/number.ts` (số đếm, `%`, byte → MB/GB); `web/lib/format/format.spec.ts` gồm mốc nửa đêm UTC → 07:00 và ngày cuối tháng.
- [X] T014 [P] `web/lib/catalogs/post-status.ts` (`PostDisplayStatus` = `draft|review|scheduled|publishing|published|attention|cancelled|unknown`; `toDisplayStatus(system, channels?)`: trạng thái tổng của bài nhiều kênh = **xấu nhất** theo thứ tự `attention > publishing > scheduled > published`; *Chờ thử lại* → "Đang đăng"; *Không xác định/Cần kiểm tra* → "Cần bạn xử lý"; giá trị lạ → `unknown` nhãn "Đang cập nhật", không ném lỗi) + `post-status.spec.ts` phủ đủ trạng thái UI/UX mục 7.
- [X] T015 [P] `web/lib/catalogs/channels.ts` (facebook, instagram, tiktok, zalo: nhãn, thứ tự; không màu kênh; `manualPublish` là khả năng do máy chủ báo, không có công tắc) và `web/lib/catalogs/error-explanations.ts` (mã `ERROR_CODES` → lời giải thích đời thường + `ErrorActionView[]`, luôn ≥ 1 hành động) + kiểm thử "mỗi mã trong `ERROR_CODES` có hàng".
- [X] T016 [P] `web/lib/safe-storage.ts`: danh sách trắng **chỉ** `ui.sidebar.collapsed`, `ui.posts.view`, `ui.calendar.view`, `ui.onboarding.dismissed`; giá trị chuỗi ngắn/cờ; khóa ngoài danh sách → ném lỗi ở dev/test; bọc try/catch; `clear()`; + `safe-storage.spec.ts`. `web/lib/url-state.ts` (`useUrlState` cho bộ lọc/tab/bước).

### Lớp gọi API duy nhất và phiên (nền cho mọi câu chuyện)

- [X] T017 [P] `web/lib/api/errors.ts`: `AppError` (`kind` ∈ network·session_expired·forbidden·not_found·version_conflict·limit_reached·validation·business·rate_limited·server·invalid_response; `status`, `code`, `message`, `actions: ErrorActionView[]` ≥ 1, `fieldErrors` khóa = đường dẫn chấm, `retryAfterSeconds?`, `support{traceId, detail?}`, `reason?: SessionEndReason`) + `toAppError()` cho `ApiError` hiện có; phân loại `UNAUTHENTICATED→session_expired`, `FORBIDDEN|ACCOUNT_UNAVAILABLE→forbidden`, `VERSION_CONFLICT→version_conflict`, `VALIDATION_FAILED→validation`, `RATE_LIMITED|LOGIN_THROTTLED→rate_limited`, tiền tố `LIMIT_`→`limit_reached`, còn lại `business` (có mã) hoặc `server` (5xx); `errors.spec.ts`.
- [X] T018 `web/lib/api/client.ts` (`apiClient.request<T>(method, path, { body?, schema, signal?, silentAuth?, safeToReplay?, version? })`): `credentials: 'same-origin'`, không đọc cookie, không thêm tiêu đề tùy ý ngoài `accept`/`content-type`; kiểm phản hồi bằng schema Zod của `@app/shared` (sai hình → `invalid_response`); mọi lỗi → `AppError`, không ném lỗi thô; **ném lỗi nếu body/path/query chứa khóa `accountId` hoặc `tenantId`** (FR-010); giữ vỏ tương thích `apiRequest`, `ApiError`, `onAuthError` trong `web/lib/api-client.ts` (xóa ở T077); `client.spec.ts` (MSW).
- [X] T019 [P] `web/lib/api/query-keys.ts` (nhà máy kiểu chặt: `session.me`, `posts.list(filter)`, `posts.detail(id)`, `plan`, `channels.list`, `media.list(filter)`, `profile.current`, `profile.versions`, `members.list`, `usage.current`, `notifications.list`, `notifications.unread`, `jobs.detail(jobId)`, `counters.pendingReview`, `overview.*`, `calendar.*`; **không** tham số `accountId`) và `web/lib/api/pagination.ts` (khóa phân trang con trỏ, `total` tùy chọn).
- [X] T020 `web/lib/api/query-client.ts` (`FreshnessClass`): `catalog` staleTime 1 giờ/gcTime 24 giờ; `entity` 30 giây/5 phút; `counter` 15 giây/5 phút; `volatile` **0/0**; `session` **0/0**; mặc định `refetchOnWindowFocus: true`, `refetchOnMount: true`, `refetchInterval: false`, `retry` 0 cho ghi, 1 (giãn 1 giây) cho đọc `network`/5xx, 0 cho 4xx; tạo `QueryClient` mới theo phiên; `ensureFresh(key)` = `fetchQuery({ queryKey, staleTime: 0 })`; `query-client.spec.ts` xác nhận từng lớp.
- [X] T021 `web/lib/api/hooks.ts`: `useApiQuery(key, fn, { freshness })` và `useApiMutation({ fn, invalidates, optimistic?, replay? })` — hai cửa duy nhất; `optimistic` chỉ nhận khi thao tác thuộc `OPTIMISTIC_ALLOWED = {reschedule, markRead, reorder}` (chặn tại biên dịch, có kiểm thử kiểu `// @ts-expect-error`); `web/lib/api/endpoints/session.ts` (`/auth/me`, đăng nhập lại); `hooks.spec.tsx`.
- [X] T022 `web/lib/session/` : `SessionProvider` + `useSession` (dữ liệu từ khóa `session.me()`, lớp `session`), `useCan(permission)` (đọc `me.permissions`), `useRole()` (chỉ để hiển thị nhãn, không quyết định hiện/ẩn), `<Can permission fallback="hide|locked" lockedReason>`; `clear-account-data.ts` (`clearAllAccountData()`: `QueryClient.clear()`, DraftStore, `safe-storage`, trạng thái ui tạm, phát `BroadcastChannel('app-session')`); `tab-sync.ts` (`{type:'logout'|'switched', at}` → tab nhận gọi `clearAllAccountData()` rồi `/login`); `session.spec.tsx` (kiểm so sánh quyền không rải rác).
- [X] T023 [P] Hạ tầng kiểm thử web: `apps/web/test/setup.ts` thêm MSW server (`msw/node`) + `afterEach(resetHandlers)` mà **không đổi hành vi bộ kiểm thử cũ**; `apps/web/test/helpers/render.tsx` (`renderWithProviders`: QueryClient mới, SessionProvider giả, MemoryRouter, vai trò owner/collaborator); `apps/web/test/helpers/axe.ts` (bọc `vitest-axe`).

### Biểu tượng

- [X] T024 [P] `web/ui/icons/svg/*.svg` đúng **26 tên**: `check clock calendar send alert bulb info home list more plus image refresh copy back bell download film link store gear library chevron-right pencil chevron-down x` (viewBox đồng nhất, dùng `currentColor`, không `fill` cứng; hình vẽ tạm đến khi lấy SVG từ Figma) + `web/ui/icons/Icon.tsx` (`IconName` là tập đóng sinh từ thư mục; `aria-hidden` khi không có `title`) + `Icon.spec.tsx` ("đủ 26 tên, mỗi tên có tệp SVG hợp lệ").
- [X] T025 [P] `web/ui/figma-variants.ts` (dữ liệu bảng biến thể theo data-model mục 2, có cờ `designPending` cho các biến thể ngoài Figma) + `web/ui/figma-variants.spec.ts` (mọi hàng có thành phần xuất khẩu tương ứng; dùng cho SC-001).

**Checkpoint**: nền xong – dựng thành phần, khung, biểu mẫu, dữ liệu song song được.

---

## Phase 3: User Story 1 – Dựng màn hình mới từ bộ thành phần dùng chung (P1) 🎯 MVP

**Mục tiêu**: bộ thành phần khớp Figma, đủ biến thể, đạt WCAG, không viết cứng giá trị thiết kế.

**Kiểm thử độc lập**: dựng trang thử chỉ bằng thành phần dùng chung; mọi biến thể trong `figma-variants.ts` hiển thị; `check-web-rules` báo 0 vi phạm; `vitest-axe` 0 lỗi.

Quy tắc chung mỗi thành phần (contracts/ui-components.md mục 1): thư mục `web/ui/<nhóm>/` gồm `X.tsx`, `X.catalog.tsx` (xuất `{ name, description, a11yNotes, variants }`), `X.spec.tsx` (render mọi biến thể, tương tác, `axe`); vùng chạm `min-h-touch min-w-touch`; `focus-visible:ring`; `motion-safe:`; cắt gọn `truncate`/`line-clamp` kèm `Tooltip` khi chữ dài; **không** nhập `lib/api|session|features`.

- [X] T026 [P] [US1] `web/ui/util/cn.ts` (`clsx` + `tailwind-merge`) và nhóm `web/ui/button/`: `Button` (`variant` primary·secondary·ghost·danger × `state` default·locked, + `loading` "Đang lưu…" `aria-busy`; thuộc tính `locked`, `lockedReason`, `reopensAt`; nút khóa dùng `aria-disabled` vẫn focus được và hiển thị lý do bằng `aria-describedby`, **không** `disabled` thuần; `icon?`, `fullWidth?`) + catalog + spec (8 tổ hợp + loading).
- [X] T027 [P] [US1] `web/ui/badge/`: `StatusBadge` (đọc nhãn/biểu tượng/token từ `lib/catalogs/post-status` qua thuộc tính; luôn **chữ + biểu tượng**; `size` sm·md; `unknown` → "Đang cập nhật"; Đã lên lịch = brand-soft/brand là **giả định**, ghi `designPending`; Đã hủy `designPending`) và `SuggestionTag` ("Gợi ý hôm nay", tách khỏi bảng trạng thái bài, dùng chung kiểu spark-soft/spark-ink) + catalog + spec (kiểm "không bao giờ render thiếu chữ hoặc biểu tượng").
- [X] T028 [P] [US1] `web/ui/alert/`: `InlineAlert` (`tone` info·warning·error; `tone="error"` bắt buộc `actions: [A, ...A[]]` — kiểu TypeScript, kèm kiểm thử `@ts-expect-error`; phần "Chi tiết cho hỗ trợ" thu gọn chứa mã gốc + `traceId`, nút "Gửi cho hỗ trợ" chỉ **sao chép mã**, không gửi dữ liệu ra ngoài; `role="alert"` cho lỗi, `role="status"` cho thông tin) + `ConfirmDialog` (Radix Dialog, `tone` mặc định/nguy hiểm, giữ tiêu điểm, Esc đóng) + catalog + spec.
- [X] T029 [P] [US1] `web/ui/cards/`: `ChannelTag` (4 kênh × `manualPublish` có/không = 8; kênh nhận diện bằng **chữ**, không màu kênh), `UsageMeter` (`level` normal·warning·exhausted; `role="meter"`/`progressbar` có `aria-valuenow`; **chỉ số đếm/%, không nhận tiền**), `IdeaCard` (`featured`, `selected`, `onEdit`, `onRemove`), `PostCard` (`post={{id,title,excerpt,status,channels,scheduledAt?}}`, tiêu đề dài cắt gọn có `Tooltip`) + catalog + spec.
- [X] T030 [P] [US1] `web/ui/nav/` (được phép nhập `NavLink` của `react-router`): `Sidebar` (7 mục), `NavBar` (5 ô, "Tạo bài" nổi bật ở giữa, `pb` theo `--safe-bottom`), `TopBar` (`kind` logo·back, `Logo`), mục hiện tại `aria-current="page"` + chữ đậm + biểu tượng đầy (không chỉ màu), huy hiệu đếm `NavItem.badge`; nhận `items` qua thuộc tính + catalog + spec (đủ 5/7 trạng thái active).
- [X] T031 [P] [US1] `web/ui/chip-tabs/`: `Chip` (`selected`, `removable`), `ChannelTabs` (Radix Tabs; nhận danh sách kênh bất kỳ — Figma chỉ vẽ Facebook·TikTok, 2 kênh còn lại `designPending`; mũi tên chuyển tab) + catalog + spec.
- [X] T032 [P] [US1] `web/ui/steps/`: `StepRow` (`state` done·error·pending; `time?`, `explanation?`, `remedy?`; bước đang đăng nhấp nháy bằng `motion-safe:`, giảm chuyển động vẫn còn chữ trạng thái) và `ProgressRow` (`done/total`, `role="progressbar"`) + catalog + spec.
- [X] T033 [P] [US1] `web/ui/calendar/`: `DayCell` (`today`, `selected`, `items`, `count`) và `CalendarItem` (`status` review·scheduled·attention·published, `time`, `title`) + catalog + spec.
- [X] T034 [P] [US1] `web/ui/channel-row/ChannelRow.tsx` (`state` connected·expiring·disconnected·manual, `detail?`, `action?`) + catalog + spec; `web/ui/layout/PageHeader.tsx` (`title`, `description?`, `actions?`).
- [X] T035 [US1] `web/ui/field/` (nền của họ ô nhập, dùng ở US3): `Field` (nhãn `label for`, trợ giúp, lỗi **biểu tượng + chữ + cách sửa**, `state` default·focus·error·disabled·readOnly dựng theo token và ghi `designPending`; cỡ chữ ô ≥ 16 px; cao ≥ 44 px; dấu `*` `aria-hidden` kèm `required`) + catalog + spec.
- [X] T036 [US1] Hoàn tất `web/ui/index.ts` (xuất công khai) và rà `web/ui/figma-variants.ts` ↔ thành phần thực (kiểm thử SC-001 xanh, các hàng `designPending` được liệt kê riêng); chạy `node tooling/check-web-rules.mjs` trên `web/ui/**` → 0 vi phạm.

**Checkpoint**: US1 độc lập – danh mục thành phần (T067) có thể dựng từ đây.

---

## Phase 4: User Story 2 – Khung ứng dụng, điều hướng theo quyền, hết phiên tại chỗ (P1)

**Mục tiêu**: thanh bên 7 mục / thanh dưới 5 mục sinh từ một bảng; ẩn mục theo quyền; xử lý 401 giữa chừng tại chỗ; lỗi cô lập.

**Kiểm thử độc lập**: đăng nhập chủ/cộng tác viên/hỗ trợ/quản trị → điều hướng đúng ma trận quyền; thu 1280 → 360 px: thanh bên → thanh dưới, không cuộn ngang; xóa phiên phía máy chủ rồi thao tác → hộp "Phiên đã hết hạn", bản nháp còn.

- [X] T037 [P] [US2] `web/app/shell/nav-registry.ts` (`NAV_ITEMS: readonly NavItem[]` theo data-model mục 3; thanh bên 7 mục: overview, calendar, posts, media, business-profile, channels-plan, settings; thanh dưới: overview, calendar, posts, `more`, `create-post` nổi bật; `area: 'customer'|'internal'`; `badge` `pendingReviewCount|unreadCount`) + `useNavItems.ts` (`{ sidebar, bottom, more }` lọc theo `useCan` và `area`) + `nav-registry.spec.ts` (ma trận vai trò × mục theo `PERMISSIONS`; hai thanh sinh từ cùng mảng).
- [X] T038 [P] [US2] `web/app/errors/` : `NotFound`, `Forbidden` ("Bạn không có quyền" + lối về Tổng quan / "Nhờ chủ tài khoản"), `ErrorPage` (`errorElement`: nút "Tải lại" + "Về Tổng quan"; mã gốc chỉ trong "Chi tiết cho hỗ trợ") + `errors.spec.tsx` (gọi thẳng URL khi thiếu quyền → `Forbidden`, API giả trả 403, không trang trắng).
- [X] T039 [US2] `web/lib/api/auth-gate.ts` (máy trạng thái theo `contracts/app-shell-and-session.md` mục 4: `idle → reauth_required → resumed|switched|ended`; **gộp mọi lời gọi 401 cùng lúc vào MỘT promise**; lời gọi `silentAuth` được bỏ qua; `/auth/me` 401 lúc **mở ứng dụng** vẫn chuyển `/login?next=…`; `reason` ∈ password_changed·removed·locked·revoked → `ended` (thông điệp theo lý do, không "tiếp tục"); chỉ phát lại GET và thao tác `safeToReplay`, **mỗi lời gọi một lần**; duyệt/đăng/xóa/ngắt kết nối **không bao giờ** tự phát lại; `EMAIL_NOT_VERIFIED` giữ hành vi chuyển `/verify-email`) + `auth-gate.spec.ts` (kiểm thử bảng chuyển trạng thái).
- [X] T040 [US2] `web/app/shell/ReauthDialog.tsx` (Radix Dialog tại chỗ, màn và bản nháp nguyên vẹn; đăng nhập lại bằng `POST /auth/login`; **cùng `user.id` & `account.id`** → `resumed`; khác → `clearAllAccountData()` rồi `/`, **không hiển thị email/dữ liệu tài khoản khác**; đăng nhập Google/Facebook qua cửa sổ phụ + `BroadcastChannel`, nếu bị chặn chỉ còn mật khẩu/thư; không đọc/giữ mã phiên, không `localStorage`) + `OfflineBanner.tsx` ("Dữ liệu có thể chưa mới" + "Thử lại") + spec.
- [X] T041 [US2] `web/app/shell/AppShell.tsx` (`TopBar` + `Sidebar` ≥ `lg` 1024 px | `NavBar` < `lg` + `<Outlet/>` + `ReauthDialog` + `OfflineBanner` + `Toaster` của `sonner`; vùng nội dung có `PageHeader`), `MorePage.tsx` (mục "Thêm" trên điện thoại), `ComingSoon.tsx` ("Sắp có") + `AppShell.spec.tsx` (360 px/1280 px, `aria-current`, không cuộn ngang).
- [X] T042 [US2] `web/app/routes.tsx` (react-router: `route.lazy` cho mọi nhóm tuyến; cấu trúc `/login /register …` công khai, `<SessionGate><AppShell>` cho `/ /calendar /posts /media /channels /settings /business-profile /settings/{security,login-methods,members} /more /no-account`; `/internal/**` gói riêng chỉ khi `me` là nhân viên; `/_catalog/**` chỉ khi `import.meta.env.DEV` hoặc `VITE_ENABLE_CATALOG=1`; `errorElement` ở gốc và mỗi nhóm; `react-error-boundary` bao từng vùng với "Thử lại vùng này"; chunk không tải được → `InlineAlert` "Có bản mới – tải lại"); thay `web/app/router.tsx`; `routes.spec.tsx`.
- [X] T043 [US2] Cập nhật `web/app/SessionGate.tsx` dùng `SessionProvider` mới và `AuthGate` (giữ `DETACHED_PATHS` của 009 và chuyển hướng tài khoản chờ/không có tài khoản); khu vực nội bộ `web/internal/` chỉ khung giữ chỗ tải lười; `apps/web/test/auth/session-gate.spec.tsx` cũ **phải vẫn qua**.
- [X] T044 [P] [US2] E2E `apps/web/e2e/shell-roles.spec.ts` (chủ/cộng tác viên/hỗ trợ/quản trị: mục và nút hiện/ẩn đúng; cộng tác viên vào thẳng `/settings/members` → "Bạn không có quyền") và `apps/web/e2e/session-expiry.spec.ts` (xóa phiên → hộp đăng nhập lại; cùng tài khoản → tiếp tục; tài khoản khác → xóa nháp, về Tổng quan; nhiều lời gọi cùng lúc → **một** hộp thoại).

**Checkpoint**: US1 + US2 – khung chạy được với trang giữ chỗ.

---

## Phase 5: User Story 3 – Nền tảng biểu mẫu dùng chung (P1)

**Mục tiêu**: mọi biểu mẫu có lỗi gắn đúng ô, chống gửi trùng, chặn mất dữ liệu, xung đột phiên bản, chỉ xem, nhiều bước, tải tệp.

**Kiểm thử độc lập**: 3 biểu mẫu mẫu (ô đơn, danh sách thẻ từ khóa, tải tệp) chạy đủ 10 kiểm thử của `testForm()` (contracts/forms.md mục 7).

- [X] T045 [US3] `web/ui/form/__tests__/form-contract.ts` (`testForm()` dùng chung, **10 hành vi**: (1) lỗi gắn đúng ô + `aria`; (2) lỗi máy chủ theo ô, tiêu điểm tới ô đầu; (3) lỗi chung có "Thử lại"; (4) bấm nhanh 10 lần = đúng 1 lời gọi; (5) chặn rời trang khi dirty; (6) xung đột phiên bản → hai lựa chọn, không ghi đè; (7) chế độ chỉ xem; (8) không có giá trị `sensitive` trong bản nháp/bộ lưu; (9) `axe` không vi phạm; (10) chỉ thao tác bằng bàn phím) — viết trước, đỏ cho đến khi T046–T052 xong.
- [X] T046 [US3] `web/lib/forms/useAppForm.ts` (bọc `react-hook-form` + `@hookform/resolvers/zod`; `{ schema, defaultValues, version, readOnly, draftKey, onSubmit }`; schema là Zod của `@app/shared` — **cùng lược đồ máy chủ**; `isSubmitting` khóa gửi trùng, Enter không gửi lần hai; `handleServerError(appError)` theo contracts/forms.md mục 3: `fieldErrors` → `setError` đường dẫn chấm + `setFocus` ô lỗi đầu theo `FIELD_ORDER`; `version_conflict` → bật `ConflictNotice`; `session_expired` không xử lý ở đây; còn lại → `InlineAlert` đầu biểu mẫu + "Thử lại" với cùng dữ liệu; **không báo thành công khi chưa có 2xx**).
- [X] T047 [P] [US3] `web/lib/forms/draft-store.ts` (`Map` mức mô-đun, **chỉ RAM**; khóa `${user.id}:${formKey}` tính từ phiên; `FormDraft { formKey, value, savedAt, subject }`; ghi mỗi lần đổi với **debounce 300 ms**; chỉ trường `persistable`, trường `sensitive` (mật khẩu, mã, tệp) không bao giờ vào; khôi phục nếu `subject` khớp; xóa khi gửi thành công/đăng xuất/đổi tài khoản) + `draft-store.spec.ts`.
- [X] T048 [P] [US3] `web/lib/forms/useUnsavedChangesGuard.ts` (rút từ `features/context/useUnsavedChangesGuard.ts` của 006: `ConfirmDialog` "Bỏ các thay đổi chưa lưu?" khi chuyển trang trong ứng dụng + `beforeunload` khi đóng tab) và `web/lib/forms/useWizard.ts` (`steps: [{ id, schema, skippable }]`, một `useAppForm` chung, kiểm theo lược đồ bước hiện tại, "Bỏ qua" và quay lại, bước trong URL `?step=`) + spec.
- [X] T049 [US3] `web/ui/form/Form.tsx` (`<form noValidate>`, `InlineAlert` lỗi chung ở đầu, vùng nút Gửi/Hủy, nút `loading` `aria-busy`, `ConflictNotice`, `ReadOnlyNotice`; chế độ `readOnly` đặt mọi ô `readOnly`/`disabled` + `aria-readonly`, ẩn nút gửi, lý do "Chỉ chủ tài khoản mới sửa được") và `ConflictNotice.tsx` ("Tải bản mới nhất" refetch + `reset` nhưng **giữ bản của tôi** trong khung "Bản của bạn" chỉ đọc; "Giữ bản của tôi để xem lại" giữ giá trị, gắn cờ `stale`, lần gửi kế dùng `version` mới sau khi xác nhận; **không tự gửi lại**) + spec.
- [X] T050 [P] [US3] `web/ui/form/fields/`: `TextField`, `TextAreaField` (bộ đếm ký tự `maxChars`, `aria-live="polite"` khi **≥ 90%** — giữ hành vi 006), `SelectField` (`<select>` gốc), `MultiSelectField` (nhóm hộp kiểm), `DateTimeField` (`<input type="datetime-local">` hiển thị UTC+7, giá trị lưu ISO UTC), `SwitchField` (Radix Switch), mỗi ô dựng trên `Field` (T035) + spec từng ô.
- [X] T051 [P] [US3] `web/ui/form/fields/TagListField.tsx` (`useFieldArray`; thêm/xóa bằng bàn phím cho từ khóa/hashtag; `max`) và biểu mẫu động danh sách chủ đề đề xuất (chọn/sửa/bỏ/thêm) dùng `IdeaCard` + spec.
- [X] T052 [US3] Tải tệp: `web/lib/upload/queue.ts` (hàng đợi **tối đa 3 tệp đồng thời**; lỗi một tệp không dừng tệp khác; thử lại giãn cách **1 s, 3 s, 10 s**; hủy/thử lại từng tệp), `web/lib/upload/validate.ts` (loại/dung lượng trước khi tải; **video ≤ 500 MB**; báo lỗi từng tệp), `web/lib/upload/transports/single.ts` (`UploadTransport.start/putPart/complete`, XHR tải **thẳng lên kho bằng đường dẫn ký sẵn**, không qua API; ngoại lệ `fetch/XHR` có chú thích) và `transports/multipart.ts` (khung, bật khi kho hỗ trợ; bản đầu thử lại cả tệp), `web/ui/upload/{UploadQueue,FileField}.tsx` (thanh tiến độ chữ "%" + `role="progressbar"`, chọn nhiều/kéo-thả, dung lượng đầy → "Đã đầy 5 GB" + "Xóa bớt tệp"); **không** lưu tên tệp/đường dẫn ký sẵn vào bộ lưu cục bộ; spec dùng MSW.
- [X] T053 [US3] Biểu mẫu mẫu cho danh mục `web/catalog/sample/forms/{SingleFieldForm,KeywordsForm,UploadForm}.tsx` đăng ký vào `testForm()`; chạy đủ 10 hành vi (T045) → xanh. Cập nhật `web/ui/figma-variants.ts` cho họ ô nhập.

**Checkpoint**: US1–US3 – nền P1 hoàn chỉnh; có thể chuyển trang hiện có (US6).

---

## Phase 6: User Story 4 – Dữ liệu dùng chung (P2)

**Mục tiêu**: một nguồn dữ liệu cho mỗi đối tượng; vô hiệu hóa đúng phạm vi; làm mới theo lớp; hạn mức khóa nút AI đồng thời; không số tiền AI.

**Kiểm thử độc lập**: MSW; thao tác ghi ở một màn → các nơi khác cập nhật ≤ 1 giây; quay lại màn hiện dữ liệu cũ tức thì rồi cập nhật; mất mạng vẫn thấy dữ liệu + nhãn "dữ liệu có thể chưa mới".

- [X] T054 [US4] `web/lib/api/mutations.ts` (bảng `MUTATIONS` + `invalidates: (vars, result) => QueryKey[]` theo `contracts/data-layer.md` mục 3: duyệt/trả lại/hủy bài → `posts.detail(id)`, `posts.list(*)`, `counters.pendingReview`, `overview.*`, `notifications.unread`; đổi giờ → `posts.detail`, `posts.list(*)`, `calendar.*`; sửa nội dung → `posts.detail`, `posts.list(*)`, `counters.pendingReview`; đăng lại/đánh dấu "Đã đăng" → `posts.detail`, `posts.list(*)`, `usage.current`, `notifications.unread`; kết nối/ngắt kênh → `channels.list`, `overview.*`, `posts.list(*)`; tải lên/xóa media → `media.list(*)`, `usage.current`; lưu hồ sơ → `profile.current`, `profile.versions`; mời/gỡ thành viên → `members.list`, `session.me`; đánh dấu đã đọc → `notifications.list`, `notifications.unread`; tạo bài hàng loạt → `posts.list(*)`, `usage.current`, `jobs.detail(id)`) + `mutations.spec.ts`: mọi thao tác có `invalidates` không rỗng và thao tác đổi số đếm có khóa đếm.
- [X] T055 [P] [US4] Thao tác ghi trên bản ghi dùng chung (FR-018): `web/lib/api/version.ts` (gửi `version` — một cách thống nhất cho mọi tính năng, tiêu đề `If-Match` **hoặc** trường thân; ghi quyết định vào wiki), nhận `409 VERSION_CONFLICT` → `AppError.kind = 'version_conflict'`; `web/ui/alert/StaleNotice.tsx` (`InlineAlert` "Bài viết đã được thay đổi" + nút "Xem bản mới"; thao tác **chưa thực hiện** cho đến khi xem lại và xác nhận làm tiếp) + spec (duyệt/đăng trên bản cũ 100% nhận cảnh báo, 0 lần duyệt nhầm).
- [X] T056 [US4] Cập nhật lạc quan an toàn: trong `hooks.ts` thực hiện `optimistic: { apply, rollback }` cho `reschedule`, `markRead`, `reorder`; máy chủ từ chối → hoàn lại + toast/`InlineAlert` có lý do và cách khắc phục; thao tác `destructive` (xóa, ngắt kết nối, hủy lịch) dùng `ConfirmDialog` **trước** và chờ máy chủ xác nhận, không `optimistic` + `optimistic.spec.tsx`.
- [X] T057 [P] [US4] `web/lib/jobs/useJobProgress.ts` (`JobProgress { jobId, kind, done, total, state: running|succeeded|partial|failed, subjectRef? }`; **chỉ** làm mới mỗi `JOB_POLL_MS = 3000` khi có thành phần gắn + tab visible + `state === 'running'`; dừng sau **5 phút**; kết thúc → vô hiệu hóa theo thao tác tạo việc; thông báo hoàn tất đến qua `notifications.unread` ở lần làm mới sau) + spec dùng đồng hồ giả (dừng khi ẩn tab/xong/gỡ gắn).
- [X] T058 [P] [US4] `web/lib/notifications/NotificationCenter.tsx` (khung: danh sách `notifications.list` lớp `counter`; số chưa đọc nối vào `NavItem.badge` của `Sidebar`/`NavBar`; đánh dấu đã đọc lạc quan) + spec.
- [X] T059 [US4] `web/lib/limits/` : `UsageSnapshot { posts{used,limit}, ai{percent, level normal|near|reached, reopensAt?}, storage{usedBytes,limitBytes} }` (**không có trường tiền** — kiểm thử kiểu), `useUsage()` (lớp `volatile`, MỘT nguồn cho Tổng quan/Gói/nút AI), `useLimit('ai'|'posts'|'storage')` → `{ locked, reason?, reopensAt?, percent }` (`near` ≥ 80% → `UsageMeter warning`; `reached` ≥ 100%), `<LimitGate kind="ai">` (nút AI → `Button locked lockedReason reopensAt`; soạn tay/duyệt/đăng không bị chặn), `ensureFresh` gọi trước thao tác dựa trên `usage` (FR-026) + spec: AI = 100% → mọi nút AI khóa cùng lúc, không số tiền.
- [X] T060 [P] [US4] E2E/đơn vị hai tab và hai tài khoản: `apps/web/e2e/two-tabs.spec.ts` (đăng xuất ở tab A → tab B về `/login`; Application không có dữ liệu tài khoản) và `web/lib/session/two-accounts.spec.tsx` (đăng xuất/đổi tài khoản → 0 dữ liệu tài khoản cũ trong `QueryClient`, DraftStore, `safe-storage`; **quét `localStorage`/`sessionStorage` không có giá trị nhạy cảm** — SC-008).
- [X] T061 [P] [US4] `web/lib/api/stale-data.spec.tsx`: lớp `volatile`/`session` không giữ cache (`gcTime` 0); quay lại màn hiện dữ liệu cũ tức thì rồi làm mới; mất mạng → vẫn xem dữ liệu đã tải, `OfflineBanner` hiện, thao tác ghi báo "Chưa gửi được", dữ liệu nhập còn; phản hồi đến sau khi rời màn không đổi màn khác nhưng vẫn cập nhật dữ liệu dùng chung.

**Checkpoint**: US4 độc lập.

---

## Phase 7: User Story 5 – Mô hình trạng thái hiển thị (P2)

**Mục tiêu**: cùng một cách thể hiện đang tải/trống/lỗi/khóa/một phần.

**Kiểm thử độc lập**: mỗi danh sách mẫu nhận lần lượt 5 tình huống từ máy chủ giả lập; mọi lỗi có ≥ 1 nút hành động; mã gốc chỉ trong "Chi tiết cho hỗ trợ".

- [X] T062 [P] [US5] `web/ui/feedback/Skeleton.tsx` (hình dạng giống nội dung, không nhảy bố cục, `aria-busy`, chuyển động `motion-safe:`) và `EmptyState.tsx` (lời nhắn đời thường + một hành động) + catalog + spec.
- [X] T063 [US5] `web/lib/api/ErrorNotice.tsx` (`AppError → InlineAlert`: lời giải thích + nút hành động tra `lib/catalogs/error-explanations`; "Chi tiết cho hỗ trợ" thu gọn chứa `code` + `traceId`; luôn ≥ 1 hành động — nếu máy chủ không trả thì bổ sung "Thử lại"/"Về Tổng quan") + spec (SC-010).
- [X] T064 [US5] `web/app/AsyncBoundary.tsx` (`<AsyncBoundary query empty lockedBy partial>` nhận kết quả `useApiQuery`; đúng **một** trong 5 mẫu: `loading` (khung chờ + thông báo "Đang tải" cho bộ đọc màn hình), `empty`, `error` (`ErrorNotice` + "Thử lại"), `locked` (giải thích + ngày mở lại), `partial` ("Đã đăng: … · Cần bạn xử lý: …")) + spec 5 tình huống.
- [X] T065 [P] [US5] `web/catalog/fixtures/` + `web/catalog/msw/handlers.ts`: fixtures cho 5 tình huống (loading, empty, error, locked, partial) dùng chung bởi spec và danh mục.
- [X] T066 [P] [US5] `web/lib/format/relative-time.spec.ts` và rà mọi nơi hiển thị thời điểm dùng `lib/format/datetime` (UTC+7, định dạng thống nhất); kiểm thử "trạng thái bài lạ → nhãn trung tính, không trắng trang" trong `AsyncBoundary`/`PostCard`.

**Checkpoint**: US5 độc lập.

---

## Phase 8: User Story 6 – Danh mục thành phần, kiểm thử tự động, chuyển các trang hiện có (P3)

**Mục tiêu**: danh mục chạy độc lập; CI chặn vi phạm; trang cũ dùng nền mới mà không đổi hành vi.

**Kiểm thử độc lập**: kiểm thử cũ của 004, 006, 009 qua 100% không sửa kỳ vọng; axe 0 lỗi nghiêm trọng trên danh mục ở 3 viewport.

### Danh mục

- [X] T067 [US6] `web/catalog/CatalogPage.tsx` + `web/catalog/index.ts` (tải lười; **chỉ** khi `import.meta.env.DEV` hoặc `VITE_ENABLE_CATALOG=1`; liệt kê `*.catalog.tsx` theo nhóm với `{ name, description, a11yNotes, variants }`; chọn khung 360/768/1280 px; công tắc "cỡ chữ 200%" và "tương phản cao"; gắn tuyến `/_catalog/**`).
- [ ] T068 [US6] `web/catalog/sample/SampleScreen.tsx` tại `/_catalog/sample`: danh sách + thẻ + biểu mẫu dựng **chỉ** từ thành phần dùng chung, không dòng viết cứng màu/cỡ chữ/khoảng cách (SC-002); kiểm thử bằng `check-web-rules`.
- [ ] T069 [P] [US6] `apps/web/e2e/catalog.a11y.spec.ts` (`@axe-core/playwright` trên mọi trang danh mục ở 360/768/1280 px: **0 vi phạm mức nghiêm trọng**, không cuộn ngang, vùng chạm ≥ 44 px; công tắc cỡ chữ 200% không cắt nút).

### Chuyển trang hiện có (FR-036) — mỗi nhóm giữ nguyên kiểm thử cũ

- [ ] T070 [US6] Chuyển `web/features/auth/{AuthLayout,PasswordField,ProviderButtons,ConsentNotice}.tsx` sang `ui/*` + `lib/forms`; thay `ErrorNotice` trong `features/auth/ui.tsx` bằng `lib/api/ErrorNotice`/`InlineAlert`. Chạy `apps/web/test/auth/*` → vẫn xanh.
- [ ] T071 [P] [US6] Chuyển `LoginPage`, `RegisterPage`, `StaffLoginPage`, `VerifyEmailPage` sang `useAppForm` + `Form` + ô dùng chung (đăng ký `LoginForm`, `RegisterForm` vào `testForm()`); `test/auth/{login,register,staff-login,verify-email}.spec.tsx` xanh.
- [ ] T072 [P] [US6] Chuyển `ForgotPasswordPage`, `ResetPasswordPage`, `OAuthConfirmPage`, `OAuthResultPage`, `NoAccountPage`, `DataDeletionStatusPage` sang nền mới; `test/auth/{forgot-reset,oauth-result,no-account}.spec.tsx` xanh.
- [ ] T073 [P] [US6] Chuyển `SecuritySettingsPage`, `LoginMethodsPage` và `features/members/{MembersPage,JoinPage}.tsx` (đăng ký "mời thành viên" vào `testForm()`; ẩn mục theo `useCan`); `test/auth/{security-settings,login-methods}.spec.tsx`, `test/members/members.spec.tsx` xanh.
- [ ] T074 [US6] Chuyển `features/context/ProfileForm.tsx` sang `useAppForm` (phép thử RHF: giữ bộ đếm ký tự `aria-live` khi **≥ 90%**, xung đột phiên bản, chỉ xem), `KeywordsInput.tsx` → `TagListField`, `BusinessProfilePage`, `VersionDetailPage`, `VersionHistory` sang `ui/*`; thay `useUnsavedChangesGuard` cục bộ bằng bản ở `lib/forms`; `test/context/*` xanh. **Nếu RHF làm hỏng kiểm thử 006 mà không sửa được**: giữ ô tự viết cho `ProfileForm` và ghi vào Complexity Tracking của plan.md.
- [ ] T075 [US6] Chuyển `features/auth/auth-api.ts`, `social-api.ts`, `features/context/context-api.ts`, `features/members/members-api.ts` sang `lib/api/endpoints/{auth,context,members}.ts` (hàm có kiểu, schema `@app/shared`; đường dẫn API **chỉ** ở `endpoints/`), màn hình dùng `useApiQuery`/`useApiMutation`; thêm các hàng vào `MUTATIONS` (lưu hồ sơ, mời/gỡ thành viên); toàn bộ kiểm thử cũ xanh.
- [ ] T076 [US6] Chuyển `features/auth/session.tsx` sang `lib/session` (`SessionProvider` dùng khóa `session.me()`), nối `StartPage` vào tuyến `/` trong `AppShell`, gắn `OfflineBanner`/`AuthGate`; `test/StartPage.spec.tsx`, `test/auth/session-gate.spec.tsx` xanh.
- [ ] T077 [US6] Dọn: xóa `web/features/auth/ui.tsx`, mọi khối `style={{}}` còn lại trong `web/features/**` (hoặc có chú thích lý do), vỏ tương thích trong `web/lib/api-client.ts`; kiểm tra `grep -r "style={{" apps/web/src/features` chỉ còn trường hợp có chú thích; `check-web-rules` → 0 vi phạm trên toàn `apps/web/src`.

### CI, tài liệu, hoàn thiện

- [ ] T078 [P] [US6] Nối CI (workflow hiện có trong `.github/workflows/` hoặc script gốc): `pnpm typecheck`, `pnpm lint` (kể cả `jsx-a11y`), `node tooling/check-web-rules.mjs`, `node tooling/check-web-bundle.mjs`, `node tooling/check-boundaries.mjs` (web chỉ nhập `@app/shared`), `pnpm --filter @app/web test`, `pnpm --filter @app/web test:e2e`.
- [ ] T079 [P] [US6] `apps/web/docs/ui-guide.md` (FR-037): thêm thành phần (thêm hàng `figma-variants.ts` → thành phần → catalog → spec), thêm mục điều hướng (một phần tử `NAV_ITEMS` + một tuyến + một hàng kiểm thử ma trận quyền), dựng biểu mẫu, khai báo dữ liệu máy chủ + lớp làm mới + hàng `MUTATIONS`, khóa theo quyền/giới hạn, danh sách thư viện bên thứ ba (phiên bản, giấy phép, lớp bọc), quy trình đồng bộ Figma (`figma-tokens.json` → `sync-design-tokens.mjs` → kiểm thử; mục tiêu ≤ 30 phút), quyết định "không bóng đổ" và điểm ngắt `lg` 1024 px.
- [ ] T080 [P] [US6] Kiểm thử hồi quy giá trị thiết kế (SC-012): đổi `--color-brand` trong `figma-tokens.json` → chạy đồng bộ → không tệp thành phần nào đổi (`git diff` chỉ `figma-tokens.json` và khối `@theme`); ghi kết quả vào `quickstart.md` mục 4.

---

## Phase 9: Polish & Cross-Cutting

- [ ] T081 [P] Đo bản dựng đầu: chạy `pnpm --filter @app/web build`, đặt `BUNDLE_BUDGET_KB` thật trong `tooling/check-web-bundle.mjs` và xác nhận `/_catalog`, `/internal` không nằm trong gói khởi đầu (FR-012, SC-006).
- [ ] T082 [P] Quét an toàn: không `localStorage`/`sessionStorage`/IndexedDB chứa dữ liệu tài khoản (E2E quét ở `apps/web/e2e/two-tabs.spec.ts`); không số tiền AI ở khu vực khách hàng (`check-web-rules`); không ghi mã/bí mật vào `console`; chạy bước quét bí mật sẵn có của repo.
- [ ] T083 [P] Cập nhật tài liệu dự án: UI/UX mục 4 (điều hướng 7/5 mục, TikTok, "Đăng tay", "Gợi ý hôm nay", "Đã hủy" cần bổ sung vào Figma) và ghi sự lệch Figma ↔ UI/UX cho PO vào `docs/` hoặc `specs/011-ui-architecture-foundation/figma-extract.md`; đối chiếu `CLAUDE.md` nếu quy ước thêm mới (chạy `pnpm wiki:check`).
- [ ] T084 Chạy toàn bộ `specs/011-ui-architecture-foundation/quickstart.md` (mục 1–4 và 13 kịch bản thủ công) và ghi kết quả; sửa lỗi phát hiện.
- [ ] T085 Rà hiến pháp bằng skill `constitution-review` (đặc biệt nguyên tắc I, III, VI, VII) và cập nhật mục "Kiểm tra hiến pháp" của `plan.md` nếu có đổi; xác nhận không tạo ADR mới là đúng.

---

## Dependencies & Execution Order

### Phase

- **Setup (1)** → không phụ thuộc.
- **Foundational (2)** → sau Setup; **chặn mọi câu chuyện**. T010–T011 (lược đồ + máy chủ) cần SA duyệt, có thể song song với còn lại; T039 (AuthGate) dùng `reason` nên cần T010.
- **US1 (3)** → sau Foundational (cần T024 biểu tượng, T012/T014/T015 danh mục).
- **US2 (4)** → sau Foundational + US1 (dùng `Sidebar`, `NavBar`, `TopBar`, `InlineAlert`, `ConfirmDialog`).
- **US3 (5)** → sau Foundational + US1 (dùng `Field`, `InlineAlert`, `ConfirmDialog`); không phụ thuộc US2 ngoài `ReauthDialog` cho bản nháp (có thể giả lập).
- **US4 (6)** → sau Foundational; phần giao diện (`StaleNotice`, `UsageMeter`) dùng US1.
- **US5 (7)** → sau US1 + `useApiQuery` (Foundational) + T063.
- **US6 (8)** → danh mục (T067–T069) sau US1; chuyển trang (T070–T077) sau US1, US2, US3 (và US4 cho T075–T076).
- **Polish (9)** → sau US6.

### Phụ thuộc quan trọng trong câu chuyện

- T018 ← T017; T021 ← T018, T019, T020; T022 ← T020; T039 ← T010, T018, T022; T040 ← T028, T039; T041 ← T030, T037, T040; T042 ← T038, T041, T043.
- T046 ← T017, T035, T047, T048; T049 ← T028, T046; T050/T051 ← T035; T053 ← T045–T052.
- T054 ← T019, T021; T056 ← T021; T059 ← T020, T026; T064 ← T021, T062, T063.
- T070 ← T026–T036, T046–T050; T074 ← T046–T051; T075 ← T054; T077 ← T070–T076.

### Cơ hội song song

- Setup: T002, T003, T004, T006, T007, T008, T009 sau T001.
- Foundational: T012–T016 cùng lúc; T017/T019/T023/T024/T025 cùng lúc; T010–T011 chạy riêng bởi người phụ trách lược đồ.
- US1: T026–T034 (khác thư mục) chạy song song; T035 sau T026.
- US3: T047, T048, T050, T051 song song sau T035.
- US6: T071, T072, T073 song song sau T070.

### Ví dụ song song – US1

```text
Task: "Button + catalog + spec trong web/ui/button/"           (T026)
Task: "StatusBadge + SuggestionTag trong web/ui/badge/"        (T027)
Task: "InlineAlert + ConfirmDialog trong web/ui/alert/"        (T028)
Task: "ChannelTag, UsageMeter, IdeaCard, PostCard trong web/ui/cards/" (T029)
Task: "Sidebar, NavBar, TopBar trong web/ui/nav/"              (T030)
```

---

## Implementation Strategy

### MVP trước (US1)

1. Setup (T001–T009) → Foundational (T010–T025).
2. US1 (T026–T036): bộ thành phần + token.
3. **DỪNG và kiểm**: `check-web-rules` 0 vi phạm, axe 0 lỗi, `figma-variants` đủ; có thể mở danh mục (T067).
4. Demo cho người thiết kế đối chiếu Figma; gửi danh sách biến thể còn thiếu (Đã hủy, trạng thái lỗi/khóa của Field, hộp thoại, `ChannelTabs` đủ 4 kênh).

### Giao tăng dần

1. Nền + US1 → thành phần.
2. + US2 → khung + hết phiên tại chỗ.
3. + US3 → biểu mẫu; **chuyển trang cũ (T070–T077) có thể bắt đầu từ đây**.
4. + US4/US5 → dữ liệu và trạng thái hiển thị.
5. + US6 → danh mục, CI, tài liệu; Polish.

### Người làm một mình (theo thực tế dự án)

Thứ tự khuyến nghị theo plan.md: Setup → Foundational → US1 → US4 (phần lõi: T054, T059) → US2 → US3 → US5 → US6 → Polish; mỗi pha kết thúc bằng bản chạy được và kiểm thử xanh, commit sau mỗi nhóm tác vụ.

---

## Notes

- Quyết định chưa chốt, **không chặn thi công** (xem research.md "việc còn mở"): SA duyệt `error.reason` (T010–T011); người thiết kế bổ sung Figma còn thiếu và Figma Variables; PO xác nhận bảng màu teal thay xanh dương cho các trang cũ; xác nhận màu "Đã lên lịch"; tính năng Thư viện media quyết định có multipart (T052).
- Mỗi lần chuyển một nhóm trang (T070–T076) phải chạy kiểm thử cũ liền sau; không sửa kỳ vọng kiểm thử cũ.
- Không chạy `docker compose` ở hai checkout cùng lúc (trùng cổng 3000/3001/8080).
