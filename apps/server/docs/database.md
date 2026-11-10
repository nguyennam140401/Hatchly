# Lớp CSDL – hướng dẫn cho lập trình viên

Tính năng 002 (WBS 1.2). Đặc tả: `specs/002-db-layer-tenant-rls/`. Hiến pháp nguyên tắc I (cô lập
tenant) là KHÔNG THƯƠNG LƯỢNG – mọi bảng khách hàng có hai lớp chặn: ứng dụng (`tenantTx`) và CSDL
(Row-Level Security).

## Tổng quan nhanh

| Khái niệm                                 | Mã                                                                                                       |
| ----------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| Biến phiên tenant (phạm vi **giao dịch**) | GUC `app.account_id`, đọc qua `account.current_account_id()`                                             |
| Chính sách mẫu                            | `tenant_isolation`: `account_id = account.current_account_id()` (USING + WITH CHECK)                     |
| Vai trò CSDL                              | `owner` (migration), `app` (API/Worker), `system` (Worker – việc dùng chung), `support` (tra cứu hỗ trợ) |
| Giao dịch                                 | `tenantTx`, `systemTx`, `supportSearch`, `supportViewAccount` (từ `core`)                                |
| Khai báo bảng                             | `tenantTable`, `sharedTable`, `partitionedLogTable`, `microUsd`                                          |
| Kiểm tra                                  | `pnpm db:check` (quy ước), `pnpm db:lint-migrations` (tương thích ngược), `pnpm test:db`                 |

Lệnh và biến môi trường: `specs/002-db-layer-tenant-rls/contracts/db-commands.md`.

```powershell
Copy-Item apps/server/.env.example apps/server/.env
pnpm db:up        # PostgreSQL cục bộ (docker compose)
pnpm db:setup     # 4 vai trò + migration (gồm sandbox ở development)
pnpm db:check     # → ĐẠT: 0 vi phạm
$env:TEST_DATABASE_ADMIN_URL = 'postgres://postgres:postgres_dev_only@localhost:5432/postgres'
pnpm test:db
```

**Bẫy cần nhớ**: sau khi giao dịch đã đặt `app.account_id` kết thúc, biến trên kết nối đó thành **chuỗi
rỗng** chứ không về NULL. Luôn dùng `account.current_account_id()` (có `nullif`), không bao giờ viết
`current_setting('app.account_id')::uuid` trực tiếp.

## Ngữ cảnh tenant / hệ thống / hỗ trợ

`accountId` CHỈ đến từ `ExecutionContext`: guard xác thực gọi `bindAccountToRequest` (từ phiên đăng
nhập – WBS 2.1), hàng chờ gọi `runWithJobContext` (từ dữ liệu việc – WBS 1.3). Module nghiệp vụ không
nhập được `core/context/bind-account` (quy tắc ranh giới `bind-account-restricted`) và **không có tham
số `accountId`** trên `tenantTx` – không thể lấy từ tham số/thân yêu cầu.

| Hàm                                                | Vai trò               | Khi nào dùng                                                                                                                                         |
| -------------------------------------------------- | --------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| `tenantTx(fn)`                                     | `app`                 | Mọi thao tác trên dữ liệu của tài khoản đang đăng nhập / của việc                                                                                    |
| `systemTx(fn, { tenant: 'from-context' })`         | `system` (chỉ Worker) | Việc dùng chung cần ghi vào **một** tài khoản (vd chia chi phí xu hướng) – chịu cùng RLS                                                             |
| `systemTx(fn)` (`tenant: 'none'`)                  | `system`              | Việc chỉ chạm bảng dùng chung. Chạm bảng `tenant` → dev/test ném `TENANT_CONTEXT_MISSING`; production: cảnh báo `db.tenant_context_missing` + 0 dòng |
| `supportSearch(actor, keywordType, fn)`            | `support` (chỉ API)   | Tìm kiếm xuyên tài khoản qua **khung nhìn tìm kiếm**                                                                                                 |
| `supportViewAccount(actor, accountId, reason, fn)` | `support`             | Xem chi tiết MỘT tài khoản qua **khung nhìn chi tiết**; lý do ≥ 5 ký tự                                                                              |

```ts
import { tenantTx } from '../../core';

const notes = await tenantTx((db) => db.select().from(posts)); // không cần WHERE account_id – RLS lọc
```

Quy tắc:

