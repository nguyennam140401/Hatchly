# Mô hình dữ liệu tầng giao diện (Phase 1) – 011

Tính năng **không tạo bảng, schema hay migration** ở máy chủ. Các "thực thể" dưới đây là kiểu TypeScript và cấu trúc dữ
liệu trong `apps/web` (và một thay đổi lược đồ cộng thêm ở `@app/shared`, mục 9). Tên mã tiếng Anh; ánh xạ thuật ngữ ghi ở
mục 10 (theo CLAUDE.md: một ánh xạ cho mỗi thuật ngữ).

## 1. Giá trị thiết kế (`DesignToken`) – FR-001

Nguồn: Figma trang "Nền tảng" → [figma-extract.md](figma-extract.md) → `src/styles/figma-tokens.json` → sinh khối `@theme` trong
`src/styles/tokens.css` (R12). **Chỉ giao diện sáng** (Figma). Tên token trùng tên Figma để đối chiếu 1–1.

| Nhóm | Tên (biến CSS → lớp Tailwind) | Giá trị (Figma) |
|---|---|---|
| Nền/đường | `--color-surface-{0,100,200}`, `--color-line`, `--color-line-strong` | #FFFFFF · #F7F6F2 · #EEECE6 · #DAD7CF · #8C887E |
| Chữ | `--color-ink`, `--color-ink-muted` | #1C1B19 · #5E5B54 |
| Thương hiệu (teal) | `--color-brand`, `-strong`, `-soft`, `--color-on-brand` | #0E6F60 · #0A584C · #DCEFEA · #FFFFFF |
| Ý tưởng (amber) | `--color-spark`, `-soft`, `-ink` | #E8912A (chỉ mảng màu) · #FCEBD3 · #8A4B05 |
| Ngữ nghĩa | `--color-{success,warning,danger,info}` + `-soft` | #1E7A3A/#E1F2E5 · #7A4F00/#FFF1CC · #B42318/#FDE4E1 · #1D5FA8/#E2ECF8 |
| Chữ | `--text-{display,title,heading,body,body-sm,label,caption}` (cỡ/dòng/đậm) | 32/40·700 · 24/32·700 · 18/26·600 · 16/24·400 · 14/20·400 · 14/20·600 · 12/16·500; phông **Be Vietnam Pro** |
| Khoảng cách | `--spacing-{1,2,3,4,6,8}` | 4 · 8 · 12 · 16 · 24 · 32 (không có 5, 7) |
| Bo góc | `--radius-{sm,md,lg,pill}` | 6 · 10 · 16 · 999 |
| Vùng chạm | `--size-touch` | 44 px (cao nút/ô nhập/chip trong Figma) |
| Khung | `--size-topbar` 56 · `--size-navbar` 64 · `--size-sidebar` 248 · `--space-gutter` 16 · `--size-phone` 390 | từ Figma |
| Điểm ngắt | `--breakpoint-lg` | 1024 px (thanh bên từ ≥ lg, Story 2.1); Figma chỉ có 390 và 1280 – điểm ngắt giữa do ta chọn, ghi vào ui-guide |
| Chuyển động | `--duration-{fast,base}`, `--ease-standard` | **Figma không có** → tự đặt 120/200 ms; về 0 khi `prefers-reduced-motion` |
| Bóng | — | **Figma không có**: mặc định không bóng, tách lớp bằng viền `line` (quyết định ghi vào ui-guide) |

Màu trạng thái bài **suy ra** từ bảng ngữ nghĩa Figma (Đã đăng=success, Đang đăng=info, Chờ duyệt=warning, Cần bạn xử lý=danger, Gợi
ý hôm nay=spark, Nháp=surface-200/ink-muted); Đã lên lịch = brand-soft/brand là **giả định** cần xác nhận khi lấy
`get_design_context` của `StatusBadge`. Màu kênh không có trong Figma → không dùng màu kênh; nhận diện kênh bằng chữ + biểu tượng.

