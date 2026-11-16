# Nghiên cứu (Phase 0) – Nền tảng kiến trúc giao diện (011)

Mục đích: chốt các điểm chưa rõ của Technical Context trong `plan.md` và chọn thư viện (FR-038). Nguồn: `spec.md`,
`library-suggestions.md`, mã hiện có ở `apps/web` và `packages/shared`, kiểm tra sổ đăng ký npm ngày 2026-11-15.

Quy ước: mỗi mục gồm **Quyết định · Lý do · Phương án đã loại**. Không mục nào đổi ngăn xếp đã chốt (React + Vite +
TypeScript, react-router) nên **không cần ADR mới**; các lựa chọn dưới đây nằm trong khoảng tự do của ngăn xếp.

## Hiện trạng cần chuyển (đã đọc mã)

- `apps/web` ~ 33 tệp nguồn: auth (14 trang), context (hồ sơ kinh doanh), members. Kiểu dáng là đối tượng
  `style={…}` viết cứng trong `features/auth/ui.tsx` (`#1d4ed8`, `#b91c1c`, 16 px…), `ProfileForm` dùng lại `styles` này.
- `lib/api-client.ts`: một lớp gọi `fetch` đã kiểm phản hồi bằng lược đồ Zod, có `ApiError` và `onAuthError`; **chưa có**
  bộ nhớ đệm, chưa có khóa dữ liệu, chưa phân loại lỗi theo FR-029 (thiếu loại *xung đột phiên bản*, *vượt hạn mức*).
- `SessionGate` tự giữ `useState` cho `/auth/me` và **chuyển trang** khi 401 (`onAuthError` → `navigate(loginPath)`), trái
  FR-011a (không được đẩy người dùng ra đột ngột).
- `useUnsavedChangesGuard` (006) đã có sẵn – rút ra dùng chung nguyên văn ý (`useBlocker` + `beforeunload`).
- `@app/shared`: `ErrorResponse` (có `actions`, `fieldErrors`, `support.traceId`), `ERROR_CODES` (đã có `VERSION_CONFLICT`,
  `FORBIDDEN`, `UNAUTHENTICATED`…), `PERMISSIONS` (nguồn duy nhất cho quyền; web đã dùng), `MeResponse`
  (`role`, `permissions`). **Chưa có**: mã lý do thu hồi phiên (FR-011a), lỗi vượt hạn mức, mã trạng thái bài.
- CI web: Vitest + jsdom + Testing Library + `vitest-axe`; ESLint dùng `strictTypeChecked`; `tooling/check-*.mjs` là chỗ
  đặt các kiểm tra tùy biến của kho (mẫu: `check-web-bundle.mjs`, `check-boundaries.mjs`).

## R1. Giá trị thiết kế (FR-001, SC-012)

**Quyết định**: Tailwind CSS v4 (`tailwindcss` + `@tailwindcss/vite`), toàn bộ giá trị thiết kế khai báo **một lần** trong
`apps/web/src/styles/tokens.css` bằng khối `@theme` (biến CSS `--color-*`, `--text-*`, `--spacing-*`, `--radius-*`,
`--shadow-*`, `--breakpoint-*`, `--duration-*`). Tắt bảng màu/khoảng cách mặc định của Tailwind (`--color-*: initial`) để
chỉ còn tên của Figma dùng được; mọi giá trị khác là lỗi biên dịch/lint. Tệp `tokens.css` là **đích duy nhất** của quy trình
đồng bộ Figma (R12).
**Lý do**: không chạy mã lúc chạy (mục tiêu tải ≤ 3 giây trên 4G), biến CSS đổi một nơi là đổi hết (SC-012), lint cấm giá trị
viết cứng dễ làm bằng ký tự (R9). Thay được toàn bộ khối `style={{}}` hiện có.
**Loại**: CSS Modules (không có hệ giá trị thiết kế, khó cấm giá trị cứng); Emotion/styled-components (tốn tài nguyên lúc
chạy trên điện thoại tầm trung); MUI/Ant/Chakra (khó khớp Figma, nặng).