- Gọi lồng cùng vai trò + cùng tài khoản → dùng lại giao dịch ngoài; khác → `TENANT_CONTEXT_CONFLICT`.
- `fn` ném lỗi → hoàn tác cả giao dịch. Lỗi kết nối → kết nối bị hủy, không quay lại bể.
- Ghi dòng có `account_id` khác ngữ cảnh → `DbPolicyViolationError` (CSDL từ chối, hoàn tác).
- Các lỗi `TenantContextError`/`DbPolicyViolationError` là lỗi lập trình: khách hàng thấy
  `INTERNAL_ERROR`, mã gốc chỉ ở "Chi tiết cho hỗ trợ". Lỗi kết nối → `SERVICE_UNAVAILABLE`.
- Nhật ký trong giao dịch tự có `account_id` (FR-007).

**Hỗ trợ**: mỗi lần gọi `support*` ghi đúng một dòng `infra.audit_log` TRƯỚC khi chạy `fn`, trong
cùng giao dịch (lỗi → không có dòng mồ côi). Kiểm toán lưu **loại** từ khóa (`email`, `post_id`…),
KHÔNG BAO GIỜ lưu giá trị từ khóa.

> ⚠ Khung nhìn hỗ trợ do `owner` sở hữu và **vượt RLS** của bảng gốc (không `security_invoker`). CHỈ
> được `GRANT SELECT` cho `support` – cấp cho `app`/`system` là rò dữ liệu chéo tenant (quy tắc
> `i-support-view-leak`). Khung nhìn chi tiết PHẢI có `WHERE account_id = account.current_account_id()`.
> Mẫu: `drizzle/migrations-dev/0001_support_views.sql`. Khung nhìn thật đặt trong schema của module
> sở hữu dữ liệu, qua migration tay, chỉ chọn cột cần cho hỗ trợ (không nội dung, không bí mật).

## Thêm bảng khách hàng

1. Khai báo trong `src/modules/<module>/internal/db/schema.ts` (chỉ module đó nhập được):

   ```ts
   import { sql } from 'drizzle-orm';
   import { index, text } from 'drizzle-orm/pg-core';
   import { microUsd, moduleSchema, nonNegativeCheck, tenantTable } from '../../../../core';

   const content = moduleSchema('content'); // KHÔNG export đối tượng schema (xem lưu ý)

   export const posts = tenantTable(
     content,
     'posts',
     {
       title: text('title').notNull(),
       status: text('status').notNull().default('draft'),
       ai_cost_micro_usd: microUsd('ai_cost_micro_usd')
         .notNull()
         .default(sql`0`),
     },
     (t) => [
       index('posts_account_id_status_idx').on(t.account_id, t.status),
       nonNegativeCheck('posts', 'ai_cost_micro_usd'),
     ],
     { softDelete: true, versioned: true },
   );
   ```

   `tenantTable` tự thêm: `id` (UUID v7), `account_id NOT NULL` FK `account.accounts ON DELETE CASCADE`,
   `created_at`, `updated_at`, tùy chọn `deleted_at`/`version`, chỉ mục `<bảng>_account_id_idx` và
   chính sách `tenant_isolation`. Mọi chỉ mục khác PHẢI bắt đầu bằng `account_id`, hoặc khai báo trong
   `indexExceptions: { tên: 'lý do' }`.

2. `pnpm db:generate --name <tên>` → tệp mới trong `drizzle/migrations/`.
3. **Review SQL**: phải có `ENABLE ROW LEVEL SECURITY`, `CREATE POLICY "tenant_isolation"`, FK `ON
DELETE cascade`. KHÔNG được có `CREATE SCHEMA` (nếu có: bạn đã export đối tượng schema – bỏ export).
4. `pnpm db:migrate`, rồi `pnpm db:check` → `ĐẠT`.
5. Thêm kiểm thử truy cập chéo `test/db/<bảng>.db.spec.ts`:

   ```ts
   describeCrossTenant({
     table: posts,
     insertRow: () => ({ title: 'a' }),
     updateRow: () => ({ status: 'x' }),
   });
   ```

   rồi `pnpm test:db`.

**Lưu ý**: schema chỉ được tạo bằng migration tay theo `modules.manifest.json` (xem
`0000_schemas_grants.sql`). Thêm module mới → thêm migration tay tạo schema + `GRANT USAGE` + `ALTER
DEFAULT PRIVILEGES` như 0000. Không bao giờ dùng `drizzle-kit push`; không sửa tay `meta/_journal.json`.

## Thêm bảng dùng chung

Bảng không thuộc tài khoản nào (vd bảng giá mô hình, danh sách nguồn xu hướng):

```ts
export const modelPrices = sharedTable(aiGateway, 'model_prices', { … }, undefined, {
  reason: 'Bảng giá mô hình là cấu hình chung cho mọi tài khoản',
});
```

Không có `account_id`, không RLS. Thiếu `reason` → lỗi. Quyền mặc định của schema cho `app`/`system`
cả đọc lẫn ghi – bảng chỉ đọc với ứng dụng PHẢI `REVOKE INSERT, UPDATE, DELETE` trong migration tay ngay
sau migration tạo bảng.

