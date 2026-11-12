# Data model – 006 Hồ sơ kinh doanh (schema `context`)

## 0. Ánh xạ thuật ngữ (VN → EN)

| Tiếng Việt | Định danh |
|---|---|
| Hồ sơ kinh doanh | `business_profile` / bảng `context.business_profiles` |
| Phiên bản hồ sơ | `profile_version` / bảng `context.profile_versions` |
| Số phiên bản | `version` (trên hồ sơ), `version_number` (trên phiên bản) |
| Ngành / tên ngành tự do | `industry_code` / `industry_other` |
| Giới thiệu | `introduction` |
| Sản phẩm/dịch vụ | `products` |
| Chính sách | `policies` |
| Giọng văn mong muốn | `tone` |
| Từ khóa riêng | `keywords` |
| Người lưu | `saved_by_user_id` |
| Trạng thái thành viên (account) / trạng thái người lưu (context) | `status` (`active\|removed\|disabled`) / `memberStatus` (`active\|left`; `removed` hoặc không còn → `left`, `disabled` → `active`) |
| Hồ sơ đã thay đổi (việc nền) | `context.profile_changed` |
| Quyền xem / sửa hồ sơ | `context.view` / `context.edit` |

## 1. `context.business_profiles`

`tenantTable(context, 'business_profiles', …, { softDelete: true, versioned: true })`

| Cột | Kiểu | Ràng buộc | Ghi chú |
|---|---|---|---|
| `id` | uuid | PK, UUID v7 (tự có) | |
| `account_id` | uuid | NOT NULL, FK `account.accounts` ON DELETE CASCADE (tự có) | RLS `tenant_isolation` |
| `version` | integer | NOT NULL, default 1 (tự có) | = số phiên bản hiện hành; khóa lạc quan |
| `created_at`, `updated_at` | timestamptz | tự có | UTC |
| `deleted_at` | timestamptz | NULL (tự có) | quy ước xóa mềm; giai đoạn này không có thao tác xóa |

Chỉ mục: `business_profiles_account_id_key` UNIQUE (`account_id`) – tối đa 1 hồ sơ/tài khoản (FR-001); bắt đầu bằng
`account_id` nên không cần ngoại lệ.

## 2. `context.profile_versions` (chỉ thêm)

`tenantTable(context, 'profile_versions', …)` – không `versioned`, không `softDelete` (lịch sử bất biến, xem plan
"Kiểm tra hiến pháp" – Quy ước dữ liệu).

| Cột | Kiểu | Ràng buộc |
|---|---|---|
| `id` | uuid | PK (tự có) |
| `account_id` | uuid | NOT NULL, FK accounts CASCADE (tự có) |
| `profile_id` | uuid | NOT NULL, FK `context.business_profiles(id)` ON DELETE CASCADE (FK nội bộ module) |
| `version_number` | integer | NOT NULL, CHECK ≥ 1 |
| `industry_code` | text | NOT NULL, CHECK `char_length BETWEEN 1 AND 50` |
| `industry_other` | text | NULL, CHECK `char_length ≤ 100`; CHECK `(industry_code = 'other') = (industry_other IS NOT NULL)` |
| `introduction` | text | NOT NULL, CHECK `char_length BETWEEN 1 AND 2000` |
| `products` | text | NULL, CHECK ≤ 5000 |
| `policies` | text | NULL, CHECK ≤ 5000 |
| `tone` | text | NULL, CHECK ≤ 500 |
| `keywords` | text[] | NOT NULL default `'{}'`, CHECK `cardinality(keywords) ≤ 20` |
| `saved_by_user_id` | uuid | NOT NULL – mã tham chiếu module `account`, **không FK** (ADR-09) |
| `created_at` | timestamptz | tự có = thời điểm lưu; `updated_at` tự có, không bao giờ đổi |

Chỉ mục: UNIQUE (`account_id`, `profile_id`, `version_number`) – không trùng số phiên bản; phục vụ luôn danh sách lịch
sử (`ORDER BY version_number DESC`).