**Đã trích từ Figma (2026-11-15)** – xem [figma-extract.md](figma-extract.md): 22 màu (teal thương hiệu `#0E6F60`, nền stone ấm, amber "spark" chỉ cho mảng màu), 7 cỡ chữ (Be Vietnam Pro), khoảng cách 4/8/12/16/24/32, bo góc 6/10/16/pill, **chỉ giao diện sáng**; mọi cặp chữ/nền đã tính ≥ 4,5:1 (viền ≥ 3:1). Hai điều chỉnh so với kế hoạch trước: (1) **không** dùng giá trị tạm xanh dương `#1d4ed8` của giao diện cũ nữa – bảng màu Figma là teal, nên việc chuyển trang cũ đổi diện mạo nhưng **không đổi hành vi**; (2) `get_variable_defs` từ xa không chạy được (đòi chọn layer trong Figma desktop) và tệp chưa định nghĩa Variables, nên `figma-tokens.json` nhập từ nhãn hex của trang Nền tảng; đề nghị người thiết kế tạo Figma Variables để đồng bộ tự động về sau. **Không có trong Figma**: bóng đổ (mặc định không bóng, tách bằng viền), chuyển động (tự đặt), điểm ngắt giữa 390 và 1280 px (chọn 1024 px).

## R2. Biến thể thành phần (FR-002)

**Quyết định**: `class-variance-authority` (+ `clsx`, `tailwind-merge`) khai báo biến thể, tên biến thể **trùng tên thuộc tính
Figma** (`variant: primary|secondary|ghost|danger`, `state` → `disabled`/`locked`, v.v.) để SC-001 đối chiếu 1–1.
**Loại**: tự viết bảng lớp thủ công (không có kiểu TypeScript cho tổ hợp biến thể).

## R3. Thành phần tương tác có truy cập (FR-003)

**Quyết định**: Radix UI Primitives, **chỉ các gói cần cho P1**: `react-dialog` (hộp thoại xác nhận, hộp đăng nhập lại,
bảng "Thêm"), `react-tabs` (tab kênh), `react-tooltip` (gợi ý chữ cắt gọn), `react-switch` (công tắc kênh/biểu mẫu).
Ô chọn (`select`) dùng **phần tử gốc của trình duyệt** (tốt nhất cho điện thoại, đã truy cập sẵn, không cần thư viện); thêm
`react-popover`/`react-select`/`react-dropdown-menu` chỉ khi một màn hình thật sự cần. Mỗi gói Radix được **bọc** trong `ui/`
(không để màn hình nhập `@radix-ui/*` trực tiếp – lint `no-restricted-imports`).
**Lý do**: Radix không đóng gói kiểu dáng (khớp Figma tới điểm ảnh), gọn hơn React Aria; ô chọn ngày giờ của Figma ("Ô nhập")
dùng `<input type="datetime-local">` bọc kiểu dáng ở giai đoạn 1 (lịch tùy chỉnh thuộc tính năng Lịch).
**Loại**: React Aria Components (mạnh hơn ở ngày giờ/kéo thả nhưng lớn hơn; xem lại khi làm Lịch); Headless UI (ít thành phần hơn).

## R4. Dữ liệu từ máy chủ (FR-022…026, FR-029, SC-005)

**Quyết định**: `@tanstack/react-query` v5 làm **kho dữ liệu máy chủ duy nhất**, **bọc sau `lib/api`** (màn hình chỉ thấy
`useApiQuery`/`useApiMutation` và bộ khóa `queryKeys`; không nhập thẳng `@tanstack/react-query` – lint). Điểm then chốt:
- **Một `QueryClient`**, không có persister → bộ nhớ đệm chỉ nằm trong bộ nhớ tab (thỏa FR-027 mặc định, không cần quét).
- **Khóa dữ liệu** là hàm của `lib/api/query-keys.ts` (nhà máy khóa có kiểu), dạng phân cấp `['posts','list',{status}]`,
  `['posts','detail',id]`, `['usage']`, `['notifications','unread']`; **ma trận vô hiệu hóa** ánh xạ mỗi thao tác ghi → các
  khóa cần làm mới (`contracts/data-layer.md` mục 3). Đây là cách đạt SC-005 (đổi một bài → danh sách, chi tiết, số đếm,
  Tổng quan cùng cập nhật).
