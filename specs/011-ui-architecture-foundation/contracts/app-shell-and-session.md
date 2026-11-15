# Hợp đồng: khung ứng dụng, điều hướng, quyền và phiên

## 1. Cấu trúc tuyến (react-router)

```text
/login /register /verify-email /forgot-password /reset-password /oauth/* /join /data-deletion/:code   (công khai, đã có)
/internal/login                                                                               (công khai, đã có – gói riêng)
<SessionGate>                         // /auth/me → SessionProvider; KHÔNG chuyển trang khi 401 giữa chừng (FR-011a)
 └ <AppShell>                         // TopBar + Sidebar|NavBar + <Outlet/> + ReauthDialog + OfflineBanner + Toaster
    ├ /                  Tổng quan    (giữ chỗ → StartPage hiện có; màn thật ở tính năng sau)
    ├ /calendar /posts /media /channels /settings   (giữ chỗ "Sắp có" dùng chung `<ComingSoon/>`)
    ├ /business-profile (+ /versions/:id)           (006, chuyển sang nền mới)
    ├ /settings/{security,login-methods,members}    (004/009, chuyển sang nền mới)
    ├ /more                                          (danh sách mục "Thêm" trên điện thoại)
    └ /no-account                                    (009, chỉ tài khoản chờ)
/internal/**                          // gói tải lười riêng, chỉ khi me là nhân viên (khu vực tách biệt – FR-011)
/_catalog/**                          // chỉ DEV hoặc VITE_ENABLE_CATALOG=1
*                                     // NotFound
```

`errorElement` ở gốc và mỗi nhóm; `route.lazy` cho mọi nhóm (FR-012). Tuyến kế thừa `loginPath(next)` hiện có cho lần vào đầu
(khi `/auth/me` trả 401 lúc **mở ứng dụng** vẫn chuyển sang `/login?next=…`, vì chưa có gì để giữ).

## 2. `nav-registry.ts` (FR-008)

Một mảng `NAV_ITEMS: readonly NavItem[]` (kiểu ở `data-model.md` mục 3). `useNavItems()` trả `{ sidebar, bottom, more }` đã lọc
theo `useCan` và `area`. **Không** component nào tự liệt kê mục. Thêm mục điều hướng = thêm một phần tử + một tuyến + một
hàng kiểm thử ma trận quyền.

Bố cục: ≥ `lg` (1024 px): `Sidebar` 7 mục + vùng nội dung tối đa rộng; < `lg`: `TopBar` + nội dung + `NavBar` (5 ô, "Tạo bài"
nổi bật; vùng an toàn `pb-[env(safe-area-inset-bottom)]` – khai báo thành biến thiết kế `--safe-bottom` trong tokens, không viết
tùy ý). `TopBar kind="logo"` ở màn gốc, `kind="back"` ở màn con (nút quay về dùng `navigate(-1)` có dự phòng về cha).

Mục hiện tại đánh dấu bằng `aria-current="page"` + chữ đậm + gạch/biểu tượng đầy (không chỉ màu).

## 3. Quyền (FR-009, FR-010)

```ts
useCan(permission: Permission): boolean            // đọc me.permissions
<Can permission fallback?="hide|locked" lockedReason?>…</Can>
useRole(): 'owner'|'collaborator'                  // chỉ cho hiển thị nhãn vai trò; KHÔNG dùng để quyết định hiện/ẩn
```

- Lint: cấm so sánh `.role ===` / `=== 'owner'` ngoài `lib/session/**` (R13).
- Mọi nút bị ẩn theo quyền vẫn phải xử lý `403 FORBIDDEN` (thông báo "bạn không có quyền" + lối về, Story 2.3) vì quyền thật
  nằm ở API. Kiểm thử: gọi thẳng tuyến bằng URL khi thiếu quyền → trang `Forbidden` (không trắng), API giả trả 403.
- **Không bao giờ** đưa mã tài khoản vào URL, tham số, thân yêu cầu (FR-010): `apiClient` loại bỏ khóa `accountId`/`tenantId` khỏi
  mọi thân yêu cầu ở môi trường phát triển/kiểm thử (ném lỗi) – kiểm thử "không có tham số tài khoản".

## 4. Phiên hết hạn giữa chừng (FR-011a) – máy trạng thái `AuthGate`

```text
            401 UNAUTHENTICATED (bất kỳ lời gọi nào, trừ lời gọi `silentAuth`)
                      │
  idle ──────────────►│ nếu me chưa từng tải (mở ứng dụng)  → chuyển /login?next=…  (không có gì để giữ)
                      ▼ nếu đã có phiên trước
               reauth_required  ← gộp mọi lời gọi thất bại cùng lúc vào MỘT promise; phát `session-expired`
                      │ reason ∈ {password_changed, removed, locked, revoked}
                      ├──────────────► ended   (thông điệp theo lý do, về /login; không có "tiếp tục")
                      ▼ reason = expired/thiếu
            ReauthDialog hiện tại chỗ (Radix Dialog; màn và bản nháp còn nguyên)
                      │ đăng nhập thành công (POST /auth/login) → MeResponse mới
                      ├─ cùng user.id & account.id ──► resumed: phát lại hàng đợi `replayable`; còn lại báo "Bạn bấm lại để gửi"
                      └─ khác ──────────────────────► switched: clearAllAccountData() → /  (Tổng quan)
```

- Phát lại chỉ cho: GET, hoặc thao tác ghi cờ `safeToReplay` (lưu nháp, đánh dấu đã đọc). Duyệt/đăng/xóa/ngắt kết nối **không
  bao giờ** tự phát lại (chống tác dụng phụ kép – nguyên tắc II).
- Mỗi lời gọi chỉ phát lại **một lần**; thất bại lần hai → lỗi thường.
- Web không đọc/giữ mã phiên; không `localStorage`. Hộp thoại không trình bày email/dữ liệu của tài khoản khác khi `switched`.
- `EMAIL_NOT_VERIFIED` giữ hành vi hiện có (chuyển `/verify-email`) – không có nội dung dở dang để giữ ở trạng thái này.
- Đồng bộ nhiều tab: `BroadcastChannel('app-session')` ↔ `{type: 'logout'|'switched', at}`; tab nhận → `clearAllAccountData()`
  rồi `/login`.

## 5. Lỗi và cô lập (FR-011)

| Tình huống | Hiển thị | Hành động bắt buộc |
|---|---|---|
| Đường dẫn không có | `NotFound` | Về Tổng quan |
| 403 / thiếu quyền | `Forbidden` hoặc `InlineAlert` tại chỗ | Về Tổng quan / "Nhờ chủ tài khoản" (`contact_owner`) |
| Lỗi hiển thị trong một vùng | `react-error-boundary` bao vùng, phần còn lại sống | "Thử lại vùng này" |
| Lỗi hiển thị ở màn | `errorElement` của nhóm tuyến (khung điều hướng còn nguyên) | "Tải lại" + Về Tổng quan |
| Lỗi toàn ứng dụng | `errorElement` gốc (ít dùng) | Tải lại trang |
| Mất mạng | `OfflineBanner` "Dữ liệu có thể chưa mới" (dữ liệu đã tải vẫn xem) | Thử lại |
| Phiên bản mới của ứng dụng (chunk không tải được) | `InlineAlert` "Có bản mới – tải lại" | Tải lại |

Mọi `errorElement`/`NotFound`/`Forbidden` bằng tiếng Việt đời thường, có nút hành động; mã lỗi gốc chỉ trong "Chi tiết cho hỗ trợ"
(kèm "Gửi cho hỗ trợ" sao chép mã theo dõi – không gửi dữ liệu ra ngoài).
