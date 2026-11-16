# Hợp đồng: lớp dữ liệu dùng chung (`apps/web/src/lib/api`, `lib/session`, `lib/catalogs`)

## 1. Bốn loại trạng thái và nơi sống (FR-022)

| Loại | Nơi sống | Công cụ | Cấm |
|---|---|---|---|
| (a) dữ liệu máy chủ | `lib/api` | `useApiQuery`/`useApiMutation` (bọc TanStack Query) | sao chép sang `useState`/context riêng của màn |
| (b) phiên và quyền | `lib/session` | `SessionProvider` + `useSession`/`useCan`; dữ liệu từ khóa `session.me()` | so sánh chuỗi vai trò rải rác |
| (c) trạng thái giao diện tạm | URL (`useUrlState`) · `useState` · `safe-storage` danh sách trắng | — | đưa dữ liệu loại (a) vào |
| (d) danh mục tĩnh | `lib/catalogs/*` (module TS thuần) | import trực tiếp | tải từ máy chủ, sao chép nhãn theo màn |

## 2. Lớp gọi API duy nhất (FR-029)

`lib/api/client.ts` thay `lib/api-client.ts` (giữ nguyên xuất khẩu cũ `apiRequest`, `ApiError`, `onAuthError` ở dạng vỏ tương
thích để các trang 004/006/009 chạy tiếp trong khi chuyển dần; **xóa vỏ khi chuyển xong**).

```ts
apiClient.request<T>(method, path, { body?, schema, signal?, silentAuth?, safeToReplay?, version? }): Promise<T>
//  - credentials 'same-origin'; không đọc cookie; không thêm tiêu đề tùy ý ngoài accept/content-type
//  - schema Zod của @app/shared: sai hình → AppError{kind:'invalid_response'}
//  - mọi lỗi → AppError (data-model mục 7); không ném lỗi thô
//  - 401 → AuthGate (contracts/app-shell-and-session.md mục 4)
//  - ném lỗi nếu body/path/query chứa khóa 'accountId'|'tenantId' (FR-010)
```

- Chỉ `lib/api/**` được gọi `fetch`/`XMLHttpRequest` (lint `no-restricted-globals` cho `fetch` ngoài thư mục này; ngoại lệ có chú
  thích `upload` dùng XHR).
- `useApiQuery(key, fn, { freshness })` và `useApiMutation({ fn, invalidates, optimistic?, replay? })` là hai cửa duy nhất.
  Màn hình **không** nhập `@tanstack/react-query` (lint).
- Đường dẫn API chỉ khai báo ở `lib/api/endpoints/<nhóm>.ts` (hàm có kiểu), không viết chuỗi URL trong màn hình.

## 3. Khóa và ma trận vô hiệu hóa (FR-023, SC-005)

`queryKeys` là nhà máy có kiểu (`data-model.md` mục 4). Mỗi thao tác ghi khai báo `invalidates: (vars, result) => QueryKey[]`
trong **một** bảng `lib/api/mutations.ts`:

| Thao tác (tính năng sở hữu) | Làm mới |
|---|---|
| duyệt / trả lại / hủy bài | `posts.detail(id)`, `posts.list(*)`, `counters.pendingReview`, `overview.*`, `notifications.unread` |
| đổi giờ bài | `posts.detail(id)`, `posts.list(*)`, `calendar.*` (lạc quan có hoàn tác) |
| sửa nội dung bài | `posts.detail(id)`, `posts.list(*)`, `counters.pendingReview` (bài về "Chờ duyệt") |
| đăng lại / đánh dấu "Đã đăng" | `posts.detail(id)`, `posts.list(*)`, `usage.current`, `notifications.unread` |
| kết nối / ngắt kênh | `channels.list`, `overview.*`, `posts.list(*)` (cờ `manualPublish` đổi) |
| tải lên media / xóa media | `media.list(*)`, `usage.current` |
| lưu hồ sơ kinh doanh | `profile.current`, `profile.versions` |
| mời / gỡ thành viên | `members.list`, `session.me` (số chỗ) |
| đánh dấu thông báo đã đọc | `notifications.list`, `notifications.unread` (lạc quan) |
| tạo bài hàng loạt (việc nền xong) | `posts.list(*)`, `usage.current`, `jobs.detail(id)` |

Kiểm thử bảng: `MUTATIONS` ↔ bảng này (mọi thao tác có `invalidates` không rỗng; thao tác đổi số đếm có khóa đếm – chặn lỗi quên).
Các màn của tính năng sau **thêm hàng** khi thêm thao tác; hàng này nằm trong cùng PR.

## 4. Làm mới (FR-024)