- **Quy tắc làm mới theo loại dữ liệu** (FR-024) đặt bằng `staleTime`/`gcTime` theo *lớp dữ liệu* (`catalog` / `entity` /
  `counter` / `volatile`), không rải con số trong màn hình (bảng ở `data-model.md` mục 4).
- Làm mới khi mở màn (`refetchOnMount`) và khi quay lại tab (`refetchOnWindowFocus`); **tắt** `refetchInterval` mặc định
  (giai đoạn 1 không làm mới định kỳ). Ngoại lệ duy nhất là `useJobProgress` (R8).
- **Cập nhật lạc quan** chỉ qua `optimistic` có khai báo rõ trong định nghĩa thao tác (đổi giờ, đánh dấu đã đọc, sắp xếp lại);
  duyệt/đăng lại/xóa/ngắt kết nối **không** có tùy chọn này (kiểu TypeScript cấm) – FR-025.
- **Dữ liệu cấm lưu lâu** (FR-026): lớp dữ liệu `volatile` (`usage`, `publishAttempt`, `channelAuth`) có `staleTime: 0`,
  `gcTime: 0`; hàm `ensureFresh(key)` gọi `fetchQuery({staleTime: 0})` trước khi dựa vào chúng để chặn/cho phép thao tác quan trọng.
- **Mất mạng** (Story 4 – dữ liệu đã tải vẫn xem được; SC-006): `onlineManager` của TanStack + biểu ngữ "dữ liệu có thể chưa mới".

**Lý do**: đúng nhu cầu "một nguồn, khóa, làm mới đúng phạm vi, hiện dữ liệu cũ rồi làm mới ngầm, hoàn tác lạc quan"; tránh tự
viết (dễ sai điều kiện đua). Bọc lại để thay thế/nâng cấp một nơi (hiến pháp IX).
**Loại**: SWR (thiếu quản lý biến đổi/vô hiệu hóa theo khóa phân cấp), RTK Query/Redux (nặng), tự viết `useEffect` + context
(chính là cách đang gây trùng lặp).

## R5. Trạng thái giao diện tạm và URL (FR-022c)

**Quyết định**: **không thêm Zustand ở tính năng này.** Bộ lọc/tab chia sẻ được → tham số tìm kiếm của react-router (hook
`useUrlState` mỏng); trạng thái cục bộ → `useState`/`useReducer`; lựa chọn nhiều bài và ngăn mở/đóng là nhu cầu của tính năng
sau → khi đó thêm Zustand (đã nằm trong danh sách "thêm đúng lúc" ở `library-suggestions.md` mục 5).
**Lý do**: YAGNI, người làm một mình, mỗi thư viện thêm là chi phí bảo trì. Ranh giới "bốn loại trạng thái" (FR-022) được giữ bằng
**cấu trúc thư mục + lint** chứ không cần thư viện: `lib/api` (a), `lib/session` (b), `lib/ui-state` + URL (c), `lib/catalogs` (d).
**Loại**: Zustand ngay bây giờ (chưa có dữ liệu loại (c) nào cần chia sẻ chéo màn hình); Redux.

## R6. Biểu mẫu (FR-013…021, SC-007)

**Quyết định**: `react-hook-form` + `@hookform/resolvers` (resolver Zod) **bọc sau `ui/form`** (`<Form>`, `<Field>`,
`useAppForm`). Lược đồ kiểm tra là **chính lược đồ Zod của `@app/shared`** (đã dùng ở 006). Nền tảng cung cấp: ô nhập có
nhãn/trợ giúp/đếm ký tự/lỗi liên kết `aria-describedby`; `applyServerErrors(error)` ánh xạ `ApiError.fieldErrors()` → `setError`
và `setFocus` vào ô lỗi đầu tiên; khóa gửi trùng (`isSubmitting` + chặn Enter); `useUnsavedChangesGuard` (rút từ 006);
`useVersionedForm` (gửi `version`, nhận `VERSION_CONFLICT` → `ConflictNotice` "Tải bản mới nhất / Giữ bản của tôi"); chế độ
`readOnly` theo quyền (`useCan`); `useFieldArray` cho thẻ nhập danh sách và biểu mẫu động; `useWizard` cho nhiều bước.
**Thay đổi so với 006**: 006 ghi "không thêm thư viện biểu mẫu (R11)" vì khi đó chỉ có một biểu mẫu. Nay có ≥ 5 biểu mẫu sắp
tới, nhiều bước + danh sách động (FR-020) nên thư viện có lợi thật. **Chuyển `ProfileForm` sang nền mới là bài kiểm thử
chấp nhận** (kiểm thử 006 phải vẫn qua – SC-011); nếu việc chuyển cho thấy RHF làm hỏng hành vi (ví dụ `aria-live` của bộ
đếm) thì giữ nguyên ô tự viết và chỉ dùng RHF cho biểu mẫu mới → ghi vào `Complexity Tracking` nếu xảy ra.
**Loại**: Formik (ngừng phát triển chậm, render lại nhiều); TanStack Form (còn mới, ít tài liệu tiếng thông dụng); tự viết (đã
chứng minh lặp lại khó: 006 viết riêng chặn rời trang, xung đột phiên bản, đếm ký tự).