**Quy tắc kiểm tra**: mọi cặp (chữ, nền) trong `tokens.contrast.ts` đạt ≥ 4,5:1 (chữ) / ≥ 3:1 (viền, biểu tượng); các cặp đã tính ở
figma-extract.md mục 1 (thấp nhất: success/success-soft 4,62; line-strong/surface-100 3,27). `spark` (2,47:1) **bị cấm làm màu chữ** –
kiểm thử cấm lớp `text-spark`. Không có giá trị nào ngoài bảng này xuất hiện trong mã (R9).

## 2. Thành phần (`ComponentSpec`) – FR-002, SC-001

Mỗi thành phần là một thư mục `src/ui/<tên>/` gồm `<Tên>.tsx`, `<Tên>.catalog.tsx`, `<Tên>.spec.tsx`. **Tên mã = tên thành phần
Figma** (đối chiếu 1–1; tên trong spec gốc ở cột phải). Bảng biến thể là **dữ liệu** trong `src/ui/figma-variants.ts` (dùng cho
kiểm thử "đủ biến thể" SC-001):

| Thành phần (Figma) | Thuộc tính biến thể | Số tổ hợp | Tên cũ trong spec |
|---|---|---|---|
| `Button` | `variant`: primary(Chính)·secondary(Thường)·ghost(Nhẹ)·danger(Nguy hiểm) × `state`: default·locked (+`loading` do ta thêm) | 8 (+4) | Nút |
| `StatusBadge` | `status`: draft·review·scheduled·publishing·published·attention (Figma 6) + **cancelled** (chưa có trong Figma) + `unknown` | 6 (+2) | Huy hiệu trạng thái |
| `SuggestionTag` | "Gợi ý hôm nay" – Figma vẽ **trong cùng bộ StatusBadge**; mã tách thành thành phần riêng (không thuộc bảng trạng thái bài – Clarifications) dùng chung kiểu dáng | 1 | Nhãn "Gợi ý hôm nay" |
| `ChannelTag` | `channel`: facebook·tiktok·instagram·zalo × `manualPublish`: có·không | 8 | Thẻ kênh |
| `UsageMeter` | `level`: normal·warning·exhausted | 3 | Thanh mức sử dụng |
| `IdeaCard` | `featured`: có·không | 2 | Thẻ chủ đề đề xuất |
| `PostCard` | — (+ `status` qua `StatusBadge`) | 1 | Thẻ bài |
| `NavBar` (thanh dưới) / `Sidebar` / `TopBar` (`kind`: logo·back) | `active` theo mục: 5 / 7 / — | 5 / 7 / 2 | Thanh điều hướng dưới / bên / trên |
| `InlineAlert` | `tone`: info·warning·error | 3 | Cảnh báo nội dòng |
| `Chip` | `selected` | 2 | Chip |
| `ChannelTabs` | `selected` – Figma chỉ vẽ Facebook·TikTok; mã nhận danh sách kênh bất kỳ | 2 (+2) | Tab kênh |
| `StepRow` | `state`: done·error·pending | 3 | Dòng bước |
| `ChannelRow` | `state`: connected·expiring·disconnected·manual | 4 | Dòng kênh |
| `DayCell` | `selected` | 2 | Ô ngày |
| `CalendarItem` | `status`: review·scheduled·attention·published | 4 | Mục lịch |
| `Field` (+ họ ô nhập) | Figma: 1 biến thể; mã thêm `state`: default·focus·error·disabled·readOnly (dựng theo token) | 1 (+4) | Ô nhập |
| `Logo` | — | 1 | (Logo ở TopBar) |
| `Icon` | `name` ∈ 26 tên (figma-extract.md mục 5) | 26 | Bộ biểu tượng |

Ghi chú: các cột "(+n)" là biến thể **chưa có thiết kế**; kiểm thử đánh dấu chúng là `designPending` (không tính vào SC-001 100%
cho đến khi Figma bổ sung; xem figma-extract.md mục 4 danh sách thiếu). Thành phần không có trong Figma nhưng cần (Skeleton,
EmptyState, ConfirmDialog, ConflictNotice, ReauthDialog, OfflineBanner, ProgressRow, PageHeader, trang lỗi) dựng **chỉ bằng token**
và ghi `designPending`.