## Bảng nhật ký phân vùng

Drizzle-kit không sinh `PARTITION BY`. Quy trình (mẫu: `infra.audit_log`):

1. Migration tay (`pnpm db:generate:custom --name <tên>`): `CREATE TABLE … PARTITION BY RANGE
(<cột thời gian>)`, khóa chính chứa cột phân vùng, `ENABLE ROW LEVEL SECURITY` + chính sách (nhật ký
   chỉ-thêm: `FOR INSERT … WITH CHECK (true)`; nhật ký khách hàng đọc được: `tenant_isolation`), quyền,
   hàm tạo phân vùng `SECURITY DEFINER` (bật RLS trên mỗi phân vùng).
2. Định nghĩa Drizzle để truy vấn có kiểu bằng `partitionedLogTable(...)` trong tệp `*.log-table.ts`
   (ngoài glob của `drizzle.config.ts`, nên drizzle-kit không sinh `CREATE TABLE` thường).
3. KHÔNG có FK tới `accounts` (dòng nhật ký còn sau khi xóa tài khoản – quy tắc `h`). Bỏ phân vùng
   > 12 tháng và ẩn danh hóa khi xóa tài khoản: việc định kỳ (WBS 1.3).

## Cột tiền

Tiền là số nguyên micro-USD: `microUsd('<tên>_micro_usd')` (`bigint`, chế độ `bigint` của JS – không
mất chính xác) + `nonNegativeCheck(bảng, cột)` khi không âm. Số thực (`real`, `double precision`,
`numeric`) bị `db:check` chặn (quy tắc `e`). Mặc định viết `default(sql\`0\`)`(drizzle-kit không tuần tự
hóa được`0n`). Không hiển thị số tiền AI cho khách hàng (hiến pháp III).

## Khóa lạc quan

Bảng `versioned: true` có cột `version`. Cập nhật có điều kiện:

```ts
await tenantTx((db) => updateVersioned(db, posts, { id, expectedVersion }, { title }));
```