## R7. Thời gian và định dạng (FR-006, Story 5 tình huống 5)

**Quyết định**: `Intl.DateTimeFormat('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh' })` trong `lib/format/datetime.ts`
(`formatDateTime`, `formatDate`, `formatTime`, `formatRelative`, `toUtcIso`). **Không thêm date-fns/@date-fns/tz** ở tính năng
này (UTC+7 không có giờ mùa hè nên dịch cố định; không cần phép tính lịch phức tạp). Thêm `date-fns` khi tính năng Lịch cần
số học tuần/tháng.
**Lý do**: 0 byte thêm. **Loại**: Moment (đã ngừng), Day.js (thừa).

## R8. Việc nền, tiến độ và thông báo (FR-030)

**Quyết định**: hook `useJobProgress(jobId | scope)` dựa trên `useApiQuery` với `refetchInterval` **chỉ bật khi** có component
đang gắn (`enabled`) **và** tab đang hiển thị **và** trạng thái chưa kết thúc; dừng khi xong/lỗi/rời màn (TanStack tự hủy khi
gỡ gắn). Chu kỳ 3 giây (hằng `JOB_POLL_MS`), tối đa 5 phút rồi dừng và hiện "Tải lại". Số thông báo chưa đọc và trung tâm thông
báo là dữ liệu lớp `counter`, làm mới khi mở màn/quay lại tab/sau thao tác ghi liên quan — **không** định kỳ. Không WebSocket/SSE
(cần ADR – hiến pháp IX).

## R9. Truy cập, cấm giá trị cứng, quét số tiền AI (FR-003, FR-034, SC-002/003/009)

**Quyết định**:
- **Truy cập tự động**: `vitest-axe` trên từng biến thể (có sẵn) + `eslint-plugin-jsx-a11y` (thêm vào `eslint.config.mjs` cho
  `apps/web`). jsdom **không tính được tương phản màu** (không áp CSS Tailwind) nên **tương phản kiểm bằng kiểm thử đơn vị trên
  `tokens.css`**: đọc cặp (chữ, nền) khai báo trong `tokens.contrast.ts` và tính tỷ lệ WCAG; cộng thêm quét `@axe-core/playwright`
  trên danh mục thành phần ở trình duyệt thật (360/768/1280 px) trong CI.
- **Cấm giá trị viết cứng**: tạo `tooling/check-web-rules.mjs` (cùng họ `check-*.mjs`, chạy trong `pnpm verify`/CI), quét
  `apps/web/src/**` (trừ `styles/tokens.css`, `catalog/fixtures`): mẫu `#rgb[a]`, `rgb(`/`hsl(`, giá trị tùy ý của Tailwind
  (`[#…]`, `text-[13px]`, `p-[7px]`), `style={{…}}` có thuộc tính màu/cỡ chữ/khoảng cách số. Báo vị trí, thoát mã ≠ 0.
- **Quét số tiền AI ở khu vực khách hàng (SC-009)**: cùng tệp kiểm tra – cấm nhập/biến tên `*MicroUsd`, `costUsd`, định dạng
  `$`/`USD`/`US$` trong `apps/web/src/**` ngoài khu vực nội bộ (`apps/web/src/internal/**`); cộng kiểm thử E2E trên màn hình mẫu.
