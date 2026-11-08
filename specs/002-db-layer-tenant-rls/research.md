# Research – Lớp CSDL, ngữ cảnh tenant, RLS mẫu (002)

Phase 0 của `/speckit-plan`. Mỗi mục: **Quyết định** · **Lý do** · **Phương án đã cân nhắc**. Mã R*
được `plan.md`, `data-model.md`, `contracts/` tham chiếu. Ngăn xếp (PostgreSQL ≥ 13 + RLS, Drizzle,
NestJS) đã chốt bởi hiến pháp – ở đây chỉ chọn chi tiết.

---

## R1. Trình điều khiển kết nối: `pg` (node-postgres)

- **Quyết định**: `pg` + `drizzle-orm/node-postgres`. Khóa phiên bản chính xác lúc cài (`.npmrc`
  `save-exact`), dòng ổn định hiện hành của `drizzle-orm`/`drizzle-kit` có `pgPolicy`, `pgRole`.
- **Lý do**: pg-boss (WBS 1.3) chạy trên `pg` – một trình điều khiển, một kiểu bể kết nối, và pg-boss
  nhận được bộ thực thi SQL bên ngoài để tạo việc **trong cùng giao dịch** với dữ liệu nghiệp vụ
  (nguyên tắc IV, ADR-03). `pg.PoolClient` cho phép tự quản giao dịch (R4) và hủy kết nối lỗi
  (`release(err)`). JS thuần, chạy được Windows/Linux.
- **Đã cân nhắc**: `postgres` (postgres.js) – nhanh, API gọn, nhưng thành hai trình điều khiển khi
  có pg-boss và khó chen kiểm tra vào từng câu lệnh; `@neondatabase/serverless` – không hợp hạ tầng.

## R2. Biến phiên tenant và điều kiện chính sách

- **Quyết định**: đầu mỗi giao dịch chạy `SELECT set_config('app.account_id', $1, true)` (tham số
  thứ ba `true` = phạm vi giao dịch). Điều kiện chính sách gói trong hàm
  `account.current_account_id()`:
  `SELECT nullif(current_setting('app.account_id', true), '')::uuid` (SQL, `STABLE`, `PARALLEL SAFE`).
  Chính sách: `account_id = account.current_account_id()` cho cả `USING` và `WITH CHECK`.
- **Lý do**:
  - **Bẫy quan trọng**: sau khi một giao dịch đã `set_config(..., true)` và kết thúc, biến trên kết nối
    đó không trở về NULL mà thành **chuỗi rỗng**. Viết thẳng `current_setting(...)::uuid` thì lần dùng
    lại kết nối sẽ lỗi `invalid input syntax for type uuid` thay vì trả 0 dòng – vừa sai FR-008 ở môi
    trường chính thức, vừa che lỗi rò ngữ cảnh. `nullif(…, '')` đưa cả hai trường hợp (chưa từng đặt,
    đã hết giao dịch) về NULL → `account_id = NULL` không đúng với dòng nào (mặc định an toàn).
  - Gói vào một hàm để khuôn chính sách chỉ có một câu điều kiện, sửa một nơi. Hàm SQL `STABLE` một
    câu được PostgreSQL nội tuyến nên không tốn thêm chi phí; chỉ mục `account_id` vẫn dùng được.
  - Đặt hàm ở schema `account` vì đó là gốc tenant (ADR-09 cho phép mọi bảng trỏ tới `account`).
- **Đã cân nhắc**: `SET LOCAL app.account_id = …` – không nhận tham số ràng buộc, phải nối chuỗi;
  phạm vi kết nối (`set_config(..., false)`) – rò ngữ cảnh qua bể, trái hiến pháp I; mỗi tenant một
  vai trò CSDL – không mở rộng được.
- **Đề xuất sửa tài liệu**: ADR-02 câu "mỗi kết nối đặt biến phiên = mã tài khoản" → "mỗi **giao
  dịch** đặt biến phiên phạm vi giao dịch" (khớp hiến pháp I và Kiến trúc dữ liệu mục 6). Là việc sửa
  câu chữ (không đổi quyết định) – đưa vào tasks.

## R3. Kiểm tra mã tài khoản khi mở ngữ cảnh