0 dòng (người khác đã sửa hoặc đã xóa) → `AppError` `VERSION_CONFLICT` (HTTP 409, "Bài vừa được người
khác sửa. Tải lại để xem bản mới nhất.", hành động "Tải lại").

## Migration tương thích ngược

API/Worker bản cũ và bản mới chạy song song khi phát hành (hiến pháp – quy trình). Mọi thay đổi cấu
trúc theo **mở rộng → chuyển → thu gọn**:

1. **Mở rộng** (bản N): chỉ thêm – bảng mới, cột mới `NULL` hoặc có `DEFAULT`, chỉ mục mới
   (`CREATE INDEX CONCURRENTLY` trong migration tay khi bảng lớn). Bản N−1 vẫn chạy đúng.
2. **Chuyển** (bản N): mã ghi cả cột cũ và mới; backfill dữ liệu bằng việc nền/migration dữ liệu.
3. **Thu gọn** (bản N+1, sau khi không còn bản N−1): bỏ cột cũ, `SET NOT NULL` sau khi đã backfill.

Cụ thể:

- Đổi tên cột = thêm cột mới + ghi cả hai + bỏ cột cũ ở lần phát hành sau. Không `RENAME`.
- Đổi kiểu = cột mới kiểu mới + chuyển dữ liệu; không `ALTER COLUMN … TYPE` trên bảng đang dùng.
- Không `SET NOT NULL` trên cột cũ khi chưa backfill và chưa phát hành bản luôn ghi giá trị.
- Không `DROP TABLE`/`DROP COLUMN` thứ bản đang chạy còn đọc.

`pnpm db:lint-migrations` quét migration MỚI so với nhánh gốc (`MIGRATION_BASE_REF`, mặc định `main`)
tìm `DROP COLUMN/TABLE/SCHEMA`, `RENAME`, `ALTER COLUMN … TYPE`, `SET NOT NULL` (trừ trên bảng tạo
trong cùng tệp). Câu lệnh cố ý (bước thu gọn) phải có chú thích ngay dòng trên:

```sql
-- breaking-ok: cột title ngừng ghi từ bản 1.4; bản 1.5 xóa (lần phát hành thứ hai)
ALTER TABLE "content"."posts" DROP COLUMN "title";
```

## Xác thực: `authTx`, `runInAccountScope`, hàm `SECURITY DEFINER` (004)

Vài bước của xác thực xảy ra **trước** khi biết tenant: đăng ký, tra email khi đăng nhập/quên mật
khẩu, tra phiên theo cookie, tra mã một lần trong liên kết. Không có vai trò nào được vượt RLS, nên các
bước này đi qua 4 hàm `SECURITY DEFINER` hẹp (migration `0006_account_auth_functions.sql`):

| Hàm                                                           | Dùng khi                         | Trả về                                                                        |
| ------------------------------------------------------------- | -------------------------------- | ----------------------------------------------------------------------------- |
| `account.auth_register(…)`                                    | đăng ký                          | `'created'` / `'email_taken'` – tạo nguyên vẹn 5 dòng hoặc không gì           |
| `account.auth_lookup_email(email_normalized)`                 | đăng nhập, quên mật khẩu         | người dùng + băm + trạng thái (khớp chính xác, bỏ tài khoản đã xóa)           |
| `account.auth_resolve_session(token_hash, touch_after, idle)` | mỗi yêu cầu khi bộ nhớ đệm trượt | phiên còn hiệu lực + vai trò; gia hạn khi `last_seen_at` cũ hơn `touch_after` |
| `account.auth_find_token(token_hash, purpose)`                | mở liên kết xác minh/đặt lại     | mã còn hiệu lực – **không** tiêu thụ                                          |

Mỗi hàm: chủ `owner`, `SET search_path = pg_catalog, account`, `REVOKE ALL … FROM PUBLIC`, chỉ `app` có
`EXECUTE` (không cấp `system`, `support`), trả đúng các cột liệt kê. Sửa các hàm này phải review theo
nguyên tắc I. Kiểm thử bắt buộc: `test/db/auth-functions.db.spec.ts` (quyền gọi, cột trả về, đăng ký
đồng thời, mọi điều kiện hiệu lực).

- `authTx(fn)` (`core/db/auth-tx.ts`): giao dịch `app` **không** đặt ngữ cảnh tenant – chỉ để gọi 4 hàm
  trên, đọc/ghi bảng dùng chung `staff_users`, `staff_sessions`, `auth_throttle` và ghi `infra.audit_log`.
  Bộ gác truy vấn vẫn chặn bảng tenant (dev/test ném `TENANT_CONTEXT_MISSING`). Không xuất qua `core`.
- `runInAccountScope(accountId, fn)` (`core/auth/account-scope.ts`): chạy `fn` trong ngữ cảnh **con** có
  `accountId` để dùng `tenantTx` – chỉ với `accountId` lấy từ CSDL sau khi danh tính đã xác minh. Đã gắn
  tài khoản khác hoặc đang trong giao dịch → `TENANT_CONTEXT_CONFLICT`.
- Quy tắc ranh giới `auth-tx-restricted`, `account-scope-restricted` giới hạn nơi được nhập hai hàm này
  (`docs/auth.md`).

**Chỉ mục duy nhất toàn cục (ngoại lệ có lý do của quy tắc `d` – cột đầu không phải `account_id`)**,
khai báo ở `indexExceptions` của `modules/account/internal/db/schema.ts`:

| Chỉ mục                                 | Lý do                                                        |
| --------------------------------------- | ------------------------------------------------------------ |
| `users_email_normalized_key`            | một email chỉ có một tài khoản trên toàn hệ thống (FR-002)   |
| `login_identities_provider_subject_key` | một danh tính nhà cung cấp chỉ thuộc một người dùng (FR-003) |
| `sessions_token_hash_key`               | tra phiên theo mã trước khi biết tenant                      |
| `auth_tokens_token_hash_key`            | tra mã một lần trước khi biết tenant                         |

## Kiểm tra quy ước (`pnpm db:check`)

Quy tắc a–k: `specs/002-db-layer-tenant-rls/contracts/db-conventions.md`. Mã thoát 0 đạt / 1 có vi
phạm / 2 không kết nối được. Chạy trên CSDL đã migrate bằng `DATABASE_OWNER_URL`; `--json` cho CI.

## Lịch sử diễn tập

| Ngày       | Nội dung                                                                                                                                                                                                                             | Kết quả                                                                                                                                                                                                                                                                                                     |
| ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 2026-11-08 | SC-005: thêm `content.dryrun_items` theo mục "Thêm bảng khách hàng" (khai báo → `db:generate` → review → `db:migrate` → `db:check` → `describeCrossTenant`) trên nhánh `impl/002-db-layer-tenant-rls`, rồi xóa bảng và migration thử | Đạt, ~5 phút (các lệnh chạy < 10 s). SQL sinh đúng khuôn, `db:check` 0 vi phạm, khuôn truy cập chéo 10/10. Đã bổ sung vào tài liệu: cảnh báo không export đối tượng schema (drizzle-kit sinh `CREATE SCHEMA` trùng), mặc định cột tiền `sql\`0\``, nhập từ `core`bằng đường dẫn tương đối`../../../../core` |
