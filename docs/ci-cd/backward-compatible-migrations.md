# Migration tương thích ngược

Hiến pháp: thay đổi cấu trúc CSDL MUST tương thích ngược để API/Worker cũ và mới chạy song song khi phát hành. Khi
triển khai, **migration chạy trước** (Job `migrate-<sha12>`), rồi `api` và `worker` được thay dần – nên trong vài phút
bản cũ chạy trên cấu trúc mới; và nếu phải quay về, bản cũ tiếp tục chạy trên cấu trúc mới **mãi mãi** (CSDL chỉ đi
tới – xem [rollback.md](rollback.md)).

## Ba bước: mở rộng → chuyển mã → thu hẹp

| Bước         | Phát hành             | Làm gì                                                                       | Ví dụ đổi tên cột `a` → `b`                      |
| ------------ | --------------------- | ---------------------------------------------------------------------------- | ------------------------------------------------ |
| 1. Mở rộng   | lần 1                 | chỉ **thêm** (cột/bảng/chỉ mục mới); bản cũ không bị ảnh hưởng               | `ADD COLUMN b` (cho phép NULL hoặc có `DEFAULT`) |
| 2. Chuyển mã | lần 1–2               | mã mới ghi cả hai, backfill dữ liệu, rồi đọc từ chỗ mới                      | ghi `a` và `b`; backfill `b` từ `a`; đọc `b`     |
| 3. Thu hẹp   | lần phát hành **sau** | khi không còn bản nào đọc/ghi chỗ cũ mới xóa/đổi; khai báo `-- breaking-ok:` | `DROP COLUMN a`                                  |

## Các luật tĩnh của `db:lint-migrations`

Chỉ xét migration **mới** (so với `MIGRATION_BASE_REF`, mặc định `origin/dev`); bảng vừa tạo trong chính migration đó
được miễn nếu luật cho phép. Mỗi vi phạm in tệp, dòng, câu lệnh, lý do và cách chia bước thay thế.

| Mã luật                                      | Câu lệnh bị chặn                                                  | Cách chia bước                                                                                                                                                     |
| -------------------------------------------- | ----------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `drop-schema` / `drop-table` / `drop-column` | xóa schema / bảng / cột                                           | tách hai lần phát hành: lần 1 ngừng dùng trong mã, lần 2 mới xóa (kèm `-- breaking-ok:`)                                                                           |
| `rename`                                     | đổi tên bảng / cột                                                | thêm tên mới → ghi cả hai → chuyển dữ liệu → đổi mã → xóa tên cũ ở lần phát hành sau                                                                               |
| `alter-column-type`                          | đổi kiểu cột                                                      | thêm cột mới kiểu mới → ghi cả hai → chuyển dữ liệu → đổi mã → xóa cột cũ ở lần sau                                                                                |
| `set-not-null`                               | `SET NOT NULL` trên cột có sẵn                                    | lần 1: mã mới luôn ghi giá trị + backfill; lần 2: `SET NOT NULL` (kèm `-- breaking-ok:`)                                                                           |
| `add-not-null-without-default`               | `ADD COLUMN … NOT NULL` không `DEFAULT`                           | thêm cột kèm `DEFAULT` hoặc cho phép NULL → mã mới ghi + backfill → `SET NOT NULL` ở lần sau                                                                       |
| `add-constraint-validating`                  | `ADD CONSTRAINT` (CHECK/FK/UNIQUE) trên bảng có sẵn, quét cả bảng | CHECK/FK: `… NOT VALID` rồi `VALIDATE CONSTRAINT` ở câu lệnh sau; UNIQUE: dựng chỉ mục duy nhất trước rồi `ADD CONSTRAINT … UNIQUE USING INDEX`                    |
| `create-index-blocking`                      | `CREATE INDEX` không `CONCURRENTLY` trên bảng có sẵn              | bảng lớn: `CREATE INDEX CONCURRENTLY` chạy ngoài giao dịch (thao tác vận hành riêng); bảng nhỏ: giữ câu lệnh và khai báo `-- breaking-ok: bảng nhỏ, khóa ghi ngắn` |
| `drop-type`                                  | xóa kiểu / bỏ giá trị enum                                        | bản đang chạy còn ghi giá trị cũ – tách hai lần phát hành như trên                                                                                                 |

## `-- breaking-ok:` và `db:compat`

Thao tác thu hẹp có chủ đích khai báo ngay dòng trên câu lệnh:

```sql
-- breaking-ok: cột legacy_name không còn được mã nào đọc/ghi từ bản 2026-11-20
ALTER TABLE context.business_profiles DROP COLUMN legacy_name;
```

Khai báo chỉ làm `db:lint-migrations` bỏ qua. Cổng thật là **`db:compat`**: nó chạy kịch bản `test:compat` của bản
**đang chạy** ở môi trường trên CSDL đã có migration mới. Nếu bản đang chạy còn đọc cột đó thì `db:compat` đỏ dù
`db:lint-migrations` xanh (FR-020). Vì vậy: thu hẹp chỉ qua cổng khi lần phát hành trước **đã ngừng dùng** nó.

## Migration bất biến (`db:immutable`)

- Tệp migration đã có trên nhánh gốc (`dev`/`master`) **không bao giờ được sửa** – sai thì viết migration mới sửa.
  "Đã áp dụng" nghĩa là "đã có trên `dev` hoặc `master`", vì hợp nhất vào `dev` là triển khai ngay.
- `meta/_journal.json` chỉ được **nối thêm** vào cuối, và mốc `when` của mục mới **phải lớn hơn** mọi mục đã có.

> **Vì sao**: bộ chạy migration chỉ so `when` của từng mục với mốc lớn nhất đã áp. Migration có `when` **nhỏ hơn** mốc đó
> bị **bỏ qua âm thầm** (không áp, không lỗi) và về sau cũng không bao giờ được áp. Đã kiểm trên PostgreSQL thật
> (`apps/server/test/db/migration-order.db.spec.ts`). Hệ quả thực tế: hai nhánh cùng thêm migration rồi hợp nhất theo
> thứ tự ngược mốc thời gian sẽ làm một migration "biến mất" – `db:immutable` chặn trường hợp này; khi gặp, sinh lại
> migration của nhánh đến sau (`pnpm --filter @app/server db:generate`) để có mốc mới.

## Sửa nóng có kèm migration

**Không cho phép.** Nhánh `hotfix/*` tách từ `master`, mà `master` luôn "cũ" hơn `dev` về mốc migration; migration của
bản sửa nóng sẽ có `when` nhỏ hơn migration đã áp từ `dev` ở staging và có thể bị bỏ qua âm thầm khi gộp về. Cần đổi cấu
trúc → đi đường thường (`dev` → `master`). `check:release-source` chặn pull request `hotfix/*` có migration.