**Loại**: stylelint (web đã không dùng tệp CSS rời, chỉ có `tokens.css`); `eslint-plugin-better-tailwindcss` (chưa cần khi đã
cấm giá trị tùy ý bằng mẫu; thêm sau nếu lộ thiếu sót).

## R10. Danh mục thành phần và giả lập máy chủ (FR-033, FR-035)

**Quyết định**: **không dùng Storybook ở giai đoạn này.** Dựng **danh mục trong chính ứng dụng** tại `/_catalog` (chỉ có khi
`import.meta.env.DEV` hoặc biến `VITE_ENABLE_CATALOG=1`; tải lười để không vào gói sản xuất – kiểm bằng `check-web-bundle.mjs`).
Mỗi thành phần có tệp `*.catalog.tsx` liệt kê biến thể/trạng thái; trang `/_catalog` hiển thị theo bảng, có công cụ chọn
360/768/1280 px (khung `iframe`/lớp chứa có chiều rộng cố định) và công tắc "cỡ chữ 200%/tương phản cao". **MSW v3** làm máy chủ
giả cho danh mục, kiểm thử Vitest (Node) và phát triển; năm tình huống tải/trống/lỗi/khóa/một phần có sẵn trong `catalog/fixtures`.
Playwright mở danh mục để chạy axe và chụp ảnh so sánh (ảnh **chỉ** cho `PostCard`/`CalendarItem`, FR-035 "MAY").
**Lý do**: Storybook thêm ~100+ gói phụ thuộc và công cụ riêng cho người làm một mình; chưa rõ tương thích Vite 8; danh mục
trong ứng dụng dùng chính bộ biên dịch/kiểm thử đang có, miễn phí, và một tệp `*.catalog.tsx` vừa là tài liệu vừa là dữ liệu
cho kiểm thử axe. Điều kiện xem lại: nếu nhóm lớn hơn hoặc cần xuất bản danh mục cho người thiết kế → thêm Storybook (khi đó
`*.catalog.tsx` chuyển thành stories gần như nguyên xi).
**Loại**: Storybook (trên); Ladle (nhẹ nhưng ít được dùng, thêm công cụ lạ); Chromatic (trả phí).

## R11. Biểu tượng và phông chữ (FR-002 bộ ≥ 26 biểu tượng, FR-012)

**Quyết định**: biểu tượng **xuất SVG từ Figma** vào `apps/web/src/ui/icons/svg/`, nạp bằng `vite-plugin-svgr` thành thành phần
React (`<Icon name="check" />` từ danh sách có kiểu; `aria-hidden` mặc định, `title` khi biểu tượng mang nghĩa). 26 tên đã chốt từ Figma (figma-extract.md mục 5), xuất bằng Figma MCP `download_assets` khi dựng `Icon`; kiểm bằng kiểm thử "đủ 26 tên". Phông: **Fontsource tự lưu**
(gói `@fontsource/be-vietnam-pro` 5.3.0, OFL-1.1; chỉ độ đậm Figma dùng 400/500/600/700, tập con `vietnamese` + `latin`) – phông **Be Vietnam Pro** theo Figma. Không gọi Google Fonts (ADR-10).
**Loại**: `lucide-react` (chỉ dự phòng, không cài lúc này); phông hệ thống thuần (chữ tiếng Việt kém nhất quán giữa Android/iOS).

## R12. Quy trình đồng bộ Figma → mã (FR-037, SC-012)

**Quyết định**: Figma MCP → `get_variable_defs` ghi vào một tệp JSON trung gian `apps/web/src/styles/figma-tokens.json`
(commit), một script `tooling/sync-design-tokens.mjs` sinh ra phần `@theme` của `tokens.css` từ JSON đó (không sửa tay giữa
dấu `/* BEGIN generated */…/* END generated */`). Nếu Figma chưa có biến (variables) đầy đủ: nhập JSON tay một lần, mọi thứ sau
đó giống nhau. Không dùng Style Dictionary/Tokens Studio (thêm công cụ cho chừng 40 giá trị). Code Connect MAY thêm sau.
Quy trình mô tả trong `apps/web/docs/ui-guide.md` (FR-037).

