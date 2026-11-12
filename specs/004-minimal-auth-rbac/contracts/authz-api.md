# Hợp đồng: giao diện xác thực và phân quyền cho module (`core/auth`)

Xuất qua `apps/server/src/core/index.ts`, trừ các mục ghi "hạn chế". Đây là hợp đồng hành vi: chữ ký có
thể chỉnh nhỏ ở bước tasks, miễn giữ nguyên hành vi.

## 1. Danh mục quyền (FR-012)

> **Sửa đổi 2026-11-11 (006):** `context.manage` sẽ được tách thành `context.view` (owner + collaborator) và
> `context.edit` (owner) khi implement 006. Danh mục chuẩn, có mã và mốc neo từng quyền:
> `TaiLieuDacTa/Dac_ta_yeu_cau_App_AI_Content_MXH.md#dt-3-1-danh-muc-quyen`.

```ts
export const PERMISSIONS = {
  'context.manage':   { owner: true,  collaborator: false, support: false, admin: false },
  'channel.manage':   { owner: true,  collaborator: false, support: false, admin: false },
  'post.edit':        { owner: true,  collaborator: true,  support: false, admin: false }, // soạn, sửa bài
  'media.upload':     { owner: true,  collaborator: true,  support: false, admin: false },
  'post.approve':     { owner: true,  collaborator: false, support: false, admin: false }, // duyệt + lên lịch bài mới duyệt
  'post.reschedule':  { owner: true,  collaborator: true,  support: false, admin: false }, // đổi giờ bài đã duyệt
  'post.republish':   { owner: true,  collaborator: true,  support: false, admin: false }, // đăng lại bài lỗi
  'status.view':      { owner: true,  collaborator: true,  support: false, admin: false }, // trạng thái, nhật ký đăng, mức sử dụng (%)
  'members.manage':   { owner: true,  collaborator: false, support: false, admin: false },
  'account.delete':   { owner: true,  collaborator: false, support: false, admin: false },
  'support.lookup':   { owner: false, collaborator: false, support: true,  admin: true  }, // qua supportSearch/supportViewAccount
  'plan.manage':      { owner: false, collaborator: false, support: false, admin: true  }, // kích hoạt, gia hạn, tạm dừng gói
  'staff.manage':     { owner: false, collaborator: false, support: false, admin: true  },
} as const;
export type Permission = keyof typeof PERMISSIONS;
export type CustomerRole = 'owner' | 'collaborator';
export type StaffRole = 'support' | 'admin';
export function permissionsOf(role: CustomerRole | StaffRole): Permission[];
```

- Quyền khách hàng **không bao giờ** cấp cho vai trò nhân viên, và ngược lại. Kiểm thử đơn vị khẳng
  định điều này trên toàn bộ danh mục.
- Thêm quyền mới: thêm một dòng vào danh mục kèm truy vết FR, rồi cập nhật ma trận kiểm thử (SC-003).
  Đổi quyền của vai trò có sẵn phải được review theo nguyên tắc VI.
- `@app/shared/auth` xuất lại `PERMISSIONS` (dữ liệu thuần) cho web.
- Thông điệp từ chối theo quyền: `PERMISSION_DENIED_MESSAGES: Record<Permission, string>`, vd
  `'post.approve' → 'Chỉ chủ tài khoản mới duyệt được bài.'`.

## 2. Khai báo truy cập cho điểm cuối (FR-013)

```ts
@Public()                                         // không cần đăng nhập
@CustomerAccess('post.edit')                      // khách hàng có ĐỦ mọi quyền liệt kê; email đã xác minh
@CustomerAccess({ allowUnverifiedEmail: true })   // chỉ cần đăng nhập (không đòi quyền cụ thể)
@StaffAccess('support.lookup')                    // nhân viên có đủ quyền liệt kê
```

- Đặt ở method; được đặt ở class làm mặc định (method ghi đè class). Có hai khai báo trên cùng một
  handler thì lỗi khi khởi động.
- Không có khai báo: `AccessGuard` trả 403 `ACCESS_NOT_DECLARED`. Kiểm tra khi khởi động và kiểm thử
  CI (R7) bắt lỗi trước khi phát hành.
- Điểm cuối `healthz`, `readyz` (ngoài tiền tố, của 001) được khai báo `@Public()`.

## 3. Đọc người gọi (FR-015)