Bất biến: migration tay `REVOKE UPDATE, DELETE ON context.profile_versions FROM app, system` (xóa chỉ qua CASCADE khi
xóa tài khoản – FK cascade chạy với quyền chủ bảng). Kiểm thử: `app` UPDATE/DELETE → lỗi quyền.

## 3. Quy tắc hợp lệ (nguồn: `PROFILE_LIMITS`, `INDUSTRIES` trong `@app/shared/context`)

Chuẩn hóa trước khi kiểm: cắt khoảng trắng đầu/cuối; trường tùy chọn rỗng → `null`; `industry_other` bị bỏ (→ `null`)
khi `industry_code ≠ other`.

| Trường | Bắt buộc | Giới hạn | Thông điệp lỗi (ví dụ) |
|---|---|---|---|
| `industryCode` | ✔ | thuộc `INDUSTRIES` | "Hãy chọn ngành kinh doanh." |
| `industryOther` | ✔ khi `other` | 1–100 | "Hãy nhập tên ngành của bạn (tối đa 100 ký tự)." |
| `introduction` | ✔ | 1–2.000 | "Hãy viết vài dòng giới thiệu (tối đa 2.000 ký tự)." |
| `products` | – | ≤ 5.000 | "Phần sản phẩm/dịch vụ dài quá 5.000 ký tự – hãy rút gọn." |
| `policies` | – | ≤ 5.000 | tương tự |
| `tone` | – | ≤ 500 | tương tự |
| `keywords` | – | ≤ 20 mục; mỗi mục 1–50; không trùng (không phân biệt hoa thường) | "Từ khóa "X" bị trùng – hãy xóa bớt." |

Đếm "ký tự" theo điểm mã Unicode (`[...s].length` ở JS, `char_length` ở PostgreSQL) để hai lớp khớp nhau với emoji.

## 4. Chuyển trạng thái lưu (một `tenantTx`)

```text
expectedVersion = 0, chưa có hồ sơ   → INSERT profile (version=1) + INSERT version #1 + enqueue → saved v1
expectedVersion = 0, đã có hồ sơ     → vi phạm UNIQUE → VERSION_CONFLICT (409)
expectedVersion = N = hiện hành:
    nội dung giống bản N              → { changed: false } (không ghi, không enqueue)
    khác                              → updateVersioned(N → N+1) + INSERT version #N+1 + enqueue → saved v(N+1)
expectedVersion ≠ hiện hành          → VERSION_CONFLICT (409)
lỗi bất kỳ trong giao dịch           → hoàn tác cả hồ sơ, phiên bản, việc nền
```

## 5. Việc nền `context.profile_changed`

| Thuộc tính | Giá trị |
|---|---|
| Hàng chờ | `ai_batch` · `scope: 'tenant'` · `version: 1` |
| Payload | `z.strictObject({ profileId: z.uuid(), version: z.int().min(1) })` |
| Khóa chống trùng | `profile:<profileId>:v<version>` |
| Bộ xử lý | đọc `getCurrentProfile()`; `null` hoặc `version` hiện hành > payload → `superseded`; bằng → `processed`; chỉ ghi nhật ký |

## 6. Kiểu dữ liệu giao diện công khai

```ts
interface CurrentBusinessProfile {
  profileId: string;
  version: number;
  savedAt: string;          // ISO UTC
  industryCode: IndustryCode;
  industryOther: string | null;
  introduction: string;
  products: string | null;
  policies: string | null;
  tone: string | null;
  keywords: string[];
}
```

Không chứa `account_id`, `saved_by_user_id` hay thông tin liên hệ (FR-014).

## 7. Thay đổi ngoài schema `context`

- `account`: thêm `describeMembers(userIds)` vào `AccountPublicApi` (đọc `users` + `memberships` trong `tenantTx`).
- `modules.manifest.json`: `context.allowedDeps` thêm `account`.
- `core/db/versioned.ts`: tùy chọn `conflictMessage` (R3).
- `packages/shared/src/auth/permissions.ts`: `context.manage` → `context.view` + `context.edit` (R9).