## R13. Điều hướng, quyền và phiên (FR-007…011a)

**Quyết định**:
- **Cây điều hướng** là một mảng khai báo `app/shell/nav-registry.ts` (`id`, `labelKey`, `icon`, `path`, `permission?`,
  `area: 'customer'|'internal'`, `mobile: 'bottom'|'more'|'hidden'`, `order`). `Sidebar` và `NavBar` cùng đọc `useNavItems()`
  (đã lọc theo quyền). Thanh dưới = Tổng quan, Lịch, Bài viết, **Thêm** (mở màn `/more` liệt kê mục còn lại), và **Tạo bài**
  (nút nổi bật ở giữa, quyền `post.edit`). Các đường dẫn của tính năng chưa có (Lịch…) trỏ trang giữ chỗ "Sắp có" dùng chung.
- **Quyền một cơ chế**: `useCan(permission)` / `<Can permission>` đọc `me.permissions` (mã quyền từ `PERMISSIONS` của
  `@app/shared`), **không** so chuỗi vai trò (lint cấm `me.role ===` ngoài `lib/session`). `Locked` hiển thị nút ở dạng khóa kèm lý do.
- **Hết phiên không đẩy ra** (FR-011a): `lib/api` phát sự kiện `session-expired` qua `AuthGate` (một promise dùng chung →
  một hộp thoại dù nhiều lời gọi thất bại). `ReauthDialog` (Radix Dialog) giữ nguyên màn hình; đăng nhập thành công: so `me.user.id`
  và `me.account.id` với phiên cũ → *cùng* → phát lại các lời gọi `replayable` (GET, hoặc thao tác ghi đánh dấu `safeToReplay`
  như lưu nháp) và với thao tác khác hiện "Bạn bấm lại để gửi"; *khác* → `clearAllAccountData()` rồi về Tổng quan.
  **Đăng nhập lại tại chỗ** dùng chính API `/auth/login` hiện có (không cần điểm cuối mới); đăng nhập bằng Google/Facebook (009) trong
  hộp thoại mở bằng chuyển trang → **ngoại lệ chấp nhận**: lưu bản nháp trong bộ nhớ không giúp khi tải lại trang, nên nút
  Google/Facebook ở hộp thoại dùng cửa sổ phụ (`window.open`) và nhận kết quả bằng `BroadcastChannel`; nếu bị chặn cửa sổ phụ → hiển thị
  chỉ đăng nhập bằng mật khẩu/thư (cách khác vẫn dùng được, hiến pháp VI).
- **Lý do thu hồi phiên** (FR-011a, đoạn "bị thu hồi vì lý do khác"): máy chủ hiện chỉ trả `UNAUTHENTICATED` không kèm lý do
  (`core/auth/auth-errors.ts:15`). Cần **một thay đổi nhỏ, cộng thêm, tương thích ngược** phía máy chủ: thêm trường tùy chọn
  `error.reason` (`expired | revoked | password_changed | removed | locked`) vào `ErrorResponse` ở `@app/shared` và điền ở các
  chỗ thu hồi phiên của tính năng 004/009. Web không có `reason` → coi là `expired` (hộp thoại tiếp tục). Đây là **việc duy nhất
  chạm máy chủ**, nhỏ, nằm trong nhóm tác vụ riêng (xem `tasks` sau), tuân thủ hiến pháp (lược đồ chỉ thêm).
- **Nhiều tab** (FR-028, biên): `BroadcastChannel('app-session')` phát `logout`/`account-switched`; mọi tab xóa bộ nhớ đệm và về
  đăng nhập. Không dùng `localStorage` event (tránh ghi gì ra bộ lưu lâu dài).

## R14. Tải tệp lên (FR-021)

