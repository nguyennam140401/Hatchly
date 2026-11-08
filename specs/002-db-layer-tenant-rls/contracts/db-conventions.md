# Hợp đồng: quy tắc kiểm tra quy ước CSDL (`pnpm db:check`)

Chạy trên CSDL **đã migrate**, đọc danh mục hệ thống + sổ đăng ký bảng (data-model mục 6) + tệp kê
khai module. Phạm vi: mọi schema trong tệp kê khai, cộng `sandbox` khi có.

## Quy tắc

| Mã | Quy tắc (FR-020) | Cách phát hiện | Ngoại lệ hợp lệ |
|---|---|---|---|
| `a-rls-missing` | Bảng có cột `account_id` (hoặc `account.accounts`) chưa bật RLS / không có chính sách | `pg_class.relrowsecurity = false` hoặc không có dòng `pg_policy` | — (không có ngoại lệ; bảng con phân vùng được kiểm qua bảng cha) |
| `b-tenant-column-missing` | Bảng trong schema module không có `account_id` mà không đăng ký `shared` | danh mục ∩ sổ đăng ký | `shared` có `reason`; `infra.schema_migrations*` |
| `c-cross-schema-fk` | Khóa ngoại sang schema khác không trỏ tới `account.accounts` | `pg_constraint contype='f'`, so `connamespace` với schema đích | — |
| `d-index-not-tenant-first` | Chỉ mục của bảng `tenant` (trừ PK) không bắt đầu bằng `account_id` | `pg_index.indkey[0]` | có trong `indexExceptions` với lý do không rỗng |
| `e-money-float` | Cột tiền kiểu số thực | tên cột khớp `(_micro_usd\|_usd\|cost\|price\|amount)` và kiểu ∈ {`real`,`double precision`,`numeric`} | — |
| `f-not-owned-by-owner` | Schema/bảng/khung nhìn/hàm/chuỗi không thuộc `owner` | `pg_namespace.nspowner`, `pg_class.relowner`, `pg_proc.proowner` | — |
| `g-app-privileges` | `app`/`system`/`support` có `SUPERUSER`/`BYPASSRLS`/`CREATEROLE`/`CREATEDB`, quyền `CREATE` trên schema, là thành viên vai trò khác, hoặc sở hữu đối tượng | `pg_roles`, `has_schema_privilege`, `pg_auth_members` | — |
| `h-fk-delete-rule` | Bảng `tenant` có FK tới `accounts` không `ON DELETE CASCADE`; hoặc `partitioned_log` có FK tới `accounts` | `pg_constraint.confdeltype` | — |
| `i-support-view-leak` *(thêm, R11)* | Khung nhìn trong schema module/`sandbox` cấp `SELECT` cho `app`/`system` | `has_table_privilege` trên `relkind='v'` | — |
| `j-unregistered-table` *(thêm)* | Bảng trong schema module không có trong sổ đăng ký | danh mục − sổ đăng ký | bảng con phân vùng của bảng đã đăng ký |
| `k-reserved-schema-not-empty` *(thêm)* | Schema có `reservedSchema: true` (vd `approval`) chứa bảng | `pg_class` | — |

## Đầu ra

Văn bản (mặc định):

```text
Kiểm tra quy ước CSDL – 11 schema, 3 bảng, 2 khung nhìn
schema          bảng                 quy tắc                   chi tiết
content         posts                a-rls-missing             bảng có account_id nhưng chưa bật RLS
→ THẤT BẠI: 1 vi phạm
```

`--json`: `{ "violations": [{ "schema", "table", "rule", "detail" }], "checked": { "schemas", "tables", "views" } }`.

Mã thoát: `0` không vi phạm · `1` có vi phạm · `2` không kết nối được / thiếu cấu hình (thông báo chỉ
nêu tên biến, không in chuỗi kết nối).

## Kiểm chứng

`apps/server/test/db/fixtures/conventions/<mã-quy-tắc>.sql` – mỗi tệp gây đúng một vi phạm trên CSDL
sạch; kiểm thử khẳng định đầu ra JSON chứa đúng `rule` đó và chỉ đó (SC-003). Một kiểm thử chạy trên
cấu trúc sạch sau migration → `violations: []`.