`Locked` (FR-002/Story 1.3): thuộc tính `lockedReason?: string` + `reopensAt?: Date` hiển thị dòng giải thích `aria-describedby`;
nút khóa dùng `aria-disabled` (vẫn focus được để đọc lý do) chứ không `disabled` thuần.


## 3. Mục điều hướng (`NavItem`) – FR-007, FR-008

```ts
interface NavItem {
  id: 'overview' | 'calendar' | 'posts' | 'media' | 'business-profile' | 'channels-plan' | 'settings'
      | 'create-post' | 'more' | …;         // khai báo một nơi: app/shell/nav-registry.ts
  labelKey: ViKey;                           // khóa chuỗi trong lib/i18n/vi.ts
  icon: IconName;
  path: string;                              // đường dẫn tuyệt đối trong ứng dụng
  permission?: Permission;                   // từ @app/shared/auth (PERMISSIONS)
  area: 'customer' | 'internal';             // nội bộ tải gói riêng (R16)
  placement: { sidebar: boolean; mobile: 'bottom' | 'more' | 'none' };
  order: number;
  badge?: 'pendingReviewCount' | 'unreadCount'; // khóa dữ liệu đếm (mục 4)
}
```

Bảng gán theo Clarifications: thanh bên 7 mục (overview, calendar, posts, media, business-profile, channels-plan, settings);
thanh dưới: overview, calendar, posts, **more**, **create-post** (nổi bật, ở giữa). Kiểm thử: hai thanh sinh từ cùng mảng; mỗi vai
trò thấy đúng tập mục theo `PERMISSIONS` (Story 2, SC-003).

## 4. Dữ liệu máy chủ, khóa và lớp làm mới (`QueryKey`, `FreshnessClass`) – FR-022…026

| Lớp (`FreshnessClass`) | `staleTime` | `gcTime` | Làm mới khi mở màn/quay lại tab | Dùng cho |
|---|---|---|---|---|
| `catalog` | 1 giờ | 24 giờ | không | danh mục máy chủ ít đổi (danh sách ngành nghề) |
| `entity` | 30 giây | 5 phút | có | bài, kế hoạch, kênh, thư viện, hồ sơ, thành viên |
| `counter` | 15 giây | 5 phút | có | số chờ duyệt, thông báo chưa đọc |
| `volatile` | 0 | 0 | có (luôn) | mức sử dụng, trạng thái lượt đăng, quyền truy cập kênh (hiến pháp: không cache) |
| `session` | 0 (làm mới khi có lỗi 401/403 hoặc sau đổi mật khẩu/email) | 0 | có | `/auth/me` |

Danh mục tĩnh loại (d) (nhãn trạng thái, danh mục kênh, thông điệp lỗi) **không** là truy vấn — là mô-đun TypeScript.

Khóa (nhà máy `queryKeys`, kiểu chặt): `session.me()`, `posts.list(filter)`, `posts.detail(id)`, `plan.…`, `channels.list()`,
`media.list(filter)`, `profile.current()`, `members.list()`, `usage.current()`, `notifications.list()`,
`notifications.unread()`, `jobs.detail(jobId)`. **Không** có tham số `accountId` trong bất kỳ khóa nào (FR-010: ngữ cảnh đến từ
phiên); thay vào đó `QueryClient` được tạo mới theo phiên và `clear()` khi đổi người (mục 8).

**Ma trận vô hiệu hóa** (thao tác ghi → khóa làm mới) nằm trong `contracts/data-layer.md` mục 3; kiểm thử "bảng" xác nhận mỗi thao tác
trong `MUTATIONS` có hàng tương ứng (chống quên số đếm).

## 5. Trạng thái hiển thị của bài (`PostDisplayStatus`) – FR-005

```ts
type PostDisplayStatus =
  'draft' | 'review' | 'scheduled' | 'publishing' | 'published' | 'attention' | 'cancelled' | 'unknown';
interface PostStatusInfo { status: PostDisplayStatus; labelKey: ViKey; icon: IconName; tokenKey: string }
function toDisplayStatus(system: string, channels?: readonly string[]): PostDisplayStatus
```