**Quyết định**: tự viết `ui/upload` + `lib/upload` quanh **`XMLHttpRequest`** (cần sự kiện tiến độ; `fetch` chưa có tiến độ tải
lên) với giao diện `UploadTransport` gồm `start(file) → {parts[]}`, `putPart(url, blob, onProgress, signal)`, `complete(parts)`.
Hàng đợi có giới hạn đồng thời (3 tệp), thử lại từng tệp/phần với giãn cách, kiểm loại/dung lượng trước (video ≤ 500 MB,
ảnh theo cấu hình), báo đầy 5 GB. Bản đầu cài `SinglePutTransport` (đường dẫn ký sẵn đơn) + `MultipartTransport` (phần ≥ 5 MiB)
chạy với máy chủ giả MSW; **điểm cuối ký sẵn thật thuộc tính năng Thư viện media** (module `media`, chưa có).
**Lý do**: Uppy kéo theo cả bộ giao diện riêng không khớp Figma và nhiều gói; nhu cầu chỉ là hàng đợi + tiến độ + thử lại.
**Rủi ro**: "tiếp tục khi mạng chập chờn" đúng nghĩa cần multipart phía máy chủ; ghi vào `plan.md` – nếu tính năng media chưa
hỗ trợ multipart thì bản đầu chỉ thử lại cả tệp (mức chấp nhận, ghi giả định). **Loại**: Uppy; tus (cần máy chủ tus).

## R15. Trạng thái bài, kênh và thông điệp lỗi chuẩn (FR-005, FR-006, Story 4.7)

**Quyết định**: danh mục tĩnh (loại (d)) đặt ở `apps/web/src/lib/catalogs/` dưới dạng TypeScript thuần (không tải từ máy chủ):
`post-status.ts` (bảng quy đổi trạng thái hệ thống → trạng thái hiển thị gồm quy tắc *tổng = xấu nhất của các kênh* và ẩn
*Chờ thử lại/Không xác định*; **mặc định rơi về "Đang cập nhật"** cho giá trị lạ – kiểm thử bằng bảng đầy đủ), `channels.ts`
(Facebook, Instagram, TikTok, Zalo OA + khả năng "Đăng tay" do **máy chủ báo**, không tự suy), `error-explanations.ts` (mã lỗi →
lời giải thích + hành động, dùng khi máy chủ không kèm sẵn; ưu tiên `message`/`actions` do máy chủ trả, đúng `ErrorResponse`).
Chuỗi chữ hiển thị gom vào `lib/i18n/vi.ts` (đối tượng lồng có kiểu, hàm `t('key')`), **không** thêm thư viện i18n (FR-006 chỉ
yêu cầu gom về một nơi).
**Phụ thuộc phía `@app/shared`**: mã trạng thái bài hệ thống chưa có trong `@app/shared` (module `content`/`approval`/`publishing`
còn là khung rỗng). Bảng quy đổi nhận **đầu vào là chuỗi** và kiểm thử đủ các trạng thái nêu ở UI/UX mục 7; khi các module có
enum thật thì đổi kiểu đầu vào (một dòng) – ghi vào `open-questions` của wiki.

## R16. Lỗi cô lập, tải mã theo màn, nội bộ (FR-011, FR-012)

**Quyết định**: `React.lazy` + `route.lazy` của react-router cho **mỗi nhóm màn hình**; khu vực nội bộ (`/internal/**`) và
danh mục thành phần là **gói riêng** không bao giờ tải với người dùng khách hàng (kiểm bằng ngân sách kích thước trong
`check-web-bundle.mjs`: gói khởi đầu ≤ ngưỡng, có kiểm tra "không chứa chuỗi của khu vực nội bộ"). `errorElement` ở gốc và ở
từng nhóm tuyến (react-router) + `react-error-boundary` cho vùng con của một màn (thẻ, danh sách). Trang `NotFound`,
`Forbidden`, `ErrorPage` tiếng Việt kèm nút về Tổng quan.

## R17. Kiểm tra chéo và quét dữ liệu nhạy cảm ở trình duyệt (SC-008)

**Quyết định**: (1) một **bộ lưu cục bộ có danh sách trắng** `lib/safe-storage.ts` (chỉ các khóa `ui.*` đã đăng ký; mọi
`localStorage`/`sessionStorage` khác bị lint cấm bằng `no-restricted-globals`/`no-restricted-properties` trong `apps/web`); xóa
toàn bộ khi đăng xuất/đổi tài khoản; (2) kiểm thử Vitest "hai tài khoản trên một trình duyệt" (đăng nhập A → tải dữ liệu →
đăng xuất → đăng nhập B → không có khóa nào của A trong `QueryClient`, `safe-storage`, bản nháp); (3) E2E quét `localStorage`,
`sessionStorage`, `IndexedDB`, `document.cookie` (không thấy cookie phiên vì HttpOnly) tìm mẫu mã phiên/mã quyền/email.