- **Quyết định**: (1) kiểm tra định dạng UUID ở ứng dụng trước khi chạm CSDL; (2) sau `set_config`
  chạy `SELECT 1 FROM account.accounts WHERE id = account.current_account_id()` – không có dòng →
  hoàn tác và ném `TenantContextError` (`TENANT_NOT_FOUND`). Hai câu lệnh, cùng một kết nối.
- **Lý do**: Edge case "tài khoản không tồn tại → từ chối, không âm thầm chạy tiếp". Câu thứ hai đi
  qua chính sách của `accounts` nên đồng thời chứng minh biến đã có hiệu lực. Đo ở SC-006 (dự kiến
  < 1 ms mỗi câu trên máy cục bộ).
- **Đã cân nhắc**: gộp một câu (`set_config` trong `WHERE`) – thứ tự đánh giá biểu thức không được
  bảo đảm; bỏ bước kiểm tra tồn tại – lỗi gõ nhầm mã sẽ chạy với "0 dòng" khó phát hiện.

## R4. Tự quản giao dịch trên `PoolClient`, Drizzle gắn vào từng giao dịch

- **Quyết định**: Lớp CSDL lấy `PoolClient` từ bể, tự chạy `BEGIN` → `set_config` → kiểm tra →
  công việc → `COMMIT`/`ROLLBACK`, rồi `release()`; lỗi kết nối/lỗi khi `ROLLBACK` → `release(err)`
  để **hủy** kết nối thay vì trả về bể. Mỗi giao dịch tạo một thể hiện `drizzle(client, { schema })`
  (rẻ – chỉ là đối tượng bọc). Ngữ cảnh giao dịch (`{ db, accountId, role }`) giữ trong
  `AsyncLocalStorage` để: phát hiện gọi lồng (cùng tài khoản → dùng lại, khác → lỗi `FR-005`), đọc
  `accountId` cho nhật ký (FR-007).
