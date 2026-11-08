# Hợp đồng: giao diện lớp CSDL cho module (`core/db`)

Giao diện TypeScript mà module nghiệp vụ và hạ tầng dùng. Xuất qua `apps/server/src/core/index.ts`
(trừ mục 5). Đây là hợp đồng hành vi – chữ ký cụ thể có thể chỉnh nhỏ ở tasks miễn giữ hành vi.

## 1. Khai báo bảng

```ts
// Lấy đối tượng pgSchema; ném lỗi khi tên không có trong modules.manifest.json (hoặc 'sandbox' ở dev/test).
moduleSchema(name: string): PgSchema

tenantTable(schema, name, columns, extra?, opts?: {
  softDelete?: boolean;          // thêm deleted_at
  versioned?: boolean;           // thêm version
  indexExceptions?: Record<string, string>; // tên chỉ mục → lý do không bắt đầu bằng account_id
}): PgTable                      // + bộ cột chuẩn, FK cascade, chỉ mục (account_id), pgPolicy tenant_isolation

sharedTable(schema, name, columns, extra?, opts: { reason: string }): PgTable
partitionedLogTable(schema, name, columns, opts: { partitionBy: string }): PgTable // DDL viết tay

microUsd(name: string, opts?: { nonNegative?: boolean }): PgBigInt  // bigint mode 'bigint'
```

Quy tắc: tệp định nghĩa bảng của module nằm ở `modules/<m>/internal/db/schema.ts` (chỉ module đó nhập
được – quy tắc ranh giới của 001). Bảng phân vùng: `modules/<m>/internal/db/*.log-table.ts` (ngoài glob
drizzle-kit).

## 2. Giao dịch có ngữ cảnh

```ts
type Db = NodePgDatabase<…>;     // Drizzle gắn vào một PoolClient của giao dịch hiện tại

// Ngữ cảnh tenant. accountId lấy từ ExecutionContext hiện hành – KHÔNG có tham số accountId.
tenantTx<T>(fn: (db: Db) => Promise<T>): Promise<T>

// Việc dùng chung (bể `system`, chỉ Worker). forAccount lấy từ ExecutionContext nếu có
// (việc trong hàng chờ mang accountId), hoặc không có tenant.
systemTx<T>(fn: (db: Db) => Promise<T>, opts?: { tenant?: 'from-context' | 'none' }): Promise<T>

// Hỗ trợ (bể `support`, chỉ API). Mỗi lần gọi = một dòng infra.audit_log trong cùng giao dịch,
// ghi TRƯỚC khi chạy fn.
supportSearch<T>(
  actor: { staffId: string },
  keywordType: 'email' | 'post_id' | 'publish_attempt_id' | 'account_id' | string,
  fn: (db: Db) => Promise<T>,
): Promise<T>
supportViewAccount<T>(
  actor: { staffId: string },
  accountId: string,           // ngoại lệ có chủ đích – chỉ ở bể support, luôn kiểm toán
  reason: string,              // bắt buộc, ≥ 5 ký tự
  fn: (db: Db) => Promise<T>,
): Promise<T>

// Ngữ cảnh tenant hiện hành (FR-007) – nhật ký và module đọc được; null khi không có.
currentAccountId(): string | null
```

Hành vi bắt buộc:

| Tình huống | Kết quả |
|---|---|
| `tenantTx` khi ExecutionContext không có `accountId` | `TenantContextError` `TENANT_CONTEXT_MISSING` (mọi môi trường – lỗi lập trình) |
| `accountId` sai định dạng UUID | `TenantContextError` `TENANT_CONTEXT_INVALID`; không chạm CSDL |
| Tài khoản không tồn tại / không thấy qua chính sách | `TenantContextError` `TENANT_NOT_FOUND`; giao dịch hoàn tác |
| Lồng cùng vai trò + cùng tài khoản | dùng lại giao dịch ngoài (không `SAVEPOINT`) |
| Lồng khác tài khoản hoặc khác vai trò | `TenantContextError` `TENANT_CONTEXT_CONFLICT` |
| `fn` ném lỗi | `ROLLBACK`, ném lại lỗi gốc |
| Lỗi kết nối / `ROLLBACK` lỗi | kết nối bị hủy (`release(err)`), lỗi trả cho người gọi |
| Truy vấn bảng loại `tenant` trong giao dịch không tenant | dev/test: `TenantContextError` `TENANT_CONTEXT_MISSING` nêu `schema.table`; staging/production: `warn` `db.tenant_context_missing` + CSDL trả 0 dòng |
| Ghi dòng có `account_id` khác ngữ cảnh | CSDL từ chối (`42501` vi phạm chính sách) → `DbPolicyViolationError`, giao dịch hoàn tác |

`TenantContextError`, `DbPolicyViolationError` là lỗi lập trình: bộ lọc lỗi toàn cục trả
`INTERNAL_ERROR` (500) cho khách hàng, mã gốc ở `support.detail`; không bao giờ chứa SQL, tham số hay
chuỗi kết nối.

## 3. Ghi ngữ cảnh tenant vào ExecutionContext

`core/context` mở rộng ngữ cảnh của 001 thành `ExecutionContext { traceId, accountId?, source:
'request' | 'job' | 'system' }`. Chỉ hai nơi được đặt `accountId`:

```ts
bindAccountToRequest(accountId: string): void   // gọi bởi guard xác thực (WBS 2.1) – từ phiên đăng nhập
runWithJobContext<T>(ctx: { traceId; accountId? }, fn: () => Promise<T>): Promise<T> // queue (WBS 1.3)
```

Ranh giới (dependency-cruiser, thêm ở tính năng này): chỉ `core/auth/**` (sau này), `modules/queue/**`
và `test/**` được nhập hai hàm trên. Module nghiệp vụ không có đường đặt `accountId` → không thể lấy từ
tham số/thân yêu cầu (FR-004).

## 4. Khóa lạc quan

```ts
updateVersioned<T extends VersionedTable>(
  db: Db, table: T,
  key: { id: string; expectedVersion: number },
  values: Partial<InsertModel<T>>,
): Promise<SelectModel<T>>
// 0 dòng → AppError { code: 'VERSION_CONFLICT', httpStatus: 409,
//   message: 'Bài vừa được người khác sửa. Tải lại để xem bản mới nhất.',
//   actions: [{ kind: 'retry', label: 'Tải lại' }] }
```

## 5. Chỉ dành cho hạ tầng và kiểm thử (không xuất qua `core/index.ts`)

```ts
createDatabase(config, unit): DatabaseService   // tạo bể lười, tự kiểm vai trò (R7), đăng ký /readyz
DatabaseService.close(): Promise<void>          // gọi bởi ShutdownCoordinator
tableRegistry(): ReadonlyMap<string, TableRegistration>   // cho db:check
```

## 6. Mã lỗi mới

| Mã | HTTP | Lớp | Ghi chú |
|---|---|---|---|
| `VERSION_CONFLICT` | 409 | `AppError` | Thêm vào `ERROR_CODES` của `@app/shared` |
| `TENANT_CONTEXT_MISSING` / `TENANT_CONTEXT_INVALID` / `TENANT_CONTEXT_CONFLICT` / `TENANT_NOT_FOUND` | 500 | `TenantContextError` | Chỉ ở `support.detail` |
| `DB_POLICY_VIOLATION` | 500 | `DbPolicyViolationError` | Chỉ ở `support.detail` |
| `SERVICE_UNAVAILABLE` (đã có) | 503 | — | CSDL không kết nối được |