Nhãn (UI/UX mục 7): Nháp · Chờ duyệt · Đã lên lịch · Đang đăng · Đã đăng · Cần bạn xử lý · Đã hủy · "Đang cập nhật" (`unknown`).
Quy tắc cố định: (1) trạng thái tổng của bài nhiều kênh = trạng thái **xấu nhất** theo thứ tự ưu tiên `attention > publishing >
scheduled > published` (UI/UX mục 7); (2) *Chờ thử lại* hiển thị là "Đang đăng"; *Không xác định/Cần kiểm tra* hiển thị là
"Cần bạn xử lý" (người dùng không thấy trạng thái nội bộ); (3) giá trị lạ → `unknown`, không ném lỗi. Mọi trạng thái luôn có
**chữ + biểu tượng** (kiểm thử: `StatusBadge` không bao giờ render thiếu một trong hai).

## 6. Quyền của phiên (`SessionPermissions`) – FR-009

Nguồn dữ liệu: `MeResponse` của `@app/shared/auth` (đã có): `{ user, account, role, permissions[] }`. Giao diện suy ra:
`can(permission) = permissions.includes(permission)`, `isOwner = role === 'owner'` **chỉ** trong `lib/session`. Không lưu bản sao
quyền ở nơi khác. Trạng thái tài khoản `unclaimed|suspended|expired|deleting` ảnh hưởng điều hướng (đã có `DETACHED_PATHS` ở 009).

## 7. Lỗi chuẩn hóa (`AppError`) – FR-029, FR-015, SC-010

```ts
type AppErrorKind =
  | 'network' | 'session_expired' | 'forbidden' | 'not_found' | 'version_conflict'
  | 'limit_reached' | 'validation' | 'business' | 'rate_limited' | 'server' | 'invalid_response';
interface AppError {
  kind: AppErrorKind;
  status: number; code: string;               // mã gốc: chỉ dùng cho "Chi tiết cho hỗ trợ"
  message: string;                            // tiếng Việt đời thường (ưu tiên của máy chủ, rơi về bảng chuẩn)
  actions: ErrorActionView[];                 // ≥ 1 (nếu máy chủ không trả thì bổ sung: Thử lại / Về Tổng quan)
  fieldErrors: Record<string, string>;        // khóa = đường dẫn chấm
  retryAfterSeconds?: number;
  support: { traceId: string; detail?: string };
  reason?: SessionEndReason;                  // mục 9
}
```

Phân loại từ `ErrorResponse.error.code` + HTTP: `UNAUTHENTICATED`→`session_expired`; `FORBIDDEN|ACCOUNT_UNAVAILABLE|…`→`forbidden`;
`VERSION_CONFLICT`→`version_conflict`; `VALIDATION_FAILED`→`validation`; `RATE_LIMITED|LOGIN_THROTTLED`→`rate_limited`; mã vượt hạn
mức/ngân sách AI (khi tính năng tương ứng thêm vào `ERROR_CODES`, tiền tố `LIMIT_`)→`limit_reached`; `NETWORK`→`network`; còn lại
→ `business` (có mã) hoặc `server` (5xx). Lớp `ApiError` hiện có **được giữ** (các trang 004/006/009 dùng) và có phương thức
`toAppError()`; không gỡ ở tính năng này.

## 8. Bản nháp biểu mẫu (`FormDraft`) và dọn dữ liệu theo tài khoản – FR-017, FR-027, FR-028

```ts
interface FormDraft { formKey: string; value: unknown; savedAt: number; subject: string /* user.id */ }
```

Nơi giữ: `Map` ở mức mô-đun trong `lib/forms/draft-store.ts` (RAM của tab, **không** ghi đâu khác); khóa = `${user.id}:${formKey}`
(tính từ phiên, không do người dùng gửi). Chỉ trường đánh dấu `persistable` mới vào bản nháp (không chứa mật khẩu, mã thông báo,
tệp). `clearAllAccountData()` xóa: `QueryClient.clear()`, `DraftStore`, `safe-storage`, trạng thái `ui-state`, và phát
`BroadcastChannel` cho các tab khác. Gọi khi: đăng xuất, đổi tài khoản/người dùng, nhận lỗi phiên không hợp lệ không khôi phục được,
nhận thông điệp từ tab khác.