Cấu hình `QueryClient` mặc định: `refetchOnWindowFocus: true`, `refetchOnMount: true` (theo `staleTime` của lớp),
`refetchInterval: false`, `retry`: 0 cho thao tác ghi, 1 cho đọc kiểu `network`/5xx (giãn 1 giây), 0 cho 4xx; **không** làm mới
nền định kỳ ngoại trừ `useJobProgress`. Lớp `volatile`/`session` đặt `staleTime: 0, gcTime: 0`.
`ensureFresh(key)` = `queryClient.fetchQuery({ queryKey: key, staleTime: 0 })` – **bắt buộc** gọi trước thao tác quan trọng dựa
trên dữ liệu `volatile` (ví dụ bấm "Tạo bài bằng AI" kiểm `usage` mới, FR-026).

## 5. Thay đổi lạc quan và xác nhận (FR-025)

`useApiMutation` nhận `optimistic?: { apply, rollback }` **chỉ** khi thao tác nằm trong tập cho phép
`OPTIMISTIC_ALLOWED = {reschedule, markRead, reorder}` (kiểu chặn tại biên dịch). Từ chối của máy chủ → hoàn lại + toast/
`InlineAlert` có lý do và cách khắc phục. Thao tác `destructive` (xóa, ngắt kết nối, hủy lịch) dùng `ConfirmDialog` **trước**
khi gọi và chờ máy chủ xác nhận; không `optimistic`.

## 6. Việc nền và tiến độ (FR-030)

```ts
useJobProgress(jobId: string, { enabled }): { progress?: JobProgress; isRunning: boolean }
// Làm mới JOB_POLL_MS (3 giây) CHỈ khi: có thành phần gắn + tab visible + state === 'running'; dừng sau 5 phút.
// Khi state đổi sang kết thúc: invalidates theo thao tác tạo việc; thông báo hoàn tất đến qua notifications.unread (lần làm mới sau).
```

`NotificationCenter` (khung): danh sách `notifications.list` (lớp `counter`), số chưa đọc ở `Sidebar`/`NavBar` qua `NavItem.badge`.

## 7. Hạn mức, khóa theo giới hạn và số tiền (FR-031, FR-032)

```ts
useUsage(): UsageSnapshot          // lớp 'volatile'; MỘT nguồn cho Tổng quan, Gói & mức sử dụng, nút AI
useLimit('ai'|'posts'|'storage'): { locked: boolean; reason?: string; reopensAt?: Date; percent: number }
<LimitGate kind="ai" fallback?>…</LimitGate>   // nút AI → <Button locked lockedReason reopensAt>; thủ công không bị chặn
```

Ngưỡng 80% (`near`) → `UsageMeter warning`; 100% (`reached`) → mọi nút phụ thuộc chuyển khóa cùng lúc (cùng một truy vấn).
`UsageSnapshot` **không có trường tiền** (data-model mục 11). Quét tự động cấm định dạng tiền ở khu vực khách hàng (R9).

## 8. Ranh giới hợp đồng với API

Tính năng 011 **không** thêm điểm cuối nào (ngoại trừ cộng thêm `error.reason`, mục 9 của data-model). Các điểm cuối nghiệp vụ
mà thành phần cần (bài, kênh, thư viện, mức sử dụng, tiến độ, thông báo) do tính năng tương ứng cung cấp; 011 định nghĩa **hình dạng
phía giao diện mong đợi** để các tính năng đó theo:

| Mong đợi | Hình |
|---|---|
| Bản ghi dùng chung có `version: number` (phiên bản, cột `phien_ban`) trong phản hồi chi tiết | bắt buộc cho bài, phiên bản kênh |
| Thao tác ghi trên bản ghi dùng chung nhận `version` (tiêu đề `If-Match` **hoặc** trường thân; chọn ở tính năng sở hữu, một cách thống nhất cho mọi tính năng – ghi vào wiki) và trả `409 VERSION_CONFLICT` khi lệch | FR-018 |
| Danh sách trả khóa phân trang con trỏ, `total` tùy chọn | `lib/api/pagination.ts` |
| Khả năng kênh: `manualPublish: boolean` (do máy chủ tính) | không có công tắc người dùng |
| Mức sử dụng: `ai.percent` (0–100+), `posts.used/limit`, `storage.usedBytes/limitBytes`, `reopensAt` | không có số tiền |
| Tiến độ việc: `JobProgress` | data-model mục 10 |
| Thời điểm: chuỗi ISO 8601 UTC | hiển thị UTC+7 |

Hợp đồng tải tệp: `UploadTransport` (research R14) — `start`, `putPart`, `complete`; điểm cuối thật do tính năng Thư viện media.
