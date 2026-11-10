# Xác thực và phân quyền – hướng dẫn cho lập trình viên module

Tính năng 004 (`specs/004-minimal-auth-rbac/`). Áp dụng nguyên tắc I (mã tài khoản chỉ từ phiên), VI (chặn
quyền ở API, mặc định từ chối) và VII (không tự viết mật mã, không lộ bí mật) của hiến pháp.

## Mặc định từ chối

`AccessGuard` chạy với **mọi** route của API. Mỗi handler phải có **đúng một** khai báo, đặt ở method
hoặc ở class (khai báo ở method ghi đè khai báo ở class):

| Khai báo                                                    | Ai gọi được                                                     | Ghi chú                                                                              |
| ----------------------------------------------------------- | --------------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| `@Public()`                                                 | mọi người                                                       | Có cookie khách hàng hợp lệ thì guard vẫn gắn `actor`, nhưng **không** gắn tài khoản |
| `@CustomerAccess(...quyền)`                                 | khách hàng đã đăng nhập, email đã xác nhận, có **đủ** các quyền | Chỉ đọc cookie `__Host-sid`                                                          |
| `@CustomerAccess({ allowUnverifiedEmail: true }, ...quyền)` | như trên nhưng cho cả email chưa xác nhận                       | Chỉ cho `/auth/me`, đăng xuất, sửa email…                                            |
| `@StaffAccess(...quyền)`                                    | nhân viên nội bộ, trong `STAFF_ALLOWED_CIDRS`                   | Chỉ đọc cookie `__Host-staff_sid`; yêu cầu thay đổi dữ liệu được ghi `staff.request` |

Kết quả của guard:

- Không có khai báo → 403 `ACCESS_NOT_DECLARED`. Ở `development`/`test`, API **không khởi động** khi có
  handler thiếu hoặc trùng khai báo. Kiểm thử `test/auth/access-declarations.spec.ts` chạy trong CI.
- Chưa đăng nhập, phiên hết hạn hoặc sai loại cookie → 401 `UNAUTHENTICATED`.
- Email chưa xác nhận → 403 `EMAIL_NOT_VERIFIED`. Thiếu quyền → 403 `FORBIDDEN`, kèm lời giải thích của
  quyền (`PERMISSION_DENIED_MESSAGES`). Cộng tác viên có thêm hành động `contact_owner`.
- Không tra được phiên (CSDL lỗi) → 503. Guard **không bao giờ** cho qua khi có lỗi.

```ts
import { Controller, Post } from '@nestjs/common';
import { CustomerAccess, currentAccountId, requireCustomer, tenantTx } from '../../core';

@Controller('posts')
export class PostsController {
  @Post(':id/approve')
  @CustomerAccess('post.approve')
  async approve() {
    const actor = requireCustomer(); // người gọi; accountId đã được guard gắn từ phiên
    return tenantTx((db) => /* … chỉ thấy dữ liệu của currentAccountId() … */ null);
  }
}
```

## Đọc người gọi trong nghiệp vụ

Nhập từ `core`: `currentActor()` (hoặc `null`), `requireCustomer()`, `requireStaff()` (ném lỗi lập trình
nếu sai loại – nghĩa là khai báo sai), `can(permission)` cho quyết định **bên trong** nghiệp vụ (vd ẩn
một trường). `can()` không thay khai báo: điểm cuối vẫn phải khai báo quyền.

Mã tài khoản đọc bằng `currentAccountId()` hoặc dùng thẳng `tenantTx`. **Không bao giờ** nhận
`accountId` từ path, query, body hay tiêu đề. Kiểm thử `test/auth/account-id-injection.e2e.spec.ts`
chứng minh guard bỏ qua mọi giá trị do người dùng gửi.

## Thêm quyền mới

1. Thêm **một dòng** vào `packages/shared/src/auth/permissions.ts` kèm chú thích truy vết FR. Đây là nguồn
   duy nhất – web dùng cùng bảng để ẩn/hiện nút (chỉ là trải nghiệm, API vẫn tự chặn).
2. Thêm lời giải thích vào `PERMISSION_DENIED_MESSAGES` (`apps/server/src/core/auth/permissions.ts`) –
   kiểu `Record<Permission, string>` bắt buộc đủ.
