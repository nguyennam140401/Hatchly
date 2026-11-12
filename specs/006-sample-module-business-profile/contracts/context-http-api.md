# Hợp đồng HTTP – module `context` (Hồ sơ kinh doanh)

Lược đồ Zod đặt ở `packages/shared/src/modules/context/` (lối vào `@app/shared/context`), dùng chung cho máy chủ
(`@ValidBody`, `@ValidQuery`, `@ValidParam`) và web (`safeParse` phản hồi). Lỗi theo `ErrorResponse` chuẩn
(`@app/shared/core`). Mọi điểm cuối là **khách hàng** (`@CustomerAccess(...)`), email phải đã xác nhận. Không điểm
cuối nào nhận mã tài khoản; trường lạ trong thân bị từ chối (`z.strictObject`).

Thời gian trả về: chuỗi ISO 8601 UTC; web hiển thị UTC+7.

## Kiểu dùng chung

```ts
ProfileFields = z.strictObject({
  industryCode: z.enum(INDUSTRY_CODES),
  industryOther: z.string().nullable(),   // bắt buộc khi industryCode = 'other'
  introduction: z.string(),
  products: z.string().nullable(),
  policies: z.string().nullable(),
  tone: z.string().nullable(),
  keywords: z.array(z.string()),
}) // + transform chuẩn hóa + superRefine theo PROFILE_LIMITS (data-model mục 3)

SavedBy = { userId: string; displayName: string | null; memberStatus: 'active' | 'left' }
// memberStatus = 'left' khi người lưu không còn trong kết quả describeMembers hoặc status = 'removed';
// status 'active' và 'disabled' đều → 'active' (vẫn hiện tên). displayName = null khi 'left' → "Thành viên đã rời"

ProfileView = { profileId, version, savedAt, savedBy: SavedBy, fields: ProfileFields }
```

## 1. `GET /context/profile` – quyền `context.view`

| Kết quả | HTTP | Thân |
|---|---|---|
| Có hồ sơ | 200 | `{ profile: ProfileView, missingOptional: ('products'|'policies'|'tone'|'keywords')[] }` |
| Chưa có hồ sơ | 200 | `{ profile: null, missingOptional: [...tất cả] }` – trạng thái hợp lệ, không phải lỗi |

`missingOptional` dùng cho gợi ý FR-007.

## 2. `PUT /context/profile` – quyền `context.edit`

Thân: `{ expectedVersion: z.int().min(0), fields: ProfileFields }` (`0` = chưa có hồ sơ).

| Kết quả | HTTP | Thân / mã lỗi |
|---|---|---|
| Lưu phiên bản mới | 200 | `{ changed: true, profile: ProfileView }` |
| Không có thay đổi | 200 | `{ changed: false, profile: ProfileView }` – web hiện "Không có thay đổi để lưu" |
| Sai hợp lệ | 400 | `VALIDATION_FAILED`, `fieldErrors[]` theo đường dẫn `fields.<tên>` (cùng thông điệp với web), hành động `fix_input` |
| Xung đột phiên bản | 409 | `VERSION_CONFLICT`, "Hồ sơ vừa được cập nhật ở nơi khác. Tải bản mới nhất để xem.", hành động `retry` "Tải bản mới nhất" |
| Cộng tác viên | 403 | `FORBIDDEN`, "Chỉ chủ tài khoản mới sửa được hồ sơ kinh doanh.", hành động `contact_owner` "Nhờ chủ tài khoản cập nhật" |
| Nhân viên nội bộ (cookie nội bộ) | 401/403 | theo lớp chặn 004 – không vào nghiệp vụ |
| Chưa đăng nhập / phiên hết hạn | 401 | `UNAUTHENTICATED`, hành động `navigate` "Đăng nhập lại" |

## 3. `GET /context/profile/versions?page=<n>` – quyền `context.view`

`page` ≥ 1, mặc định 1; 20 dòng/trang, mới nhất trước.

200: `{ items: { versionId, version, savedAt, savedBy: SavedBy }[], page, pageSize: 20, total }`.
Chưa có hồ sơ → `items: []`, `total: 0`.

## 4. `GET /context/profile/versions/:versionId` – quyền `context.view`

`versionId`: `z.uuid()` (sai định dạng → 400).

| Kết quả | HTTP |
|---|---|
| Phiên bản của tài khoản mình | 200 `{ versionId, version, savedAt, savedBy, fields, isCurrent: boolean }` |
| Không tồn tại **hoặc** thuộc tài khoản khác | 404 `NOT_FOUND`, "Không tìm thấy phiên bản này.", hành động `navigate` "Về hồ sơ kinh doanh" (FR-011 – hai trường hợp không phân biệt được) |

## 5. Lời giải thích từ chối quyền (`PERMISSION_DENIED_MESSAGES`)

| Quyền | Thông điệp |
|---|---|
| `context.view` | "Bạn không có quyền xem hồ sơ kinh doanh." |
| `context.edit` | "Chỉ chủ tài khoản mới sửa được hồ sơ kinh doanh." |

## 6. Kiểm thử hợp đồng

- `apps/server/test/context/profile-api.e2e.spec.ts`: mỗi dòng của các bảng trên × vai trò (chủ, cộng tác viên, hỗ
  trợ, quản trị, chưa đăng nhập); phản hồi lỗi phải qua `ErrorResponse.safeParse`.
- `apps/server/test/auth/access-matrix.e2e.spec.ts` (sẵn có) tự phủ `context.view`, `context.edit`.
- `apps/server/test/auth/account-id-injection.e2e.spec.ts` (sẵn có) thêm `PUT /context/profile`: `accountId` trong
  **thân** → 400 (trường lạ, `z.strictObject`); `accountId` trong **truy vấn** → bị bỏ qua (điểm cuối không đọc truy
  vấn), lưu vào đúng tài khoản của phiên. Cả hai: tài khoản khác không bị ghi.