- **Lý do**: kiểm soát chính xác thời điểm đặt biến, việc hủy kết nối hỏng (edge case "ngắt giữa giao
  dịch"), và chèn bộ gác truy vấn (R5) vào `client.query`. `db.transaction()` của Drizzle không cho
  chèn bước sau `BEGIN` một cách tường minh và không phân biệt trả/hủy kết nối.
- **Đã cân nhắc**: `db.transaction(async tx => { await tx.execute(set_config…) })` – được, nhưng
  không hủy được kết nối lỗi và không chèn được bộ gác; middleware/plugin RLS bên thứ ba – thêm phụ
  thuộc không cần thiết (nguyên tắc IX).

## R5. Phát hiện truy vấn bảng khách hàng ngoài ngữ cảnh tenant (FR-008)

- **Quyết định**: Hai lớp:
  1. **Thiết kế API**: lớp CSDL **không xuất** thể hiện Drizzle/bể kết nối "trần" cho module. Đường
     duy nhất tới bảng là `tenantTx`, `systemTx`, `supportSearch`, `supportViewAccount`. Truy vấn tự
     xác nhận ngoài giao dịch không viết được.
  2. **Bộ gác truy vấn** trong giao dịch **không** có tenant (chỉ `systemTx` không tài khoản, và bước
     tìm kiếm của hỗ trợ): bọc `client.query`, quét chuỗi SQL tìm định danh `"schema"."table"` (Drizzle
     luôn sinh dạng có ngoặc kép, có schema) và đối chiếu với **sổ đăng ký bảng** (R8) loại `tenant`.
     Trúng → `development`/`test`: ném `TenantContextError` (`TENANT_CONTEXT_MISSING`, nêu
     `schema.table`); `staging`/`production`: ghi `warn` có cấu trúc (`event: db.tenant_context_missing`,
     `table`, `trace_id`; không có tham số/dữ liệu) rồi vẫn chạy – CSDL trả 0 dòng nhờ RLS.
- **Lý do**: lớp 1 loại bỏ phần lớn khả năng sai; lớp 2 là phản hồi nhanh cho lập trình viên khi viết
  việc hệ thống. Chi phí: một lần quét biểu thức chính quy trên câu SQL ngắn, chỉ trong giao dịch không
  tenant. Lớp chặn cuối vẫn là RLS ở CSDL.
- **Đã cân nhắc**: dựa vào `logger` của Drizzle (không chặn được câu SQL thô, ném lỗi từ logger là
  dùng sai mục đích); để CSDL tự ném lỗi bằng `current_setting('app.account_id')` không `missing_ok` –
  ném lỗi cả ở môi trường chính thức (trái clarification) và không ổn định vì bẫy chuỗi rỗng ở R2;
  phân tích cú pháp SQL đầy đủ – nặng, không cần.

## R6. Vai trò CSDL: tạo bằng bước khởi tạo, quyền bằng migration

- **Quyết định**: Tách hai bước:
  - **Khởi tạo** (`pnpm db:bootstrap`, chạy bằng tài khoản quản trị cụm, idempotent): tạo 4 vai trò
    đăng nhập `owner`, `app`, `system`, `support` (`NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE
    NOREPLICATION`, không vai trò nào là thành viên của vai trò khác), đặt mật khẩu từ biến môi trường,
    trao CSDL cho `owner`, `REVOKE CREATE ON SCHEMA public FROM PUBLIC`, `REVOKE ALL ON DATABASE … FROM
    PUBLIC` + `GRANT CONNECT` cho 4 vai trò. Dev/test chạy bằng lệnh; môi trường thật do hạ tầng
    (WBS 1.5) chạy **cùng tệp SQL**.
  - **Migration** (`pnpm db:migrate`, vai trò `owner`): schema, bảng, hàm, chính sách, `GRANT`,
    `ALTER DEFAULT PRIVILEGES`. Trong Drizzle khai báo `pgRole('app').existing()` để chính sách tham
    chiếu vai trò mà drizzle-kit không cố tạo/xóa vai trò.
- **Lý do**: vai trò là đối tượng **cấp cụm**, cần quyền `CREATEROLE` mà `owner` không nên có (nếu có
  thì `owner` tự cấp được `BYPASSRLS`… cho vai trò khác); mật khẩu không được nằm trong migration lưu ở
  kho mã. Dịch vụ CSDL được quản lý thường tạo người dùng qua bảng điều khiển/API, không qua migration.
  `pnpm db:setup` (dev) = bootstrap + migrate, nên kịch bản "sau lệnh có đủ 4 vai trò" của US2 vẫn
  kiểm chứng được bằng một lệnh.
- **Đã cân nhắc**: migration tạo vai trò `NOLOGIN` + bootstrap chỉ đặt mật khẩu – vẫn cần `CREATEROLE`
  cho `owner`; một vai trò đăng nhập + `SET ROLE` – `app` sẽ là thành viên của vai trò khác, trái
  US4-AS6 ("chuyển sang vai trò khác → bị từ chối").
- **Ghi chú tên**: `owner`, `system` là từ khóa *không dành riêng* của PostgreSQL nên hợp lệ làm tên
  vai trò; mã SQL luôn đặt trong ngoặc kép (`"owner"`) cho chắc. Vai trò là cấp cụm → các CSDL dev/test
  trên cùng cụm dùng chung 4 vai trò (bootstrap idempotent).

## R7. Không dùng `FORCE ROW LEVEL SECURITY`; tự kiểm vai trò khi khởi động

- **Quyết định**: Không bật `FORCE`. Thay vào đó: (1) API/Worker không bao giờ có chuỗi kết nối của
  `owner` (lược đồ cấu hình không có biến đó; chỉ script migration đọc `DATABASE_OWNER_URL`);
  (2) khi bể kết nối khởi tạo, chạy tự kiểm: `current_user` ∈ {`app`,`system`,`support`} và
  `rolsuper = false`, `rolbypassrls = false`; sai → thoát với thông báo không chứa mật khẩu;
  (3) kiểm tra quy ước (g) và (f).
- **Lý do**: `FORCE` làm chính `owner` bị RLS – migration dữ liệu (backfill) sau này phải đặt ngữ cảnh
  từng tenant, phức tạp không cần thiết; và drizzle-kit không sinh `FORCE` nên phải viết tay mỗi bảng,
  trái mục tiêu "một khai báo". Mối nguy mà `FORCE` chặn (ứng dụng chạy nhầm bằng chủ bảng) được chặn
  ở (1)–(3).
- **Đã cân nhắc**: `FORCE` trên mọi bảng khách hàng – an toàn hơn một chút, nhưng chi phí vận hành cao
  hơn lợi ích khi đã tách vai trò.

## R8. Khuôn bảng: hàm dựng `tenantTable` / `sharedTable` / `partitionedLogTable` + sổ đăng ký

- **Quyết định**: Lõi `core/db` cung cấp ba hàm dựng bọc `schema.table()` của Drizzle:
  - `tenantTable(schema, name, columns, extra?, opts?)`: thêm bộ cột chuẩn (`id` UUID v7 `$defaultFn`,
    `account_id NOT NULL REFERENCES account.accounts(id) ON DELETE CASCADE`, `created_at`,
    `updated_at`, tùy chọn `deleted_at`, `version`), chính sách `tenant_isolation` (`pgPolicy`,
    `for: 'all'`, `to: [app, system]`, `using` + `withCheck` = R2) và chỉ mục mặc định
    `(account_id)`; `opts.indexExceptions: { [tên]: lý do }`.
  - `sharedTable(schema, name, columns, extra?, { reason })`: bảng dùng chung, không `account_id`.
  - `partitionedLogTable(schema, name, columns, { partitionBy })`: chỉ để Drizzle biết kiểu khi truy
    vấn; DDL viết tay (R10).
  Mỗi hàm ghi `{ schema, name, kind, indexExceptions, reason }` vào **sổ đăng ký bảng** (một `Map` trong
  tiến trình) – nguồn cho bộ gác R5 và lệnh kiểm tra quy ước R12.
- **Lý do**: lập trình viên không tự viết câu điều kiện (US3); drizzle-kit sinh sẵn `ENABLE ROW LEVEL
  SECURITY` + `CREATE POLICY` khi bảng có `pgPolicy`. Loại bảng được khai báo ở mã → kiểm tra (b) phân
  biệt được "bảng dùng chung" với "bảng khách hàng quên cột" (edge case).
- **Đã cân nhắc**: chú thích `COMMENT ON TABLE` làm nơi khai báo loại – drizzle-kit không sinh, phải
  viết tay; tự viết `CREATE POLICY` trong migration tay cho từng bảng – dễ quên (đúng rủi ro US3 nêu).
- **Chính sách cho `support`**: không cấp. `support` không có quyền trên bảng gốc (US4-AS3); chỉ đọc
  khung nhìn (R11).

## R9. Bảng gốc `account.accounts` nằm ở lõi

- **Quyết định**: Định nghĩa Drizzle của `account.accounts` nằm ở `core/db/tenant-root.ts` (lõi), vì
  hàm dựng `tenantTable` ở lõi phải tham chiếu nó để tạo khóa ngoại, mà lõi **không được** nhập module
  (`core-no-modules`). Module `account` sở hữu về nghiệp vụ và bổ sung cột ở chính tệp này (ghi chú đầu
  tệp). Chính sách: `id = account.current_account_id()`; `app`, `system` chỉ `SELECT, UPDATE`
  (không `INSERT`/`DELETE` – đăng ký và xóa tài khoản là đường riêng có kiểm soát, ngoài phạm vi).
- **Lý do**: ADR-09 coi `accounts` là đích khóa ngoại chung của mọi module – về bản chất là hạ tầng
  tenant; giữ quy tắc ranh giới không ngoại lệ.
- **Đã cân nhắc**: khai báo khóa ngoại bằng SQL thô không tham chiếu bảng Drizzle – drizzle-kit không
  biết, sẽ sinh sai khi đổi; cho lõi nhập riêng `modules/account` – phá quy tắc ranh giới của 001.

## R10. Migration: drizzle-kit `generate` + migration SQL tay; trình chạy tự viết bằng migrator

- **Quyết định**:
  - Bảng thường + chính sách: `drizzle-kit generate` từ định nghĩa TypeScript → tệp SQL trong
    `apps/server/drizzle/migrations/` (lưu ở kho, review như mã).
  - Phần drizzle-kit không biểu diễn được (schema theo tệp kê khai, hàm `current_account_id`, quyền,
    quyền mặc định, bảng phân vùng `infra.audit_log`, hàm tạo phân vùng): `drizzle-kit generate
    --custom` → SQL viết tay, cùng thư mục, cùng nhật ký thứ tự.
  - Bảng phân vùng được định nghĩa Drizzle trong tệp **không** nằm trong glob `schema` của
    `drizzle.config.ts` (`*.log-table.ts`) để drizzle-kit không sinh `CREATE TABLE` thường.
  - Trình chạy: `src/db/migrate.ts` (biên dịch ra `dist/db/migrate.js`, chạy được trong ảnh container
    như một Job riêng) dùng `migrate()` của `drizzle-orm/node-postgres/migrator`, bảng nhật ký
    migration ở `infra.schema_migrations` (không tạo schema `drizzle` thừa). Khóa
    `pg_advisory_lock` quanh lần chạy để hai bản chạy cùng lúc không đè nhau. Idempotent nhờ nhật ký.
  - Bảng mẫu (FR-017): thư mục riêng `apps/server/drizzle/migrations-dev/`, cấu hình
    `drizzle.dev.config.ts`, nhật ký `infra.schema_migrations_dev`; trình chạy chỉ áp dụng khi
    `APP_ENV ∈ {development, test}`.
- **Lý do**: giữ một công cụ (Drizzle) cho cả sinh lẫn chạy; phần đặc thù PostgreSQL vẫn là SQL rõ ràng,
  review được. Migration tách khỏi tiến trình ứng dụng (architecture.md mục 3).
- **Đã cân nhắc**: `drizzle-kit push` – không có lịch sử, cấm ở môi trường thật; `drizzle-kit migrate`
  (CLI) – cần drizzle-kit (devDependency) trong ảnh chạy; công cụ migration khác (graphile-migrate,
  node-pg-migrate) – thêm công cụ thứ hai ngoài ngăn xếp đã chốt.

## R11. Ngữ cảnh hỗ trợ: khung nhìn do `owner` sở hữu, không `security_invoker`

- **Quyết định**:
  - Khung nhìn **tìm kiếm** (xuyên tài khoản): chỉ chọn cột mã tài khoản, mã đối tượng, trạng thái; do
    `owner` sở hữu nên đọc được mọi tenant (chủ bảng không bị RLS khi không `FORCE`).
  - Khung nhìn **chi tiết**: thêm `WHERE account_id = account.current_account_id()` tường minh trong
    định nghĩa khung nhìn → chỉ thấy tài khoản đang được đặt ngữ cảnh.
  - `support` chỉ có `SELECT` trên hai khung nhìn và `INSERT` trên `infra.audit_log`; không có quyền
    trên bảng gốc.
  - `supportSearch(actor, keywordType, fn)` và `supportViewAccount(actor, accountId, reason, fn)` mở
    giao dịch trên bể `support`, **ghi dòng kiểm toán trước** rồi mới chạy `fn`, cùng giao dịch – lỗi
    giữa chừng thì không có cả kết quả lẫn dòng kiểm toán "mồ côi" (SC-007).
- **Lý do**: `security_invoker` (PG ≥ 15) buộc `support` phải có `SELECT` trên bảng gốc → trái US4-AS3;
  và PG 13/14 không có. Bộ lọc tường minh trong khung nhìn chi tiết là bản sao cùng một hàm R2.
- **Rủi ro & chặn**: khung nhìn do `owner` sở hữu vượt RLS → MUST NOT cấp khung nhìn hỗ trợ cho `app`/
  `system`. Ghi trong hướng dẫn; kiểm tra quy ước thêm quy tắc (i) "khung nhìn trong schema module cấp
  cho `app`/`system`" (cảnh báo, ngoài danh sách (a)–(h) của spec).
- **`accountId` từ tham số**: `supportViewAccount` là ngoại lệ có chủ đích (nhân viên chọn tài khoản để
  xem); chỉ dùng được với bể `support`, luôn có kiểm toán – đúng hiến pháp I ("vai trò riêng, chỉ đọc
  qua khung nhìn đã lọc, mọi lần xem được ghi kiểm toán").

## R12. Lệnh kiểm tra quy ước CSDL (`pnpm db:check`)

- **Quyết định**: Script TypeScript `src/db/check-conventions.ts`, đọc **danh mục hệ thống**
  (`pg_class`, `pg_namespace`, `pg_policy`, `pg_index`, `pg_constraint`, `pg_attribute`, `pg_roles`,
  `has_*_privilege`) trên CSDL đã migrate, đối chiếu sổ đăng ký bảng (R8) và tệp kê khai module. Quy tắc
  (a)–(h) theo FR-020, thêm (i) ở R11 và (j) "bảng trong schema module không có trong sổ đăng ký". Kết
  quả: bảng `schema · bảng · quy tắc · chi tiết`, mã thoát 1 khi có vi phạm; định dạng JSON với
  `--json`. Chi tiết quy tắc: `contracts/db-conventions.md`.
- **Kiểm chứng (SC-003)**: thư mục `test/db/fixtures/conventions/<quy-tắc>.sql`, mỗi tệp tạo một vi
  phạm trong một CSDL kiểm thử sạch; kiểm thử chạy lệnh và khớp đúng quy tắc mong đợi; thêm một lần chạy
  trên cấu trúc sạch → 0 vi phạm.
- **Đã cân nhắc**: chỉ kiểm tra tĩnh trên định nghĩa TypeScript – không bắt được thứ được tạo bằng
  migration tay (vd bảng phân vùng, quyền); dùng công cụ lint SQL bên ngoài – không biết loại bảng.

## R13. Khóa lạc quan

- **Quyết định**: Hàm `updateVersioned(db, table, { id, expectedVersion }, values)`:
  `UPDATE … SET …, version = version + 1, updated_at = now() WHERE id = $id AND version = $expected
  RETURNING *`; 0 dòng → `AppError` mã `VERSION_CONFLICT` (HTTP 409, thông điệp "Bài vừa được người
  khác sửa. Tải lại để xem bản mới nhất.", hành động `retry`). Thêm mã vào `ERROR_CODES` của
  `@app/shared`.
- **Lý do**: FR-019; RLS đã ẩn dòng của tenant khác nên "0 dòng" chỉ có hai nghĩa (đã bị sửa / đã xóa)
  – cả hai đều xử lý như xung đột ở tầng trên.
- **Đã cân nhắc**: `SELECT … FOR UPDATE` rồi so sánh – thêm một vòng, giữ khóa lâu hơn.

## R14. UUID v7 và thời gian

- **Quyết định**: `id` dùng `$defaultFn(() => uuidV7())` – hàm sẵn có ở `core/ids` (tính năng 001).
  `created_at`/`updated_at` kiểu `timestamp with time zone`, `DEFAULT now()`; `updated_at` thêm
  `$onUpdateFn(() => sql\`now()\`)`. Bể kết nối đặt `options: '-c TimeZone=UTC'`; Drizzle `mode:
  'date'`.
- **Lý do**: hiến pháp (UUID v7 sinh ở ứng dụng; UTC). Không thêm thư viện (`uuid` npm) khi đã có hàm
  kiểm thử sẵn. Thời gian lấy từ CSDL để mọi bản API/Worker cùng một đồng hồ.
- **Đã cân nhắc**: trigger cập nhật `updated_at` – thêm đối tượng CSDL mỗi bảng; `gen_random_uuid()` –
  là v4, không có thứ tự thời gian.

## R15. Bể kết nối và cấu hình

- **Quyết định**: Mỗi vai trò một bể `pg.Pool`, tạo lười: `app` (API + Worker), `system` (chỉ Worker;
  API không tạo), `support` (chỉ API, chỉ khi có cấu hình). Biến mới (đánh dấu `secret()` cho URL):
  `DATABASE_APP_URL` (bắt buộc), `DATABASE_SYSTEM_URL` (bắt buộc ở Worker), `DATABASE_SUPPORT_URL`
  (tùy chọn ở API), `DATABASE_POOL_MAX` (mặc định 10), `DATABASE_STATEMENT_TIMEOUT_MS` (mặc định
  15000), `DATABASE_IDLE_IN_TX_TIMEOUT_MS` (mặc định 30000). Script migration/bootstrap có lược đồ
  riêng: `DATABASE_OWNER_URL`, `DATABASE_ADMIN_URL`, `DB_ROLE_PASSWORD_{OWNER,APP,SYSTEM,SUPPORT}`.
  Đăng ký kiểm tra sẵn sàng `database` (`SELECT 1` trên bể `app`, hết hạn 2 s) vào `ReadinessRegistry`;
  `ShutdownCoordinator` đóng bể sau khi việc đang chạy xong.
- **Lý do**: FR-002; tách bể theo vai trò để quyền được CSDL thực thi chứ không phải ứng dụng tự giữ;
  `idle_in_transaction_session_timeout` cắt giao dịch treo giữ ngữ cảnh. Lỗi kết nối được chuẩn hóa
  thành thông điệp không chứa chuỗi kết nối (SC-008): không bao giờ ghi `err.message` thô của `pg` khi
  lỗi xảy ra lúc kết nối; chỉ ghi `code` (vd `ECONNREFUSED`, `28P01`) và tên biến cấu hình.
- **Đã cân nhắc**: một bể `app` dùng cho mọi việc + `SET ROLE` – đã loại ở R6.

## R16. CSDL cho phát triển và kiểm thử

- **Quyết định**:
  - Dịch vụ `postgres` trong `docker-compose.yml` bỏ `profiles` (API/Worker giờ cần CSDL), giữ
    `postgres:17-alpine` (phiên bản chính có thể đổi bằng `POSTGRES_IMAGE` cho khớp môi trường thật –
    tối thiểu 13; mã không dùng tính năng > 13). Thêm dịch vụ một lần `migrate` (cùng ảnh server, lệnh
    `node dist/db/setup-dev.js` = bootstrap + migrate); `api`, `worker` `depends_on: migrate:
    service_completed_successfully`.
  - Kiểm thử tích hợp CSDL ở `apps/server/test/db/**/*.db.spec.ts`, cấu hình Vitest riêng
    (`vitest.db.config.mts`, chạy tuần tự). `globalSetup` dùng `TEST_DATABASE_ADMIN_URL` tạo một CSDL
    mới tên `app_test_<ngẫu nhiên>`, bootstrap + migrate (gồm migration dev), chạy xong thì xóa.
    Không có biến → bỏ qua có thông báo.
  - `pnpm verify` thêm bước `test:db`; thiếu `TEST_DATABASE_ADMIN_URL` → bước hiện "bỏ qua (chưa có
    CSDL kiểm thử)" và **không** tính là đạt hay lỗi (FR-021). Gắn CI ở WBS 1.4.
- **Lý do**: PostgreSQL thật (FR-025, không giả lập); một lệnh trên Windows và Linux (FR-027); CSDL
  riêng mỗi lần chạy → kiểm thử không phụ thuộc dữ liệu dev.
- **Đã cân nhắc**: Testcontainers – thêm phụ thuộc, vẫn cần Docker, chậm hơn trên Windows; pg-mem /
  PGlite – không đầy đủ RLS/vai trò, trái "không giả lập".

## R17. Kiểm tra migration tương thích ngược (FR-012)

- **Quyết định**: Hướng dẫn "mở rộng → chuyển → thu gọn" (expand/contract) trong tài liệu, và script
  `pnpm db:lint-migrations` quét các tệp SQL migration **mới so với nhánh gốc** (hoặc mọi tệp khi không có
  git) tìm câu lệnh phá vỡ: `DROP COLUMN`, `DROP TABLE`, `RENAME`, `ALTER COLUMN … TYPE`, `SET NOT NULL`
  trên cột có sẵn, `DROP SCHEMA`. Muốn dùng phải có chú thích `-- breaking-ok: <lý do + lần phát hành
  thứ hai>` ngay trước câu lệnh. Gắn CI ở WBS 1.4.
- **Lý do**: rẻ, bắt được lỗi phổ biến nhất khi bản cũ và mới chạy song song.
- **Đã cân nhắc**: công cụ phân tích migration chuyên dụng (squawk…) – thêm công cụ ngoài; để WBS 1.4
  làm hết – spec yêu cầu có quy tắc kiểm tra ngay ở đây.

---

## Thuật ngữ mới (bổ sung `architecture.md` mục 11)

| Tài liệu / đặc tả | Mã nguồn |
|---|---|
| Biến phiên tenant | GUC `app.account_id`; hàm `account.current_account_id()` |
| Bảng khách hàng / bảng dùng chung / bảng nhật ký phân vùng | loại bảng `tenant` / `shared` / `partitioned_log`; hàm dựng `tenantTable` / `sharedTable` / `partitionedLogTable` |
| Khuôn chính sách mẫu | chính sách `tenant_isolation` |
| Giao dịch có ngữ cảnh tenant / hệ thống / hỗ trợ | `tenantTx` / `systemTx` / `supportSearch`, `supportViewAccount` |
| Bảng mẫu (chỉ dev/test) | schema `sandbox`, bảng `sandbox.tenant_notes`, khung nhìn `sandbox.support_note_search`, `sandbox.support_note_detail` |
| Nhật ký migration | `infra.schema_migrations`, `infra.schema_migrations_dev` |
| Xung đột phiên bản | mã lỗi `VERSION_CONFLICT` |
| Kiểm tra quy ước CSDL | lệnh `pnpm db:check` |