**Danh sách trắng bộ lưu cục bộ** (`safe-storage`, FR-027): `ui.sidebar.collapsed`, `ui.posts.view` (danh sách/lưới), `ui.calendar.view`
(tuần/tháng), `ui.onboarding.dismissed`; giá trị chỉ là chuỗi ngắn/cờ, không có mã định danh người dùng/tài khoản. Khóa ngoài
danh sách → ném lỗi ở môi trường phát triển/kiểm thử. Xóa khi đăng xuất/đổi tài khoản.

## 9. Thay đổi lược đồ dùng chung (cộng thêm, tương thích ngược) – R13

Tại `packages/shared/src/core/error-response.ts`:

```ts
export const SESSION_END_REASONS = ['expired','revoked','password_changed','removed','locked'] as const;
// ErrorResponse.error: thêm  reason: z.enum(SESSION_END_REASONS).optional()   (chỉ có ý nghĩa với UNAUTHENTICATED)
```

Máy chủ điền `reason` ở các chỗ 004/009 thu hồi phiên; chưa điền → web coi `expired`. Không đổi mã lỗi hiện có, không xóa
trường nào ⇒ API/Worker cũ–mới chạy song song được (hiến pháp: tương thích ngược). Thêm một dòng vào bảng hợp đồng
`contracts/auth-http-api.md` mục 3 của 004.

## 10. Tiến độ việc nền (`JobProgress`) – FR-030

```ts
interface JobProgress { jobId: string; kind: string; done: number; total: number;
  state: 'running' | 'succeeded' | 'partial' | 'failed'; subjectRef?: { type: string; id: string } }
```

Cung cấp bởi `useJobProgress(jobId)`; điểm cuối do tính năng sinh việc (Soạn bài, Thư viện media) khai báo, kiểu trả về theo
hình trên (`contracts/data-layer.md` mục 6). Số `x/N` hiển thị bằng `ProgressRow`.

## 11. Giới hạn sử dụng (`UsageSnapshot`) – FR-031, FR-032

```ts
interface UsageSnapshot {
  posts: { used: number; limit: number };                  // đếm, không phải tiền
  ai: { percent: number; level: 'normal'|'near'|'reached'; reopensAt?: string }; // % của trần, KHÔNG có trường tiền
  storage: { usedBytes: number; limitBytes: number };
}
```

Kiểu **không có** trường tiền ⇒ không thể hiển thị/tính số tiền ở web (SC-009 bảo đảm từ cấu trúc, thêm quét tự động ở R9). Mức:
`near` ≥ 80%, `reached` ≥ 100%. `LimitGate`/`useLimit('ai')` suy ra `locked`+`reason`+`reopensAt`; hành động thủ công không bị chặn.

## 12. Ánh xạ thuật ngữ (VN → EN) mới của tính năng

| Tiếng Việt | Mã |
|---|---|
| giá trị thiết kế | `design token` / `DesignToken` |
| huy hiệu trạng thái | `StatusBadge` |
| trạng thái hiển thị của bài | `PostDisplayStatus` |
| thanh điều hướng dưới / thanh bên / thanh trên | `NavBar` / `Sidebar` / `TopBar` |
| cảnh báo nội dòng | `InlineAlert` |
| khóa dữ liệu | `queryKey` |
| lớp làm mới | `FreshnessClass` |
| bản nháp biểu mẫu | `FormDraft` |
| tiến độ việc nền | `JobProgress` |
| mức sử dụng | `UsageSnapshot` |
| đăng tay | `manualPublish` (khả năng kênh do máy chủ báo) |
| hộp thoại đăng nhập lại | `ReauthDialog` |
| danh mục thành phần | `catalog` (`/_catalog`) |