```ts
type Actor =
  | { kind: 'user'; userId: string; accountId: string; role: CustomerRole; emailVerified: boolean; sessionId: string }
  | { kind: 'staff'; staffId: string; role: StaffRole; sessionId: string };

currentActor(): Actor | null           // từ ExecutionContext
requireCustomer(): Extract<Actor, { kind: 'user' }>   // ném lỗi lập trình nếu không phải khách hàng
requireStaff(): Extract<Actor, { kind: 'staff' }>
can(permission: Permission): boolean   // theo người gọi hiện tại
```

- Module nghiệp vụ dùng `can()` cho quyết định **trong** nghiệp vụ, vd ẩn trường trong phản hồi. Chặn
  truy cập điểm cuối vẫn phải dùng khai báo ở mục 2.
- Với khách hàng, mã tài khoản đọc bằng `currentAccountId()` của 002 (đã được guard gắn), cũng là mã
  `tenantTx` dùng. Module **không có** cách nào đặt mã tài khoản từ tham số.

## 4. Đảo phụ thuộc giữa lõi và module `account`

```ts
// core/auth – giao diện, token DI
export const SESSION_RESOLVER = Symbol('SESSION_RESOLVER');
export interface SessionResolver {
  resolveCustomer(tokenHash: Buffer): Promise<Extract<Actor, { kind: 'user' }> | null>;
  resolveStaff(tokenHash: Buffer, ip: string): Promise<Extract<Actor, { kind: 'staff' }> | null>;
}
```

`AccountModule` cung cấp `SESSION_RESOLVER`. Thiếu nhà cung cấp thì API không khởi động được.

## 5. Hạn chế: chỉ dành cho module `account` và lõi xác thực

| Hàm | Nơi định nghĩa | Được nhập bởi (quy tắc ranh giới) |
|---|---|---|
| `authTx(fn)` – bể `app`, không đặt tenant | `core/db/auth-tx.ts` | `core/auth/**`, `modules/account/internal/auth/**` – quy tắc `auth-tx-restricted` |
| `runInAccountScope(accountId, fn)` – ngữ cảnh con có `accountId` đã xác minh | `core/auth/account-scope.ts` | `modules/account/internal/auth/**` – quy tắc `account-scope-restricted` |
| `sessionCache.evict(tokenHash)` | `core/auth/session-cache.ts` | `modules/account/internal/auth/**` |
| `bindAccountToRequest` (của 002) | `core/context/bind-account.ts` | giữ nguyên quy tắc `bind-account-restricted`: chỉ `core/auth/access.guard.ts` gọi |

`runInAccountScope` ném `TenantContextError('TENANT_CONTEXT_CONFLICT')` khi yêu cầu đã gắn một tài
khoản khác, hoặc khi đang ở trong một giao dịch.

## 6. Hành vi bắt buộc của `AccessGuard`

| Tình huống | Kết quả |
|---|---|
| Handler không có khai báo | 403 `ACCESS_NOT_DECLARED`, nhật ký `error` `auth.access_not_declared` |
| `@Public` | cho qua; có cookie hợp lệ thì vẫn gắn `actor` (không gắn tài khoản) |
| `@CustomerAccess` mà không có/sai/hết hạn phiên | 401 `UNAUTHENTICATED` |
| `@CustomerAccess` mà người gọi chỉ có cookie nhân viên | 401 (cookie nhân viên không được đọc ở điểm cuối khách hàng) |
| `@StaffAccess` mà người gọi là khách hàng | 401 (cookie khách hàng không được đọc ở điểm cuối nội bộ) |
| Chưa xác minh email, khai báo không có `allowUnverifiedEmail` | 403 `EMAIL_NOT_VERIFIED` |
| Thiếu quyền | 403 `FORBIDDEN` + thông điệp theo quyền + `auth.denied` |
| `@StaffAccess`, địa chỉ ngoài `STAFF_ALLOWED_CIDRS` | 403 `IP_NOT_ALLOWED` + kiểm toán |
| Hợp lệ (khách hàng) | `bindAccountToRequest(accountId)`, đặt `actor`, vào handler |
| Mã tài khoản trong path/query/body khác tài khoản của phiên | Bị bỏ qua: guard không đọc chúng; mọi truy vấn chạy với tài khoản của phiên (kiểm thử truy cập chéo) |
| Lỗi CSDL khi tra phiên | 503 `SERVICE_UNAVAILABLE` (không cho qua) |

Kiểm tra nguồn gửi (CSRF) là middleware riêng, chạy **trước** guard cho mọi phương thức không an toàn.