## Tổng kết thư viện (phiên bản **cố định chính xác**, kiểm sổ đăng ký 2026-11-15)

| Gói | Phiên bản | Giấy phép | Loại | Ghi chú |
|---|---|---|---|---|
| `tailwindcss`, `@tailwindcss/vite` | 4.3.5 | MIT | dev (CSS dựng sẵn) | peer Vite `^8` ✔ |
| `class-variance-authority` | 0.7.1 | Apache-2.0 | dep | |
| `clsx` | 2.1.1 | MIT | dep | |
| `tailwind-merge` | 3.7.0 | MIT | dep | |
| `@radix-ui/react-dialog` | 1.3.1 | MIT | dep | peer React 19 ✔ |
| `@radix-ui/react-tabs` | 1.2.1 | MIT | dep | |
| `@radix-ui/react-tooltip` | 1.4.1 | MIT | dep | |
| `@radix-ui/react-switch` | 1.4.1 | MIT | dep | |
| `@tanstack/react-query` | 5.107.1 | MIT | dep | bọc sau `lib/api` |
| `react-hook-form` | 7.92.0 | MIT | dep | bọc sau `ui/form` |
| `@hookform/resolvers` | 7.0.6 | MIT | dep | resolver Zod (`zod` 4.6.7 đã có ở shared) |
| `sonner` | 2.0.8 | MIT | dep | chỉ toast xác nhận ngắn |
| `react-error-boundary` | 6.1.6 | MIT | dep | vùng con của màn |
| `@fontsource/be-vietnam-pro` | 5.3.0 | OFL-1.1 | dep | phông của Figma; tự lưu |
| `vite-plugin-svgr` | 5.2.0 | MIT | dev | |
| `msw` | 3.0.6 | MIT | dev | cần Node ≥ 22.12 (repo dùng 24 ✔) |
| `eslint-plugin-jsx-a11y` | 6.10.2 | MIT | dev | |
| `@playwright/test` | 1.65.1 | Apache-2.0 | dev | |
| `@axe-core/playwright` | 4.14.0 | MPL-2.0 | dev | chỉ dùng trong CI, không vào gói sản phẩm ✔ |

**Hoãn** (thêm đúng lúc tính năng cần): `zustand`, `@dnd-kit/*`, `@tanstack/react-virtual`, `date-fns` + `@date-fns/tz`,
`uppy`, `storybook`, `lucide-react`. **Không dùng**: MUI/Ant/Chakra, Redux, Moment, CSS-in-JS lúc chạy, phông/CDN ngoài nước,
Chromatic, kênh đẩy.

Mọi gói bên trên đều là mã nguồn mở cho dùng thương mại (MPL-2.0 chỉ ở công cụ kiểm thử, không phân phối). Nhập khẩu đều đi
qua tệp bọc để thay thế một nơi (FR-038).

## Việc còn mở (đưa vào `docs/wiki/open-questions.md` khi ingest)

1. ~~Liên kết Figma~~ **Đã có** (2026-11-15, figma-extract.md). Còn: người thiết kế tạo Figma Variables để đồng bộ tự động; xác nhận màu "Đã lên lịch".
2. Người thiết kế bổ sung vào Figma: huy hiệu "Đã hủy"; trạng thái lỗi/tiêu điểm/khóa/chỉ xem của `Field` và các ô còn thiếu; `ChannelTabs` đủ 4 kênh; khung chờ, hộp thoại, trang trống/lỗi (figma-extract.md mục 4).
3. Điểm cuối ký sẵn có hỗ trợ multipart không (tính năng Thư viện media) – quyết định mức "tiếp tục khi mạng chập chờn" (R14).
4. Trường `error.reason` cho `UNAUTHENTICATED` (R13) – cần PO/SA xác nhận mở rộng `ErrorResponse` (cộng thêm).
5. Cập nhật UI/UX mục 4 (điều hướng 7/5 mục), mô tả TikTok/"Đăng tay"/"Gợi ý hôm nay" (spec Assumptions).