3. Cập nhật bảng mong đợi ở `test/auth/permissions.spec.ts`. Ma trận e2e
   (`test/auth/access-matrix.e2e.spec.ts`) tự sinh điểm cuối cho mỗi quyền.
4. Đổi quyền của vai trò có sẵn phải được review theo nguyên tắc VI.

Quyền của khách hàng (chủ hoặc cộng tác viên có) chỉ dùng được với `@CustomerAccess`; quyền nội bộ chỉ
với `@StaffAccess` – trộn lẫn sẽ ném lỗi ngay khi nạp mô-đun.

## Hàm hạn chế và quy tắc ranh giới

| Hàm                                                            | Ai được nhập                                                | Quy tắc                    |
| -------------------------------------------------------------- | ----------------------------------------------------------- | -------------------------- |
| `bindAccountToRequest` (`core/context/bind-account.ts`)        | chỉ `core/auth/access.guard.ts`, `core/db`, `modules/queue` | `bind-account-restricted`  |
| `authTx` (`core/db/auth-tx.ts`) – giao dịch `app` không tenant | `core/auth/**`, `modules/account/internal/auth/**`          | `auth-tx-restricted`       |
| `runInAccountScope` (`core/auth/account-scope.ts`)             | `modules/account/internal/auth/**`                          | `account-scope-restricted` |
| `SessionCache` (`core/auth/session-cache.ts`)                  | `core/auth/**`, `modules/account/internal/auth/**`          | `account-scope-restricted` |

`authTx` chỉ dùng để gọi 4 hàm `SECURITY DEFINER` (xem `docs/database.md`), đọc/ghi bảng dùng chung
của xác thực và ghi `infra.audit_log`. Bộ gác truy vấn của 002 vẫn chặn bảng tenant bên trong `authTx`.
`runInAccountScope(accountId, fn)` chỉ được gọi với `accountId` lấy từ CSDL **sau khi** danh tính đã
được xác minh (mật khẩu đúng, mã phiên hoặc mã một lần hợp lệ).

## Phiên, cookie, chống giả mạo

- Cookie `HttpOnly; Secure; SameSite=Lax; Path=/`, tiền tố `__Host-`, không `Domain`. Web không bao giờ
  đọc được mã phiên. CSDL và bộ nhớ đệm chỉ giữ SHA-256 của mã.
- Bộ nhớ đệm phiên trong tiến trình sống ≤ 60 giây: thu hồi (đăng xuất, gỡ thành viên, khóa người dùng)
  có hiệu lực **ngay** trên bản API xử lý yêu cầu và ≤ 60 giây trên các bản khác (SC-005).
- Mọi `POST/PUT/PATCH/DELETE` (kể cả điểm cuối công khai) phải có `Origin` thuộc `WEB_ORIGINS` hoặc
  `Sec-Fetch-Site: same-origin`, nếu không → 403 `CSRF_REJECTED`.

## Nhật ký

Mọi dòng nhật ký có `actor_id`, `actor_kind`. Pino che `cookie`, `set-cookie`, `authorization`,
`password`, `currentPassword`, `newPassword`, `token`. Không ghi email, mật khẩu, mã phiên, mã một lần,
băm vào nhật ký hay `infra.audit_log.metadata` (chỉ `{ ip, ua_family, reason }`). Kiểm thử
`test/auth/auth-secrets-in-logs.e2e.spec.ts` và `pnpm check:secrets` chặn hồi quy.

## Kiểm thử

- Đơn vị: `pnpm --filter @app/server test` (guard với `SessionResolver` giả, quyền, cookie, mật khẩu…).
- e2e cần CSDL thật: `pnpm test:db` (đặt `TEST_DATABASE_ADMIN_URL`) chạy `test/auth/**/*.e2e.spec.ts`
  với `test/auth/helpers/app.ts` (ApiAppModule thật, thư trong bộ nhớ, mỗi agent một địa chỉ mạng giả).
- Dữ liệu mẫu cho máy dev: `pnpm dev:seed-auth`. Nhân viên nội bộ: `pnpm staff create|disable|reset-password|list`.
